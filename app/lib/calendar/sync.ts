import 'server-only'

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceClient } from '@/app/lib/billing/supabase'
import { subjectLabelFromSlug } from '@/app/lib/camino/caminoCurriculumPlan'
import { decryptToken, encryptToken } from './tokenCrypto'
import { CalendarEventNotFoundError, CalendarProviderError, CalendarSyncGoneError, type CalendarEvent, type CalendarEventInput, type CalendarProvider } from './types'
import { GoogleCalendarProvider, refreshGoogleToken } from './google'

const APP_CALENDAR_SUMMARY = 'Kairo – Estudio'
const MADRID_TZ = 'Europe/Madrid'
const WATCH_RENEWAL_WINDOW_MS = 36 * 60 * 60 * 1000

type CalendarConnection = {
  id: string
  user_id: string
  provider: 'google'
  provider_account_email: string | null
  external_calendar_id: string | null
  external_calendar_summary: string | null
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  sync_token: string | null
  sync_enabled: boolean
  google_channel_id: string | null
  google_resource_id: string | null
  google_channel_expiration: string | null
  last_synced_at: string | null
}

type CaminoMissionRow = {
  id: string
  user_id: string
  scheduled_date: string
  subject: string
  title: string | null
  block_key: string | null
  block_slug: string | null
  mission_type: string
  status: string
  start_time: string | null
  end_time: string | null
  updated_at: string | null
  metadata: Record<string, unknown> | null
}

type CalendarEventLink = {
  id: string
  user_id: string
  entity_type: string
  entity_id: string
  provider: 'google'
  external_calendar_id: string
  external_event_id: string
  external_etag: string | null
  last_local_update: string | null
  last_external_update: string | null
  last_sync_source: string
  sync_status: string
}

function nowISO() {
  return new Date().toISOString()
}

function localDateTime(date: string, time: string) {
  const t = time.slice(0, 5)
  return `${date}T${t}:00`
}

function stableGoogleEventId(missionId: string) {
  return `kairo${missionId.toLowerCase().replace(/[^0-9a-v]/g, '')}`.slice(0, 1024)
}

function timeFromDateTime(value: string | undefined | null) {
  if (!value) return null
  const match = value.match(/T(\d{2}:\d{2})/)
  return match ? `${match[1]}:00` : null
}

function dateFromEvent(event: CalendarEvent) {
  return event.start.date ?? event.start.dateTime?.slice(0, 10) ?? null
}

function mergeMetadata(current: Record<string, unknown> | null | undefined, patch: Record<string, unknown>) {
  return { ...(current ?? {}), ...patch }
}

async function getConnection(db: SupabaseClient, userId: string): Promise<CalendarConnection | null> {
  const { data, error } = await db
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle()
  if (error) throw error
  return data as CalendarConnection | null
}

export async function getCalendarConnectionStatus(userId: string) {
  const db = createServiceClient()
  const connection = await getConnection(db, userId)
  if (!connection || !connection.sync_enabled) return { connected: false as const }
  return {
    connected: true as const,
    accountEmail: connection.provider_account_email,
    calendarId: connection.external_calendar_id,
    calendarSummary: connection.external_calendar_summary ?? APP_CALENDAR_SUMMARY,
    lastSyncedAt: connection.last_synced_at,
    watchExpiration: connection.google_channel_expiration,
  }
}

async function providerForConnection(db: SupabaseClient, connection: CalendarConnection) {
  const refreshToken = decryptToken(connection.refresh_token)
  let accessToken = decryptToken(connection.access_token)
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
  if (!accessToken || Date.now() > expiresAt - 60_000) {
    accessToken = await refreshConnectionAccessToken(db, connection, refreshToken)
  }
  return new GoogleCalendarProvider(
    accessToken,
    () => refreshConnectionAccessToken(db, connection, refreshToken),
  )
}

