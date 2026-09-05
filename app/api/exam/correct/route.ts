import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { checkAiRateLimit, extractAnthropicTokenUsage, getAiErrorCode, logAiUsageEvent, logAiUsageEventForPhotos } from '@/app/lib/aiUsage'
import { isOverloadedError, withAnthropicRetry } from '@/app/lib/ai/withAnthropicRetry'
import { isInternalUser } from '@/app/lib/internalUsers'
import { createRateLimitPayload, type RateLimitAction, BILLING_BLOCK_CODE, monthlyLimitResetNotice } from '@/app/lib/rateLimitMessages'
import { getUserBillingContext, getMonthlyActionCount, getMonthlyUniqueActionCount } from '@/app/lib/billing/serverUsage'
import { createServiceClient } from '@/app/lib/billing/supabase'
import { getCaminoPlanLimits } from '@/app/lib/camino/caminoPlanLimits'
import { getEffectivePlanLimits } from '@/app/lib/billing/limitOverrides'
import { buildBlockPrompt, normalizeCorrectionForOfficialScores, parseCorrectionJson } from '@/app/lib/correctionPrompt'
import { getTheoryContextForExercise, theoryContextToPrompt } from '@/app/lib/whyItWorksTheory'

// 55s SDK timeout leaves ~5s for the function to return a clean JSON error
// before Vercel's 60s maxDuration (Hobby plan ceiling) kills the process.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 55_000 })

export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'
// Simulacro's per-block budget (1800) is tuned for shorter blocks corrected in
// parallel; a single meaty exam exercise (e.g. a 3-variable Gauss system with
// verification + model answer + advice + theory) needs more room. Too tight a
// budget doesn't just truncate cleanly — it makes the model rush and blur field
// boundaries near the end (headers/content bleeding across JSON string values).
const MAX_TOKENS = 4000
const MAX_IMAGE_PAYLOAD_CHARS = 8_000_000

function examSystemLabel(comunidad: string) {
  return comunidad === 'Cataluña' ? 'PAU Catalunya' : 'EBAU Madrid'
}

// The general "¿Por qué es así?" explanation for a topic (idea clave, método,
// error típico, mini ejemplo) doesn't depend on which student or exercise
// triggered it — only the topic does. Caching it by (subject, blockSlug,
// topicSlug) skips asking the model to regenerate the same content every time,
// which was adding real output tokens/latency to every correction. Best-effort:
// a cache failure must never break the actual correction.
async function getCachedWhyExplanation(subject: string, blockSlug: string, topicSlug: string) {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('topic_why_cache')
      .select('porque_es_asi')
      .eq('subject', subject)
      .eq('block_slug', blockSlug)
      .eq('topic_slug', topicSlug)
      .maybeSingle()
    return data?.porque_es_asi ?? null
  } catch {
    return null
  }
}

async function cacheWhyExplanation(subject: string, blockSlug: string, topicSlug: string, porqueEsAsi: unknown) {
  try {
    const db = createServiceClient()
    await db
      .from('topic_why_cache')
      .upsert(
        { subject, block_slug: blockSlug, topic_slug: topicSlug, porque_es_asi: porqueEsAsi },
        { onConflict: 'subject,block_slug,topic_slug', ignoreDuplicates: true }
      )
  } catch (error) {
    console.error('[exam/correct] why_cache_write_failed', { message: (error as Error)?.message?.slice(0, 150) })
  }
}

type ExamCorrectBody = {
  subject?: unknown
  community?: unknown
  examLabel?: unknown
  option?: unknown
  maxScore?: unknown
  year?: unknown
  examCall?: unknown
  exerciseId?: unknown
  exerciseLabel?: unknown
  officialPrompt?: unknown
  criteria?: unknown
  sourceText?: unknown
  concepts?: unknown
  studentAnswer?: unknown
  imagen?: unknown
  imagenTipo?: unknown
  imagenes?: unknown
  creditKey?: unknown
}

export async function POST(request: NextRequest) {
  try {
    return await handlePost(request)
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorCode = (error as any)?.status ?? (error as any)?.code ?? 'unknown'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorName = (error as any)?.name ?? (error as any)?.constructor?.name ?? 'Error'
    console.error('EXAM_CORRECTION_ERROR', {
      errorCode,
      errorName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: (error as any)?.message?.slice(0, 200)
    })
    return NextResponse.json(
      { error: 'No hemos podido corregir este ejercicio ahora mismo. Inténtalo de nuevo en unos minutos.' },
      { status: 500 }
    )
  }
}

