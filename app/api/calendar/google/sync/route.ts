import { NextRequest, NextResponse } from 'next/server'

import { getAuthContext } from '@/app/lib/camino/caminoProgressServer'
import { syncGoogleChangesForUser, syncKairoMissionsToGoogle } from '@/app/lib/calendar/sync'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request)
  if ('response' in auth) return auth.response
  try {
    const pulled = await syncGoogleChangesForUser(auth.user.id)
    const pushed = await syncKairoMissionsToGoogle(auth.user.id)
    if ((pushed.failed ?? 0) > 0) {
      return NextResponse.json({ ok: false, error: 'No se pudo sincronizar Google Calendar. Reintentar.', ...pulled, ...pushed }, { status: 502 })
    }
    return NextResponse.json({ ok: true, ...pulled, ...pushed })
  } catch (error) {
    console.error('[calendar/google/sync]', error)
    return NextResponse.json({ error: 'No se pudo sincronizar Google Calendar.' }, { status: 500 })
  }
}