async function refreshConnectionAccessToken(db: SupabaseClient, connection: CalendarConnection, refreshToken = decryptToken(connection.refresh_token)) {
  if (!refreshToken) throw new Error('Google Calendar necesita volver a conectarse')
  const refreshed = await refreshGoogleToken(refreshToken)
  const { error } = await db.from('calendar_connections').update({
    access_token: encryptToken(refreshed.access_token),
    token_expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
  }).eq('id', connection.id)
  if (error) throw error
  return refreshed.access_token
}

async function ensureExternalCalendar(db: SupabaseClient, connection: CalendarConnection) {
  const provider = await providerForConnection(db, connection)
  if (connection.external_calendar_id) {
    const existing = await provider.getCalendar(connection.external_calendar_id)
    if (existing) return { provider, calendarId: existing.id, summary: existing.summary ?? APP_CALENDAR_SUMMARY }
  }
  const created = await provider.createCalendar(APP_CALENDAR_SUMMARY, MADRID_TZ)
  await db.from('calendar_connections').update({
    external_calendar_id: created.id,
    external_calendar_summary: created.summary ?? APP_CALENDAR_SUMMARY,
  }).eq('id', connection.id)
  return { provider, calendarId: created.id, summary: created.summary ?? APP_CALENDAR_SUMMARY }
}

function eventFromMission(mission: CaminoMissionRow): CalendarEventInput | null {
  if (!mission.start_time || !mission.end_time) return null
  const title = mission.title?.trim() || 'Mision de Kairo'
  const start = localDateTime(mission.scheduled_date, mission.start_time)
  const end = localDateTime(mission.scheduled_date, mission.end_time)
  return {
    id: stableGoogleEventId(mission.id),
    summary: `Kairo: ${title}`,
    description: [
      'Mision de Camino PAU sincronizada desde Kairo.',
      `Asignatura: ${subjectLabelFromSlug(mission.subject)}`,
      mission.block_key ? `Bloque: ${mission.block_key}` : null,
      'Edita hora o fecha si lo necesitas; Kairo intentara reflejarlo.',
    ].filter(Boolean).join('\n'),
    start: { dateTime: start, timeZone: MADRID_TZ },
    end: { dateTime: end, timeZone: MADRID_TZ },
    extendedProperties: {
      private: {
        kairoEntityType: 'mission',
        kairoEntityId: mission.id,
        kairoUserId: mission.user_id,
      },
    },
  }
}

export async function upsertCalendarConnection(params: {
  userId: string
  accountEmail: string | null
  accessToken: string
  refreshToken?: string | null
  expiresIn?: number
}) {
  const db = createServiceClient()
  const expiresAt = new Date(Date.now() + (params.expiresIn ?? 3600) * 1000).toISOString()
  const existing = await getConnection(db, params.userId)
  const payload = {
    user_id: params.userId,
    provider: 'google',
    provider_account_email: params.accountEmail,
    access_token: encryptToken(params.accessToken),
    refresh_token: encryptToken(params.refreshToken ?? decryptToken(existing?.refresh_token)),
    token_expires_at: expiresAt,
    sync_enabled: true,
  }
  const { data, error } = await db
    .from('calendar_connections')
    .upsert(payload, { onConflict: 'user_id,provider' })
    .select('*')
    .single()
  if (error) throw error
  const connection = data as CalendarConnection
  await ensureExternalCalendar(db, connection)
  const refreshed = await getConnection(db, params.userId)
  if (refreshed) {
    await syncKairoMissionsToGoogle(params.userId, db)
    await startGoogleWatch(params.userId, db).catch(error => console.warn('[calendar] watch not started:', error))
  }
  return refreshed
}