async function handlePost(request: NextRequest) {
  const totalStart = Date.now()
  const authContext = await getAuthContext(request)
  if ('response' in authContext) return authContext.response

  let body: ExamCorrectBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const subject = asString(body.subject) || 'Examen'
  const community = asString(body.community) || 'Madrid'
  const examLabel = asString(body.examLabel) || subject
  const option = asString(body.option)
  const maxScore = asNumber(body.maxScore) ?? 10
  const officialPrompt = asString(body.officialPrompt)
  const studentAnswer = asString(body.studentAnswer)
  const concepts = Array.isArray(body.concepts) ? body.concepts.filter((item): item is string => typeof item === 'string') : undefined
  const criteria = asString(body.criteria) || undefined
  const sourceText = asString(body.sourceText) || undefined

  if (!officialPrompt.trim()) {
    return NextResponse.json({ error: 'Falta el enunciado del ejercicio.' }, { status: 400 })
  }
  if (!studentAnswer.trim()) {
    return NextResponse.json({ error: 'Falta la respuesta del alumno.' }, { status: 400 })
  }

  // Legacy singular `imagen` still works (older clients / single-photo
  // callers); `imagenes` is the new multi-photo array. Both can combine —
  // the legacy field is just treated as photo #1 if present.
  const imagen = typeof body.imagen === 'string' && body.imagen.trim() ? body.imagen : null
  const imagenTipo = typeof body.imagenTipo === 'string' && body.imagenTipo.trim() ? body.imagenTipo : 'image/jpeg'
  const imagenes = Array.isArray(body.imagenes)
    ? body.imagenes
      .filter((item): item is { data: string; mediaType?: string } => Boolean(item && typeof (item as { data?: unknown }).data === 'string'))
      .map(item => ({ data: item.data, mediaType: typeof item.mediaType === 'string' && item.mediaType.trim() ? item.mediaType : 'image/jpeg' }))
    : []
  const allImages = [
    ...(imagen ? [{ data: imagen, mediaType: imagenTipo }] : []),
    ...imagenes,
  ]
  const imagePayloadChars = allImages.reduce((sum, img) => sum + img.data.length, 0)
  if (imagePayloadChars > MAX_IMAGE_PAYLOAD_CHARS) {
    return NextResponse.json({ error: 'Las imágenes son demasiado grandes en conjunto. Sube fotos más ligeras o menos páginas.' }, { status: 413 })
  }

  const action: RateLimitAction = allImages.length > 0 ? 'image_correction' : 'chat'
  const creditKey = typeof body.creditKey === 'string' && body.creditKey.trim() ? body.creditKey.trim().slice(0, 180) : null
  const metadata = {
    creditKey,
    subject,
    community,
    examLabel,
    option: option || null,
    year: body.year ?? null,
    examCall: asString(body.examCall) || null,
    exerciseId: asString(body.exerciseId) || null,
    exerciseLabel: asString(body.exerciseLabel) || null,
    hasImage: allImages.length > 0,
    imageCount: allImages.length,
    imagePayloadChars,
    promptChars: officialPrompt.length,
    answerChars: studentAnswer.length
  }

  const internalUser = isInternalUser(authContext.user.email)
  if (!internalUser) {
    // Comparte cupo con el chat general de Kairo (/api/chat): mismo action,
    // mismo route en checkAiRateLimit/logAiUsageEvent a propósito — ver nota
    // más abajo. Duplicar la ruta aquí crearía un cupo diario independiente.
    const limitResponse = await enforceUsageLimits({
      userId: authContext.user.id,
      userCreatedAt: authContext.user.created_at,
      email: authContext.user.email,
      action,
      creditKey,
      photoCount: allImages.length,
      accessToken: authContext.accessToken
    })
    if (limitResponse) return limitResponse
  }

  const theoryContext = getTheoryContextForExercise({
    subject,
    community,
    year: typeof body.year === 'number' || typeof body.year === 'string' ? body.year : undefined,
    examCall: asString(body.examCall) || undefined,
    exerciseId: asString(body.exerciseId) || undefined,
    exerciseLabel: asString(body.exerciseLabel) || undefined,
    exerciseText: officialPrompt,
    officialSolution: criteria,
    rubric: criteria,
    concepts
  })
  const combinedCriteria = [criteria, theoryContextToPrompt(theoryContext)].filter(Boolean).join('\n\n')

  // Only worth a cache lookup when a real topic was matched — fallbackReason
  // means the generic "no theory found" path, which has no stable topic key.
  const hasStableTopic = !theoryContext.fallbackReason && Boolean(theoryContext.blockSlug) && Boolean(theoryContext.topicSlug)
  const cachedWhy = hasStableTopic
    ? await getCachedWhyExplanation(subject, theoryContext.blockSlug, theoryContext.topicSlug)
    : null

  const prompt = buildBlockPrompt({
    block: {
      numeroBloque: 'Ejercicio',
      tema: examLabel,
      community,
      year: (body.year as number | string | undefined) ?? new Date().getFullYear(),
      convocatoria: asString(body.examCall) || 'Examen',
      option: option || 'Curso',
      maxScore,
      officialPrompt,
      criteria: combinedCriteria,
      sourceText,
      concepts,
      studentAnswer: allImages.length > 0
        ? `Respuesta manuscrita adjunta como ${allImages.length === 1 ? 'imagen' : `${allImages.length} imágenes — están en orden, léelas como páginas consecutivas de una misma respuesta`}. Texto adicional: ${studentAnswer}`
        : studentAnswer
    },
    blockIndex: 0,
    totalBlocks: 1,
    subject,
    community,
    includeWhyExplanation: !cachedWhy
  }) + `

Tienes espacio de sobra: prioriza una corrección completa y bien estructurada.
Nunca mezcles el contenido de un campo con el de otro ni escribas encabezados
Markdown (##, ###) dentro del valor de un campo — cada campo del JSON contiene
únicamente su propio contenido. Si un bloque LaTeX ocupa varias líneas dentro de
un valor de texto, escapa los saltos de línea correctamente para no romper el JSON.`

  const content: Anthropic.Messages.ContentBlockParam[] = []
  for (const img of allImages) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: sanitizeImageType(img.mediaType), data: img.data }
    })
  }
  content.push({ type: 'text', text: prompt })

  let message
  const llmStart = Date.now()
  try {
    message = await withAnthropicRetry(
      () => client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: `Eres Kairo, corrector experto de ${examSystemLabel(community)}. Devuelve exclusivamente JSON válido y completo. Sin texto fuera del JSON. No repitas el enunciado ni la respuesta del alumno, pero desarrolla el paso a paso con el detalle necesario para que el alumno aprenda: no lo recortes por brevedad. Cierra siempre el JSON correctamente con todas las claves, aunque eso signifique una respuesta larga.`,
        messages: [{ role: 'user', content }]
      }),
      (intento, status) => console.warn('[exam/correct] reintento por saturación', { intento, status })
    )
  } catch (error) {
    await logAiUsageEvent({
      userId: authContext.user.id,
      route: '/api/chat',
      action,
      model: MODEL,
      status: 'error',
      errorCode: getAiErrorCode(error),
      metadata,
      accessToken: authContext.accessToken
    })
    if (isOverloadedError(error)) {
      return NextResponse.json(
        {
          error: 'ai_overloaded',
          message: 'Hay mucha gente corrigiendo ahora mismo. Espera un minuto y vuelve a intentarlo — tu respuesta no se ha perdido.'
        },
        { status: 503, headers: { 'Retry-After': '60' } }
      )
    }
    throw error
  }

  const usage = extractAnthropicTokenUsage(message)
  console.info('[exam/correct] llm_done', { ms: Date.now() - llmStart, stopReason: message.stop_reason ?? 'unknown' })
  await logAiUsageEventForPhotos({
    userId: authContext.user.id,
    route: '/api/chat',
    action,
    model: MODEL,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    status: 'success',
    metadata: { ...metadata, truncated: message.stop_reason === 'max_tokens' },
    photoCount: allImages.length,
    accessToken: authContext.accessToken
  })

  const rawText = message.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  const parsed = parseCorrectionJson(rawText)
  if (!parsed) {
    console.error('[exam/correct] failed', { phase: 'parse', ms: Date.now() - totalStart, rawPreview: rawText.slice(0, 150) })
    return NextResponse.json(
      { error: 'No hemos podido formatear la corrección. Inténtalo de nuevo.' },
      { status: 502 }
    )
  }

  const normalized = normalizeCorrectionForOfficialScores(parsed, [maxScore])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON de corrección sin interfaz completa
  const block = (normalized as any)?.desglose_bloques?.[0]

  if (hasStableTopic && block) {
    if (cachedWhy) {
      // Cache hit: the model was told not to bother generating porqueEsAsi —
      // attach the cached explanation now.
      block.porqueEsAsi = cachedWhy
    } else if (block.porqueEsAsi && block.porqueEsAsi.status === 'generated') {
      // Cache miss: this is the first time this topic was seen, or the model
      // produced a usable explanation despite a prior miss — save it for next time.
      await cacheWhyExplanation(subject, theoryContext.blockSlug, theoryContext.topicSlug, block.porqueEsAsi)
    }
  }

  console.info('[exam/correct] done', { ms: Date.now() - totalStart, whyExplanationCacheHit: Boolean(cachedWhy) })

  if ((normalized as { notEvaluable?: boolean })?.notEvaluable) {
    console.warn('[exam/correct] not_evaluable', { ms: Date.now() - totalStart, hasImage: allImages.length > 0, imageCount: allImages.length })
  }

  return NextResponse.json({
    correction: normalized,
    notEvaluable: Boolean((normalized as { notEvaluable?: boolean })?.notEvaluable),
    whyContext: theoryContext,
    truncated: message.stop_reason === 'max_tokens',
    finishReason: message.stop_reason ?? 'unknown'
  })
}

