import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { createCalendarOAuthState, verifyCalendarOAuthState } from './oauthState.ts'

const originalSecret = process.env.CALENDAR_OAUTH_STATE_SECRET
const originalNow = Date.now

afterEach(() => {
  Date.now = originalNow
  if (originalSecret === undefined) delete process.env.CALENDAR_OAUTH_STATE_SECRET
  else process.env.CALENDAR_OAUTH_STATE_SECRET = originalSecret
})

test('OAuth state round-trips the authenticated user and rejects tampering', () => {
  process.env.CALENDAR_OAUTH_STATE_SECRET = 'test-only-calendar-oauth-state-secret'
  const state = createCalendarOAuthState('user-123')

  assert.equal(verifyCalendarOAuthState(state)?.userId, 'user-123')
  assert.equal(verifyCalendarOAuthState(`${state.slice(0, -1)}x`), null)
  assert.equal(verifyCalendarOAuthState(null), null)
})

test('OAuth state expires after the ten-minute callback window', () => {
  process.env.CALENDAR_OAUTH_STATE_SECRET = 'test-only-calendar-oauth-state-secret'
  Date.now = () => 1_000
  const state = createCalendarOAuthState('user-123')
  Date.now = () => 1_000 + 10 * 60 * 1000 + 1

  assert.equal(verifyCalendarOAuthState(state), null)
})