export async function syncKairoMissionsToGoogle(userId: string, db = createServiceClient()) {
  const connection = await getConnection(db, userId)
  if (!connection || !connection.sync_enabled) return { pushed: 0 }
  const { provider, calendarId } = await ensureExternalCalendar(db, connection)
  const { data } = await db
    .from('camino_calendar')
    .select('id, user_id, scheduled_date, subject, title, block_key, block_slug, mission_type, status, start_time, end_time, updated_at, metadata')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('scheduled_date', new Date().toLocaleDateString('sv-SE', { timeZone: MADRID_TZ }))
    .order('scheduled_date', { ascending: true })
    .limit(90)
  const missions = (data ?? []) as CaminoMissionRow[]
  let pushed = 0
  let skippedNoTime = 0
  let failed = 0
  for (const mission of missions) {
    const { data: linkData } = await db
      .from('calendar_event_links')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .eq('entity_type', 'mission')
      .eq('entity_id', mission.id)
      .maybeSingle()
    const link = linkData as CalendarEventLink | null
    const eventInput = eventFromMission(mission)
    if (!eventInput) {
      try {
        if (link?.external_event_id) {
          await provider.deleteEvent(link.external_calendar_id, link.external_event_id)
          const { error: deleteLinkError } = await db.from('calendar_event_links').delete().eq('id', link.id)
          if (deleteLinkError) throw deleteLinkError
        }
        skippedNoTime++
        await db.from('camino_calendar').update({
          metadata: mergeMetadata(mission.metadata, { calendar_synced: false, calendar_sync_status: 'pending_no_time' }),
        }).eq('id', mission.id).eq('user_id', userId)
      } catch (error) {
        failed++
        await db.from('camino_calendar').update({
          metadata: mergeMetadata(mission.metadata, { calendar_synced: false, calendar_sync_status: 'error' }),
        }).eq('id', mission.id).eq('user_id', userId)
        console.warn('[calendar] unscheduled mission cleanup failed:', error)
      }
      continue
    }
    try {
      let event: CalendarEvent
      if (link?.external_event_id) {
        try {
          event = await provider.updateEvent(link.external_calendar_id, link.external_event_id, eventInput)
        } catch (error) {
          if (!(error instanceof CalendarEventNotFoundError)) throw error
          event = await createOrRecoverMissionEvent(provider, calendarId, eventInput)
        }
      } else {
        event = await createOrRecoverMissionEvent(provider, calendarId, eventInput)
      }
      const { error: linkError } = await db.from('calendar_event_links').upsert({
        user_id: userId,
        entity_type: 'mission',
        entity_id: mission.id,
        provider: 'google',
        external_calendar_id: calendarId,
        external_event_id: event.id,
        external_etag: event.etag ?? null,
        last_local_update: mission.updated_at ?? nowISO(),
        last_external_update: event.updated ?? nowISO(),
        last_sync_source: 'kairo',
        last_synced_at: nowISO(),
        sync_status: 'synced',
      }, { onConflict: 'user_id,entity_type,entity_id,provider' })
      if (linkError) throw linkError
      await db.from('camino_calendar').update({
        metadata: mergeMetadata(mission.metadata, { calendar_synced: true, calendar_sync_status: 'synced' }),
        updated_at: mission.updated_at ?? nowISO(),
      }).eq('id', mission.id).eq('user_id', userId)
      pushed++
    } catch (error) {
      failed++
      await db.from('camino_calendar').update({
        metadata: mergeMetadata(mission.metadata, { calendar_synced: false, calendar_sync_status: 'error' }),
      }).eq('id', mission.id).eq('user_id', userId)
      console.warn('[calendar] mission push failed:', error)
    }
  }
  await db.from('calendar_connections').update({ last_synced_at: nowISO() }).eq('id', connection.id)
  return { pushed, skippedNoTime, failed }
}

