'use client'

import { useState } from 'react'
import { Camera, PenLine, UploadCloud, X } from 'lucide-react'
import { supabase } from '@/app/lib/supabase'
import { scoreFromCorrection } from '@/app/lib/correctionPrompt'
import { getApiErrorMessage } from '@/app/lib/rateLimitMessages'
import { compressImageToBase64 } from '@/app/lib/clientImageCompression'
import CorrectionResultCard from './CorrectionResultCard'
import RichTextArea from './RichTextArea'
import KairoLoadingDot from './KairoLoadingDot'
import MathMarkdown from './MathMarkdown'

export type RepeatExamSource = {
  id: string
  asignatura: string
  tipo?: string | null
  bloque?: string | null
  opcion?: string | null
  año?: number | null
  enunciado: string
  nota_maxima: number | null
}

// "Repetir para mejorar" para la vista de Historial de Exámenes: mismo
// enunciado exacto, nueva respuesta, corregido por el mismo /api/exam/correct
// que ya usa la página de Exámenes. Autocontenido a propósito — no toca el
// árbol de estado de la práctica normal de Exámenes (page-client.tsx es un
// monolito grande y delicado), solo inserta un intento nuevo en
// historial_examenes con repeated_from_id y deja que
// /api/camino/award-exam-xp decida el XP reducido leyendo esa misma fila.
export default function RepeatExamModal({ source, onClose, onDone }: {
  source: RepeatExamSource
  onClose: () => void
  onDone?: (result: { xpAwarded: number; bonusXp: number; nota: number | null; noImprovement: boolean }) => void
}) {
  const [modo, setModo] = useState<'texto' | 'imagen'>('texto')
  const [answer, setAnswer] = useState('')
  const [imagenes, setImagenes] = useState<Array<{ data: string; type: string; preview: string }>>([])
  const [imagenError, setImagenError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [correction, setCorrection] = useState<unknown>(null)
  const [nota, setNota] = useState<number | null>(null)
  const [xpMessage, setXpMessage] = useState('')
  const maxScore = source.nota_maxima ?? 10
  const canSubmit = modo === 'texto' ? Boolean(answer.trim()) : imagenes.length > 0

  async function handleImagen(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    // allSettled: una sola foto en formato no compatible (típicamente HEIC
    // de iPhone) no debe descartar las demás ya comprimidas del mismo lote.
    const results = await Promise.allSettled(files.map(async file => ({
      data: await compressImageToBase64(file),
      type: 'image/jpeg',
      preview: URL.createObjectURL(file),
    })))
    const succeeded = results.filter((r): r is PromiseFulfilledResult<{ data: string; type: string; preview: string }> => r.status === 'fulfilled').map(r => r.value)
    const failedCount = results.length - succeeded.length
    if (succeeded.length) setImagenes(current => [...current, ...succeeded])
    if (failedCount > 0) {
      console.error('[repeat-exam] image_compression_failed', { failedCount })
      setImagenError(`No hemos podido leer ${failedCount === 1 ? 'una foto' : `${failedCount} fotos`} (formato no compatible, p. ej. HEIC de iPhone). Prueba con la cámara del navegador o convierte a JPG/PNG.`)
    } else {
      setImagenError('')
    }
  }

  function removeImagen(index: number) {
    setImagenes(current => current.filter((img, i) => {
      if (i === index) URL.revokeObjectURL(img.preview)
      return i !== index
    }))
  }

  async function submit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) { setError('Tu sesión ha caducado. Vuelve a iniciar sesión.'); return }

      const res = await fetch('/api/exam/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          subject: source.asignatura,
          examLabel: source.bloque || source.asignatura,
          exerciseId: source.id,
          exerciseLabel: source.bloque || source.asignatura,
          maxScore,
          officialPrompt: source.enunciado,
          studentAnswer: modo === 'imagen'
            ? `Respuesta manuscrita adjunta como ${imagenes.length === 1 ? 'imagen' : `${imagenes.length} imágenes — están en orden, léelas como páginas consecutivas de una misma respuesta`}. Corrígela leyendo la(s) imagen(es) enviada(s).`
            : answer,
          imagen: modo === 'imagen' ? imagenes[0]?.data ?? null : null,
          imagenTipo: modo === 'imagen' ? imagenes[0]?.type ?? null : null,
          imagenes: modo === 'imagen' ? imagenes.slice(1).map(img => ({ data: img.data, mediaType: img.type })) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(getApiErrorMessage(data, 'No hemos podido corregir ahora mismo. Inténtalo de nuevo en unos minutos.'))
        return
      }
      // Antes esto pasaba data.respuesta (inexistente en la respuesta de
      // /api/exam/correct, que solo devuelve `correction`) a
      // normalizeCorrectionForOfficialScores, que caía en `data` entero
      // (el sobre {correction, notEvaluable, ...}, no la corrección real) y
      // sin desglose_bloques reconocible devolvía siempre nota_final: 0 —
      // "Repetir para mejorar" mostraba 0/10 pase lo que pase. El servidor
      // ya normaliza y marca notEvaluable, así que basta con leerlo.
      if (data.notEvaluable) {
        setError('No se pudo leer tu respuesta — error técnico, no un problema con tu trabajo. No se ha guardado como intento. Vuelve a intentarlo.')
        return
      }
      const correctionJson = data.correction ?? null
      const rawScore = correctionJson ? scoreFromCorrection(correctionJson, maxScore) : null
      setCorrection(correctionJson)
      setNota(rawScore)

      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      const { data: inserted } = await supabase.from('historial_examenes').insert({
        user_id: userData.user.id,
        asignatura: source.asignatura,
        tipo: source.tipo ?? 'Examen',
        año: source.año ?? new Date().getFullYear(),
        bloque: source.bloque ?? null,
        opcion: source.opcion ?? null,
        nota: rawScore,
        nota_maxima: maxScore,
        enunciado: source.enunciado.slice(0, 2000),
        respuesta: modo === 'imagen' ? `Respuesta manuscrita adjunta (${imagenes.length} imagen${imagenes.length === 1 ? '' : 'es'}).` : answer.slice(0, 4000),
        correccion: JSON.stringify(correctionJson),
        repeated_from_id: source.id,
      }).select('id').single()

      if (inserted?.id) {
        try {
          const xpRes = await fetch('/api/camino/award-exam-xp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ historialExamenId: inserted.id }),
          })
          const xpJson = await xpRes.json()
          // Con el nuevo sistema de XP, repetir sin mejorar ya no da 0 XP
          // (se queda con el XP reducido de repetición de siempre) — xpJson
          // .improved (no xpAwarded > 0, casi siempre true ahora) es lo que
          // distingue si hubo bonus de mejora de verdad.
          if (xpJson.success && typeof xpJson.xpAwarded === 'number' && xpJson.xpAwarded > 0) {
            setXpMessage(xpJson.improved
              ? `+${xpJson.xpAwarded} XP${xpJson.bonusXp > 0 ? ` · +${xpJson.bonusXp} bonus por mejora` : ''} — ¡nota mejorada!`
              : `+${xpJson.xpAwarded} XP. No has mejorado tu mejor nota anterior, así que sin bonus extra esta vez.`)
            onDone?.({ xpAwarded: xpJson.xpAwarded, bonusXp: xpJson.bonusXp ?? 0, nota: rawScore, noImprovement: !xpJson.improved })
          } else {
            setXpMessage('No has mejorado tu mejor nota anterior, así que no hay XP extra esta vez.')
            onDone?.({ xpAwarded: 0, bonusXp: 0, nota: rawScore, noImprovement: true })
          }
        } catch { /* silent */ }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.4)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto', borderRadius: 20, background: 'white', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', color: '#2563eb' }}>Repetir para mejorar</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{source.bloque || source.asignatura}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: '#f1f5f9', borderRadius: 8, padding: 6, cursor: 'pointer' }}><X size={15} /></button>
        </div>

        <div style={{ borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc', padding: '12px 14px', marginBottom: 14 }}>
          <MathMarkdown text={source.enunciado} className="text-[13px] text-slate-700" />
        </div>

        {!correction ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setModo('texto')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 900, cursor: 'pointer', border: 'none', background: modo === 'texto' ? '#0f172a' : '#f1f5f9', color: modo === 'texto' ? 'white' : '#64748b' }}
              >
                <PenLine size={13} /> Escribir
              </button>
              <button
                type="button"
                onClick={() => setModo('imagen')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 900, cursor: 'pointer', border: 'none', background: modo === 'imagen' ? '#0f172a' : '#f1f5f9', color: modo === 'imagen' ? 'white' : '#64748b' }}
              >
                <Camera size={13} /> Subir foto
              </button>
            </div>

            {modo === 'texto' ? (
              <RichTextArea
                value={answer}
                onChange={setAnswer}
                placeholder="Escribe tu nueva respuesta..."
                minHeight={200}
              />
            ) : (
              <div>
                <input type="file" accept="image/*" multiple capture="environment" onChange={handleImagen} style={{ display: 'none' }} id="repeat-exam-image-input" />
                {imagenes.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 10 }}>
                    {imagenes.map((img, index) => (
                      <div key={`${img.preview}-${index}`} style={{ position: 'relative' }}>
                        <img src={img.preview} alt={`Página ${index + 1}`} loading="lazy" decoding="async" style={{ height: 100, width: '100%', objectFit: 'cover', borderRadius: 10, border: '1.5px solid #dbe7fb' }} />
                        <span style={{ position: 'absolute', bottom: 4, left: 4, borderRadius: 6, background: 'rgba(15,23,42,0.75)', color: 'white', fontSize: 10, fontWeight: 900, padding: '1px 6px' }}>{index + 1}</span>
                        <button onClick={() => removeImagen(index)} type="button" aria-label={`Quitar página ${index + 1}`} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <label htmlFor="repeat-exam-image-input" style={{ height: imagenes.length > 0 ? 80 : 160, borderRadius: 10, border: '2px dashed #93c5fd', background: '#eff6ff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <UploadCloud size={imagenes.length > 0 ? 20 : 30} color="#2563eb" />
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', margin: '8px 0 3px' }}>{imagenes.length > 0 ? 'Añadir otra página' : 'Haz una foto o sube una imagen'}</p>
                  {imagenes.length === 0 && <p style={{ fontSize: 11, color: '#60a5fa', margin: 0 }}>Fotografía tu respuesta manuscrita</p>}
                </label>
                {imagenes.length > 1 && (
                  <p style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: '#64748b' }}>Se corrigen juntas como páginas consecutivas de una misma respuesta.</p>
                )}
                {imagenError && <p style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{imagenError}</p>}
              </div>
            )}
            {error && (
              <div style={{ marginTop: 10 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{error}</p>
                <a
                  href="mailto:hola@kairo.es?subject=Problema%20t%C3%A9cnico%20%E2%80%94%20Kairo"
                  style={{ display: 'inline-block', marginTop: 6, fontSize: 11.5, fontWeight: 700, color: '#475569' }}
                >
                  Reportar error →
                </a>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white', fontSize: 13, fontWeight: 800, color: '#475569', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={submit} disabled={!canSubmit || submitting} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, border: 'none', background: '#2563eb', fontSize: 13, fontWeight: 800, color: 'white', cursor: submitting ? 'default' : 'pointer', opacity: !canSubmit || submitting ? .6 : 1 }}>
                {submitting ? (<><KairoLoadingDot /> Corrigiendo…</>) : 'Corregir'}
              </button>
            </div>
          </>
        ) : (
          <>
            {nota != null && (
              <div style={{ marginBottom: 10, fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{nota}/{maxScore}</div>
            )}
            {xpMessage && (
              <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 10, background: '#f5f3ff', color: '#6d28d9', fontSize: 12, fontWeight: 800 }}>{xpMessage}</div>
            )}
            <CorrectionResultCard correction={correction} officialMaxScore={maxScore} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: '#0f172a', fontSize: 13, fontWeight: 800, color: 'white', cursor: 'pointer' }}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
