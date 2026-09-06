import { NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/app/lib/billing/supabase'
import { busySlotsForMadridDate, getAvailability, hasTimeConflict } from '@/app/lib/calendar/availability'
import { syncExistingKairoMissionToGoogle } from '@/app/lib/calendar/sync'
import { getAuthContext } from '@/app/lib/camino/caminoProgressServer'
import { estimatedMinutesForMissionType, placeBestAcrossDates, type TimeRange } from '@/app/lib/camino/scheduleTimeSlot'
import { recordMissionBehaviorEvent } from '@/app/lib/camino/missionBehavior'

export const dynamic = 'force-dynamic'

type MissionRow = {
  id: string
  scheduled_date: string
  subject: string
  title: string | null
  block_key: string | null
  block_slug: string | null
  mission_type: string
  is_main: boolean
  is_bonus: boolean
  status: string
  v2_sort_order: number | null
  xp_awarded: number | null
  start_time: string | null
  end_time: string | null
  conflict_reschedule_count: number | null
  metadata: Record<string, unknown> | null
}

const SELECT_COLUMNS = 'id, scheduled_date, subject, title, block_key, block_slug, mission_type, is_main, is_bonus, status, v2_sort_order, xp_awarded, start_time, end_time, conflict_reschedule_count, metadata'

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function normalizeTime(value: string | null) {
  return value ? value.slice(0, 5) : null
}

function minutesBetween(start: string | null, end: string | null, fallback: number) {
  if (!start || !end) return fallback
  const toMinutes = (value: string) => {
    const [h, m] = value.slice(0, 5).split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const diff = toMinutes(end) - toMinutes(start)
  return diff > 0 ? diff : fallback
}

function mergeMetadata(current: Record<string, unknown> | null | undefined, patch: Record<string, unknown>) {
  return { ...(current ?? {}), ...patch }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))).slice(0, 12)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext(request)
    if ('response' in auth) return auth.response

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* ok */ }
    const missionIds = uniqueStrings(body.missionIds)
    if (missionIds.length === 0) {
      return NextResponse.json({ error: 'mission_ids_required' }, { status: 400 })
    }

    const db = createServiceClient()
    const { data, error } = await db
      .from('camino_calendar')
      .select(SELECT_COLUMNS)
      .eq('user_id', auth.user.id)
      .eq('status', 'pending')
      .in('id', missionIds)

    if (error) throw error
    const missions = (data ?? []) as MissionRow[]
    if (missions.length === 0) {
      return NextResponse.json({ updated: [], moved: 0, unchanged: missionIds, unscheduled: [], calendarSync: [] })
    }

    const minDate = missions.reduce((min, mission) => mission.scheduled_date < min ? mission.scheduled_date : min, missions[0].scheduled_date)
    const maxDate = addDays(missions.reduce((max, mission) => mission.scheduled_date > max ? mission.scheduled_date : max, missions[0].scheduled_date), 7)
    const busySlots = await getAvailability(auth.user.id, minDate, maxDate)

    const movedIds: string[] = []
    const unscheduledIds: string[] = []
    const unchangedIds: string[] = []
    const calendarSync: Array<{ missionId: string; status: string }> = []

    for (const mission of missions) {
      const startTime = normalizeTime(mission.start_time)
      const endTime = normalizeTime(mission.end_time)
      if (!startTime || !endTime) {
        unchangedIds.push(mission.id)
        continue
      }

      const currentBusy = busySlotsForMadridDate(busySlots, mission.scheduled_date)
      const stillConflicts = currentBusy.some(slot => hasTimeConflict({ start: startTime, end: endTime }, slot))
      if (!stillConflicts) {
        unchangedIds.push(mission.id)
        continue
      }

      const duration = minutesBetween(startTime, endTime, estimatedMinutesForMissionType(mission.mission_type))
      const candidateDates = Array.from({ length: 8 }, (_, offset) => addDays(mission.scheduled_date, offset))
      const externalBusyByDate = new Map<string, TimeRange[]>(
        candidateDates.map(candidateDate => [candidateDate, busySlotsForMadridDate(busySlots, candidateDate)]),
      )
      const placed = await placeBestAcrossDates(auth.user.id, db, candidateDates, duration, {
        excludeCalendarRowIds: new Set([mission.id]),
        externalBusyByDate,
        context: {
          subject: mission.subject,
          missionType: mission.mission_type,
          deadlineDate: typeof mission.metadata?.partial_exam_date === 'string' ? mission.metadata.partial_exam_date : null,
          priority: typeof mission.metadata?.priority === 'string' ? mission.metadata.priority : null,
        },
      })

      const reorganizedAt = new Date().toISOString()
      const metadata = mergeMetadata(mission.metadata, {
        calendar_reorganized_at: reorganizedAt,
        calendar_reorganized_from: {
          date: mission.scheduled_date,
          start: startTime,
          end: endTime,
        },
        calendar_reorganized_score: placed?.score ?? null,
        calendar_reorganized_reasons: placed?.reasons ?? [],
        calendar_sync_status: placed ? 'pending' : 'pending_no_time',
      })
      const patch = placed
        ? {
            scheduled_date: placed.date,
            start_time: placed.start,
            end_time: placed.end,
            conflict_reschedule_count: (mission.conflict_reschedule_count ?? 0) + 1,
            metadata,
            updated_at: reorganizedAt,
          }
        : {
            start_time: null,
            end_time: null,
            conflict_reschedule_count: (mission.conflict_reschedule_count ?? 0) + 1,
            metadata,
            updated_at: reorganizedAt,
          }
      const { error: updateError } = await db
        .from('camino_calendar')
        .update(patch)
        .eq('id', mission.id)
        .eq('user_id', auth.user.id)
      if (updateError) throw updateError

      await recordMissionBehaviorEvent(db, auth.user.id, mission.id, 'rescheduled_conflict', `conflict:${reorganizedAt}`, {
        from: { date: mission.scheduled_date, start: startTime, end: endTime },
        to: placed ? { date: placed.date, start: placed.start, end: placed.end } : { date: mission.scheduled_date, start: null, end: null },
      }).catch(eventError => {
        console.warn('[camino/calendar-conflicts/reorganize] mission behavior event skipped:', eventError)
      })

      if (placed) {
        movedIds.push(mission.id)
      } else {
        unscheduledIds.push(mission.id)
      }
      try {
        const result = await syncExistingKairoMissionToGoogle(auth.user.id, mission.id, db)
        calendarSync.push({ missionId: mission.id, status: result.updated ? (result.created ? 'created' : 'updated') : result.reason })
      } catch (syncError) {
        console.warn('[camino/calendar-conflicts/reorganize] google sync pending:', syncError)
        calendarSync.push({ missionId: mission.id, status: 'error' })
      }
    }

    const { data: refreshed } = await db
      .from('camino_calendar')
      .select(SELECT_COLUMNS)
      .eq('user_id', auth.user.id)
      .in('id', missionIds)

    return NextResponse.json({
      updated: refreshed ?? [],
      moved: movedIds.length,
      unchanged: unchangedIds,
      unscheduled: unscheduledIds,
      calendarSync,
    })
  } catch (error) {
    console.error('[camino/calendar-conflicts/reorganize]', error)
    return NextResponse.json({ error: 'No se pudieron reorganizar las misiones.' }, { status: 500 })
  }
}
