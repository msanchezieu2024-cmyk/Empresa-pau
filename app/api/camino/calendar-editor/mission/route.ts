import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/app/lib/billing/supabase'
import { getAuthContext } from '@/app/lib/camino/caminoProgressServer'
import { normalizeSubjectSlug, sanitizeLessonTitle } from '@/app/lib/camino/caminoCurriculumPlan'
import { getAvailabilityForDate, hasTimeConflict } from '@/app/lib/calendar/availability'
import { deleteKairoMission, syncExistingKairoMissionToGoogle, syncKairoMissionsToGoogle } from '@/app/lib/calendar/sync'
import { DEFAULT_MISSION_DURATION_MINUTES } from '@/app/lib/camino/calendarEditorConfig'

export const dynamic = 'force-dynamic'

const MINUTES_PER_DAY = 24 * 60

function cleanString(value: unknown, max = 220) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(numberValue)))
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeTime(value: unknown) {
  const raw = cleanString(value, 8)
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/)
  return match ? `${match[1]}:${match[2]}` : null
}

function addMinutesToTime(startTime: string | null, durationMinutes: number) {
  if (!startTime) return null
  const [hours, minutes] = startTime.split(':').map(Number)
  const startTotal = hours * 60 + minutes
  const endTotal = startTotal + durationMinutes
  if (endTotal > MINUTES_PER_DAY) return null
  const endHours = Math.floor(endTotal / 60)
  const endMinutes = endTotal % 60
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number)
  return hours * 60 + minutes
}