async function getAuthContext(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return {
      response: NextResponse.json({ error: 'La autenticación no está configurada en el servidor.' }, { status: 500 })
    }
  }

  const accessToken = getBearerToken(request)
  if (!accessToken) {
    return {
      response: NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const authSupabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data, error } = await authSupabase.auth.getUser(accessToken)
  if (error || !data.user) {
    return {
      response: NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  return { user: data.user, accessToken }
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function enforceUsageLimits({
  userId,
  userCreatedAt,
  email,
  action,
  creditKey,
  photoCount,
  accessToken
}: {
  userId: string
  userCreatedAt: string
  email: string | undefined
  action: RateLimitAction
  creditKey: string | null
  photoCount: number
  accessToken: string
}) {
  const billing = await getUserBillingContext(userId, userCreatedAt, email)
  if (!billing.hasActivePack && billing.daysSince >= 7) {
    return NextResponse.json(
      { error: 'free_plan_expired', message: 'Tu prueba gratuita ha terminado.', code: BILLING_BLOCK_CODE },
      { status: 403 }
    )
  }

  const planLimits = await getEffectivePlanLimits(createServiceClient(), userId, getCaminoPlanLimits(billing.planId))
  if (action === 'image_correction') {
    const monthlyPhotos = creditKey
      ? await getMonthlyUniqueActionCount(userId, ['image_correction'])
      : await getMonthlyActionCount(userId, ['image_correction'])
    // Rejects up front if THIS submission's photos would push the student
    // over the limit (not just when already at/over it) — a 3-photo
    // submission with only 1 slot left must be blocked entirely, not let
    // through and silently under-charged.
    if (monthlyPhotos + Math.max(1, photoCount) > planLimits.photosPerMonth) {
      return NextResponse.json(
        { error: 'photo_limit_reached', message: `Has alcanzado el límite de ${planLimits.photosPerMonth} correcciones con foto este mes. ${monthlyLimitResetNotice()}`, code: BILLING_BLOCK_CODE },
        { status: 429 }
      )
    }
  } else {
    const monthlyCorrections = creditKey
      ? await getMonthlyUniqueActionCount(userId, ['chat'])
      : await getMonthlyActionCount(userId, ['chat'])
    if (monthlyCorrections >= planLimits.correctionsPerMonth) {
      return NextResponse.json(
        { error: 'correction_limit_reached', message: `Has alcanzado el límite de ${planLimits.correctionsPerMonth} correcciones este mes. ${monthlyLimitResetNotice()}`, code: BILLING_BLOCK_CODE },
        { status: 429 }
      )
    }
  }

  // route: '/api/chat' a propósito — checkAiRateLimit filtra por (userId, route,
  // action), y este endpoint sustituye al flujo de corrección que antes vivía en
  // /api/chat. Usar la ruta nueva aquí crearía un cupo diario independiente del
  // chat general y duplicaría el límite del usuario.
  const rateLimit = await checkAiRateLimit({
    userId,
    route: '/api/chat',
    action,
    limit: action === 'image_correction' ? 5 : 20,
    windowSeconds: 24 * 60 * 60,
    accessToken
  })

  if (!rateLimit.allowed) {
    return NextResponse.json(
      createRateLimitPayload(action, rateLimit),
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { 'Retry-After': String(rateLimit.retryAfterSeconds) } : undefined
      }
    )
  }

  return null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numeric) ? numeric : null
}

function sanitizeImageType(value: unknown): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (value === 'image/png' || value === 'image/gif' || value === 'image/webp') return value
  return 'image/jpeg'
}
