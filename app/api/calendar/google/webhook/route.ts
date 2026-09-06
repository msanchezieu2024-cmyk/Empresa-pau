import { NextRequest, NextResponse } from 'next/server'

import { findConnectionByGoogleChannel, syncGoogleChangesForConnection } from '@/app/lib/calendar/sync'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id')
  const resourceId = request.headers.get('x-goog-resource-id')
  try {
    const found = await findConnectionByGoogleChannel(channelId, resourceId)
    if (!found?.connection) return new NextResponse(null, { status: 204 })
    await syncGoogleChangesForConnection(found.connection.id, found.db)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[calendar/google/webhook]', error)
    return new NextResponse(null, { status: 503 })
  }
}
