import { expect, test, type Page } from '@playwright/test'

import { hasAuthenticatedSession } from './auth-session'

async function accessToken(page: Page) {
  return page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? '{}') as { access_token?: unknown }
        if (typeof value.access_token === 'string') return value.access_token
      } catch {}
    }
    return null
  })
}

async function deleteMission(page: Page, missionId: string) {
  const token = await accessToken(page)
  if (!token) return
  await page.request.delete('/api/camino/calendar-editor/mission', {
    headers: { Authorization: `Bearer ${token}` },
    data: { missionId },
  }).catch(() => undefined)
}

async function dismissCookieBanner(page: Page) {
  const reject = page.getByRole('button', { name: 'Rechazar' })
  if (await reject.isVisible().catch(() => false)) await reject.click()
}

test('guardar elimina una misión persistida y F5 no la restaura', async ({ page }) => {
  test.setTimeout(180_000)
  const title = `Cierre E2E ${Date.now()}`
  let missionId: string | null = null

  await page.goto('/camino')
  await dismissCookieBanner(page)
  await expect.poll(() => hasAuthenticatedSession(page), { timeout: 12_000 }).toBe(true)
  const token = await accessToken(page)
  expect(token).toBeTruthy()

  try {
    const create = await page.request.post('/api/camino/calendar-editor/mission', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        scheduledDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date()),
        subject: 'matematicas_ii',
        title,
        missionType: 'concept',
        role: 'main',
        estimatedMinutes: 30,
        startTime: null,
        requestKey: `product-closure:${title}`,
      },
    })
    if (!create.ok()) throw new Error(`No se pudo preparar la misión E2E: ${create.status()} ${await create.text()}`)
    const created = await create.json() as { mission?: { id?: string } }
    missionId = created.mission?.id ?? null
    expect(missionId).toBeTruthy()

    await page.route('**/api/calendar/google/sync', route => route.fulfill({ status: 200, contentType: 'application/json', json: { ok: true, pushed: 0, failed: 0 } }))
    await page.reload()
    await page.getByRole('button', { name: 'Calendario', exact: true }).click()
    const missionTitle = page.getByText(title, { exact: true })
    await expect(missionTitle).toBeVisible()
    await missionTitle.locator('..').getByRole('button', { name: 'Eliminar' }).click()
    await expect(missionTitle).toHaveCount(0)

    const [, deleteResult] = await Promise.all([
      page.getByRole('button', { name: 'Guardar cambios' }).click(),
      page.waitForResponse(response => response.url().endsWith('/api/camino/calendar-editor/mission') && response.request().method() === 'DELETE'),
    ])
    expect(deleteResult.ok()).toBe(true)
    await expect(page.getByText(title, { exact: true })).toHaveCount(0)

    await page.reload()
    await page.getByRole('button', { name: 'Calendario', exact: true }).click()
    await expect(page.getByText(title, { exact: true })).toHaveCount(0)
    missionId = null
  } finally {
    if (missionId) await deleteMission(page, missionId)
  }
})

test('el calendario conserva controles útiles a 390 px sin overflow horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/camino')
  await dismissCookieBanner(page)
  await expect.poll(() => hasAuthenticatedSession(page), { timeout: 12_000 }).toBe(true)
  await page.getByRole('button', { name: 'Calendario', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
})