function findNextFreeStart(startTime: string, durationMinutes: number, busy: { start: string; end: string }[]) {
  for (let cursor = Math.ceil(minutesFromTime(startTime) / 15) * 15; cursor + durationMinutes <= MINUTES_PER_DAY; cursor += 15) {
    const start = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`
    const end = addMinutesToTime(start, durationMinutes)
    if (end && !busy.some(slot => hasTimeConflict({ start, end }, slot))) return start
  }
  return null
}

function dbMissionTypeFromKind(kind: string, missionType: string) {
  if (['concept', 'review', 'comment_text', 'pau_practice', 'partial_practice'].includes(missionType)) return missionType
  if (kind === 'evau_practice' || kind === 'mock_exam') return 'pau_practice'
  if (kind === 'guided_example' || kind === 'guided_practice' || kind === 'exam_focus') return 'review'
  return 'concept'
}

function stableManualSortOrder(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return -1 * (Math.abs(hash) % 1_000_000_000 || 1)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request)
    if ('response' in auth) return auth.response

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* ok */ }

    const scheduledDate = cleanString(body.scheduledDate, 20)
    if (!isIsoDate(scheduledDate)) {
      return NextResponse.json({ error: 'scheduled_date_invalid' }, { status: 400 })
    }

    const subject = normalizeSubjectSlug(cleanString(body.subject, 80))
    if (!subject) {
      return NextResponse.json({ error: 'subject_required' }, { status: 400 })
    }

    const title = sanitizeLessonTitle(cleanString(body.title, 220))
    if (!title) {
      return NextResponse.json({ error: 'title_required' }, { status: 400 })
    }

    const durationMinutes = cleanNumber(body.estimatedMinutes, DEFAULT_MISSION_DURATION_MINUTES, 5, 180)
    const requestedStartTime = normalizeTime(body.startTime)
    const requestedEndTime = addMinutesToTime(requestedStartTime, durationMinutes)
    if (requestedStartTime && !requestedEndTime) {
      return NextResponse.json({ error: 'end_time_after_midnight' }, { status: 400 })
    }
    const startTime = requestedStartTime
    const endTime = requestedEndTime
    const role = cleanString(body.role, 20) === 'bonus' ? 'bonus' : 'main'
    const kind = cleanString(body.kind, 80)
    const missionType = dbMissionTypeFromKind(kind, cleanString(body.missionType, 80))
    const blockKey = cleanString(body.blockKey, 160) || null
    const blockSlug = cleanString(body.blockSlug, 160) || null
    const topicSlug = cleanString(body.topicSlug, 160) || null
    const requestKey = cleanString(body.requestKey, 260) || `${scheduledDate}:${subject}:${missionType}:${title}:${startTime ?? 'no-time'}:${role}`
    const v2SortOrder = typeof body.v2SortOrder === 'number'
      ? body.v2SortOrder
      : stableManualSortOrder(`calendar_editor:${requestKey}`)
    const db = createServiceClient()
    const selectColumns = 'id, scheduled_date, subject, title, block_key, block_slug, mission_type, is_main, is_bonus, status, v2_sort_order, xp_awarded, start_time, end_time, metadata'
    const { data: existing, error: existingError } = await db
      .from('camino_calendar')
      .select(selectColumns)
      .eq('user_id', auth.user.id)
      .eq('scheduled_date', scheduledDate)
      .eq('subject', subject)
      .eq('v2_sort_order', v2SortOrder)
      .maybeSingle()

    if (existingError) throw existingError

    if (existing?.id) {
      let calendarSync = existing.start_time && existing.end_time ? 'pending' : 'pending_no_time'
      if (existing.start_time && existing.end_time) {
        try {
          const result = await syncExistingKairoMissionToGoogle(auth.user.id, existing.id, db)
          calendarSync = result.updated ? 'synced' : result.reason
        } catch (error) {
          console.warn('[camino/calendar-editor/mission] duplicate google retry failed', error)
          calendarSync = 'error'
        }
      }
      return NextResponse.json({ ok: true, duplicate: true, mission: existing, calendarSync })
    }

    const { data: sameDayRows, error: sameDayError } = requestedStartTime && requestedEndTime
      ? await db
        .from('camino_calendar')
        .select('id, start_time, end_time')
        .eq('user_id', auth.user.id)
        .eq('scheduled_date', scheduledDate)
        .eq('status', 'pending')
        .not('start_time', 'is', null)
        .not('end_time', 'is', null)
      : { data: [], error: null }
    if (sameDayError) throw sameDayError
    const kairoBusy = ((sameDayRows ?? []) as { start_time: string | null; end_time: string | null }[])
      .flatMap(row => row.start_time && row.end_time ? [{ start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) }] : [])
    const externalBusy = requestedStartTime && requestedEndTime
      ? await getAvailabilityForDate(auth.user.id, scheduledDate)
      : []
    if (requestedStartTime && requestedEndTime) {
      const requestedSlot = { start: requestedStartTime, end: requestedEndTime }
      const kairoConflict = kairoBusy.some(slot => hasTimeConflict(requestedSlot, slot))
      const externalConflict = externalBusy.some(slot => hasTimeConflict(requestedSlot, slot))
      if (kairoConflict || externalConflict) {
        return NextResponse.json({
          ok: false,
          code: 'TIME_CONFLICT',
          conflictType: kairoConflict ? 'kairo' : 'external',
          suggestedStart: findNextFreeStart(requestedStartTime, durationMinutes, [...kairoBusy, ...externalBusy]),
        }, { status: 409 })
      }
    }

    const metadata = {
      ...(typeof body.metadata === 'object' && body.metadata ? body.metadata : {}),
      manual_editor: true,
      request_key: requestKey,
      estimated_minutes: durationMinutes,
      topic_slug: topicSlug || undefined,
      start_time: startTime || undefined,
      end_time: endTime || undefined,
      calendar_sync_status: startTime && endTime ? 'pending' : 'pending_no_time',
    }

    const { data: inserted, error: insertError } = await db
      .from('camino_calendar')
      .insert({
        user_id: auth.user.id,
        scheduled_date: scheduledDate,
        subject,
        v2_sort_order: v2SortOrder,
        title,
        block_key: blockKey,
        block_slug: blockSlug,
        mission_type: missionType,
        is_main: role === 'main',
        is_bonus: role !== 'main',
        status: 'pending',
        locked: true,
        source: 'manual',
        generated_by: 'calendar_editor',
        start_time: startTime,
        end_time: endTime,
        metadata,
      })
      .select(selectColumns)
      .single()

    if (insertError) throw insertError

    const { data: verified, error: verifyError } = await db
      .from('camino_calendar')
      .select(selectColumns)
      .eq('id', inserted.id)
      .eq('user_id', auth.user.id)
      .single()

    if (verifyError) throw verifyError

    let calendarSync = startTime && endTime ? 'pending' : 'pending_no_time'
    if (startTime && endTime) {
      try {
        const result = await syncKairoMissionsToGoogle(auth.user.id, db)
        calendarSync = (result.failed ?? 0) > 0 ? 'error' : 'synced'
      } catch (error) {
        console.warn('[camino/calendar-editor/mission] google sync skipped', error)
        await db
          .from('camino_calendar')
          .update({ metadata: { ...metadata, calendar_sync_status: 'error' } })
          .eq('id', verified.id)
          .eq('user_id', auth.user.id)
        calendarSync = 'error'
      }
    }

    return NextResponse.json({
      ok: true,
      duplicate: false,
      mission: verified,
      calendarSync,
    })
  } catch (error) {
    console.error('[camino/calendar-editor/mission]', error)
    return NextResponse.json({ error: 'No se pudo guardar la misión.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthContext(request)
    if ('response' in auth) return auth.response

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* handled below */ }
    const missionId = cleanString(body.missionId, 80)
    if (!missionId) return NextResponse.json({ error: 'mission_id_required' }, { status: 400 })

    const result = await deleteKairoMission(auth.user.id, missionId)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[camino/calendar-editor/mission/delete]', error)
    return NextResponse.json({ error: 'No se pudo eliminar la misión. Reintentar.' }, { status: 502 })
  }
}
