'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CalendarDays, Check, ChevronDown, Link2, Loader2, X } from 'lucide-react'
import { supabase } from '@/app/lib/supabase'

type CalendarStatus =
  | { connected: false; error?: string }
  | { connected: true; accountEmail: string | null; calendarId: string | null; calendarSummary: string | null; lastSyncedAt: string | null; watchExpiration: string | null }

export default function GoogleCalendarConnection() {
  const [status, setStatus] = useState<CalendarStatus>({ connected: false })
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [statusError, setStatusError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const getToken = useCallback(async () => {
    const session = await supabase.auth.getSession()
    return session.data.session?.access_token ?? null
  }, [])

  const refreshStatus = useCallback(async (token?: string | null) => {
    const accessToken = token ?? await getToken()
    if (!accessToken) return
    try {
      const res = await fetch('/api/calendar/google/status', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) throw new Error('status_failed')
      setStatus(await res.json() as CalendarStatus)
      setStatusError(false)
    } catch {
      setStatusError(true)
    }
  }, [getToken])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStatus()
      const params = new URLSearchParams(window.location.search)
      const calendarResult = params.get('calendar')
      if (calendarResult === 'connected') setMessage('Google Calendar conectado')
      if (calendarResult === 'cancelled') setMessage('Conexión cancelada')
      if (calendarResult === 'error') setMessage('No se ha podido conectar. Reintentar')
      if (calendarResult) {
        params.delete('calendar')
        const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`
        window.history.replaceState({}, '', next)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshStatus])

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  async function connect() {
    setLoading(true)
    setMessage('')
    try {
      const token = await getToken()
      if (!token) throw new Error('no_session')
      const res = await fetch('/api/calendar/google/connect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json() as { url?: string }
      if (!res.ok || !json.url) throw new Error('connect_failed')
      window.location.href = json.url
    } catch {
      setMessage('No se ha podido conectar. Reintentar')
      setLoading(false)
    }
  }

  async function disconnect() {
    setLoading(true)
    setMessage('')
    try {
      const token = await getToken()
      if (!token) throw new Error('no_session')
      const confirmed = window.confirm('¿Desconectar Google Calendar? Tus misiones de Kairo no se borrarán.')
      if (!confirmed) { setLoading(false); return }
      const res = await fetch('/api/calendar/google/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('disconnect_failed')
      setStatus({ connected: false })
      setMenuOpen(false)
      setMessage('')
    } catch {
      setMessage('No se ha podido desconectar.')
    } finally {
      setLoading(false)
    }
  }

  const buttonBase: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 800,
    padding: '8px 12px',
    borderRadius: 10,
    cursor: loading ? 'default' : 'pointer',
    border: '1px solid #e2e8f0',
    background: 'white',
    color: status.connected ? '#15803d' : '#334155',
    transition: 'all .15s',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    opacity: loading ? 0.72 : 1,
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {status.connected ? (
        <button type="button" onClick={() => setMenuOpen(v => !v)} disabled={loading} style={buttonBase}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Google Calendar
          <ChevronDown size={12} />
        </button>
      ) : (
        <button type="button" onClick={connect} disabled={loading} style={buttonBase}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
          Conectar Google Calendar
        </button>
      )}

      {menuOpen && status.connected && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 60, width: 220, borderRadius: 12, border: '1px solid #e2e8f0', background: 'white', boxShadow: '0 18px 44px rgba(15,23,42,.16)', padding: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #f1f5f9', marginBottom: 4 }}>
            <CalendarDays size={15} color="#16a34a" />
            <span style={{ minWidth: 0, fontSize: 11, fontWeight: 800, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {status.accountEmail ?? 'Conectado'}
            </span>
          </div>
          <button type="button" onClick={disconnect} disabled={loading} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 8, border: 'none', background: 'white', color: '#dc2626', fontSize: 12, fontWeight: 800, cursor: loading ? 'default' : 'pointer', textAlign: 'left' }}>
            <X size={14} /> Desconectar
          </button>
        </div>
      )}

      {message && (
        <span style={{ fontSize: 11, fontWeight: 750, color: message.startsWith('No') ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
          {message}
        </span>
      )}
      {statusError && (
        <button type="button" onClick={() => void refreshStatus()} style={{ border: 0, background: 'transparent', color: '#dc2626', fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
          No se pudo comprobar Google Calendar · Reintentar
        </button>
      )}
    </div>
  )
}