export async function syncExistingKairoMissionToGoogle(userId: string, missionId: string, db = createServiceClient()) {
  const connection = await getConnection(db, userId)
  if (!connection || !connection.sync_enabled) return { updated: false as const, reason: 'not_connected' as const }
  const { provider, calendarId } = await ensureExternalCalendar(db, connection)
  const { data: missionData, error: missionError } = await db
    .from('camino_calendar')
    .select('id, user_id, scheduled_date, subject, title, block_key, block_slug, mission_type, status, start_time, end_time, updated_at, metadata')
    .eq('user_id', userId)
    .eq('id', missionId)
    .maybeSingle()
  if (missionError) throw missionError
  const mission = missionData as CaminoMissionRow | null
  if (!mission || mission.status !== 'pending') return { updated: false as const, reason: 'missing_mission' as const }
  const { data: linkData, error: linkError } = await db
    .from('calendar_event_links')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .eq('entity_type', 'mission')
    .eq('entity_id', mission.id)
    .maybeSingle()
  if (linkError) throw linkError
  const link = linkData as CalendarEventLink | null
  const eventInput = eventFromMission(mission)
  if (!eventInput) {
    if (link?.external_event_id) {
      await provider.deleteEvent(link.external_calendar_id, link.external_event_id)
      const { error: deleteLinkError } = await db.from('calendar_event_links').delete().eq('id', link.id)
      if (deleteLinkError) throw deleteLinkError
    }
    await db.from('camino_calendar').update({
      metadata: mergeMetadata(mission.metadata, { calendar_synced: false, calendar_sync_status: 'pending_no_time' }),
    }).eq('id', mission.id).eq('user_id', userId)
    return { updated: false as const, reason: 'no_time' as const }
  }
  try {
    let event: CalendarEvent
    if (link?.external_event_id) {
      try {
        event = await provider.updateEvent(link.external_calendar_id, link.external_event_id, eventInput)
      } catch (error) {
        if (!(error instanceof CalendarEventNotFoundError)) throw error
        event = await createOrRecoverMissionEvent(provider, calendarId, eventInput)
      }
    } else {
      event = await createOrRecoverMissionEvent(provider, calendarId, eventInput)
    }
    const { error: upsertError } = await db.from('calendar_event_links').upsert({
      user_id: userId,
      entity_type: 'mission',
      entity_id: mission.id,
      provider: 'google',
      external_calendar_id: calendarId,
      external_event_id: event.id,
      external_etag: event.etag ?? null,
      last_local_update: mission.updated_at ?? nowISO(),
      last_external_update: event.updated ?? nowISO(),
      last_sync_source: 'kairo',
      last_synced_at: nowISO(),
      sync_status: 'synced',
    }, { onConflict: 'user_id,entity_type,entity_id,provider' })
    if (upsertError) throw upsertError
    await db.from('camino_calendar').update({
      metadata: mergeMetadata(mission.metadata, { calendar_synced: true, calendar_sync_status: 'synced' }),
      updated_at: mission.updated_at ?? nowISO(),
    }).eq('id', mission.id).eq('user_id', userId)
    return { updated: true as const, created: !link?.external_event_id }
  } catch (error) {
    await db.from('camino_calendar').update({
      metadata: mergeMetadata(mission.metadata, { calendar_synced: false, calendar_sync_status: 'error' }),
    }).eq('id', mission.id).eq('user_id', userId)
    throw error
  }
}

async function createOrRecoverMissionEvent(provider: CalendarProvider, calendarId: string, eventInput: CalendarEventInput) {
  try {
    return await provider.createEvent(calendarId, eventInput)
  } catch (error) {
    if (!(error instanceof CalendarProviderError) || error.status !== 409 || !eventInput.id) throw error
    const existing = await provider.getEvent(calendarId, eventInput.id)
    if (!existing) throw error
    return provider.updateEvent(calendarId, eventInput.id, eventInput)
  }
}

