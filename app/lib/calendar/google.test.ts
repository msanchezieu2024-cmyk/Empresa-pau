import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { GoogleCalendarProvider } from './google.ts'
import { CalendarProviderError } from './types.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
}

test('creates and edits one stable Google event with the supplied Madrid wall time', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const responses = [
    jsonResponse(200, { id: 'event-1', updated: '2026-09-06T12:00:00Z' }),
    jsonResponse(200, { id: 'event-1', updated: '2026-09-06T12:05:00Z' }),
  ]
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init })
    return responses.shift()!
  }) as typeof fetch

  const provider = new GoogleCalendarProvider('access-token')
  const event = {
    id: 'kairo1234abcdef',
    summary: 'Kairo: Derivadas',
    start: { dateTime: '2026-10-26T18:00:00', timeZone: 'Europe/Madrid' },
    end: { dateTime: '2026-10-26T18:30:00', timeZone: 'Europe/Madrid' },
  }
  await provider.createEvent('calendar-1', event)
  await provider.updateEvent('calendar-1', 'event-1', event)

  assert.equal(calls.length, 2)
  assert.equal(calls[0].init?.method, 'POST')
  assert.equal(calls[1].init?.method, 'PUT')
  assert.match(String(calls[1].url), /events\/event-1$/)
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), event)
})

test('refreshes once after a 401 and retries with the new access token', async () => {
  const authorization: string[] = []
  let refreshes = 0
  globalThis.fetch = (async (_input, init) => {
    authorization.push(String((init?.headers as Record<string, string>).Authorization))
    return authorization.length === 1
      ? jsonResponse(401, { error: 'invalid_token' })
      : jsonResponse(200, { id: 'calendar-1', summary: 'Kairo – Estudio' })
  }) as typeof fetch

  const provider = new GoogleCalendarProvider('expired-token', async () => {
    refreshes++
    return 'fresh-token'
  })
  const calendar = await provider.getCalendar('calendar-1')

  assert.equal(calendar?.id, 'calendar-1')
  assert.equal(refreshes, 1)
  assert.deepEqual(authorization, ['Bearer expired-token', 'Bearer fresh-token'])
})

test('does not retry or create another event after a rate-limit/provider failure', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return jsonResponse(429, { error: 'rate_limited' })
  }) as typeof fetch

  const provider = new GoogleCalendarProvider('access-token')
  await assert.rejects(
    provider.updateEvent('calendar-1', 'event-1', {
      summary: 'Kairo: Derivadas',
      start: { dateTime: '2026-09-06T18:00:00', timeZone: 'Europe/Madrid' },
      end: { dateTime: '2026-09-06T18:30:00', timeZone: 'Europe/Madrid' },
    }),
    (error: unknown) => error instanceof CalendarProviderError && error.status === 429,
  )
  assert.equal(calls, 1)
})

test('treats an already deleted Google event as an idempotent deletion', async () => {
  globalThis.fetch = (async () => jsonResponse(404, { error: 'not_found' })) as typeof fetch
  const provider = new GoogleCalendarProvider('access-token')
  await assert.doesNotReject(provider.deleteEvent('calendar-1', 'event-1'))
})