export async function deleteKairoMission(userId: string, missionId: string, db = createServiceClient()) {
  const { data: mission, error: missionError } = await db
    .from('camino_calendar')
    .select('id')
    .eq('id', missionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (missionError) throw missionError
  if (!mission) return { deleted: true as const, external: 'missing' as const }

  const { data: linkData, error: linkError } = await db
    .from('calendar_event_links')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .eq('entity_type', 'mission')
    .eq('entity_id', missionId)
    .maybeSingle()
  if (linkError) throw linkError
  const link = linkData as CalendarEventLink | null
  const connection = await getConnection(db, userId)
  let external: 'deleted' | 'not_linked' | 'disconnected' = link ? 'disconnected' : 'not_linked'
  if (link?.external_event_id && connection?.sync_enabled) {
    const provider = await providerForConnection(db, connection)
    await provider.deleteEvent(link.external_calendar_id, link.external_event_id)
    external = 'deleted'
  }
  if (link) {
    const { error } = await db.from('calendar_event_links').delete().eq('id', link.id)
    if (error) throw error
  }
  const { error: deleteMissionError } = await db
    .from('camino_calendar')
    .delete()
    .eq('id', missionId)
    .eq('user_id', userId)
  if (deleteMissionError) throw deleteMissionError
  return { deleted: true as const, external }
}

async function applyExternalEvent(db: SupabaseClient, connection: CalendarConnection, event: CalendarEvent) {
  const calendarId = connection.external_calendar_id
  if (!calendarId) return
  const privateProps = event.extendedProperties?.private ?? {}
  const entityId = privateProps.kairoEntityId
  const { data: linkData } = await db
    .from('calendar_event_links')
    .select('*')
    .eq('provider', 'google')
    .eq('external_calendar_id', calendarId)
    .eq('external_event_id', event.id)
    .maybeSingle()
  const link = linkData as CalendarEventLink | null
  const missionId = link?.entity_id ?? entityId
  if (!missionId) return
  if (event.status === 'cancelled') {
    await db.from('camino_calendar').update({ status: 'postponed', updated_at: nowISO() }).eq('id', missionId).eq('user_id', connection.user_id)
    if (link) await db.from('calendar_event_links').update({ sync_status: 'deleted_external', last_sync_source: 'external', last_synced_at: nowISO() }).eq('id', link.id)
    return
  }
  const nextDate = dateFromEvent(event)
  if (!nextDate) return
  const { data: missionData } = await db
    .from('camino_calendar')
    .select('metadata')
    .eq('id', missionId)
    .eq('user_id', connection.user_id)
    .maybeSingle()
  const patch = {
    scheduled_date: nextDate,
    start_time: timeFromDateTime(event.start.dateTime),
    end_time: timeFromDateTime(event.end.dateTime),
    metadata: mergeMetadata((missionData as { metadata?: Record<string, unknown> | null } | null)?.metadata, { calendar_synced: true }),
    updated_at: nowISO(),
  }
  await db.from('camino_calendar').update(patch).eq('id', missionId).eq('user_id', connection.user_id)
  await db.from('calendar_event_links').upsert({
    user_id: connection.user_id,
    entity_type: 'mission',
    entity_id: missionId,
    provider: 'google',
    external_calendar_id: calendarId,
    external_event_id: event.id,
    external_etag: event.etag ?? null,
    last_external_update: event.updated ?? nowISO(),
    last_sync_source: 'external',
    last_synced_at: nowISO(),
    sync_status: 'synced',
  }, { onConflict: 'user_id,entity_type,entity_id,provider' })
}

export async function syncGoogleChangesForConnection(connectionId: string, db = createServiceClient()) {
  const { data } = await db.from('calendar_connections').select('*').eq('id', connectionId).maybeSingle()
  const connection = data as CalendarConnection | null
  if (!connection || !connection.sync_enabled || !connection.external_calendar_id) return { pulled: 0 }
  const provider = await providerForConnection(db, connection)
  let syncToken: string | undefined = connection.sync_token ?? undefined
  let pageToken: string | undefined
  let pulled = 0
  try {
    do {
      const page = await provider.getChanges(connection.external_calendar_id, { syncToken, pageToken })
      for (const event of page.events) {
        await applyExternalEvent(db, connection, event)
        pulled++
      }
      pageToken = page.nextPageToken
      if (page.nextSyncToken) syncToken = page.nextSyncToken
    } while (pageToken)
  } catch (error) {
    if (error instanceof CalendarSyncGoneError) {
      await db.from('calendar_connections').update({ sync_token: null }).eq('id', connection.id)
      return syncGoogleChangesForConnection(connection.id, db)
    }
    throw error
  }
  await db.from('calendar_connections').update({ sync_token: syncToken ?? null, last_synced_at: nowISO() }).eq('id', connection.id)
  return { pulled }
}

export async function syncGoogleChangesForUser(userId: string, db = createServiceClient()) {
  const connection = await getConnection(db, userId)
  if (!connection) return { pulled: 0 }
  return syncGoogleChangesForConnection(connection.id, db)
}

export async function startGoogleWatch(userId: string, db = createServiceClient()) {
  const connection = await getConnection(db, userId)
  if (!connection || !connection.sync_enabled) return null
  const webhookUrl = process.env.GOOGLE_CALENDAR_WEBHOOK_URL
  if (!webhookUrl) return null
  const { provider, calendarId } = await ensureExternalCalendar(db, connection)
  const previousChannelId = connection.google_channel_id
  const previousResourceId = connection.google_resource_id
  const previousExpiration = connection.google_channel_expiration
  const channelId = crypto.randomUUID()
  const watch = await provider.watch(calendarId, webhookUrl, channelId)
  await db.from('calendar_connections').update({
    google_channel_id: watch.channelId,
    google_resource_id: watch.resourceId,
    google_channel_expiration: watch.expiration ?? null,
  }).eq('id', connection.id)
  if (previousChannelId && previousResourceId) {
    await provider.unwatch(previousChannelId, previousResourceId).catch(error => {
      console.warn('[calendar] old watch stop skipped:', {
        connectionId: connection.id,
        previousExpiration,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  console.log('[calendar] watch renewed', {
    connectionId: connection.id,
    previousExpiration,
    nextExpiration: watch.expiration ?? null,
  })
  return watch
}

export async function renewExpiringGoogleWatches(db = createServiceClient()) {
  const threshold = new Date(Date.now() + WATCH_RENEWAL_WINDOW_MS).toISOString()
  const { data } = await db
    .from('calendar_connections')
    .select('id, user_id, google_channel_expiration')
    .eq('provider', 'google')
    .eq('sync_enabled', true)
    .or(`google_channel_expiration.is.null,google_channel_expiration.lt.${threshold}`)
  let renewed = 0
  let failed = 0
  for (const row of (data ?? []) as Array<{ id: string; user_id: string; google_channel_expiration: string | null }>) {
    await startGoogleWatch(row.user_id, db)
      .then(watch => {
        if (watch) renewed++
      })
      .catch(error => {
        failed++
        console.warn('[calendar] watch renew failed:', {
          connectionId: row.id,
          previousExpiration: row.google_channel_expiration,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }
  return { renewed, failed, checked: data?.length ?? 0, threshold }
}

export async function disconnectGoogleCalendar(userId: string) {
  const db = createServiceClient()
  const connection = await getConnection(db, userId)
  if (!connection) return
  if (connection.google_channel_id && connection.google_resource_id) {
    await providerForConnection(db, connection)
      .then(provider => provider.unwatch(connection.google_channel_id!, connection.google_resource_id!))
      .catch(() => undefined)
  }
  await db.from('calendar_connections').update({
    sync_enabled: false,
    access_token: null,
    refresh_token: null,
    sync_token: null,
    google_channel_id: null,
    google_resource_id: null,
    google_channel_expiration: null,
  }).eq('id', connection.id)
  await db.from('calendar_event_links').update({ sync_status: 'disconnected' }).eq('user_id', userId).eq('provider', 'google')
}

export async function findConnectionByGoogleChannel(channelId: string | null, resourceId: string | null) {
  if (!channelId || !resourceId) return null
  const db = createServiceClient()
  const { data } = await db
    .from('calendar_connections')
    .select('*')
    .eq('provider', 'google')
    .eq('google_channel_id', channelId)
    .eq('google_resource_id', resourceId)
    .maybeSingle()
  return { db, connection: data as CalendarConnection | null }
}

export async function getGoogleAvailability(userId: string, timeMin: string, timeMax: string) {
  const db = createServiceClient()
  const connection = await getConnection(db, userId)
  if (!connection || !connection.sync_enabled) return []
  const provider = await providerForConnection(db, connection)
  return provider.getAvailability(['primary'], timeMin, timeMax, MADRID_TZ)
}
