'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, BookOpen, BookPlus, BrainCircuit, Bookmark, CalendarDays, Check, ChevronDown, ChevronLeft, ClipboardList, Clock3, GripVertical, Loader2, MessageCircle, Pencil, Plus, RotateCcw, Route, Target, TimerReset, Trash2, Trophy, Zap } from 'lucide-react'
import WeeklyCheckinBanner from '@/app/components/camino/WeeklyCheckinBanner'
import ExamCoverageBanner from '@/app/components/camino/ExamCoverageBanner'
import HistoriaTopicChips from '@/app/components/camino/HistoriaTopicChips'
import GoogleCalendarConnection from '@/app/components/camino/GoogleCalendarConnection'
import SidebarNav from '@/app/components/SidebarNav'
import { supabase } from '@/app/lib/supabase'
import { clearOnboarding, loadOnboarding, restoreOnboardingFromServer, saveOnboarding, type OnboardingData } from '@/app/lib/onboarding/onboardingStorage'
import { buildEvauHref, buildTopicHref, getCurriculumForSubjects, getTopicByV2SortOrder, normalizeCaminoSlug, normalizeSubjectSlug, normalizeTopicSlug, resolveCaminoTopic, resolveTopicSlugAlias, sanitizeLessonTitle, subjectLabelFromSlug, type CaminoCurriculumTopic } from '@/app/lib/camino/caminoCurriculumPlan'
import { PRIVATE_BETA_SUBJECTS } from '@/app/lib/camino/betaCurriculum'
import { getCaminoPlanLimits, monthlyToWeeklyLimit, normalizeCaminoPlanId, type CaminoPlanId } from '@/app/lib/camino/caminoPlanLimits'
import { estimatedMinutesForSlot, missionsPerDayForMinutes } from '@/app/lib/camino/dailyTimeCapacity'
import { DIVISIONS, divisionFor } from '@/app/lib/camino/leagues'
import { MAX_LIGAS_PER_USER } from '@/app/lib/camino/leagueRounds'
import { deletePartialExamMissions, injectAllPartialExamMissions, weekdaysBefore } from '@/app/lib/camino/injectPartialExamMissions'
import { computeExamTimeNeed, getBlockPerformance } from '@/app/lib/camino/examTimeNeed'
import { calcularRacha } from '@/app/lib/calcularRacha'
import { resolveMissionTypeXp } from '@/app/lib/camino/xpMap'
import { normalizeBlockKey } from '@/app/lib/simulacros/blockNormalization'
import { caminoSubjectFromSimulacro } from '@/app/lib/camino/partialExamSubjects'
import { monthlyLimitResetNotice } from '@/app/lib/rateLimitMessages'
import { DEFAULT_MISSION_DURATION_MINUTES } from '@/app/lib/camino/calendarEditorConfig'
import { CONTENT_TYPE_COLORS } from '@/app/lib/camino/contentTypeColors'
import DivisionIcon from '@/components/shared/DivisionIcon'
import FullRankingModal from '@/components/shared/FullRankingModal'
import { RankingRow } from '@/components/shared/RankingRow'
import UsernameGate from '@/app/components/camino/UsernameGate'
import { CAMINO_ORIENTATION_CONTEXT_KEY, parseCaminoOrientationContext } from '@/app/orientacion/access-paths/storage'
import type { CaminoOrientationContext } from '@/app/orientacion/access-paths/types'
import { matchingOrientationContext, orientationImpactForSubject, orientationRotationBonusSlots, priorityPresentationForMission, rankMissionCandidates, withPriorityReasons, type PersistedOrientationGoal } from '@/app/lib/camino/orientationPriority'

type MissionKind = 'concept_explanation' | 'guided_example' | 'guided_practice' | 'evau_practice' | 'exam_focus' | 'mock_exam' | 'manual'
type MissionRole = 'main' | 'bonus'
type MissionStatus = 'pending' | 'done'

type Mission = {
  id: string
  calendarRowId?: string
  role: MissionRole
  kind: MissionKind
  subject: string
  block?: string
  topic?: string
  title: string
  reason: string
  href: string
  target: string
  source: 'camino_pau'
  xpPolicy: 'after_correction'
  estimatedMinutes: number
  baseXP: number
  status: MissionStatus
  metadata?: Record<string, unknown>
  subjectSlug?: string
  v2SortOrder?: number
  blockKey?: string
  missionType?: string
  startTime?: string | null
  endTime?: string | null
}
// "Aún no lo he dado"/"No lo he dado en clase" nació como señal genérica de
// ritmo de Camino, pero solo se pidió para los 2 temas de integrales de
// Matemáticas CCSS (llegan tarde en muchos institutos) — mismo alcance que
// NOT_SEEN_BUTTON_TOPICS en CaminoTopicClient.tsx, identificado aquí por
// subject+v2SortOrder (23 y 24) porque Mission no lleva topicSlug fiable.
// Antes el botón se ofrecía para cualquier misión de cualquier asignatura
// con subjectSlug+v2SortOrder — mucho más amplio que lo pedido.
const NOT_SEEN_BUTTON_MISSIONS = new Set<string>([
  'matematicas_ccss:23', // primitiva-de-una-funcion-y-la-integral-indefinida
  'matematicas_ccss:24', // la-integral-definida-regla-de-barrow-y-areas
])
function canMarkNotSeen(mission: { subjectSlug?: string; v2SortOrder?: number } | null | undefined): boolean {
  if (!mission?.subjectSlug || mission.v2SortOrder == null) return false
  return NOT_SEEN_BUTTON_MISSIONS.has(`${mission.subjectSlug}:${mission.v2SortOrder}`)
}
type DayPlan = { date: string; label: string; isToday: boolean; missions: Mission[] }
type ExamPriority = 'baja' | 'normal' | 'alta' | 'muy_alta'
type ExamConfidence = 'bajo' | 'medio' | 'alto'
// 'parcial' (por defecto): el Simulacro de este examen se filtra por los
// topic_id fijos elegidos con los chips (exam_topics). 'global': sin chips
// fijos — cubre todo lo que el alumno ya tenga completado en camino_calendar
// para esta asignatura en el momento de generar.
type ExamScope = 'parcial' | 'global'
type StudentExam = { id: string; subject: string; date: string; block: string; topic: string; name: string; priority: ExamPriority; confidence?: ExamConfidence; content?: string; sessionOverride?: number; examScope?: ExamScope }
type CurriculumItem = { subject: string; subjectSlug: string; block: string; blockSlug: string; topic: string; topicSlug: string; title: string; sortOrder: number; contentStatus: string; source: 'supabase' | 'fallback' | 'seed'; planTopic?: CaminoCurriculumTopic }
type RankingEntry = { id: string; name: string; community: string; xp: number; rank: number; isCurrentUser: boolean }
type LeaderboardPayload = {
  global: { top: RankingEntry[]; current: RankingEntry | null }
  community: { name: string; top: RankingEntry[]; current: RankingEntry | null }
  currentXp: number
  realUserCount: number
}
type LigaMiembro = { user_id: string; name: string; weekly_xp: number; total_xp: number }
type LigaInfo = { id: string; codigo: string; nombre: string; miembros: LigaMiembro[] }
type GlobalTopEntry = { name: string; xp: number; rank: number; isCurrentUser: boolean }
type SchoolTopicAdjustment = { schoolName: string | null; community: string | null; subject: string; blockSlug: string | null; topicSlug: string; feedbackType: 'not_seen_in_class'; status: 'not_seen' | 'delayed_for_school'; notSeenCount: number; date: string }
type LegacySchoolFeedback = { schoolName: string | null; community: string | null; subject: string; block: string; topic: string; reason: 'not_seen_in_class'; date: string }
type CalendarWeekCache = Record<string, DayPlan[]>
type TopicProgress = Record<string, { explanation?: boolean; guided?: boolean; evau?: boolean; xp: number; score?: number }>
type CalendarSource = 'server' | 'client' | 'cache' | 'server_empty' | 'server_error'
type CalendarSourceContext = 'initial_load' | 'week_navigation' | 'exam_change' | 'postpone'
type CalendarConflict = { missionId: string; date: string; title: string | null; start: string; end: string; busyStart: string; busyEnd: string }
type ExternalBusySlot = { start: string; end: string }
type ExternalBusyByDate = Record<string, ExternalBusySlot[]>

const EXAMS_KEY = 'kairo_camino_student_exams_v1'
const WEAK_AREAS_KEY = 'kairo_camino_weak_areas_v1'
const TOPIC_PROGRESS_KEY = 'kairo_camino_topic_progress_v1'
const CALENDAR_VISIBILITY_KEY = 'kairo_camino_calendar_expanded_v1'
const CALENDAR_WEEK_CACHE_KEY = 'kairo_camino_week_cache_v2'
const SCHOOL_FEEDBACK_KEY = 'kairo_school_topic_feedback_v1'
const SCHOOL_ADJUSTMENTS_KEY = 'kairo_camino_school_adjustments_v1'
const BETA_FEEDBACK_URL = process.env.NEXT_PUBLIC_BETA_FEEDBACK_URL

const SUBJECT_SLUGS: Record<string, string> = {
  'Matemáticas II': 'matematicas_ii', 'Matemáticas CCSS': 'matematicas_ccss', 'Física': 'fisica', 'Química': 'quimica',
  'Historia de España': 'historia_espana', 'Historia de la Filosofía': 'historia_filosofia', 'Lengua Castellana': 'lengua', 'Inglés': 'ingles', 'Biología': 'biologia'
}
const PRIVATE_BETA_SUBJECT_SLUGS = new Set<string>(PRIVATE_BETA_SUBJECTS)
const DB_SUBJECTS: Record<string, string> = {
  'Matemáticas CCSS': 'matematicas_ccss',
  'Lengua Castellana': 'lengua',
  'Historia de España': 'historia_espana',
}
const seedTopicToCurriculumItem = (topic: CaminoCurriculumTopic): CurriculumItem => ({
  subject: SUBJECT_SLUGS[topic.subject] ? topic.subject : Object.entries(SUBJECT_SLUGS).find(([, slug]) => slug === topic.subject)?.[0] ?? topic.subject,
  subjectSlug: topic.subject,
  block: topic.blockTitle,
  blockSlug: topic.blockSlug,
  topic: sanitizeLessonTitle(topic.title),
  topicSlug: topic.topicSlug,
  title: sanitizeLessonTitle(topic.title),
  sortOrder: topic.orderIndex,
  contentStatus: topic.contentStatus,
  source: 'seed',
  planTopic: topic,
})
const FALLBACK_CURRICULUM: CurriculumItem[] = getCurriculumForSubjects(Object.keys(SUBJECT_SLUGS)).map(seedTopicToCurriculumItem)
const SUBJECT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Matemáticas II': { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }, 'Matemáticas CCSS': { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
  'Física': { bg: '#fefce8', text: '#a16207', border: '#fef08a' }, 'Química': { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  'Historia de España': { bg: '#fff8f1', text: '#78350f', border: '#fed7aa' }, 'Historia de la Filosofía': { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe' },
  'Lengua Castellana': { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' }, 'Inglés': { bg: '#ecfeff', text: '#0e7490', border: '#a5f3fc' }, 'Biología': { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }
}
const CAMINO_TO_SIM_SUBJECT: Record<string, string> = {
  matematicas_ii: 'mates', matematicas_ccss: 'matematicas_ccss',
  fisica: 'fisica', quimica: 'quimica', biologia: 'biologia',
  ingles: 'ingles', lengua: 'lengua', historia_espana: 'historia',
}

function toISO(date: Date) { return date.toISOString().slice(0, 10) }
function todayISO() { return toISO(new Date()) }
function todayMadrid() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) }
function dateFromISO(dateISO: string) { return new Date(`${dateISO}T12:00:00Z`) }
function addDays(date: Date, days: number) { const next = new Date(date); next.setDate(next.getDate() + days); return next }
function mondayOf(date: Date) { const d = new Date(date); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); d.setUTCHours(12, 0, 0, 0); return d }
function currentWeekStartISO() { return toISO(mondayOf(dateFromISO(todayMadrid()))) }
function daysBetween(fromISO: string, toDateISO: string) { return Math.ceil((dateFromISO(toDateISO).getTime() - dateFromISO(fromISO).getTime()) / 86400000) }
function monthKey(dateISO: string) { return dateISO.slice(0, 7) }
function themeFor(subject: string) { return SUBJECT_COLORS[subject] ?? { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' } }
function missionKindLabel(kind: string, missionType?: string): string {
  const lookup = (key: string): string | null => {
    switch (key) {
      case 'concept': case 'concept_explanation': return 'Teoría'
      case 'guided': case 'guided_example': case 'guided_practice': return 'Práctica'
      case 'evau': case 'evau_practice': return 'Ejercicio PAU'
      case 'review': case 'exam_focus': return 'Repaso'
      case 'mock': case 'mock_exam': case 'block_mock': return 'Simulacro'
      case 'partial': case 'partial_practice': return 'Prep. parcial'
      case 'manual': return 'Manual'
      default: return null
    }
  }
  return (missionType ? lookup(missionType) : null) ?? lookup(kind) ?? kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function dbMissionTypeFromKind(kind: MissionKind, missionType?: string): string {
  if (missionType) return missionType
  if (kind === 'evau_practice') return 'pau_practice'
  if (kind === 'guided_example' || kind === 'guided_practice' || kind === 'exam_focus') return 'review'
  if (kind === 'mock_exam') return 'pau_practice'
  return 'concept'
}
function addMinutesToHHMM(startTime: string | null | undefined, durationMinutes: number): string | null {
  if (!startTime || !/^\d{2}:\d{2}$/.test(startTime)) return null
  const [hours, minutes] = startTime.split(':').map(Number)
  const total = hours * 60 + minutes + Math.max(0, Math.round(durationMinutes))
  if (total > 24 * 60) return null
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const SUBJECT_ABBR: Record<string, string> = {
  'Matemáticas II': 'MAT II', 'Matemáticas CCSS': 'MAT CCSS',
  'Física': 'FIS', 'Química': 'QUI', 'Biología': 'BIO',
  'Historia de España': 'HIST', 'Historia de la Filosofía': 'FILOS',
  'Lengua Castellana': 'LEN', 'Inglés': 'ING',
}
function subjectAbbr(subject: string): string {
  return SUBJECT_ABBR[subject] ?? subject.split(' ')[0].slice(0, 5).toUpperCase()
}
function subjectSlug(subject: string) { return normalizeSubjectSlug(SUBJECT_SLUGS[subject] ?? subject) }
function normalizeOnboardingSubjects(subjects: string[]) {
  const seen = new Set<string>()
  return subjects.map(subject => {
    const slug = normalizeSubjectSlug(subject)
    const label = subjectLabelFromSlug(slug)
    return { slug, label }
  }).filter(({ slug }) => {
    if (!slug || seen.has(slug) || !PRIVATE_BETA_SUBJECT_SLUGS.has(slug)) return false
    seen.add(slug)
    return true
  }).map(({ label }) => label)
}
function textSlug(value: string) { return normalizeCaminoSlug(value) }
function calendarDayLabel(dateISO: string) { return new Date(`${dateISO}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) }
function weekRangeLabel(weekStartISO: string) {
  const start = dateFromISO(weekStartISO)
  const end = addDays(start, 6)
  const startText = start.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  const endText = end.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return `Semana del ${startText} al ${endText}`
}
function monthStartISO(dateISO: string) { return `${dateISO.slice(0, 7)}-01` }
function addMonths(monthStartISOStr: string, n: number): string {
  const [year, month] = monthStartISOStr.split('-').map(Number)
  const total = year * 12 + month - 1 + n
  const nextYear = Math.floor(total / 12)
  const nextMonth = total % 12 + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
}
function monthLabel(monthStartISOStr: string) {
  const [year, month] = monthStartISOStr.split('-').map(Number)
  const label = new Date(Date.UTC(year, month - 1, 1, 12)).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return label.replace(/^\w/, c => c.toUpperCase())
}
function buildMonthGrid(monthStartISOStr: string): string[] {
  const first = dateFromISO(monthStartISOStr)
  const day = first.getUTCDay() || 7
  const gridStart = addDays(first, -day + 1)
  return Array.from({ length: 42 }, (_, i) => toISO(addDays(gridStart, i)))
}
function weekOffset(weekStartISO: string, weeks: number) { return toISO(addDays(dateFromISO(weekStartISO), weeks * 7)) }
function isRealToday(dateISO: string) { return dateISO === todayMadrid() }
function buildWeekDays(weekStartISO: string, sourceDays: DayPlan[] = []) {
  const byDate = new Map(sourceDays.map(day => [day.date, day]))
  const start = dateFromISO(weekStartISO)
  return Array.from({ length: 7 }, (_, index): DayPlan => {
    const dateISO = toISO(addDays(start, index))
    const source = byDate.get(dateISO)
    return { date: dateISO, label: calendarDayLabel(dateISO), isToday: isRealToday(dateISO), missions: source?.missions ?? [] }
  })
}
function weekStartForDate(dateISO: string) {
  return toISO(mondayOf(dateFromISO(dateISO)))
}
function cloneWeek(days: DayPlan[]) {
  return days.map(day => ({ ...day, missions: day.missions.map(mission => ({ ...mission })) }))
}
function mergeMissionMetadata(current: Record<string, unknown> | undefined, patch: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries({ ...(current ?? {}), ...patch }).filter(([, value]) => value !== undefined && value !== null),
  )
}
function mergeWeekIntoCalendar(current: DayPlan[], weekStartISO: string, weekDays: DayPlan[]) {
  const weekEndISO = toISO(addDays(dateFromISO(weekStartISO), 6))
  const outsideWeek = current.filter(day => day.date < weekStartISO || day.date > weekEndISO)
  return [...outsideWeek, ...cloneWeek(weekDays)].sort((a, b) => a.date.localeCompare(b.date))
}
function saveWeekCache(weekStartISO: string, weekDays: DayPlan[]) {
  const cache = loadJson<CalendarWeekCache>(CALENDAR_WEEK_CACHE_KEY, {})
  saveJson(CALENDAR_WEEK_CACHE_KEY, { ...cache, [weekStartISO]: cloneWeek(weekDays) })
}
function saveCalendarWeeksToCache(days: DayPlan[]) {
  const cache = loadJson<CalendarWeekCache>(CALENDAR_WEEK_CACHE_KEY, {})
  const next = { ...cache }
  const grouped = new Map<string, DayPlan[]>()
  for (const day of days) {
    const weekStart = weekStartForDate(day.date)
    if (!grouped.has(weekStart)) grouped.set(weekStart, [])
    grouped.get(weekStart)!.push(day)
  }
  for (const [weekStart, weekDays] of grouped) {
    next[weekStart] = buildWeekDays(weekStart, weekDays)
  }
  saveJson(CALENDAR_WEEK_CACHE_KEY, next)
}
function getSimulationLimitForPlan(planId: CaminoPlanId) {
  return getCaminoPlanLimits(planId).fullMocksPerMonth
}
function getMonthlySimulationUsage(_userId: string | null, month: string, cache: CalendarWeekCache) {
  return Object.values(cache).flat().flatMap(day => day.missions)
    .filter(mission => mission.kind === 'mock_exam' && monthKey(mission.id.slice(0, 10)) === month)
    .length
}
function canScheduleSimulation(_userId: string | null, planId: CaminoPlanId, dateISO: string, cache: CalendarWeekCache, plannedThisRun = 0) {
  return getMonthlySimulationUsage(_userId, monthKey(dateISO), cache) + plannedThisRun < getSimulationLimitForPlan(planId)
}
function resolveCourseHref(subjectValue: string, blockValue?: string | null, topicValue?: string | null) {
  const subjectValueSlug = normalizeSubjectSlug(subjectValue)
  const blockSlug = textSlug(blockValue ?? '')
  if (!blockSlug) return ''
  const topicSlug = resolveTopicSlugAlias(subjectValueSlug, blockSlug, textSlug(topicValue ?? blockSlug))
  const resolved = resolveCaminoTopic({ subjectSlug: subjectValueSlug, blockSlug, topicSlug }).topic
  return resolved ? buildTopicHref(resolved) : ''
}
function courseHrefForItem(item: CurriculumItem) {
  if (item.planTopic) return buildTopicHref(item.planTopic)
  return resolveCourseHref(item.subjectSlug || item.subject, item.blockSlug || item.block, item.topicSlug || item.topic)
}
function getMissionTarget(kind: MissionKind, subject: string, topic?: string, block?: string, planTopic?: CaminoCurriculumTopic) {
  const s = subjectSlug(subject)
  if (planTopic && (kind === 'concept_explanation' || kind === 'guided_example' || kind === 'guided_practice')) return { href: buildTopicHref(planTopic), fallback: '', autoCompletable: false }
  const topicParam = topic ? `&topic=${encodeURIComponent(textSlug(topic))}` : ''
  const blockParam = block ? `&block=${encodeURIComponent(textSlug(block))}` : ''
  if (kind === 'mock_exam') return { href: `/simulacros?subject=${s}${blockParam}${topicParam}&source=camino_pau`, fallback: '', autoCompletable: false }
  if (kind === 'evau_practice' || kind === 'exam_focus') return { href: `/examenes?subject=${s}${blockParam}${topicParam}&mode=random&source=camino`, fallback: '', autoCompletable: false }
  if ((kind === 'concept_explanation' || kind === 'guided_example' || kind === 'guided_practice') && block && topic) {
    const href = resolveCourseHref(s, block, topic)
    if (href) return { href, fallback: '', autoCompletable: false }
    return { href: '', fallback: 'Este tema todavía no está conectado al itinerario de Camino PAU.', autoCompletable: true }
  }
  if (kind === 'concept_explanation' || kind === 'guided_example' || kind === 'guided_practice') return { href: '', fallback: 'Este tema necesita bloque y tema para abrir una página de curso.', autoCompletable: true }
  return { href: '', fallback: 'Esta misión todavía no tiene pantalla propia. Puedes marcarla como hecha cuando la termines fuera de Kairo.', autoCompletable: true }
}
function actionHref(kind: MissionKind, subject: string, topic?: string, block?: string, planTopic?: CaminoCurriculumTopic) {
  if (planTopic && (kind === 'evau_practice' || kind === 'exam_focus')) return buildEvauHref(planTopic)
  return getMissionTarget(kind, subject, topic, block, planTopic).href
}
function missionTarget(kind: MissionKind, subject: string, topic?: string, block?: string, planTopic?: CaminoCurriculumTopic) {
  return actionHref(kind, subject, topic, block, planTopic)
}
function missionMeta(kind: MissionKind, subject: string, topic?: string, block?: string, planTopic?: CaminoCurriculumTopic) {
  const target = missionTarget(kind, subject, topic, block, planTopic)
  return { href: target, target, source: 'camino_pau' as const, xpPolicy: 'after_correction' as const }
}
function indexesFor(count: number) { if (count <= 3) return [0, 2, 4]; if (count === 4) return [0, 1, 3, 5]; if (count === 5) return [0, 1, 2, 4, 5]; if (count === 6) return [0, 1, 2, 3, 4, 5]; return [0, 1, 2, 3, 4, 5, 6] }
function titleFor(kind: MissionKind, subject: string, item?: CurriculumItem) { if (kind === 'concept_explanation') return `Tema de hoy: ${item?.topic ?? subject}`; if (kind === 'guided_example') return `Ejemplo guiado: ${item?.topic ?? subject}`; if (kind === 'guided_practice') return `Practica guiada: ${item?.topic ?? subject}`; if (kind === 'evau_practice') return `Ejercicio PAU de ${item?.topic ?? subject}`; if (kind === 'exam_focus') return `Parcial cerca: ${item?.topic ?? subject}`; if (kind === 'mock_exam') return `Mini simulacro de ${subject}`; return `Tarea personalizada de ${subject}` }
function loadJson<T>(key: string, fallback: T): T { try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }
function saveJson(key: string, value: unknown) { window.localStorage.setItem(key, JSON.stringify(value)) }
// "Sugiéreme qué repasar" (FreeReviewPanel) guarda la propuesta aquí para
// que CompactWeekView pueda mostrarla junto a "Repaso libre" del día de hoy.
// Si el alumno pulsa "Añadir misión sugerida", se persiste en
// camino_calendar desde el endpoint idempotente correspondiente.
const FREE_REVIEW_SUGGESTION_KEY = 'kairo_free_review_suggestion_v2'
type FreeReviewOption = { subject: string; focusNote: string }
type FreeReviewSuggestion = { date: string; options: FreeReviewOption[]; selectedIndex: number; addedKeys?: string[] }
// `exam-${date}-${exams.length + 1}` could collide with an existing exam's id
// once one had been deleted (the counter resets to a value already used by a
// surviving exam on the same date) — a React key collision that can hide the
// newly-added exam from the "Exámenes parciales" list. IDs must stay unique
// for the exam's whole lifetime, not just relative to the array's current length.
function generateExamId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `exam-${crypto.randomUUID()}`
  return `exam-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
function priorityWeight(priority: ExamPriority) { if (priority === 'muy_alta') return 4; if (priority === 'alta') return 3; if (priority === 'normal') return 2; return 1 }
function priorityLabel(priority: ExamPriority) { return priority === 'muy_alta' ? 'Muy alta' : priority.charAt(0).toUpperCase() + priority.slice(1) }
// Extra rotation slots a subject earns for a given day based on how close/how prioritized its nearest exam is.
// Capped so a subject never claims the whole rotation pool — every other active subject keeps at least its base slot.
function subjectRotationWeight(subject: string, dateISO: string, relevantExams: StudentExam[]): number {
  const subjSlug = subjectSlug(subject)
  let extra = 0
  for (const exam of relevantExams) {
    if (normalizeSubjectSlug(exam.subject) !== subjSlug) continue
    const distance = daysBetween(dateISO, exam.date)
    if (distance < 0 || distance > 21) continue
    const weight = priorityWeight(exam.priority)
    if (distance <= 6) extra = Math.max(extra, weight - 1) // baja:+0, normal:+1, alta:+2, muy_alta:+3
    else if (distance <= 14 && weight >= 3) extra = Math.max(extra, 1)
  }
  return 1 + extra
}
function formatDate(dateISO: string) { return new Date(dateISO).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }
type MissionHrefResult = { href: string; fallback: string }
function hrefForMission(mission: Mission): MissionHrefResult {
  if (mission.missionType === 'partial_practice') {
    // Una práctica de parcial ya completada hoy no debe volver a abrir el
    // flujo de "nueva" — eso es justo lo que dejaba reentregar sin avisar
    // hasta corregir. Si ya sabemos a qué historial_simulacros quedó
    // enlazada (practica_simulacro_id, escrito por /api/simulacro al
    // completarla), el enlace lleva directo a esa corrección ya hecha.
    if (mission.status === 'done') {
      const resultId = typeof mission.metadata?.practica_simulacro_id === 'string' ? mission.metadata.practica_simulacro_id : ''
      return resultId
        ? { href: `/simulacros/${resultId}/results`, fallback: '' }
        : { href: '', fallback: 'Práctica completada.' }
    }
    const simSubject = String(mission.metadata?.simulacro_subject ?? '')
    const simBlock = String(mission.metadata?.simulacro_block_filter ?? mission.block ?? '')
    if (simSubject && simBlock) {
      // partial_exam_id: escrito por injectPartialExamMissions.ts al crear
      // esta misión — deja que /api/practica-parcial reutilice la práctica
      // de hoy para este Parcial (y filtre por sus exam_topics si es
      // Historia) sin depender de que el missionId coincida exacto.
      const examId = typeof mission.metadata?.partial_exam_id === 'string' ? mission.metadata.partial_exam_id : ''
      const examIdParam = examId ? `&examId=${encodeURIComponent(examId)}` : ''
      return {
        href: `/simulacros/practica/nueva?subject=${encodeURIComponent(simSubject)}&block=${encodeURIComponent(simBlock)}&source=camino_partial&missionId=${encodeURIComponent(mission.id)}${examIdParam}`,
        fallback: '',
      }
    }
  }
  if (mission.missionType === 'pau_practice') {
    // Misión automática de "ejercicios de bloque" (ver
    // generateBlockPracticeMission.ts) — igual que partial_practice arriba,
    // pero sin examId: no está ligada a ningún examen, así que
    // /api/practica-parcial resuelve sus topicSlugs directo de esta misma
    // fila (metadata.topicSlugs) en vez de exam_topics.
    if (mission.status === 'done') {
      const resultId = typeof mission.metadata?.practica_simulacro_id === 'string' ? mission.metadata.practica_simulacro_id : ''
      return resultId
        ? { href: `/simulacros/${resultId}/results`, fallback: '' }
        : { href: '', fallback: 'Práctica completada.' }
    }
    const blockPracticeFor = typeof mission.metadata?.block_practice_for === 'string' ? mission.metadata.block_practice_for : ''
    const simSubject = String(mission.metadata?.simulacro_subject ?? '')
    if (blockPracticeFor && simSubject) {
      return {
        href: `/simulacros/practica/nueva?subject=${encodeURIComponent(simSubject)}&block=${encodeURIComponent(blockPracticeFor)}&source=camino_block_practice&missionId=${encodeURIComponent(mission.id)}`,
        fallback: '',
      }
    }
    // final_mini_mock (ver injectPartialExamMissions.ts) — el mismo
    // mission_type='pau_practice' de arriba, pero para el Simulacro real de
    // 90 min en vez de una práctica de bloque. Mismo patrón de URL que
    // PartialExamBanner (examId+examScope), más missionId para que
    // /simulacros/page.tsx pueda guardarlo y la corrección marque esta
    // misión como completada (ver markCalendarMissionCompleted).
    const linksToSimulacroExamId = typeof mission.metadata?.links_to_simulacro_exam_id === 'string' ? mission.metadata.links_to_simulacro_exam_id : ''
    if (linksToSimulacroExamId && simSubject) {
      const examScope = typeof mission.metadata?.links_to_simulacro_exam_scope === 'string' ? mission.metadata.links_to_simulacro_exam_scope : 'parcial'
      return {
        href: `/simulacros?subject=${encodeURIComponent(simSubject)}&examId=${encodeURIComponent(linksToSimulacroExamId)}&examScope=${encodeURIComponent(examScope)}&source=camino_partial_final_mock&missionId=${encodeURIComponent(mission.id)}`,
        fallback: '',
      }
    }
  }
  const target = mission.href ? { href: mission.href, fallback: '' } : getMissionTarget(mission.kind, mission.subject, mission.topic, mission.block)
  if (!target.href) return target
  const separator = target.href.includes('?') ? '&' : '?'
  const start = mission.kind === 'concept_explanation' || mission.kind === 'guided_example' || mission.kind === 'guided_practice' ? '&start=exercise' : ''
  return { ...target, href: `${target.href}${separator}missionId=${encodeURIComponent(mission.id)}&source=camino_pau${start}` }
}
async function fetchLeaderboard(token: string, community: string) {
  try {
    const res = await fetch(`/api/camino/leaderboard?community=${encodeURIComponent(community)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return await res.json() as LeaderboardPayload
  } catch {
    return null
  }
}

// `force` salta el throttle diario del servidor. Solo debe usarse cuando el
// usuario acaba de provocar un cambio y espera verlo ya (crear el Camino,
// cambiar preferencias). En las cargas normales se deja en false: el servidor
// responde { skipped: 'already_ensured_today' } sin tocar camino_calendar.
async function ensureServerCalendar(token: string, force = false) {
  const res = await fetch('/api/camino/ensure-calendar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  })
  return res.ok
}

type CaminoCalRow = {
  id: string
  scheduled_date: string
  subject: string
  title: string
  block_key: string | null
  block_slug: string | null
  is_main: boolean
  is_bonus: boolean
  status: string
  v2_sort_order: number | null
  mission_type: string
  xp_awarded: number | null
  start_time: string | null
  end_time: string | null
  metadata?: Record<string, unknown> | null
}

function calRowToMission(row: CaminoCalRow): Mission {
  const subjectLabel = subjectLabelFromSlug(row.subject)
  const rowSubjectSlug = normalizeSubjectSlug(row.subject)
  const blockSlug = row.block_slug ?? (row.block_key ? textSlug(row.block_key) : '')
  const linkedTopic = getTopicByV2SortOrder(row.subject, row.v2_sort_order)
  const rawTopicSlug = typeof row.metadata?.topic_slug === 'string'
    ? normalizeTopicSlug(row.metadata.topic_slug)
    : normalizeTopicSlug(sanitizeLessonTitle(row.title))
  const topicSlug = resolveTopicSlugAlias(row.subject, blockSlug, rawTopicSlug)
  const href = linkedTopic ? buildTopicHref(linkedTopic) : resolveCourseHref(rowSubjectSlug, blockSlug, topicSlug)
  const cleanTitle = sanitizeLessonTitle(row.title)
  const estimatedMinutes = typeof row.metadata?.estimated_minutes === 'number' ? row.metadata.estimated_minutes : 30
  const weakReviewReason = typeof row.metadata?.reason === 'string' ? row.metadata.reason : null
  return {
    id: row.id,
    calendarRowId: row.id,
    role: row.is_main ? 'main' : 'bonus',
    kind: 'concept_explanation',
    subject: subjectLabel,
    block: row.block_key ?? subjectLabel,
    topic: cleanTitle,
    title: cleanTitle,
    reason: weakReviewReason ?? (row.block_key ? `${row.block_key} · misión de tu Camino PAU.` : 'Misión de tu Camino PAU.'),
    href,
    target: href,
    source: 'camino_pau',
    xpPolicy: 'after_correction',
    estimatedMinutes,
    // Antes de completar: estimación real por tipo de misión (misma fuente
    // que usa el servidor al otorgar XP — xpMap.ts), no un valor fijo de
    // 10/20 que subestimaba pau_practice/comment_text (base real 30). Ya
    // completada: el importe real otorgado (base + bonus de calidad),
    // guardado en xp_awarded por complete-mission/markCalendarMissionCompleted
    // — antes esta tarjeta se quedaba congelada en la estimación pre-completar
    // incluso después de corregir con nota, mostrando p.ej. "+20 XP" a la vez
    // que el toast de corrección ya había mostrado "+35 XP · +15 bonus" para
    // esa misma misión.
    baseXP: row.status === 'completed' && typeof row.xp_awarded === 'number' && row.xp_awarded > 0
      ? row.xp_awarded
      : resolveMissionTypeXp(row.mission_type),
    status: row.status === 'completed' ? 'done' : 'pending',
    metadata: mergeMissionMetadata(row.metadata ?? undefined, {
      start_time: row.start_time,
      end_time: row.end_time,
    }),
    subjectSlug: rowSubjectSlug,
    v2SortOrder: row.v2_sort_order ?? undefined,
    blockKey: row.block_key ?? undefined,
    missionType: row.mission_type,
    startTime: row.start_time,
    endTime: row.end_time,
  }
}

async function fetchCaminoCalendar(userId: string): Promise<DayPlan[] | null> {
  // Arranca en el lunes de la semana actual, no en "hoy": si el fetch
  // empezaba en hoy, los días ya pasados de la semana en curso (p.ej. lunes
  // y martes si hoy es miércoles) nunca llegaban a `calendar`, así que
  // buildWeekDays/fillWeekGaps los rellenaba con `missions: []` — un lunes
  // con misiones ya completadas se veía como "estudio libre" en el widget de
  // semana. Estos días pasados son solo lectura aquí: se muestran tal cual
  // quedaron registrados (completed/missed/pending), nunca se recalculan.
  const weekStartStr = currentWeekStartISO()
  const { data, error } = await supabase
    .from('camino_calendar')
    .select('id, scheduled_date, subject, title, block_key, block_slug, is_main, is_bonus, status, v2_sort_order, mission_type, xp_awarded, start_time, end_time, metadata')
    .eq('user_id', userId)
    .gte('scheduled_date', weekStartStr)
    .order('scheduled_date', { ascending: true })
    // Filas, no días — un día puede tener más de una misión (bonus,
    // comment_text, prácticas de parcial). ensureCaminoCalendar mantiene
    // sembrados CALENDAR_HORIZON=30 días futuros más hasta 6 días pasados de
    // esta semana; este límite tiene que ser generoso para no cortar antes
    // de cubrirlos todos, o el cliente caería al generador local (ver
    // generateCalendar) para días que en realidad ya están en Supabase.
    .limit(110)
  if (error || !data || data.length === 0) return null
  const byDate = new Map<string, CaminoCalRow[]>()
  for (const row of data as CaminoCalRow[]) {
    if (!byDate.has(row.scheduled_date)) byDate.set(row.scheduled_date, [])
    byDate.get(row.scheduled_date)!.push(row)
  }
  const today = todayMadrid()
  return Array.from(byDate.entries()).map(([date, rows]) => ({
    date,
    label: calendarDayLabel(date),
    isToday: date === today,
    missions: rows.map(calRowToMission),
  }))
}

async function fetchCurriculumItems(subjects: string[]): Promise<CurriculumItem[]> {
  const seeded = getCurriculumForSubjects(subjects).map(seedTopicToCurriculumItem)
  const dbSubjects = subjects.map(subject => DB_SUBJECTS[subject]).filter(Boolean)
  if (dbSubjects.length === 0) return seeded
  const { data, error } = await supabase
    .from('curriculum_flashcards')
    .select('subject, chapter_title, block_key, title, sort_order')
    .in('subject', dbSubjects)
    .eq('region', 'ambas')
    .order('sort_order', { ascending: true })

  if (error || !data) return seeded

  const flashcardItems = data.map(row => {
    const subject = subjectLabelFromSlug(row.subject)
    const blockSlug = textSlug(row.block_key)
    const rawTopicSlug = textSlug(row.chapter_title)
    return {
      subject,
      subjectSlug: normalizeSubjectSlug(row.subject),
      block: sanitizeLessonTitle(row.block_key),
      blockSlug,
      topic: sanitizeLessonTitle(row.chapter_title),
      topicSlug: resolveTopicSlugAlias(row.subject, blockSlug, rawTopicSlug),
      title: sanitizeLessonTitle(row.title),
      sortOrder: row.sort_order,
      contentStatus: 'latex_notes',
      source: 'supabase' as const,
    }
  }).filter(item => item.subjectSlug !== 'matematicas_ccss' || item.blockSlug !== 'geometria')
  return [...seeded, ...flashcardItems]
}

function curriculumForSubject(subject: string, curriculum: CurriculumItem[]) {
  const rows = curriculum.filter(item => item.subject === subject)
  if (rows.length > 0) return rows
  return FALLBACK_CURRICULUM.filter(item => item.subject === subject)
}

function examBlockOptionsForSubject(subject: string, curriculum: CurriculumItem[]): string[] {
  const rows = curriculumForSubject(subject, curriculum)
  const seen = new Set<string>()
  const blocks: string[] = []
  for (const item of rows) {
    if (item.block && !seen.has(item.block)) { seen.add(item.block); blocks.push(item.block) }
  }
  return blocks
}

function courseTopicsForSubjects(subjects: string[], curriculum: CurriculumItem[]) {
  const source = (curriculum.length ? curriculum : FALLBACK_CURRICULUM).filter(item => item.planTopic)
  const allowedSubjects = new Set(normalizeOnboardingSubjects(subjects))
  const grouped = new Map<string, Map<string, CurriculumItem[]>>()
  for (const item of source) {
    if (!allowedSubjects.has(item.subject)) continue
    if (item.subject === 'Matemáticas CCSS' && item.blockSlug === 'geometria-3d') continue
    if (!grouped.has(item.subject)) grouped.set(item.subject, new Map())
    const blocks = grouped.get(item.subject)!
    if (!blocks.has(item.block)) blocks.set(item.block, [])
    blocks.get(item.block)!.push(item)
  }
  return Array.from(grouped.entries()).map(([subject, blocks]) => ({
    subject,
    blocks: Array.from(blocks.entries()).map(([block, items]) => ({
      block,
      items: items.sort((a, b) => a.sortOrder - b.sortOrder)
    }))
  }))
}

function pickCurriculumItem(subject: string, rotation: number, curriculum: CurriculumItem[]) {
  const rows = curriculumForSubject(subject, curriculum)
  if (rows.length === 0) return null
  return rows[rotation % rows.length]
}

function loadSchoolAdjustments(): SchoolTopicAdjustment[] {
  const direct = loadJson<SchoolTopicAdjustment[]>(SCHOOL_ADJUSTMENTS_KEY, [])
  const legacy = loadJson<LegacySchoolFeedback[]>(SCHOOL_FEEDBACK_KEY, []).map(item => ({
    schoolName: item.schoolName,
    community: item.community,
    subject: item.subject,
    blockSlug: item.block,
    topicSlug: item.topic,
    feedbackType: item.reason,
    status: 'not_seen' as const,
    notSeenCount: 1,
    date: item.date,
  }))
  return [...direct, ...legacy].filter(item => item.feedbackType === 'not_seen_in_class')
}

function adjustmentMatchesSubject(adjustment: SchoolTopicAdjustment, subject: string) {
  return normalizeSubjectSlug(adjustment.subject) === subjectSlug(subject)
}

function adjustmentMatchesSchool(adjustment: SchoolTopicAdjustment, onboarding: OnboardingData) {
  if (!adjustment.schoolName) return true
  return adjustment.schoolName === onboarding.schoolName
}

function findAdjustmentForItem(item: CurriculumItem | null | undefined, subject: string, onboarding: OnboardingData, adjustments: SchoolTopicAdjustment[]) {
  if (!item) return null
  return adjustments.find(adjustment =>
    adjustmentMatchesSchool(adjustment, onboarding) &&
    adjustmentMatchesSubject(adjustment, subject) &&
    (!adjustment.blockSlug || adjustment.blockSlug === item.blockSlug || adjustment.blockSlug === textSlug(item.block)) &&
    (adjustment.topicSlug === item.topicSlug || adjustment.topicSlug === textSlug(item.topic))
  ) ?? null
}

function findReplacementItem(subject: string, blockedItem: CurriculumItem, onboarding: OnboardingData, curriculum: CurriculumItem[], adjustments: SchoolTopicAdjustment[]) {
  const rows = curriculumForSubject(subject, curriculum)
    .filter(item => item.blockSlug === blockedItem.blockSlug || item.block === blockedItem.block)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const before = rows.filter(item => item.sortOrder < blockedItem.sortOrder).reverse()
  const after = rows.filter(item => item.sortOrder > blockedItem.sortOrder)
  return [...before, ...after].find(item => !findAdjustmentForItem(item, subject, onboarding, adjustments)) ?? null
}

function schoolAdjustedItem(subject: string, item: CurriculumItem | null, onboarding: OnboardingData, curriculum: CurriculumItem[], adjustments: SchoolTopicAdjustment[], examContext?: StudentExam) {
  const adjustment = findAdjustmentForItem(item, subject, onboarding, adjustments)
  if (!item || !adjustment) return { item, adjustment: null, replacedTopic: null }
  const replacement = findReplacementItem(subject, item, onboarding, curriculum, adjustments)
  if (replacement) return { item: replacement, adjustment, replacedTopic: item.topic }
  return { item: null, adjustment, replacedTopic: examContext?.topic || item.topic }
}

const GENERAL_EXAM_BLOCK_LABELS = new Set(['', 'repaso general', 'general', 'todo el temario', 'todo'])
function isGeneralExamBlock(block: string | undefined): boolean {
  return GENERAL_EXAM_BLOCK_LABELS.has((block ?? '').trim().toLowerCase())
}

function findExamCurriculumItem(exam: StudentExam | undefined, subject: string, curriculum: CurriculumItem[]) {
  if (!exam) return null
  const blockNeedle = textSlug(exam.block || '')
  const topicNeedle = textSlug(exam.topic || '')
  if (!blockNeedle && !topicNeedle) return null
  return curriculumForSubject(subject, curriculum).find(item => {
    const block = textSlug(item.block)
    const topic = textSlug(item.topic)
    return Boolean((blockNeedle && block.includes(blockNeedle)) || (topicNeedle && topic.includes(topicNeedle)))
  }) ?? null
}

function progressKeyForItem(item: CurriculumItem | null | undefined) {
  if (!item) return ''
  return `${item.subjectSlug || subjectSlug(item.subject)}:${item.blockSlug}:${item.topicSlug}`
}

function topicIsCompleted(item: CurriculumItem | null | undefined, progress: TopicProgress) {
  const key = progressKeyForItem(item)
  return Boolean(key && progress[key]?.evau)
}

function blockIsCompleted(item: CurriculumItem | null | undefined, subject: string, curriculum: CurriculumItem[], progress: TopicProgress) {
  if (!item) return false
  const rows = curriculumForSubject(subject, curriculum).filter(row => row.blockSlug === item.blockSlug || row.block === item.block)
  return rows.length > 0 && rows.every(row => topicIsCompleted(row, progress))
}

function missionPhaseForExam(distance: number | null) {
  if (distance == null) return 'normal'
  if (distance <= 1) return 'eve'
  if (distance <= 6) return 'close'
  if (distance <= 14) return 'medium'
  return 'far'
}

function buildMission(input: {
  dateISO: string
  slot: string
  role: MissionRole
  kind: MissionKind
  subject: string
  item: CurriculumItem | null
  title: string
  reason: string
  minutes: number
  xp: number
  metadata?: Record<string, unknown>
}): Mission {
  const subjectSlugValue = input.item?.subjectSlug ?? subjectSlug(input.subject)
  const blockSlugValue = input.item?.blockSlug ?? (input.item?.block ? textSlug(input.item.block) : undefined)
  const topicSlugValue = input.item?.topicSlug ?? (input.item?.topic && blockSlugValue ? resolveTopicSlugAlias(subjectSlugValue, blockSlugValue, textSlug(input.item.topic)) : undefined)
  return {
    id: `${input.dateISO}-${input.slot}`,
    role: input.role,
    kind: input.kind,
    subject: input.subject,
    block: input.item?.block,
    topic: input.item?.topic,
    title: input.title,
    reason: input.reason,
    ...missionMeta(input.kind, input.subject, input.item?.topic, input.item?.block, input.item?.planTopic),
    estimatedMinutes: input.minutes,
    baseXP: input.xp,
    status: 'pending',
    metadata: topicSlugValue || input.metadata ? { ...(topicSlugValue ? { topic_slug: topicSlugValue } : {}), ...input.metadata } : undefined,
    subjectSlug: subjectSlugValue,
    blockKey: input.item?.block,
  }
}

function generateCalendar(onboarding: OnboardingData, exams: StudentExam[], curriculum: CurriculumItem[] = [], planId: CaminoPlanId = 'free', weekStartISO = currentWeekStartISO(), weekCache: CalendarWeekCache = {}, orientationContext: CaminoOrientationContext | null = null) {
  const planLimits = getCaminoPlanLimits(planId)
  const start = dateFromISO(weekStartISO)
  const subjects = normalizeOnboardingSubjects(onboarding.subjects)
  if (!subjects.length) {
    return Array.from({ length: 7 }, (_, index): DayPlan => {
      const date = addDays(start, index)
      const dateISO = toISO(date)
      return { date: dateISO, label: calendarDayLabel(dateISO), isToday: isRealToday(dateISO), missions: [] }
    })
  }
  const weeklyDays = Math.min(onboarding.weeklyStudyDaysValue ?? 4, planLimits.maxStudyDaysPerWeek)
  const weekDelta = Math.max(0, Math.floor(daysBetween(currentWeekStartISO(), weekStartISO) / 7))
  const topicStepPerWeek = Math.max(1, Math.ceil(weeklyDays / Math.max(subjects.length, 1)))
  const weeklyCorrectionBudget = monthlyToWeeklyLimit(planLimits.correctionsPerMonth)
  const weeklyPhotoBudget = monthlyToWeeklyLimit(planLimits.photosPerMonth)
  const maxCorrectableMissions = Math.max(1, Math.min(weeklyCorrectionBudget, Math.max(weeklyPhotoBudget, planLimits.caminoMode === 'limited' ? 2 : weeklyCorrectionBudget)))
  const minutes = onboarding.dailyMinutes ?? 60
  const indexes = indexesFor(weeklyDays)
  let subjectRotation = weekDelta * weeklyDays
  const topicRotationBySubject = new Map<string, number>(
    subjects.map(subject => [subject, weekDelta * topicStepPerWeek])
  )
  const allowedSubjectSlugs = new Set(subjects.map(subject => subjectSlug(subject)))
  const relevantExams = exams.filter(exam => allowedSubjectSlugs.has(normalizeSubjectSlug(exam.subject)))
  const weakAreas = typeof window === 'undefined' ? [] : loadJson<Array<{ subject: string; block?: string; topic?: string; score: number }>>(WEAK_AREAS_KEY, [])
  const topicProgress = typeof window === 'undefined' ? {} : loadJson<TopicProgress>(TOPIC_PROGRESS_KEY, {})
  const schoolAdjustments = typeof window === 'undefined' ? [] : loadSchoolAdjustments()
  const recentTopicKeys = new Set(
    Object.values(weekCache)
      .flat()
      .flatMap(day => day.missions)
      .map(mission => `${subjectSlug(mission.subject)}:${mission.block ? textSlug(mission.block) : ''}:${typeof mission.metadata?.topic_slug === 'string' ? mission.metadata.topic_slug : mission.topic ? textSlug(mission.topic) : ''}`)
      .filter(Boolean),
  )
  let plannedSimulationsThisRun = 0
  const nextCurriculumItem = (subject: string) => {
    const rows = curriculumForSubject(subject, curriculum)
    const startRotation = topicRotationBySubject.get(subject) ?? 0
    for (let attempt = 0; attempt < Math.max(rows.length, 1); attempt += 1) {
      const rotation = startRotation + attempt
      const item = pickCurriculumItem(subject, rotation, curriculum)
      const recentKey = item ? `${subjectSlug(subject)}:${item.blockSlug}:${item.topicSlug}` : ''
      if (!item || (!recentTopicKeys.has(recentKey) && !findAdjustmentForItem(item, subject, onboarding, schoolAdjustments))) {
        topicRotationBySubject.set(subject, rotation + 1)
        return item
      }
    }
    topicRotationBySubject.set(subject, startRotation + 1)
    return pickCurriculumItem(subject, startRotation, curriculum)
  }

  return Array.from({ length: 7 }, (_, index): DayPlan => {
    const date = addDays(start, index)
    const dateISO = toISO(date)
    const upcoming = relevantExams
      .map(exam => ({ exam, distance: daysBetween(dateISO, exam.date), weight: priorityWeight(exam.priority) }))
      .filter(item => item.distance >= 0 && item.distance <= 21)
      .sort((a, b) => a.distance - b.distance || b.weight - a.weight)[0]?.exam
    const sameDay = relevantExams.find(exam => exam.date === dateISO)
    const examDistance = sameDay ? 0 : upcoming ? daysBetween(dateISO, upcoming.date) : null
    const examPhase = missionPhaseForExam(examDistance)
    const strongExamNearby = upcoming && priorityWeight(upcoming.priority) >= 3 && examDistance != null && examDistance <= 6
    // Block correlation near an exam must not depend on priority: a normal/baja
    // priority exam with a specific block (e.g. "Geometría") still needs its
    // eve to review THAT block, not whatever the subject's overall topic
    // rotation happens to land on (which could be an unrelated block like
    // Álgebra/Gauss). Only widens which curriculum item gets picked — kind
    // (concept vs practice) selection below is untouched.
    const examHasSpecificBlock = Boolean(upcoming) && !isGeneralExamBlock(upcoming?.block)
    const blockCorrelationNearby = examHasSpecificBlock && examDistance != null && examDistance <= 6
    const studyDay = indexes.includes(index) || Boolean(sameDay)
    const missions: Mission[] = []

    if (studyDay) {
      const weakArea = weakAreas.find(area => subjects.some(subject => subjectSlug(subject) === normalizeSubjectSlug(area.subject)) && area.score < 6)
      // Exam day itself always wins the day's subject. Otherwise, priority only biases which
      // subject is more *likely* to come up in the rotation — it never removes other active
      // subjects from the pool, so a high-priority exam gets more days, not all of them.
      const rawPrioritySubject = sameDay?.subject ?? (index <= 2 ? weakArea?.subject : null)
      const prioritySubject = rawPrioritySubject ? subjectLabelFromSlug(normalizeSubjectSlug(rawPrioritySubject)) : null
      const rotationPool = subjects.flatMap(subj => Array(subjectRotationWeight(subj, dateISO, relevantExams) + orientationRotationBonusSlots(subj, orientationContext)).fill(subj) as string[])
      const subject = prioritySubject ?? rotationPool[subjectRotation % rotationPool.length]
      const examContext = sameDay ?? ((strongExamNearby || blockCorrelationNearby) ? upcoming : undefined)
      const weakItem = weakArea && normalizeSubjectSlug(weakArea.subject) === subjectSlug(subject) ? findExamCurriculumItem({ id: 'weak-area', subject, date: todayISO(), block: weakArea.block ?? '', topic: weakArea.topic ?? '', name: 'Refuerzo', priority: 'normal' }, subject, curriculum) : null
      const rawCurriculumItem = findExamCurriculumItem(examContext, subject, curriculum) ?? weakItem ?? nextCurriculumItem(subject)
      const schoolAdjusted = schoolAdjustedItem(subject, rawCurriculumItem, onboarding, curriculum, schoolAdjustments, examContext)
      const curriculumItem = schoolAdjusted.item
      if (!prioritySubject) subjectRotation += 1
      const topicDone = topicIsCompleted(curriculumItem ?? rawCurriculumItem, topicProgress)
      const blockDone = blockIsCompleted(curriculumItem ?? rawCurriculumItem, subject, curriculum, topicProgress)
      const canUseSimulation = (examPhase === 'eve' || examPhase === 'close') && canScheduleSimulation(null, planId, dateISO, weekCache, plannedSimulationsThisRun)
      const simulationLimitReached = (examPhase === 'eve' || examPhase === 'close') && !canUseSimulation && getSimulationLimitForPlan(planId) > 0
      const kind: MissionKind = schoolAdjusted.adjustment
        ? 'concept_explanation'
        : canUseSimulation
          ? 'mock_exam'
          : sameDay || strongExamNearby || topicDone || blockDone
            ? 'evau_practice'
            : 'concept_explanation'
      const reason = schoolAdjusted.adjustment
        ? examContext
          ? 'Este tema aparece en tu parcial, pero lo has marcado como no dado. Te proponemos una base previa antes de practicarlo.'
          : schoolAdjusted.replacedTopic
            ? `Tema marcado como no dado en clase: retrasamos ${schoolAdjusted.replacedTopic} y trabajamos una base previa del bloque.`
            : 'Tema marcado como no dado en clase. Repasa la base previa de este bloque.'
        : canUseSimulation ? `Parcial próximo${upcoming ? ` (${priorityLabel(upcoming.priority)})` : ''}: toca simulacro del mismo bloque sin superar tu límite mensual.`
          : simulationLimitReached ? 'Has alcanzado el límite de simulacros de tu plan este mes. Te proponemos ejercicios PAU del mismo tema.'
            : blockDone ? 'Bloque completado: pasamos a ejercicio PAU mixto y repaso inteligente, sin repetir teoría básica.'
              : topicDone ? 'Tema completado: evitamos repetir teoría básica y pasamos a práctica PAU.'
                : sameDay ? `Parcial hoy: ${sameDay.block || sameDay.topic || sameDay.name || sameDay.subject}. Prioridad a ejercicios PAU del bloque.` : weakItem ? `Refuerzo concreto de ${curriculumItem?.topic ?? weakArea?.topic ?? subject} por una corrección baja anterior.` : curriculumItem ? `${curriculumItem.block} · explicación, práctica guiada y ejercicio PAU.` : upcoming?.subject === subject ? `Parcial cercano (${priorityLabel(upcoming.priority)}): priorizamos ${subject}.` : onboarding.preparationFeeling === 'Me cuesta organizarme' ? 'Poco volumen, mucha claridad.' : 'Reparto equilibrado según tu onboarding.'
      if (missions.length < maxCorrectableMissions) {
        const missionItem = curriculumItem ?? rawCurriculumItem
        missions.push(buildMission({
          dateISO,
          slot: 'main-1',
          role: 'main',
          kind,
          subject,
          item: missionItem,
          title: kind === 'mock_exam'
            ? `Simulacro corto: ${missionItem?.block ?? subject}`
            : schoolAdjusted.adjustment ? curriculumItem ? `Base previa: ${curriculumItem.topic}` : `Base previa de ${rawCurriculumItem?.block ?? subject}` : weakItem ? `Refuerza ${curriculumItem?.topic ?? weakArea?.topic ?? subject}` : sameDay ? `Foco parcial: ${sameDay.block || sameDay.topic || subject}` : topicDone || blockDone ? `Ejercicio PAU de ${missionItem?.topic ?? subject}` : titleFor(kind, subject, missionItem ?? undefined),
          reason,
          minutes: estimatedMinutesForSlot(minutes, 0),
          xp: kind === 'mock_exam' ? 35 : kind === 'evau_practice' ? 25 : 15,
          metadata: {
            ...(upcoming && normalizeSubjectSlug(upcoming.subject) === subjectSlug(subject) ? { partial_exam_date: upcoming.date, exam_priority: upcoming.priority } : {}),
            ...(weakItem ? { weak_review: true, weak_area_label: weakArea?.topic ?? weakArea?.block ?? subject, weak_area_avg_score: weakArea?.score } : {}),
          },
        }))
        if (kind === 'mock_exam') plannedSimulationsThisRun += 1
      }

      // Extra main slots scale with the student's declared daily time
      // (missionsPerDayForMinutes) instead of a hardcoded single second
      // mission gated on `minutes >= 60` — a student who said 150-180
      // min/day gets 3-4 main missions, not capped at 2 no matter how much
      // time they declared.
      if (planLimits.caminoMode !== 'limited' && !sameDay) {
        const dailySlotCount = missionsPerDayForMinutes(minutes)
        for (let slot = 1; slot < dailySlotCount && missions.length < maxCorrectableMissions; slot++) {
          const secondItem = curriculumItem ?? rawCurriculumItem
          missions.push(buildMission({
            dateISO,
            slot: `main-${slot + 1}`,
            role: 'main',
            kind: 'evau_practice',
            subject,
            item: secondItem,
            title: blockDone ? `Ejercicio PAU mixto de ${secondItem?.block ?? subject}` : `Ejercicio PAU de ${secondItem?.topic ?? subject}`,
            reason: topicDone || blockDone ? 'Seguimos practicando con PAU porque este contenido ya está trabajado.' : 'Después del curso, practica con un ejercicio PAU del mismo tema.',
            minutes: estimatedMinutesForSlot(minutes, slot),
            xp: 25,
          }))
        }
      }

      if (planLimits.includeBonusMissions) {
        missions.push({ id: `${dateISO}-bonus-1`, role: 'bonus', kind: 'guided_example', subject, block: curriculumItem?.block, topic: curriculumItem?.topic, title: `Bonus: ejemplo guiado de ${curriculumItem?.topic ?? subject}`, reason: 'Opcional para practicar con calma.', ...missionMeta('guided_example', subject, curriculumItem?.topic, curriculumItem?.block, curriculumItem?.planTopic), estimatedMinutes: 10, baseXP: 12, status: 'pending' })
        if (missions.length < maxCorrectableMissions) {
          missions.push({ id: `${dateISO}-bonus-2`, role: 'bonus', kind: 'evau_practice', subject, block: curriculumItem?.block, topic: curriculumItem?.topic, title: `Bonus: ejercicio PAU de ${curriculumItem?.topic ?? subject}`, reason: 'Cierra el día con práctica real si te queda energía.', ...missionMeta('evau_practice', subject, curriculumItem?.topic, curriculumItem?.block, curriculumItem?.planTopic), estimatedMinutes: 12, baseXP: 12, status: 'pending' })
        }
      }
    }

    return { date: dateISO, label: calendarDayLabel(dateISO), isToday: isRealToday(dateISO), missions }
  })
}

function calendarStartsWeek(calendar: DayPlan[], weekStartISO: string) {
  return calendar[0]?.date === weekStartISO
}

function missionBelongsToSubjects(mission: Mission, subjects: string[]) {
  const allowed = new Set(subjects.map(subject => normalizeSubjectSlug(subject)))
  return Boolean(mission.subject && allowed.has(normalizeSubjectSlug(mission.subject)))
}

function missionHasStructuredTarget(mission: Mission) {
  return Boolean(
    mission.id &&
    mission.subject &&
    mission.block &&
    mission.topic &&
    mission.href &&
    mission.target &&
    mission.source === 'camino_pau' &&
    mission.xpPolicy === 'after_correction'
  )
}

function visibleCalendarForOnboarding(calendar: DayPlan[], onboarding: OnboardingData | null) {
  if (!onboarding) return calendar
  return calendar.map(day => ({
    ...day,
    missions: day.missions.filter(mission => missionBelongsToSubjects(mission, onboarding.subjects) && missionHasStructuredTarget(mission)),
  }))
}

function missionCount(days: DayPlan[]) {
  return days.reduce((sum, day) => sum + day.missions.length, 0)
}

function calendarMatchesOnboarding(calendar: DayPlan[], onboarding: OnboardingData, weekStartISO = currentWeekStartISO()) {
  if (!calendarStartsWeek(calendar, weekStartISO)) return false
  return calendar.every(day => day.missions.every(mission =>
    missionBelongsToSubjects(mission, onboarding.subjects) &&
    missionHasStructuredTarget(mission) &&
    !/flashcard|tarjeta|mazo|historial|corrige un error|revisa tus errores/i.test(`${mission.kind} ${mission.title} ${mission.reason}`)
  ))
}

export default function CaminoCalendarClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isFirstSession = searchParams.get('first_session') === '1'
  const calendarSourceEventsRef = useRef<Set<string>>(new Set())
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const [calendar, setCalendar] = useState<DayPlan[]>([])
  const [exams, setExams] = useState<StudentExam[]>([])
  const [localOrientationContext, setLocalOrientationContext] = useState<CaminoOrientationContext | null>(null)
  const [persistedOrientationTarget, setPersistedOrientationTarget] = useState<PersistedOrientationGoal | null | undefined>(undefined)
  // ?editExam=<id> (used by the "elige tus temas" message on a Historia
  // Parcial with no exam_topics, see app/simulacros/page.tsx) deep-links
  // straight into that exam's edit modal instead of leaving the student to
  // hunt for it in the list.
  const editExamParam = searchParams.get('editExam')
  const editExamParamHandledRef = useRef<string | null>(null)
  const [xpTotal, setXpTotal] = useState(0)
  const [weeklyXP, setWeeklyXP] = useState(0)
  const [weeklySimsCompleted, setWeeklySimsCompleted] = useState(0)
  const [weeklyExamsCompleted, setWeeklyExamsCompleted] = useState(0)
  // Asignaturas donde el alumno ya trabajó hoy por su cuenta desde
  // /examenes o /simulacros (no vía Camino, que ya se refleja como misión
  // normal en camino_calendar con source='free_initiative' — ver
  // /api/camino/complete-mission). Esas dos fuentes no tienen un tema
  // exacto enlazable a v2_sort_order, así que aquí solo se refleja a nivel
  // de asignatura+día, sin intentar excluir contenido del plan por ello.
  const [freeActivitySubjectsToday, setFreeActivitySubjectsToday] = useState<string[]>([])
  const [rankingOpen, setRankingOpen] = useState(false)

  const [showFullRanking, setShowFullRanking] = useState(false)
  const [fullRankingToken, setFullRankingToken] = useState<string | null>(null)
  const [showExamForm, setShowExamForm] = useState(false)
  const [editingExamId, setEditingExamId] = useState<string | null>(null)
  const [examDraft, setExamDraft] = useState({ subject: '', date: toISO(addDays(new Date(), 3)), block: '', topic: '', topicIds: [] as string[], examScope: 'parcial' as ExamScope, name: '', priority: 'normal' as ExamPriority, confidence: 'medio' as ExamConfidence, content: '' })
  const [savingExam, setSavingExam] = useState(false)
  const [recalcExamId, setRecalcExamId] = useState<string | null>(null)
  const [recalcResult, setRecalcResult] = useState<{ examId: string; message: string } | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardPayload | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [curriculumItems, setCurriculumItems] = useState<CurriculumItem[]>([])
  const [showCalendarEditor, setShowCalendarEditor] = useState(false)
  const [showAddSubjectModal, setShowAddSubjectModal] = useState(false)
  const [addSubjectLoading, setAddSubjectLoading] = useState(false)
  const [calendarExpanded, setCalendarExpanded] = useState(false)
  const [expandedDayDate, setExpandedDayDate] = useState<string | null>(null)
  const [showPastExams, setShowPastExams] = useState(false)
  const [selectedWeekStart, setSelectedWeekStart] = useState(currentWeekStartISO())
  const [calendarConflicts, setCalendarConflicts] = useState<CalendarConflict[]>([])
  const [externalBusyByDate, setExternalBusyByDate] = useState<ExternalBusyByDate>({})
  const [calendarConflictStatus, setCalendarConflictStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [calendarReorganizeStatus, setCalendarReorganizeStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [calendarAvailabilityRefreshKey, setCalendarAvailabilityRefreshKey] = useState(0)
  const [caminoPlanId, setCaminoPlanId] = useState<CaminoPlanId>('free')
  const [ligas, setLigas] = useState<LigaInfo[]>([])
  const [ligaLoading, setLigaLoading] = useState(true)
  const [globalTop, setGlobalTop] = useState<GlobalTopEntry[] | null>(null)
  const [globalNextTarget, setGlobalNextTarget] = useState<{ name: string; xpNeeded: number } | null>(null)
  const [globalMyRank, setGlobalMyRank] = useState<number | null>(null)
  const [leagueUpgrade, setLeagueUpgrade] = useState<{ from: string; to: string } | null>(null)
  const [supabaseCalLoaded, setSupabaseCalLoaded] = useState(false)
  const [streak, setStreak] = useState(0)
  const [subjectProgress, setSubjectProgress] = useState<Record<string, number>>({})
  const [blockCompletedCount, setBlockCompletedCount] = useState(0)
  const [daysSinceReg, setDaysSinceReg] = useState<number | null>(null)
  const [caminoReadyStatus, setCaminoReadyStatus] = useState<'checking' | 'no_queue' | 'no_future' | 'ready'>('checking')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showNotSeenConfirm, setShowNotSeenConfirm] = useState(false)
  const [projection, setProjection] = useState<Array<{ asignatura: string; nota_proyectada: number | null; num_entries: number; recent_entries: number; confidence: 'low' | 'medium' | 'high'; trend_7d: number | null; bloques: Array<{ bloque: string; nota_proyectada: number; num_entries: number; avg_max_pts: number | null }> }> | null>(null)
  const [centroPulso, setCentroPulso] = useState<{ enoughData: true; centroDisplay: string; subject: string; topicName: string; position: 'ahead' | 'same' | 'behind'; delta: number; peers: number } | null>(null)
  const [sundayMockSession, setSundayMockSession] = useState<{ id: string; nota_final: number | null } | null | undefined>(undefined)
  const [monthlySimsUsed, setMonthlySimsUsed] = useState(0)
  const isSunday = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' }) === 'Sun'

  // Auth guard: every other protected route in the app redirects to /login
  // when there's no session (settings, planning, simulacros, zona...) but
  // this page never did. Every session-dependent effect below just no-ops
  // on a missing session, so an unauthenticated visit — e.g. the daily
  // mission email opened in a browser/webview that doesn't share the
  // logged-in session — rendered a permanently blank page (see the
  // `!hasProfile` early return further down) instead of sending the user
  // to log in.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (!data.session) router.push('/login?returnTo=%2Fcamino')
    })
    return () => { cancelled = true }
  }, [router])

  // First-session redirect: when calendar is ready, send new users to their first mission
  useEffect(() => {
    if (!isFirstSession || caminoReadyStatus !== 'ready' || calendar.length === 0) return
    const realTodayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
    const todayDay = calendar.find(d => d.date === realTodayStr)
    const firstMission = todayDay?.missions.find(m => m.role === 'main')
    if (!firstMission) return
    const target = hrefForMission(firstMission)
    if (!target.href) return
    const sep = target.href.includes('?') ? '&' : '?'
    router.replace(`${target.href}${sep}first_session=1`)
  }, [isFirstSession, caminoReadyStatus, calendar, router])

  function recordCalendarSource(source: CalendarSource, context: CalendarSourceContext, details: { weekStart?: string; missionCount?: number; reason?: string } = {}) {
    const weekStart = details.weekStart ?? selectedWeekStart
    const key = `${context}:${source}:${weekStart}:${details.reason ?? ''}`
    if (calendarSourceEventsRef.current.has(key)) return
    calendarSourceEventsRef.current.add(key)
    supabase.auth.getSession()
      .then(({ data }) => {
        const token = data.session?.access_token
        if (!token) return
        return fetch('/api/camino/calendar-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            source,
            context,
            weekStart,
            missionCount: details.missionCount,
            reason: details.reason,
          }),
        })
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    let cancelled = false
    async function loadInitialState() {
      const loadedOnboarding = loadOnboarding()
      if (cancelled) return

      // Pintado inmediato con la copia local (evita parpadeo) — se
      // reconcilia con el servidor justo debajo, sea cual sea su estado.
      const loadedExams = loadJson<StudentExam[]>(EXAMS_KEY, [])
      const loadedCalendarExpanded = loadJson<boolean>(CALENDAR_VISIBILITY_KEY, false)
      const loadedOrientationContext = parseCaminoOrientationContext(window.localStorage.getItem(CAMINO_ORIENTATION_CONTEXT_KEY))
      setOnboarding(loadedOnboarding)
      setExams(loadedExams)
      setLocalOrientationContext(loadedOrientationContext)
      setCalendarExpanded(loadedCalendarExpanded)
      setSelectedWeekStart(currentWeekStartISO())
      setExamDraft(current => ({ ...current, subject: loadedOnboarding.subjects[0] ?? 'Matemáticas II' }))
      fetchCurriculumItems(loadedOnboarding.subjects)
        .then(items => { if (!cancelled) setCurriculumItems(items.length ? items : FALLBACK_CURRICULUM) })
        .catch(() => { if (!cancelled) setCurriculumItems(FALLBACK_CURRICULUM) })

      // El servidor es la fuente de verdad de qué asignaturas tiene el
      // alumno — antes solo se reconciliaba la primera vez que ESTE
      // navegador completaba onboarding; a partir de ahí se quedaba para
      // siempre con la copia local, así que un cambio hecho desde otro
      // dispositivo (u otra pestaña añadiendo una asignatura desde Camino)
      // nunca llegaba aquí. Ahora se reconcilia en cada carga.
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token || cancelled) return
        const result = await restoreOnboardingFromServer(token)
        if (cancelled) return
        if (result.status === 'found') {
          setOnboarding(result.data)
          setExamDraft(current => ({ ...current, subject: result.data.subjects[0] ?? current.subject }))
          fetchCurriculumItems(result.data.subjects)
            .then(items => { if (!cancelled) setCurriculumItems(items.length ? items : FALLBACK_CURRICULUM) })
            .catch(() => undefined)
        } else if (result.status === 'empty' && loadedOnboarding.completedAt) {
          // El servidor confirma que ESTA cuenta no completó onboarding,
          // aunque el navegador tuviera una copia local "completada" (p.ej.
          // de otra cuenta probada en el mismo navegador). El servidor manda:
          // se descarta la copia local para que el guard de redirect actúe.
          clearOnboarding()
          setOnboarding(loadOnboarding())
        }
        // status === 'error': se mantiene la copia local ya pintada arriba.
      } catch { /* si falla, se queda con la copia local ya pintada arriba */ }
      if (!cancelled) setOnboardingChecked(true)
    }
    loadInitialState()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const userId = data.session?.user.id
      if (!userId || cancelled) return
      const token = data.session?.access_token
      // El servidor es la fuente de verdad de los parciales del alumno —
      // antes solo se reconciliaba si la copia local de ESTE navegador
      // estaba vacía, así que en cuanto un dispositivo tenía algo en caché
      // (aunque fuera antiguo) nunca más volvía a leer el servidor: un
      // parcial añadido desde otro dispositivo no llegaba nunca, y al
      // añadir uno aquí se sobrescribía la fila entera con la lista local
      // desactualizada. Ahora se reconcilia en cada carga, igual que ya
      // hace el onboarding más arriba.
      if (token) {
        fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then((profile: { student_exams?: StudentExam[]; target_degree?: unknown; target_university?: unknown; target_admission_score?: unknown; target_orientation_source_type?: unknown; target_orientation_community?: unknown }) => {
            if (Array.isArray(profile.student_exams) && !cancelled) {
              setExams(profile.student_exams)
              saveJson(EXAMS_KEY, profile.student_exams)
            }
            if (!cancelled) {
              const admissionScore = Number(profile.target_admission_score)
              setPersistedOrientationTarget(
                typeof profile.target_degree === 'string' && typeof profile.target_university === 'string' && Number.isFinite(admissionScore)
                  ? { degree: profile.target_degree, university: profile.target_university, community: typeof profile.target_orientation_community === 'string' ? profile.target_orientation_community : null, admissionScore, sourceType: profile.target_orientation_source_type === 'official' || profile.target_orientation_source_type === 'fixture' ? profile.target_orientation_source_type : null }
                  : null,
              )
            }
          })
          .catch(() => undefined)
      }
      const created = data.session?.user.created_at
      if (created) {
        const days = Math.floor((Date.now() - new Date(created).getTime()) / 86400000)
        if (!cancelled) setDaysSinceReg(days)
      }
      if (token) await ensureServerCalendar(token)
      if (cancelled) return
      const weekStart = currentWeekStartISO()
      const weekEnd = toISO(addDays(dateFromISO(weekStart), 6))
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const todayStr = todayMadrid()
      const [calDays, rachaValue, matCount, ccssCount, lenguaCount, historiaCount, fisicaCount, quimicaCount, progressRow, weeklyXpRows, queueResult, simsWeekResult, monthlySimsResult, examsWeekResult, freeExamsToday, freeSimsToday] = await Promise.all([
        fetchCaminoCalendar(userId),
        calcularRacha(userId, supabase),
        supabase.from('camino_calendar').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed').eq('subject', 'matematicas_ii'),
        supabase.from('camino_calendar').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed').eq('subject', 'matematicas_ccss'),
        supabase.from('camino_calendar').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed').eq('subject', 'lengua'),
        supabase.from('camino_calendar').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed').eq('subject', 'historia_espana'),
        supabase.from('camino_calendar').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed').eq('subject', 'fisica'),
        supabase.from('camino_calendar').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed').eq('subject', 'quimica'),
        supabase.from('camino_user_progress').select('xp_total').eq('user_id', userId).maybeSingle(),
        supabase.from('camino_xp_events').select('xp_amount').eq('user_id', userId).gte('created_at', weekStart + 'T00:00:00Z'),
        supabase.from('user_learning_queue').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('historial_simulacros').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('estado', 'completado').gte('created_at', weekStart + 'T00:00:00Z').lte('created_at', weekEnd + 'T23:59:59Z'),
        supabase.from('historial_simulacros').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('estado', 'completado').gte('created_at', startOfMonth),
        // historial_examenes no tiene columna 'estado' — nota != null es la
        // misma condición que usa award-exam-xp/route.ts para considerar una
        // corrección real (no evaluable = no cuenta).
        supabase.from('historial_examenes').select('*', { count: 'exact', head: true }).eq('user_id', userId).not('nota', 'is', null).gte('created_at', weekStart + 'T00:00:00Z').lte('created_at', weekEnd + 'T23:59:59Z'),
        // Práctica libre de hoy fuera de Camino (Exámenes/Simulacros directos)
        // — sin v2_sort_order/tema exacto enlazable, así que solo se agrega a
        // nivel de asignatura para el indicador "también trabajaste hoy".
        supabase.from('historial_examenes').select('asignatura').eq('user_id', userId).neq('tipo', 'Camino PAU').not('nota', 'is', null).gte('created_at', todayStr + 'T00:00:00Z').lte('created_at', todayStr + 'T23:59:59Z'),
        supabase.from('historial_simulacros').select('asignatura').eq('user_id', userId).eq('estado', 'completado').gte('created_at', todayStr + 'T00:00:00Z').lte('created_at', todayStr + 'T23:59:59Z'),
      ])
      if (cancelled) return
      const freeSubjects = new Set<string>()
      for (const row of (freeExamsToday.data ?? []) as Array<{ asignatura: string }>) {
        freeSubjects.add(subjectLabelFromSlug(caminoSubjectFromSimulacro(row.asignatura)))
      }
      for (const row of (freeSimsToday.data ?? []) as Array<{ asignatura: string }>) {
        freeSubjects.add(subjectLabelFromSlug(caminoSubjectFromSimulacro(row.asignatura)))
      }
      setFreeActivitySubjectsToday([...freeSubjects])
      if (calDays && calDays.length > 0) {
        setCalendar(calDays)
        saveCalendarWeeksToCache(calDays)
        setSupabaseCalLoaded(true)
        setCaminoReadyStatus('ready')
        recordCalendarSource('server', 'initial_load', { weekStart, missionCount: missionCount(calDays) })
        const realTodayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
        const todayDay = calDays.find(d => d.date === realTodayStr)
        const heroMission = todayDay?.missions.find(m => m.role === 'main')
        if (heroMission?.blockKey) {
          supabase
            .from('camino_calendar')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('block_key', heroMission.blockKey)
            .eq('status', 'completed')
            .then(({ count }) => { if (!cancelled) setBlockCompletedCount(count ?? 0) })
        }
      } else {
        const qCount = (queueResult as { count: number | null }).count ?? 0
        recordCalendarSource('server_empty', 'initial_load', { weekStart, missionCount: 0, reason: qCount > 0 ? 'queue_without_future_calendar' : 'empty_queue' })
        if (!cancelled) setCaminoReadyStatus(qCount > 0 ? 'no_future' : 'no_queue')
      }
      setStreak(rachaValue)
      setSubjectProgress({
        matematicas_ii: matCount.count ?? 0,
        matematicas_ccss: ccssCount.count ?? 0,
        lengua: lenguaCount.count ?? 0,
        historia_espana: historiaCount.count ?? 0,
        fisica: fisicaCount.count ?? 0,
        quimica: quimicaCount.count ?? 0,
      })
      setXpTotal(Number(progressRow.data?.xp_total) || 0)
      setWeeklyXP(((weeklyXpRows.data ?? []) as Array<{ xp_amount: number }>).reduce((sum, r) => sum + (Number(r.xp_amount) || 0), 0))
      setWeeklySimsCompleted((simsWeekResult as { count: number | null }).count ?? 0)
      setMonthlySimsUsed((monthlySimsResult as { count: number | null }).count ?? 0)
      setWeeklyExamsCompleted((examsWeekResult as { count: number | null }).count ?? 0)
    }).catch(() => {
      recordCalendarSource('server_error', 'initial_load', { weekStart: currentWeekStartISO(), reason: 'initial_load_failed' })
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (caminoReadyStatus !== 'no_future') return
    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id
      if (!userId || cancelled) return
      const token = data.session?.access_token
      if (token) await ensureServerCalendar(token)
      const calDays = await fetchCaminoCalendar(userId)
      if (cancelled) return
      if (calDays && calDays.length > 0) {
        setCalendar(calDays)
        saveCalendarWeeksToCache(calDays)
        setSupabaseCalLoaded(true)
        setCaminoReadyStatus('ready')
        recordCalendarSource('server', 'initial_load', { weekStart: currentWeekStartISO(), missionCount: missionCount(calDays), reason: 'retry_after_empty' })
      } else {
        recordCalendarSource('server_empty', 'initial_load', { weekStart: currentWeekStartISO(), missionCount: 0, reason: 'retry_still_empty' })
        setCaminoReadyStatus('no_queue')
      }
    }, 2000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [caminoReadyStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onboarding?.community) return
    const community = onboarding.community
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token ?? null
      if (cancelled) return
      if (!token) return
      const next = await fetchLeaderboard(token, community)
      if (!cancelled && next) setLeaderboard(next)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [onboarding?.community])

  // displayedXP/ranking below prefer leaderboard.currentXp over the locally
  // bumped xpTotal (see displayedXP), but leaderboard was only ever fetched
  // once on mount — so after earning XP with a quality bonus (e.g. a good
  // simulacro grade), the ranking kept showing the pre-bonus number until a
  // full reload. Call this after anything that awards XP.
  async function refreshLeaderboard() {
    if (!onboarding?.community) return
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    const next = await fetchLeaderboard(token, onboarding.community)
    if (next) setLeaderboard(next)
  }

  // Compartido por el botón "Clasificación →" del panel derecho (solo
  // desktop, lg+) y por el chip equivalente del ticker (solo lg:hidden) —
  // mismo modal (FullRankingModal), mismo estado, un único punto de entrada
  // en dos sitios distintos según el tamaño de pantalla.
  async function openFullRanking() {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token ?? null
    if (!token) { setToast('No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.'); return }
    setFullRankingToken(token)
    setShowFullRanking(true)
  }

  // refreshLeaderboard is redefined every render and closes over that
  // render's onboarding — the visibility/focus listener effect below is
  // attached once on mount, so calling refreshLeaderboard directly from it
  // would permanently use the first render's version (onboarding still null
  // then). useEffectEvent gives a stable function that always runs with the
  // latest render's values without needing a manual ref or re-subscribing
  // the listener on every onboarding change.
  const notifyLeaderboardRefresh = useEffectEvent(() => {
    refreshLeaderboard()
  })

  // XP earned elsewhere (a simulacro, an exam correction — different
  // pages/tabs) doesn't touch this component's state at all, so the
  // leaderboard fetched once above could otherwise sit stale for the rest
  // of the session. Refresh whenever the student comes back to this tab.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') notifyLeaderboardRefresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token ?? null
      if (!token || cancelled) return
      try {
        const res = await fetch('/api/proyeccion', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok || cancelled) return
        const json = await res.json() as { projections?: Array<{ asignatura: string; nota_proyectada: number | null; num_entries: number; recent_entries: number; confidence: 'low' | 'medium' | 'high'; trend_7d: number | null; bloques: Array<{ bloque: string; nota_proyectada: number; num_entries: number; avg_max_pts: number | null }> }> }
        if (!cancelled) setProjection(json.projections ?? [])
      } catch { /* silently ignore */ }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token ?? null
      if (!token || cancelled) return
      try {
        const res = await fetch('/api/centro/pulso', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok || cancelled) return
        const json = await res.json() as { enoughData: boolean; centroDisplay?: string; subject?: string; topicName?: string; position?: 'ahead' | 'same' | 'behind'; delta?: number; peers?: number }
        if (!cancelled && json.enoughData && json.centroDisplay && json.subject && json.topicName && json.position !== undefined && json.delta !== undefined && json.peers !== undefined) {
          setCentroPulso({ enoughData: true, centroDisplay: json.centroDisplay, subject: json.subject, topicName: json.topicName, position: json.position, delta: json.delta, peers: json.peers })
        }
      } catch { /* silently ignore */ }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isSunday) { setSundayMockSession(null); return }
    const weekStart = currentWeekStartISO()
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session || cancelled) return
      const { data: rows } = await supabase
        .from('historial_simulacros')
        .select('id, nota_final, estado')
        .contains('resultado_json', { source: 'sunday_mock', week_start: weekStart })
        .eq('estado', 'completado')
        .limit(1)
      if (cancelled) return
      const done = rows?.[0] ?? null
      setSundayMockSession(done ? { id: String(done.id), nota_final: done.nota_final != null ? Number(done.nota_final) : null } : null)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [isSunday]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onboarding?.completedAt) return
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token ?? null
      if (!token || cancelled) return
      const res = await fetch('/api/billing/me', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok || cancelled) return
      const billing = await res.json() as { activePlans?: Array<{ planId?: string | null }> }
      const planId = normalizeCaminoPlanId(billing.activePlans?.[0]?.planId)
      if (!cancelled) setCaminoPlanId(planId)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [onboarding?.completedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token ?? null
      if (!token || cancelled) { if (!cancelled) setLigaLoading(false); return }
      const res = await fetch('/api/ligas', { headers: { Authorization: `Bearer ${token}` } })
      if (!cancelled && res.ok) { const d = await res.json(); setLigas(d.ligas ?? []) }
      if (!cancelled) setLigaLoading(false)
    }).catch(() => { if (!cancelled) setLigaLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Top 5 Global junto a Mi liga — mismo endpoint/campos que la pestaña
  // Global del modal completo, sin lógica de XP propia.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token ?? null
      if (!token || cancelled) return
      const res = await fetch('/api/ligas/global?period=total', { headers: { Authorization: `Bearer ${token}` } })
      if (!cancelled && res.ok) {
        const d = await res.json() as { entries?: GlobalTopEntry[]; nextTarget?: { name: string; xpNeeded: number } | null; myRank?: number }
        setGlobalTop((d.entries ?? []).slice(0, 5))
        setGlobalNextTarget(d.nextTarget ?? null)
        setGlobalMyRank(typeof d.myRank === 'number' ? d.myRank : null)
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const hasProfile = Boolean(onboarding?.completedAt && onboarding.community && onboarding.subjects.length)

  useEffect(() => {
    if (onboardingChecked && !hasProfile) router.push('/onboarding')
  }, [onboardingChecked, hasProfile, router])

  useEffect(() => {
    if (!hasProfile) return
    let cancelled = false
    async function loadCalendarConflicts() {
      setCalendarConflictStatus('loading')
      setCalendarReorganizeStatus('idle')
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token || cancelled) return
      const weekEnd = toISO(addDays(dateFromISO(selectedWeekStart), 6))
      try {
        const res = await fetch(`/api/camino/calendar-conflicts?start=${selectedWeekStart}&end=${weekEnd}&refresh=1`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json().catch(() => null) as { conflicts?: CalendarConflict[]; busyByDate?: ExternalBusyByDate; unavailable?: boolean } | null
        if (cancelled) return
        setCalendarConflicts(Array.isArray(json?.conflicts) ? json.conflicts : [])
        setExternalBusyByDate(json?.busyByDate && typeof json.busyByDate === 'object' ? json.busyByDate : {})
        setCalendarConflictStatus(json?.unavailable ? 'unavailable' : 'ready')
      } catch {
        if (!cancelled) {
          setCalendarConflicts([])
          setExternalBusyByDate({})
          setCalendarConflictStatus('unavailable')
        }
      }
    }
    loadCalendarConflicts()
    return () => { cancelled = true }
  }, [hasProfile, selectedWeekStart, calendar, calendarExpanded, calendarAvailabilityRefreshKey])

  useEffect(() => {
    if (!hasProfile) return
    const refreshAvailability = () => {
      if (document.visibilityState === 'visible') setCalendarAvailabilityRefreshKey(key => key + 1)
    }
    document.addEventListener('visibilitychange', refreshAvailability)
    window.addEventListener('focus', refreshAvailability)
    return () => {
      document.removeEventListener('visibilitychange', refreshAvailability)
      window.removeEventListener('focus', refreshAvailability)
    }
  }, [hasProfile])

  const realToday = todayMadrid()
  const orientationContext = matchingOrientationContext(localOrientationContext, persistedOrientationTarget)
  const orientationTarget: PersistedOrientationGoal | null = persistedOrientationTarget ?? null
  const visibleCalendar = visibleCalendarForOnboarding(calendar, onboarding).map(day => ({
    ...day,
    missions: day.missions.map(mission => withPriorityReasons(mission, orientationContext, realToday)),
  }))
  const today = visibleCalendar.find(day => day.date === realToday) ?? { date: realToday, label: calendarDayLabel(realToday), isToday: true, missions: [] }
  const allMissions = visibleCalendar.flatMap(day => day.missions)
  const totalMain = allMissions.filter(mission => mission.role === 'main').length
  const completedMain = allMissions.filter(mission => mission.role === 'main' && mission.status === 'done').length
  // Un simulacro/práctica parcial (historial_simulacros, weeklySimsCompleted)
  // o una corrección de Exámenes (historial_examenes, weeklyExamsCompleted)
  // no viven como filas de camino_calendar, así que nunca marcan como 'done'
  // ninguna misión role='main' — aunque el calendario haya programado justo
  // ese día una misión kind='mock_exam' o 'evau_practice'. Sin esto el
  // contador se quedaba en 0 tras completar cualquiera de los dos, aunque XP
  // y racha sí se actualizaran (esos sí leen camino_xp_events). Se suman como
  // si fueran una misión normal más, sin superar el objetivo semanal ya
  // mostrado (Math.min(totalMain, 5)) para no desbordar la UI.
  const completedMainWithSims = Math.min(completedMain + weeklySimsCompleted + weeklyExamsCompleted, Math.min(totalMain, 5))
  const todayMain = rankMissionCandidates(today?.missions.filter(mission => mission.role === 'main') ?? [], orientationContext, realToday)
  const todayBonus = today?.missions.filter(mission => mission.role === 'bonus') ?? []
  const todayDone = todayMain.length > 0 && todayMain.every(mission => mission.status === 'done')
  const displayedXP = leaderboard?.currentXp ?? xpTotal
  const division = divisionFor(displayedXP)
  const nextDivision = DIVISIONS[DIVISIONS.indexOf(division) + 1]
  const divisionPct = nextDivision ? Math.min(100, Math.round(((displayedXP - division.min) / (nextDivision.min - division.min)) * 100)) : 100

  // Puesto del héroe. Solo se muestra cuando lo sabemos de verdad.
  //
  // Antes leía /api/camino/leaderboard, que resuelve el nombre público
  // mirando perfiles.display_name/nombre/name — campos que no existen en el
  // esquema real (el nombre público vive en perfiles.username). Como
  // resultado, cualquier otro alumno sin esos campos se filtraba del
  // ranking entero, así que casi todo el mundo aparecía solo consigo mismo y
  // salía "#1" sin importar su XP real — contradiciendo el puesto correcto
  // que ya se ve justo debajo en "Mi liga". Ahora usamos esa misma fuente
  // (liga.miembros, ya con el username correcto) para que el héroe y la
  // lista de abajo nunca discrepen.
  // Con hasta MAX_LIGAS_PER_USER ligas, se muestra el mejor puesto entre
  // todas — el alumno enseña su mejor posición, no una liga arbitraria.
  const heroRank: number | null = ligas.length
    ? ligas.reduce<number | null>((best, l) => {
        const idx = [...l.miembros].sort((a, b) => b.total_xp - a.total_xp).findIndex(m => m.name === 'Tú')
        const rank = idx >= 0 ? idx + 1 : null
        if (rank == null) return best
        return best == null ? rank : Math.min(best, rank)
      }, null)
    : null
  const onboardingSubjects = normalizeOnboardingSubjects(onboarding?.subjects ?? [])
  const courseGroups = courseTopicsForSubjects(onboardingSubjects, curriculumItems.length ? curriculumItems : FALLBACK_CURRICULUM)
  const caminoPlanLimits = getCaminoPlanLimits(caminoPlanId)
  const hasOnboardingSubjects = Boolean(onboarding?.subjects.length)
  const microMission = (todayMain.length > 0 || !hasOnboardingSubjects || caminoReadyStatus !== 'ready')
    ? null
    : (() => {
      const topEntry = Object.entries(subjectProgress).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])[0]
      const topSlug = topEntry?.[0] ?? (onboardingSubjects[0] ? subjectSlug(onboardingSubjects[0]) : null)
      if (!topSlug) return null
      const subjectLabel = subjectLabelFromSlug(topSlug)
      const items = (curriculumItems.length ? curriculumItems : FALLBACK_CURRICULUM)
        .filter(item => (item.subjectSlug === topSlug || subjectSlug(item.subject) === topSlug) && item.planTopic)
      const item = items[0] ?? null
      const href = item?.planTopic
        ? `${buildTopicHref(item.planTopic)}?start=exercise&source=repaso_express`
        : `/examenes?subject=${encodeURIComponent(topSlug)}&mode=random&source=repaso_express`
      return { subject: subjectLabel, subjectSlug: topSlug, topic: item?.topic ?? subjectLabel, href, hasCompletedItems: Boolean(topEntry) }
    })()
  const isRescueMode = calendar.some(day => day.missions.some(m => m.metadata?.plan_mode === 'rescue'))
  const selectedWeekLabel = weekRangeLabel(selectedWeekStart)
  const selectedIsCurrentWeek = selectedWeekStart === currentWeekStartISO()
  const nextMissionInCalendar = visibleCalendar
    .filter(day => day.date > realToday)
    .flatMap(day => day.missions.filter(m => m.role === 'main' && m.status !== 'done'))
    [0] ?? null

  const weekEndISO = toISO(addDays(dateFromISO(selectedWeekStart), 6))
  const weekCalendar = buildWeekDays(selectedWeekStart, visibleCalendar.filter(day => day.date >= selectedWeekStart && day.date <= weekEndISO))
  const activeExams = exams.filter(e => e.date >= realToday)
  const pastExams = exams.filter(e => e.date < realToday)
  const upcomingPartial = (() => {
    const horizon = toISO(addDays(new Date(), 7))
    return exams
      .filter(e => e.date >= realToday && e.date <= horizon)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  })()

  const userSubjectSlugs = new Set(onboardingSubjects.map(s => subjectSlug(s)))
  const filteredProjection = projection?.filter(p => userSubjectSlugs.has(p.asignatura)) ?? null
  const isShareWindow = (() => {
    const dow = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' })
    return dow === 'Fri' || dow === 'Sat' || dow === 'Sun'
  })()
  const heroAsignatura = (() => {
    const todayMainSubject = todayMain[0]?.subjectSlug ?? null
    if (todayMainSubject) return todayMainSubject
    if (!filteredProjection?.length) return null
    const nextPartialSlug = upcomingPartial ? subjectSlug(upcomingPartial.subject) : null
    if (nextPartialSlug && filteredProjection.some(p => p.asignatura === nextPartialSlug)) return nextPartialSlug
    return [...filteredProjection].sort((a, b) => b.recent_entries - a.recent_entries)[0]?.asignatura ?? null
  })()

  const sundayMockSimSubject = heroAsignatura ? (CAMINO_TO_SIM_SUBJECT[heroAsignatura] ?? null) : null
  const sundayMockBlock = (() => {
    if (!heroAsignatura) return null
    const heroProj = filteredProjection?.find(p => p.asignatura === heroAsignatura)
    if (heroProj?.bloques.length) return heroProj.bloques[0].bloque
    // Fallback: block with fewest completed missions for the hero subject
    const counts = new Map<string, number>()
    for (const m of allMissions.filter(m => m.subjectSlug === heroAsignatura && m.blockKey)) {
      const k = m.blockKey!
      counts.set(k, (counts.get(k) ?? 0) + (m.status === 'done' ? 1 : 0))
    }
    if (!counts.size) return null
    return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0]
  })()

  async function shareInforme() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    try {
      const res = await fetch('/api/informe/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) { setToast('No se pudo generar el enlace'); return }
      const { url } = await res.json() as { url?: string }
      if (!url) { setToast('No se pudo generar el enlace'); return }
      const isMobile = /Mobi|Android/i.test(navigator.userAgent)
      if (isMobile) {
        const msg = encodeURIComponent(`Mira mi progreso de esta semana en Kairo: ${url}`)
        window.open(`https://wa.me/?text=${msg}`, '_blank')
      } else {
        await navigator.clipboard.writeText(url)
        setToast('Enlace copiado')
      }
    } catch {
      setToast('No se pudo generar el enlace')
    }
  }

  async function startSundayMock() {
    if (!sundayMockSimSubject || !sundayMockBlock) { setToast('No hay datos suficientes aún'); return }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const weekStart = currentWeekStartISO()
    const res = await fetch('/api/practica-parcial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        subject: sundayMockSimSubject,
        block: normalizeBlockKey(sundayMockBlock),
        comunidad: onboarding?.community ?? 'Madrid',
        numQuestions: 3,
        source: 'sunday_mock',
        weekStart,
      }),
    })
    if (!res.ok) { setToast('No hay ejercicios para ese bloque aún'); return }
    const { id } = await res.json() as { id: string }
    router.push(`/simulacros/practica/${id}`)
  }

  async function createLiga(nombre: string): Promise<{ error?: string }> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { error: 'No hay sesión activa' }
    const res = await fetch('/api/ligas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ nombre }),
    })
    const json = await res.json()
    if (!res.ok) return { error: json.error ?? 'Error al crear liga' }
    setLigas(json.ligas ?? [])
    return {}
  }

  async function joinLiga(codigo: string): Promise<{ error?: string }> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { error: 'No hay sesión activa' }
    const res = await fetch('/api/ligas/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ codigo: codigo.trim().toUpperCase() }),
    })
    const json = await res.json()
    if (!res.ok) return { error: json.error ?? 'Error al unirse' }
    const refreshRes = await fetch('/api/ligas', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (refreshRes.ok) { const d = await refreshRes.json(); setLigas(d.ligas ?? []) }
    return {}
  }

  async function completeMission(mission: Mission) {
    if (!mission.calendarRowId || !mission.subjectSlug || mission.v2SortOrder == null) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/camino/complete-mission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        subject: mission.subjectSlug,
        v2SortOrder: mission.v2SortOrder,
        calendarRowId: mission.calendarRowId,
        missionType: mission.missionType ?? 'concept',
        title: mission.title,
      }),
    })
    const json = await res.json() as {
      success?: boolean
      reason?: string
      xpAwarded?: number
      totalXp?: number
      streakDays?: number | null
      leagueUpgrade?: { from: string; to: string } | null
      error?: string
    }
    if (!res.ok) {
      setToast(json.error ?? 'No hemos podido completar la misión ahora mismo')
      return
    }
    if (json.success || json.reason === 'already_completed') {
      setCalendar(current => current.map(day => ({
        ...day,
        missions: day.missions.map(m => m.id === mission.id ? { ...m, status: 'done' as MissionStatus } : m),
      })))
    }
    if (json.success && typeof json.xpAwarded === 'number') {
      const xpAwarded = json.xpAwarded
      setXpTotal(typeof json.totalXp === 'number' ? json.totalXp : prev => prev + xpAwarded)
      setWeeklyXP(prev => prev + xpAwarded)
      if (typeof json.streakDays === 'number') setStreak(json.streakDays)
      if (json.leagueUpgrade) setLeagueUpgrade(json.leagueUpgrade)
      setToast(`¡Misión completada! +${xpAwarded} XP`)
      fetch('/api/ligas', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.ligas) setLigas(data.ligas) })
        .catch(() => undefined)
      refreshLeaderboard()
    } else if (json.reason === 'already_completed') {
      setToast('Misión ya completada')
    }
  }

  async function generateCamino() {
    if (!hasProfile) { router.push('/onboarding'); return }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setIsGenerating(true)
    try {
      const subjectSlugs = (onboarding?.subjects ?? []).map(s => SUBJECT_SLUGS[s]).filter((slug): slug is string => Boolean(slug) && PRIVATE_BETA_SUBJECT_SLUGS.has(slug))
      const subjects = subjectSlugs.length > 0 ? subjectSlugs : ['matematicas_ii']
      const res = await fetch('/api/onboarding/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ subjects, startMode: 'zero' }),
      })
      if (res.ok) {
        // Camino recién creado: hay que preparar sí o sí, sin throttle.
        await ensureServerCalendar(session.access_token, true)
        const calDays = await fetchCaminoCalendar(session.user.id)
        if (calDays && calDays.length > 0) {
          setCalendar(calDays)
          saveCalendarWeeksToCache(calDays)
          setSupabaseCalLoaded(true)
          setCaminoReadyStatus('ready')
        }
      }
    } catch { /* silent */ }
    setIsGenerating(false)
  }

  function persist(nextCalendar: DayPlan[], nextExams = exams) {
    const weekStart = weekStartForDate(nextCalendar[0]?.date ?? selectedWeekStart)
    saveWeekCache(weekStart, nextCalendar)
    setCalendar(current => nextCalendar.length <= 7 ? mergeWeekIntoCalendar(current, weekStart, nextCalendar) : nextCalendar)
    setExams(nextExams)
    saveJson(EXAMS_KEY, nextExams)
    // Returns the PATCH promise (existing callers ignore it, fire-and-forget
    // as before) so saveExam() can await it before writing exam_topics —
    // exam_topics ownership checks look up the exam inside student_exams, so
    // writing it out of order would make a fresh exam's chips fail with 403.
    return supabase.auth.getSession().then(({ data: sessionData }) => {
      const token = sessionData.session?.access_token
      if (!token) return
      return fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ student_exams: nextExams }),
      }).catch(() => undefined)
    }, () => undefined)
  }
  function resolveWeek(weekStartISO: string, nextExams = exams, planId = caminoPlanId): { days: DayPlan[]; source: CalendarSource; reason: string; shouldCache: boolean; shouldMerge: boolean } {
    if (!onboarding) return { days: [], source: 'client', reason: 'missing_onboarding', shouldCache: false, shouldMerge: false }
    const weekEndISO = toISO(addDays(dateFromISO(weekStartISO), 6))
    const existingWeek = buildWeekDays(weekStartISO, calendar.filter(day => day.date >= weekStartISO && day.date <= weekEndISO))
    if (existingWeek.some(day => day.missions.length > 0)) {
      return { days: existingWeek, source: supabaseCalLoaded ? 'server' : 'cache', reason: 'existing_visible_week', shouldCache: true, shouldMerge: false }
    }
    const cachedWeek = loadJson<CalendarWeekCache>(CALENDAR_WEEK_CACHE_KEY, {})[weekStartISO]
    if (cachedWeek) {
      const stableWeek = buildWeekDays(weekStartISO, cachedWeek)
      return { days: stableWeek, source: 'cache', reason: 'cached_week', shouldCache: false, shouldMerge: true }
    }
    const source = curriculumItems.length ? curriculumItems : FALLBACK_CURRICULUM
    const weekCache = loadJson<CalendarWeekCache>(CALENDAR_WEEK_CACHE_KEY, {})
    const nextCalendar = generateCalendar(onboarding, nextExams, source, planId, weekStartISO, weekCache, orientationContext)
    return { days: nextCalendar, source: 'client', reason: 'no_server_or_cache_week', shouldCache: true, shouldMerge: true }
  }
  function generateWeek(weekStartISO: string, nextExams = exams, planId = caminoPlanId) {
    return resolveWeek(weekStartISO, nextExams, planId).days
  }
  function applyWeekNavigation(weekStartISO: string, nextExams = exams, planId = caminoPlanId) {
    const result = resolveWeek(weekStartISO, nextExams, planId)
    const nextCalendar = result.days
    setSelectedWeekStart(weekStartISO)
    if (result.shouldCache) saveWeekCache(weekStartISO, nextCalendar)
    if (result.shouldMerge) setCalendar(current => mergeWeekIntoCalendar(current, weekStartISO, nextCalendar))
    recordCalendarSource(result.source, 'week_navigation', { weekStart: weekStartISO, missionCount: missionCount(nextCalendar), reason: result.reason })
    return nextCalendar
  }
  function goToWeek(weekStartISO: string) {
    applyWeekNavigation(weekStartISO)
  }
  function goToCurrentWeek() {
    goToWeek(currentWeekStartISO())
  }
  async function reorganizeCalendarConflicts() {
    if (calendarReorganizeStatus === 'saving' || calendarConflicts.length === 0) return
    setCalendarReorganizeStatus('saving')
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const userId = data.session?.user.id
    if (!token || !userId) {
      setCalendarReorganizeStatus('error')
      setToast('No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.')
      return
    }
    try {
      const res = await fetch('/api/camino/calendar-conflicts/reorganize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ missionIds: calendarConflicts.map(conflict => conflict.missionId) }),
      })
      const payload = await res.json().catch(() => null) as { moved?: number; unscheduled?: string[]; error?: string } | null
      if (!res.ok) throw new Error(payload?.error ?? 'calendar_reorganize_failed')
      const calDays = await fetchCaminoCalendar(userId)
      if (calDays) {
        setCalendar(calDays)
        saveCalendarWeeksToCache(calDays)
        setSupabaseCalLoaded(true)
      }
      setCalendarConflicts([])
      setCalendarAvailabilityRefreshKey(key => key + 1)
      setCalendarReorganizeStatus('done')
      const moved = payload?.moved ?? 0
      const unscheduled = payload?.unscheduled?.length ?? 0
      setToast(unscheduled > 0
        ? `${unscheduled} misión queda pendiente de programar porque no hay hueco libre.`
        : moved > 0
          ? 'Misiones reorganizadas en huecos libres.'
          : 'No había conflictos activos que reorganizar.')
    } catch {
      setCalendarReorganizeStatus('error')
      setToast('No se pudieron reorganizar las misiones afectadas.')
    }
  }
  function regenerate(nextExams = exams) {
    if (!onboarding) return
    const source = curriculumItems.length ? curriculumItems : FALLBACK_CURRICULUM
    const regenerated = generateCalendar(onboarding, nextExams, source, caminoPlanId, selectedWeekStart, {}, orientationContext)
    recordCalendarSource('client', 'exam_change', { weekStart: selectedWeekStart, missionCount: missionCount(regenerated) })
    const saved = persist(regenerated, nextExams)
    setToast('Camino PAU actualizado')
    return saved
  }
  function toggleCalendarExpanded() {
    const next = !calendarExpanded
    setCalendarExpanded(next)
    saveJson(CALENDAR_VISIBILITY_KEY, next)
    if (next) setCalendarAvailabilityRefreshKey(key => key + 1)
  }
  function postponeMission(missionId: string) {
    const dayIndex = calendar.findIndex(day => day.missions.some(mission => mission.id === missionId))
    if (dayIndex < 0 || dayIndex >= calendar.length - 1) return
    const mission = calendar[dayIndex].missions.find(item => item.id === missionId)
    if (!mission) return
    const nextCalendar = calendar.map((day, index) => index === dayIndex ? { ...day, missions: day.missions.filter(item => item.id !== missionId) } : index === dayIndex + 1 ? { ...day, missions: [...day.missions, { ...mission, id: `${day.date}-${mission.role}-postponed-${day.missions.length + 1}` }] } : day)
    recordCalendarSource('client', 'postpone', { weekStart: selectedWeekStart, missionCount: missionCount(nextCalendar) })
    persist(nextCalendar); setToast('Misión pospuesta a mañana')
  }
  function resetExamDraft() {
    setEditingExamId(null)
    setShowExamForm(false)
    setExamDraft(current => ({ ...current, block: '', topic: '', topicIds: [], examScope: 'parcial', name: '', date: toISO(addDays(new Date(), 3)), priority: 'normal', confidence: 'medio', content: '' }))
  }
  function openNewExam() { setEditingExamId(null); setShowExamForm(true) }
  function openEditExam(exam: StudentExam) {
    setEditingExamId(exam.id)
    setExamDraft({ subject: exam.subject, date: exam.date, block: exam.block ?? '', topic: exam.topic, topicIds: [], examScope: exam.examScope ?? 'parcial', name: exam.name, priority: exam.priority, confidence: exam.confidence ?? 'medio', content: exam.content ?? '' })
    setShowExamForm(true)
    // Chip selection lives in exam_topics, not in the student_exams jsonb
    // itself — fetch it separately so re-opening a Historia Parcial for
    // editing shows the chips that were picked last time instead of none.
    if (normalizeSubjectSlug(exam.subject) === 'historia_espana') {
      supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token
        if (!token) return
        fetch(`/api/parciales/exam-topics?examId=${encodeURIComponent(exam.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(res => res.ok ? res.json() : null).then(json => {
          if (Array.isArray(json?.topicIds)) {
            setExamDraft(current => current.subject === exam.subject ? { ...current, topicIds: json.topicIds } : current)
          }
        }).catch(() => undefined)
      }, () => undefined)
    }
  }
  useEffect(() => {
    if (!editExamParam || editExamParamHandledRef.current === editExamParam) return
    const exam = exams.find(e => e.id === editExamParam)
    if (!exam) return
    editExamParamHandledRef.current = editExamParam
    openEditExam(exam)
  }, [editExamParam, exams])
  async function saveExam() {
    if (!examDraft.subject || !examDraft.date || savingExam) return
    const isHistoria = normalizeSubjectSlug(examDraft.subject) === 'historia_espana'
    const isGlobalScope = isHistoria && examDraft.examScope === 'global'
    // 'global' has no fixed chip set to require — it's resolved dynamically
    // at generation time from whatever the student has completed by then.
    if (isHistoria && !isGlobalScope && examDraft.topicIds.length === 0) return
    setSavingExam(true)
    try {
      const normalizedBlock = normalizeBlockKey(examDraft.block ?? '')

      // Historia now picks real curriculum_topics rows via chips instead of
      // typing free text — build the legacy `topic` string from their
      // titles so every place that still reads exam.topic (list/calendar
      // labels, injectPartialExamMissions matching) keeps working exactly
      // as before, unchanged, while exam_topics (below) carries the real
      // topic_id relations for later phases to query structurally.
      let topicText = examDraft.topic
      if (isGlobalScope) {
        topicText = 'Todo lo visto hasta la fecha'
      } else if (isHistoria) {
        const { data: topicRows } = await supabase.from('curriculum_topics').select('title').in('id', examDraft.topicIds)
        topicText = (topicRows ?? []).map(t => t.title).join(', ')
      }

      // Ask the AI to size the plan to how the student says they're doing in
      // this subject/block, and to whatever custom instructions they have
      // active — before the plan gets generated, not after.
      let sessionOverride: number | undefined
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) {
          const res = await fetch('/api/parciales/plan-intensity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              subject: examDraft.subject,
              block: normalizedBlock,
              topic: topicText,
              content: examDraft.content,
              confidence: examDraft.confidence,
              priority: examDraft.priority,
            }),
          })
          if (res.ok) {
            const json = await res.json()
            if (typeof json.sessionCount === 'number') sessionOverride = json.sessionCount
          }
        }
      } catch { /* AI sizing is best-effort; deterministic fallback in injectPartialExamMissions still applies */ }

      const { topicIds, ...examDraftFields } = examDraft
      const draft = { ...examDraftFields, topic: topicText, block: normalizedBlock, sessionOverride }
      const currentEditingId = editingExamId
      const examId = currentEditingId ?? generateExamId()
      const nextExams = currentEditingId
        ? exams.map(exam => exam.id === currentEditingId ? { ...exam, ...draft } : exam)
        : [...exams, { id: examId, ...draft }]
      resetExamDraft()
      // Await so the exam_topics write below (ownership-checked against
      // perfiles.student_exams) never races the PATCH that puts this exam
      // id there in the first place — the route would 403 a brand-new exam
      // if its chips were saved before student_exams caught up.
      await regenerate(nextExams)
      // 'global' skips exam_topics entirely — there's no fixed chip set to
      // persist, and leaving stale rows from a PREVIOUS 'parcial' save (if
      // the student switches scope while editing) would make the Simulacro
      // wrongly still filter by those old topics, so any existing rows are
      // cleared too.
      if (isHistoria) {
        supabase.auth.getSession().then(({ data }) => {
          const token = data.session?.access_token
          if (!token) return
          fetch('/api/parciales/exam-topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ examId, topicIds: isGlobalScope ? [] : topicIds }),
          }).catch(() => undefined)
        }, () => undefined)
      }
      supabase.auth.getSession().then(({ data }) => {
        const userId = data.session?.user.id
        if (!userId) return
        injectAllPartialExamMissions(userId, supabase, nextExams)
      }, () => undefined)
    } finally {
      setSavingExam(false)
    }
  }
  function deleteExam(id: string) {
    const remaining = exams.filter(exam => exam.id !== id)
    regenerate(remaining)
    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id
      if (!userId) return
      deletePartialExamMissions(userId, supabase, id).then(() => injectAllPartialExamMissions(userId, supabase, remaining))
    }, () => undefined)
  }
  // Recálculo explícito del Camino para UN examen: a diferencia del sizing
  // automático de saveExam() (que solo pide a la IA cuántas sesiones caben
  // dentro del tope normal para no invadir el resto de asignaturas), este
  // calcula el tiempo REALMENTE necesario según días restantes, nivel
  // autoevaluado, dificultad implícita en la prioridad e historial de notas
  // en ese bloque — y si hace falta más de lo que el ritmo diario de
  // onboarding daría, apila más de una sesión por día en vez de quedarse
  // corto. `force` en injectAllPartialExamMissions hace que se reescriba
  // aunque nada del examen haya cambiado (el alumno lo pidió explícitamente).
  async function recalculateExamCamino(exam: StudentExam) {
    if (recalcExamId) return
    setRecalcExamId(exam.id)
    setRecalcResult(null)
    try {
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id
      if (!userId) { setToast('No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.'); return }

      const daysUntilExam = weekdaysBefore(exam.date, todayMadrid()).length
      if (daysUntilExam <= 0) { setToast('Este examen ya no puede recalcularse.'); return }

      const performance = await getBlockPerformance(supabase, userId, exam.subject, exam.block ?? '')
      const need = computeExamTimeNeed({
        daysUntilExam,
        priority: exam.priority,
        confidence: exam.confidence,
        historicalAvgScore: performance?.avgScore ?? null,
        historicalAttempts: performance?.attempts,
        dailyMinutesOnboarding: onboarding?.dailyMinutes ?? null,
      })

      const nextExams = exams.map(e => e.id === exam.id
        ? { ...e, sessionOverride: need.recommendedSessions, maxSessionsPerDay: need.maxSessionsPerDay }
        : e)
      await injectAllPartialExamMissions(userId, supabase, nextExams, { forceExamId: exam.id })

      // Refresca el calendario visible con las misiones recién escritas —
      // mismo patrón que addSubject() usa tras inyectar contenido nuevo.
      const calDays = await fetchCaminoCalendar(userId)
      if (calDays) { setCalendar(calDays); saveCalendarWeeksToCache(calDays) }

      setRecalcResult({ examId: exam.id, message: need.summary })
    } catch {
      setToast('No se pudo recalcular tu Camino. Inténtalo de nuevo.')
    } finally {
      setRecalcExamId(null)
    }
  }

  async function addSubject(subjectLabel: string) {
    const SUBJECT_TO_SLUG: Record<string, string> = {
      'Matemáticas II': 'matematicas_ii',
      'Matemáticas CCSS': 'matematicas_ccss',
      'Lengua Castellana': 'lengua',
      'Historia de España': 'historia_espana',
      'Historia de la Filosofía': 'historia_filosofia',
      'Inglés': 'ingles',
      'Física': 'fisica',
      'Química': 'quimica',
      'Economía de la Empresa': 'economia',
    }
    const slug = SUBJECT_TO_SLUG[subjectLabel]
    if (!slug) return
    setAddSubjectLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const res = await fetch('/api/camino/add-subject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject: slug }),
      })
      if (!res.ok) {
        setToast('Error al añadir la asignatura. Inténtalo de nuevo.')
        return
      }
      // Update localStorage and local state so Nota Proyectada picks it up immediately
      const currentOnboarding = loadOnboarding()
      const updatedSubjects = [...currentOnboarding.subjects.filter(s => s !== subjectLabel), subjectLabel]
      saveOnboarding({ subjects: updatedSubjects })
      setOnboarding(prev => prev ? { ...prev, subjects: updatedSubjects } : prev)
      setShowAddSubjectModal(false)
      setToast(`¡${subjectLabel} añadida! Verás sus misiones en tu Camino a partir de mañana.`)
      // Refresh calendar so new missions appear
      const userId = sessionData.session?.user.id
      if (userId) {
        const calDays = await fetchCaminoCalendar(userId)
        if (calDays) { setCalendar(calDays); saveCalendarWeeksToCache(calDays) }
      }
    } finally {
      setAddSubjectLoading(false)
    }
  }

  async function markNotSeenHero() {
    const mission = todayMain[0]
    if (!canMarkNotSeen(mission)) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setCalendar(current => current.map(day => ({
      ...day,
      missions: day.missions.filter(m => m.id !== mission.id),
    })))
    try {
      const res = await fetch('/api/camino/postpone-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ subject: mission.subjectSlug, v2SortOrder: mission.v2SortOrder }),
      })
      const json = await res.json()
      setToast(json.warning ? 'Avisamos: tendrás que ver este bloque antes de la PAU.' : 'Tema marcado como no visto en clase.')
    } catch {
      setToast('Error al marcar el tema.')
    }
  }

  if (onboarding === null || !hasProfile) return null

  const HF_LIBRARY = 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260727_125452_25c3d09d-ecc3-4e9b-8a16-773cfeb46a83.png'

  if (caminoReadyStatus === 'no_queue' && onboardingChecked && !hasProfile) {
    router.push('/onboarding')
    return null
  }

  if (caminoReadyStatus === 'no_queue') return (
    <Shell>
      <main style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={HF_LIBRARY} alt="" loading="eager" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 35%' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(5,12,26,0.92) 0%, rgba(5,12,26,0.68) 50%, rgba(5,12,26,0.88) 100%)' }} />
        <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.22em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 20 }}>Camino PAU · Kairo</p>
          <h1 style={{ fontSize: 52, fontWeight: 900, color: '#fff', letterSpacing: '-.04em', lineHeight: .88, marginBottom: 18 }}>Tu plan<br/>aún no<br/>está listo.</h1>
          <p style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,.5)', lineHeight: 1.6, maxWidth: 360, marginBottom: 32 }}>Algo fue mal al generar tu Camino. Vamos a intentarlo de nuevo.</p>
          <button
            onClick={generateCamino}
            disabled={isGenerating}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: isGenerating ? 'rgba(37,99,235,.18)' : '#2563eb', color: isGenerating ? 'rgba(255,255,255,.7)' : '#fff', border: isGenerating ? '1px solid rgba(37,99,235,.35)' : 'none', borderRadius: 10, padding: '14px 26px', fontSize: 13, fontWeight: 900, cursor: isGenerating ? 'default' : 'pointer', boxShadow: isGenerating ? 'none' : '0 12px 32px rgba(37,99,235,.4)', letterSpacing: '-.01em' }}
          >
            {isGenerating
              ? <><div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,.2)', borderTopColor: 'rgba(255,255,255,.75)', animation: 'spin .8s linear infinite' }} /> Generando tu plan...</>
              : <>Generar mi Camino PAU <ArrowRight size={16} /></>}
          </button>
        </div>
      </main>
    </Shell>
  )

  if (caminoReadyStatus === 'no_future') return (
    <Shell>
      <main style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={HF_LIBRARY} alt="" loading="eager" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 35%' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(5,12,26,0.92) 0%, rgba(5,12,26,0.68) 50%, rgba(5,12,26,0.88) 100%)' }} />
        <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.22em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 20 }}>Camino PAU · Kairo</p>
          <h1 style={{ fontSize: 52, fontWeight: 900, color: '#fff', letterSpacing: '-.04em', lineHeight: .88, marginBottom: 18 }}>Preparando<br/>tu Camino<br/>PAU.</h1>
          <p style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,.5)', lineHeight: 1.6, maxWidth: 360, marginBottom: 32 }}>Kairo está analizando tu perfil y construyendo tu plan. Tarda unos segundos.</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(37,99,235,.18)', color: 'rgba(255,255,255,.7)', border: '1px solid rgba(37,99,235,.35)', borderRadius: 10, padding: '14px 26px', fontSize: 13, fontWeight: 700 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,.2)', borderTopColor: 'rgba(255,255,255,.75)', animation: 'spin .8s linear infinite' }} /> Generando tu plan...
          </div>
        </div>
      </main>
    </Shell>
  )

  const heroImageUrl = (() => {
    const s = (heroAsignatura ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (s.includes('filosofia'))                    return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260726_000852_5474f700-2ed4-44ef-83b0-2a54eeff1d80.png'
    if (s.includes('historia'))                     return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260724_175525_a082853d-a113-4ae3-bd27-0bff89dc2c5b.png'
    if (s.includes('fisica'))                       return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260726_000822_ca28aa98-71b6-42b5-82a1-eb035f90e318.png'
    if (s.includes('quimica'))                      return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260726_000824_d921117a-9232-49e7-b9c2-08ffffcd4475.png'
    if (s.includes('biologia'))                     return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260726_000825_0fbd7567-1cac-444c-81e2-36c2551b946c.png'
    if (s.includes('ingles'))                       return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260726_000853_ea284c50-cadc-413d-8412-9ddfb0c44ec9.png'
    if (s.includes('lengua'))                       return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260725_134153_21d8ecce-c198-4ae1-8fc9-22814072fdbc.png'
    if (s.includes('ccss') || s.includes('social')) return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260726_000821_38eb7eb4-e4a8-415f-b754-88efab45f708.png'
    // matematicas (II y cualquier otra) y fallback
    return 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260725_130632_68dfbf7a-aa85-468a-87c7-855c54c5b88f.png'
  })()
  const daysUntilPAU = (() => {
    const now = realToday ? new Date(realToday + 'T00:00:00') : new Date()
    const year = now.getFullYear()
    // Community-specific last exam day: Cataluña PAU ends ~June 6, Madrid EBAU ~June 8
    const mmdd = onboarding?.community === 'Cataluña' ? '06-06' : '06-08'
    const pau = new Date(`${year}-${mmdd}T00:00:00`)
    if (pau <= now) pau.setFullYear(year + 1)
    return Math.ceil((pau.getTime() - now.getTime()) / 86400000)
  })()

  const mainMission = todayMain[0] ?? null
  const mainTarget = mainMission ? hrefForMission(mainMission) : null
  const mainPriorityPresentation = mainMission
    ? priorityPresentationForMission(mainMission, {
        orientationInfluenced: orientationImpactForSubject(mainMission.subject, orientationContext).level === 'medium',
      })
    : null
  const mainReason = mainMission && mainPriorityPresentation?.visibleReasons.length === 0
    ? heroReason(mainMission, blockCompletedCount, nextMissionInCalendar?.title ?? null)
    : null
  const orientationUniversity = orientationContext?.target.universityAcronym || orientationTarget?.university || ''
  const formatOrientationScore = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 3 })

  return (
    <Shell>
      <UsernameGate />
      {/* ── HEADER ── */}
      <header className="kairo-topbar" style={{ position: 'sticky', top: 0, zIndex: 30 }}>
        <div className="camino-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2563eb' }}>Camino PAU</span>
            <span className="camino-header-title" style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>Tu semana de estudio</span>
          </div>
          <div className="camino-header-actions" style={{ display: 'flex', gap: 8 }}>
            <GoogleCalendarConnection />
            <button className="kairo-soft-control" onClick={() => setShowCalendarEditor(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 14px', cursor: 'pointer', color: '#334155', transition: 'all .15s', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <CalendarDays size={13} /> Calendario
            </button>
            <button className="kairo-soft-control" onClick={openNewExam} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 14px', cursor: 'pointer', color: '#334155', transition: 'all .15s', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <Plus size={13} /> Examen
            </button>
            <button className="kairo-clay-action" onClick={() => setShowAddSubjectModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 14px', borderRadius: 12, cursor: 'pointer', border: 'none', color: 'white', transition: 'all .15s', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <BookPlus size={13} /> Asignatura
            </button>
          </div>
        </div>
        {/* Ticker */}
        <div style={{ background: 'rgba(248,251,255,.82)', borderBottom: '1px solid #dbeafe', padding: '5px 20px', display: 'flex', gap: 16, overflowX: 'auto', backdropFilter: 'blur(10px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}><span style={{ width: 4, height: 4, borderRadius: '50%', background: '#93c5fd', flexShrink: 0, display: 'inline-block' }} />{streak > 0 ? `${streak} días de racha` : 'Empieza tu racha hoy'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}><span style={{ width: 4, height: 4, borderRadius: '50%', background: '#93c5fd', flexShrink: 0, display: 'inline-block' }} />{completedMainWithSims}/{Math.min(totalMain, 5)} principales</div>
          {weeklyXP > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}><span style={{ width: 4, height: 4, borderRadius: '50%', background: '#93c5fd', flexShrink: 0, display: 'inline-block' }} />+{weeklyXP} XP semana</div>}
          {upcomingPartial && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 800, color: '#1e40af', whiteSpace: 'nowrap' }}><span style={{ width: 4, height: 4, borderRadius: '50%', background: '#2563eb', flexShrink: 0, display: 'inline-block' }} />Parcial · {upcomingPartial.subject}</div>}
          {/* El botón "Clasificación →" de siempre vive en el panel derecho
              (RIGHT PANEL, hidden lg:flex) — invisible por debajo de lg. Este
              es el mismo punto de entrada (openFullRanking) para mobile/tablet;
              en lg+ el de la derecha ya cubre el caso y este se oculta. */}
          <button
            onClick={openFullRanking}
            className="lg:hidden"
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
          >
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#93c5fd', flexShrink: 0, display: 'inline-block' }} />Clasificación →
          </button>
        </div>
      </header>

      {/* ── CONTENT GRID ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,.86)' }}>

          {/* Banners */}
          {BETA_FEEDBACK_URL && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 20px', background: '#eff6ff', borderBottom: '1px solid #dbeafe' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', margin: 0 }}>Beta privada · Matemáticas II, Matemáticas CCSS, Lengua e Historia.</p>
              <a href={BETA_FEEDBACK_URL} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 800, color: '#2563eb', background: 'white', borderRadius: 8, padding: '3px 10px', textDecoration: 'none', whiteSpace: 'nowrap' }}>Feedback</a>
            </div>
          )}
          {isRescueMode && <div style={{ padding: '8px 20px', background: '#fef3c7', borderBottom: '1px solid #fde68a' }}><p style={{ fontSize: 11, fontWeight: 900, color: '#92400e', margin: 0 }}>⚠️ Modo Rescate PAU — nos centramos en los temas más importantes para maximizar tu nota.</p></div>}
          <WeeklyCheckinBanner />
          <ExamCoverageBanner />

          {orientationTarget && (
            <div style={{ padding: '10px 20px', borderBottom: '1px solid #e2e8f0', background: 'linear-gradient(135deg,rgba(239,246,255,.72),rgba(255,255,255,.68))' }}>
              <div className="camino-target-card kairo-soft-panel" data-testid="camino-orientation-target" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '10px 14px', border: '1px solid rgba(191,219,254,.72)', background: 'rgba(255,255,255,.68)', backdropFilter: 'blur(14px)', boxShadow: '0 8px 28px rgba(37,99,235,.07), inset 0 1px 0 rgba(255,255,255,.9)' }}>
                <div className="camino-target-objective" style={{ minWidth: 0 }}>
                  <span className="camino-target-label">Objetivo</span>
                  <p style={{ margin: '3px 0 0', fontSize: 13, fontWeight: 900, color: '#0f172a', lineHeight: 1.25 }}>{orientationTarget.degree} · {orientationUniversity}</p>
                </div>
                <div className="camino-target-metrics">
                  <div><span className="camino-target-label">Referencia</span><strong>{formatOrientationScore(orientationTarget.admissionScore)}</strong></div>
                  {orientationContext?.calculationComplete && orientationContext.estimatedScore != null && <div><span className="camino-target-label">Tu escenario</span><strong>{formatOrientationScore(orientationContext.estimatedScore)}</strong></div>}
                  {orientationContext?.calculationComplete && orientationContext.gap != null && <div><span className="camino-target-label">Gap</span><strong className={orientationContext.gap < 0 ? 'is-below' : 'is-above'}>{orientationContext.gap > 0 ? '+' : ''}{formatOrientationScore(Math.abs(orientationContext.gap))}</strong></div>}
                </div>
                <a href="/orientacion" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 900, color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}>Ver orientación →</a>
              </div>
            </div>
          )}

          {/* ── HERO ── */}
          <div className="camino-hero" style={{ position: 'relative', height: 214, overflow: 'hidden', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
            <img src={heroImageUrl} alt="" loading="eager" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.48) saturate(0.68)', display: 'block' }} />
            <div className="camino-hero-overlay" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(10,15,30,0.88) 0%, rgba(10,15,30,0.36) 72%, rgba(10,15,30,0.18) 100%)', padding: '24px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#93c5fd', marginBottom: 6 }}>Días hasta selectividad</div>
              <div className="camino-hero-days" style={{ fontSize: 72, fontWeight: 900, color: 'white', lineHeight: 0.88, letterSpacing: '-0.04em' }}>{daysUntilPAU}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 8 }}>Restan</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span style={{ fontSize: 15, fontWeight: 900, color: 'white' }}>{streak > 0 ? streak : '—'}</span><span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Racha</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span style={{ fontSize: 15, fontWeight: 900, color: 'white' }}>{displayedXP.toLocaleString('es-ES')}</span><span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>XP</span></div>
                {heroRank != null && <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span style={{ fontSize: 15, fontWeight: 900, color: 'white' }}>#{heroRank}</span><span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Ranking</span></div>}
              </div>
            </div>
          </div>

          {/* Sunday mock */}
          {isSunday && sundayMockSession !== undefined && sundayMockSimSubject && sundayMockBlock && (() => {
            const simLimitReached = monthlySimsUsed >= getCaminoPlanLimits(caminoPlanId).partialsPerMonth
            return (
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
                {sundayMockSession !== null ? (
                  <div style={{ borderRadius: 14, border: '1px solid #bfdbfe', background: 'linear-gradient(135deg,#eff6ff,#eef2ff)', padding: '12px 16px' }}>
                    <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2563eb', margin: 0 }}>Simulacro del Domingo</p>
                    <p style={{ fontSize: 14, fontWeight: 900, color: '#1e293b', margin: '4px 0 0' }}>Simulacro del Domingo hecho ✓</p>
                    {(() => {
                      const heroProj = filteredProjection?.find(p => p.asignatura === heroAsignatura)
                      const nota = sundayMockSession.nota_final
                      const proj = heroProj?.nota_proyectada ?? null
                      if (nota == null) return null
                      if (proj != null && heroProj?.confidence !== 'low') {
                        const delta = Math.round((nota - proj) * 10) / 10
                        const sign = delta >= 0 ? '+' : ''
                        return <p style={{ fontSize: 12, color: '#1d4ed8', margin: '4px 0 0', fontWeight: 600 }}>{sign}{delta.toFixed(1).replace('.', ',')} vs proyección · {nota.toFixed(1)}/10</p>
                      }
                      return <p style={{ fontSize: 12, color: '#1d4ed8', margin: '4px 0 0', fontWeight: 600 }}>Sacaste {nota.toFixed(1)}/10 esta semana</p>
                    })()}
                  </div>
                ) : simLimitReached ? (
                  <div style={{ borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc', padding: '16px 20px' }}>
                    <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#94a3b8', margin: 0 }}>Simulacro del Domingo</p>
                    <p style={{ fontSize: 15, fontWeight: 900, color: '#64748b', margin: '6px 0 4px', lineHeight: 1.3 }}>3 ejercicios de {sundayMockBlock} · ~20 min</p>
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, fontWeight: 600 }}>Has alcanzado el límite de simulacros de este mes. {monthlyLimitResetNotice()}</p>
                  </div>
                ) : (
                  <div style={{ borderRadius: 14, border: '1px solid #e2e8f0', borderLeft: '3px solid #0f172a', background: 'white', padding: '16px 20px' }}>
                    <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#94a3b8', margin: 0 }}>Simulacro del Domingo</p>
                    <p style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', margin: '6px 0 4px', lineHeight: 1.3 }}>3 ejercicios de {sundayMockBlock} · ~20 min</p>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, fontWeight: 600 }}>El momento que más mueve tu Nota Proyectada.</p>
                    <button onClick={startSundayMock} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 10, background: '#2563eb', padding: '8px 16px', fontSize: 12, fontWeight: 800, color: 'white', border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,.22)' }}>Empezar simulacro →</button>
                  </div>
                )}
              </div>
            )
          })()}

          {upcomingPartial && (() => {
            // Debe ser la misión de HOY del MISMO examen que el banner
            // muestra (upcomingPartial), no cualquier partial_practice de
            // hoy: con dos parciales activos (p.ej. Mates y Historia) cuyas
            // prácticas caen el mismo día, filtrar solo por missionType
            // podía coger la de Mates aunque el banner mostrara Historia —
            // ese missionId viajaba a /api/practica-parcial, que lo usa
            // para reutilizar/devolver una sesión existente sin mirar
            // subject/block, así que "Empezar" en el parcial de Historia
            // podía abrir (o reanudar) la sesión de Mates.
            const todayPartialMission = today.missions.find(
              m => m.missionType === 'partial_practice' && m.metadata?.partial_exam_id === upcomingPartial.id
            )
            return (
              <div style={{ padding: '8px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <PartialExamBanner
                  exam={upcomingPartial}
                  today={realToday}
                  completedToday={todayPartialMission?.status === 'done'}
                  missionId={todayPartialMission?.status === 'pending' ? todayPartialMission.id : undefined}
                />
              </div>
            )
          })()}

          {/* ── MISSIONS HEADER ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #eef2f7', background: 'rgba(255,255,255,.72)' }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>Haz esto ahora</span>
            {/* "principales" deja claro que este contador es solo del objetivo
                semanal (role='main', tope de 5) — las bonus no cuentan aquí y
                nunca bloquean nada, así que "sigue con las bonus" evita que
                llegar a 5/5 se lea como un tope duro de toda la app. */}
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{completedMainWithSims}/{Math.min(totalMain, 5)} principales</span>
          </div>

          {/* Trabajo de hoy hecho por iniciativa propia fuera de Camino
              (Exámenes/Simulacros directos) — sin tema exacto enlazable a una
              misión, así que se muestra aquí a nivel de asignatura en vez de
              como una tarjeta de misión. El trabajo hecho dentro de Camino
              (Mis Cursos) ya aparece como misión normal más abajo, marcada
              "✎ Por tu cuenta". */}
          {freeActivitySubjectsToday.length > 0 && (
            <div style={{ padding: '10px 20px', borderBottom: '1px solid #f1f5f9', background: '#ecfdf5' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#059669' }}>
                ✎ Hoy también trabajaste por tu cuenta: {freeActivitySubjectsToday.join(', ')}
              </span>
            </div>
          )}

          {/* ── MISSION 01 — PRINCIPAL ── */}
          {mainMission ? (
            <div className="camino-mission-card kairo-raised" data-testid="camino-main-mission" style={{ display: 'flex', alignItems: 'flex-start', gap: 16, margin: '16px 20px', padding: '20px', borderRadius: 16, borderLeft: '3px solid #2563eb', cursor: 'default' }}>
              <div className="camino-mission-number" style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: '#93c5fd', flexShrink: 0, width: 48, paddingTop: 2, fontVariantNumeric: 'tabular-nums' }}>01</div>
              <div className="camino-main-body" data-testid="camino-main-body" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{mainMission.subject}</span>
                  {(formatBlockLabel(mainMission.blockKey) || mainMission.block) && <><span style={{ color: '#cbd5e1', fontSize: 10 }}>·</span><span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{formatBlockLabel(mainMission.blockKey) || mainMission.block}</span></>}
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#2563eb', color: 'white' }}>Principal</span>
                  {!!mainMission.metadata?.express && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#fffbeb', color: '#d97706' }}>⚡ Exprés</span>}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3, marginBottom: 8, color: mainMission.status === 'done' ? '#94a3b8' : '#0f172a', textDecoration: mainMission.status === 'done' ? 'line-through' : 'none' }}>{mainMission.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ flex: 1, height: 3, background: '#dbeafe', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: '#2563eb', borderRadius: 2, width: mainMission.status === 'done' ? '100%' : '0%' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{mainMission.estimatedMinutes} min · {mainMission.status === 'done' ? 'Completada' : 'Sin comenzar'}</span>
                </div>
                {!!mainPriorityPresentation?.visibleReasons.length && (
                  <div className="camino-reason-list" data-testid="camino-priority-reasons" aria-label="Razones de esta recomendación">
                    {mainPriorityPresentation.visibleReasons.map(reason => (
                      <span
                        key={reason.code}
                        className={`camino-reason-chip camino-reason-chip--${reason.emphasis}${reason.code === 'exam_soon' || reason.code === 'academic_risk' ? ' camino-reason-chip--urgent' : ''}${reason.source === 'orientation' ? ' camino-reason-chip--orientation' : ''}`}
                      >
                        {reason.label}
                      </span>
                    ))}
                  </div>
                )}
                {mainPriorityPresentation?.explanation && (
                  <details className="camino-why-now" data-testid="camino-why-now">
                    <summary>¿Por qué ahora?</summary>
                    <p>{mainPriorityPresentation.explanation}</p>
                  </details>
                )}
                {mainReason && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: '#64748b' }}>{mainReason}</div>}
                {mainMission.status !== 'done' && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <button onClick={() => postponeMission(mainMission.id)} style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>↺ Posponer</button>
                    {canMarkNotSeen(mainMission) && (
                      <button onClick={() => setShowNotSeenConfirm(true)} style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Aún no lo he dado</button>
                    )}
                  </div>
                )}
              </div>
              <div className="camino-main-action" data-testid="camino-main-action" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>+{mainMission.baseXP} XP</span>
                {mainMission.status === 'done' ? (
                  mainMission.missionType === 'partial_practice' && mainTarget?.href ? (
                    <a href={mainTarget.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 16px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#059669', textDecoration: 'none' }}>✓ Hecha · Ver resultado</a>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 16px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#059669' }}>✓ Hecha</span>
                  )
                ) : mainTarget?.href ? (
                  <a href={mainTarget.href} className="kairo-clay-action" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 900, padding: '10px 18px', borderRadius: 12, color: 'white', textDecoration: 'none' }}>Empezar misión →</a>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 16px', borderRadius: 10, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#94a3b8' }}>En preparación</span>
                )}
              </div>
            </div>
          ) : microMission ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 20px', borderBottom: '1px solid #f1f5f9', background: '#eff6ff', borderLeft: '3px solid #2563eb' }}>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: '#93c5fd', flexShrink: 0, width: 48 }}>01</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase' }}>{microMission.subject}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#2563eb', color: 'white' }}>Reto exprés</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>Reto exprés de hoy</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginTop: 4 }}>{microMission.topic} · repaso rápido</div>
              </div>
              <div style={{ flexShrink: 0 }}>
                <a href={microMission.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '8px 16px', borderRadius: 10, background: '#2563eb', color: 'white', textDecoration: 'none' }}>Empezar →</a>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: '#dbeafe', flexShrink: 0, width: 48 }}>01</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#94a3b8' }}>Completa tu perfil para empezar</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginTop: 4 }}>Configura tu perfil y construiremos tu Camino PAU.</div>
              </div>
            </div>
          )}

          {/* ── BONUS SECTION (Mañana) ── */}
          {todayBonus.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', borderTop: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8' }}>Mañana</span>
              </div>
              {todayBonus.map((mission, idx) => {
                const bonusTarget = hrefForMission(mission)
                return (
                  <div key={mission.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 20px', borderBottom: '1px solid #f1f5f9', opacity: mission.status === 'done' ? 0.55 : 1 }}>
                    <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: '#dbeafe', flexShrink: 0, width: 48, paddingTop: 2 }}>0{idx + 2}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{mission.subject}</span>
                        {mission.block && <><span style={{ color: '#cbd5e1', fontSize: 10 }}>·</span><span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{mission.block}</span></>}
                        {mission.metadata?.free_initiative ? (
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#ecfdf5', color: '#059669' }}>✎ Por tu cuenta</span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#f3e8ff', color: '#7c3aed' }}>Extra</span>
                        )}
                        {!!mission.metadata?.express && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#fffbeb', color: '#d97706' }}>⚡ Exprés</span>}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: mission.status === 'done' ? '#94a3b8' : '#0f172a', lineHeight: 1.3, textDecoration: mission.status === 'done' ? 'line-through' : 'none', marginBottom: 8 }}>{mission.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 3, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: mission.status === 'done' ? '#34d399' : '#2563eb', borderRadius: 2, width: mission.status === 'done' ? '100%' : '0%' }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{mission.estimatedMinutes} min · {mission.status === 'done' ? 'Completada' : 'Sin comenzar'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#2563eb' }}>+{mission.baseXP} XP</span>
                      {mission.status === 'done' ? (
                        mission.missionType === 'partial_practice' && bonusTarget?.href ? (
                          <a href={bonusTarget.href} style={{ fontSize: 12, fontWeight: 800, padding: '6px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#059669', textDecoration: 'none' }}>✓ Hecha · Ver</a>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 800, padding: '6px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#059669' }}>✓ Hecha</span>
                        )
                      ) : bonusTarget?.href ? (
                        <a href={bonusTarget.href} style={{ fontSize: 11, fontWeight: 800, padding: '6px 12px', borderRadius: 8, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', textDecoration: 'none' }}>Ir →</a>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '6px 12px', borderRadius: 8, background: '#f1f5f9', color: '#94a3b8', border: '1px solid #e2e8f0' }}>Sin pantalla</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {/* ── PRÓXIMAS MISIONES ── */}
          {(() => {
            const nextDays = visibleCalendar
              .filter(d => d.date > realToday)
              .slice(0, 2)
              .filter(d => d.missions.some(m => m.role === 'main'))
            if (nextDays.length === 0) return null
            const todayMs = new Date(realToday + 'T00:00:00').getTime()
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9', borderTop: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8' }}>Próximas misiones</span>
                </div>
                {nextDays.map((day, di) => {
                  const mission = day.missions.find(m => m.role === 'main')
                  if (!mission) return null
                  const diff = Math.round((new Date(day.date + 'T00:00:00').getTime() - todayMs) / 86400000)
                  const dayName = diff === 1 ? 'Mañana' : diff === 2 ? 'Pasado mañana' : calendarDayLabel(day.date)
                  const num = String(2 + todayBonus.length + di).padStart(2, '0')
                  return (
                    <div key={day.date} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '16px 20px', borderBottom: '1px solid #f1f5f9', borderLeft: `3px solid ${di === 0 ? '#2563eb' : '#8b5cf6'}`, opacity: 0.45 }}>
                      <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: di === 0 ? '#2563eb' : '#8b5cf6', flexShrink: 0, width: 48, paddingTop: 2 }}>{num}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: di === 0 ? '#2563eb' : '#8b5cf6', marginBottom: 5 }}>{dayName}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 5, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: di === 0 ? '#2563eb' : '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{mission.subject}</span>
                          {(formatBlockLabel(mission.blockKey) || mission.block) && (
                            <><span style={{ color: '#cbd5e1', fontSize: 10 }}>·</span><span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{formatBlockLabel(mission.blockKey) || mission.block}</span></>
                          )}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>{mission.title}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginTop: 4 }}>{mission.estimatedMinutes} min</div>
                      </div>
                    </div>
                  )
                })}
              </>
            )
          })()}

          {/* ── WEEK SECTION ── */}
          <div style={{ padding: '16px 20px', borderTop: '2px solid #0f172a' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>Esta semana</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => goToWeek(weekOffset(selectedWeekStart, -1))} style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>← Ant</button>
                <button onClick={goToCurrentWeek} style={{ fontSize: 11, fontWeight: 800, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>Hoy</button>
                <button onClick={() => goToWeek(weekOffset(selectedWeekStart, 1))} style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>Sig →</button>
              </div>
            </div>
            {calendarConflicts.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 12px', borderRadius: 12, border: '1px solid #fed7aa', background: '#fff7ed' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#9a3412' }}>
                    Tu calendario ha cambiado · {calendarConflicts.length} {calendarConflicts.length === 1 ? 'misión afectada' : 'misiones afectadas'}.
                  </div>
                  <div style={{ marginTop: 2, fontSize: 10, fontWeight: 700, color: '#c2410c' }}>
                    {calendarConflicts[0].date} · {calendarConflicts[0].start}-{calendarConflicts[0].end} coincide con {calendarConflicts[0].busyStart}-{calendarConflicts[0].busyEnd} Ocupado.
                  </div>
                </div>
                <button type="button" onClick={reorganizeCalendarConflicts} disabled={calendarReorganizeStatus === 'saving'} style={{ flexShrink: 0, border: 'none', borderRadius: 10, background: '#ea580c', color: 'white', padding: '8px 12px', fontSize: 11, fontWeight: 900, cursor: calendarReorganizeStatus === 'saving' ? 'default' : 'pointer', opacity: calendarReorganizeStatus === 'saving' ? 0.7 : 1 }}>
                  {calendarReorganizeStatus === 'saving' ? 'Reorganizando...' : calendarReorganizeStatus === 'done' ? '✓ Reorganizado' : calendarReorganizeStatus === 'error' ? 'Reintentar' : 'Reorganizar'}
                </button>
              </div>
            )}
            {calendarConflictStatus === 'unavailable' && (
              <div style={{ marginBottom: 12, fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>Disponibilidad externa no disponible; Camino sigue usando tu calendario Kairo.</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {weekCalendar.map((day, i) => {
                const isPast = day.date < realToday
                const isSelected = day.date === expandedDayDate
                const dayNum = day.date ? parseInt(day.date.split('-')[2], 10) : i + 1
                const dayLetter = ['L', 'M', 'X', 'J', 'V', 'S', 'D'][i] ?? day.label.slice(0, 1).toUpperCase()
                // Mismo criterio de "completado" que ya usa el calendario por
                // horas (WeekHourView/MonthCalendarOverlay: status de la
                // misión) y que CompactWeekView/DayCard más abajo — antes esta
                // tira solo distinguía "día pasado" de "día futuro", así que
                // un día pasado sin nada hecho se veía igual que uno con la
                // misión completada.
                const dayMain = day.missions.filter(m => m.role === 'main')
                const dayDone = dayMain.length > 0 && dayMain.every(m => m.status === 'done')
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setExpandedDayDate(day.date); setCalendarExpanded(true); setCalendarAvailabilityRefreshKey(key => key + 1) }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{dayLetter}</span>
                    <div style={{ position: 'relative' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: day.isToday ? '#2563eb' : isPast ? '#0f172a' : '#f1f5f9', color: day.isToday || isPast ? 'white' : '#64748b', border: isSelected ? '2px solid #93c5fd' : day.isToday || isPast ? 'none' : '1px solid #e2e8f0', boxShadow: isSelected ? '0 0 0 2px #eff6ff' : 'none' }}>{dayNum}</div>
                      {dayDone && (
                        <span style={{ position: 'absolute', top: -3, right: -3, width: 14, height: 14, borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid white' }}>
                          <Check size={9} color="white" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
            <button onClick={toggleCalendarExpanded} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', marginTop: 10, padding: 6, fontSize: 10, fontWeight: 800, color: '#94a3b8', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer' }}>
              <ChevronDown style={{ transition: 'transform 200ms', transform: calendarExpanded ? 'rotate(180deg)' : 'none' }} size={12} />
              {calendarExpanded ? 'Ocultar semana' : 'Ver semana completa'}
            </button>
            {calendarExpanded && <CompactWeekView days={weekCalendar} exams={exams} initialExpandedDate={expandedDayDate} externalBusyByDate={externalBusyByDate} conflicts={calendarConflicts} />}
            <FreeReviewPanel subjects={onboardingSubjects} />
          </div>

          {/* ── EXAMS SECTION ── */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              Exámenes parciales
              <button onClick={openNewExam} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 10, cursor: 'pointer', border: '1px solid #e2e8f0', background: 'white', color: '#334155' }}>+ Añadir</button>
            </div>
            {activeExams.length ? activeExams.map(exam => (
              <div key={exam.id} style={{ padding: '8px 0 8px 8px', borderBottom: '1px solid #f1f5f9', borderLeft: `2px solid ${exam.examScope === 'global' ? '#7c3aed' : '#2563eb'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em', width: 56, flexShrink: 0 }}>{formatDate(exam.date)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', flex: 1 }}>{exam.subject} · {exam.topic || exam.name || 'Parcial'}</span>
                  {exam.examScope === 'global' && (
                    <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c3aed', background: '#f5f3ff', border: '1px solid #7c3aed33', borderRadius: 999, padding: '2px 6px', flexShrink: 0 }}>Global</span>
                  )}
                  <button
                    onClick={() => recalculateExamCamino(exam)}
                    disabled={recalcExamId === exam.id}
                    title="Recalcular mi Camino para este examen"
                    style={{ fontSize: 11, color: recalcExamId === exam.id ? '#93c5fd' : '#cbd5e1', background: 'none', border: 'none', cursor: recalcExamId === exam.id ? 'default' : 'pointer', padding: 3 }}
                  >
                    <TimerReset size={13} className={recalcExamId === exam.id ? 'animate-spin' : undefined} />
                  </button>
                  <button onClick={() => openEditExam(exam)} style={{ fontSize: 11, color: '#cbd5e1', background: 'none', border: 'none', cursor: 'pointer', padding: 3 }}><Pencil size={13} /></button>
                  <button onClick={() => deleteExam(exam.id)} style={{ fontSize: 11, color: '#cbd5e1', background: 'none', border: 'none', cursor: 'pointer', padding: 3 }}><Trash2 size={13} /></button>
                </div>
                {recalcResult?.examId === exam.id && (
                  <div style={{ marginTop: 8, marginLeft: 66, display: 'flex', alignItems: 'start', gap: 8, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '8px 10px' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', flex: 1, lineHeight: 1.4 }}>{recalcResult.message}</p>
                    <button onClick={() => setRecalcResult(null)} style={{ fontSize: 10, color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>✕</button>
                  </div>
                )}
              </div>
            )) : null}
            {pastExams.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <button onClick={() => setShowPastExams(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0' }}>
                  <ChevronDown size={11} style={{ transform: showPastExams ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />Pasados ({pastExams.length})
                </button>
                {showPastExams && pastExams.map(exam => (
                  <div key={exam.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0 6px 8px', opacity: 0.5, borderLeft: `2px solid ${exam.examScope === 'global' ? '#7c3aed' : '#2563eb'}` }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', width: 56, flexShrink: 0 }}>{formatDate(exam.date)}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', flex: 1 }}>{exam.subject} · {exam.topic || exam.name || 'Parcial'}</span>
                    <button onClick={() => deleteExam(exam.id)} style={{ color: '#cbd5e1', background: 'none', border: 'none', cursor: 'pointer', padding: 3 }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={openNewExam} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginTop: 8, padding: 8, fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'none', border: '1px dashed #e2e8f0', borderRadius: 8, cursor: 'pointer' }}>+ Añadir examen</button>
          </div>

          {/* Centro Pulso */}
          {centroPulso && (
            <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 4px' }}>Tu instituto</p>
              <p style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', margin: 0 }}>Los alumnos de {centroPulso.centroDisplay} van por <span style={{ color: '#2563eb' }}>{centroPulso.topicName}</span></p>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', margin: '4px 0 0' }}>{centroPulso.position === 'ahead' ? `Vas ${centroPulso.delta} ${centroPulso.delta === 1 ? 'tema' : 'temas'} por delante — mantén el ritmo` : centroPulso.position === 'same' ? 'Vas al ritmo de tu clase' : `Estás a ${centroPulso.delta} ${centroPulso.delta === 1 ? 'tema' : 'temas'} — tu Camino ya lo tiene en cuenta`}</p>
            </div>
          )}

        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ width: 288, flexShrink: 0, flexDirection: 'column', background: 'white', borderLeft: '1px solid #e2e8f0', position: 'sticky', top: 81, maxHeight: 'calc(100vh - 81px)', overflowY: 'auto' }} className="hidden lg:flex">

          {/* XP + División */}
          <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', marginBottom: 10 }}>Tu progreso</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: '#2563eb', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{displayedXP.toLocaleString('es-ES')}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>XP</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: division.bg, color: division.text }}>
              <DivisionIcon tierIndex={DIVISIONS.indexOf(division)} size={12} color={division.text} strokeWidth={1.1} />
              {division.name}{nextDivision ? ` · ${nextDivision.name} en ${Math.max(0, nextDivision.min - displayedXP)} XP` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{streak > 0 ? `🔥 ${streak}` : '—'}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>Racha</div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{completedMainWithSims}/{Math.min(totalMain, 5)}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>Esta semana</div>
              </div>
            </div>
            {caminoPlanId === 'free' && daysSinceReg !== null && (
              <div style={{ marginTop: 8, background: '#eff6ff', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#1d4ed8' }}>Te quedan {Math.max(0, 7 - daysSinceReg)} días de prueba</div>
            )}
          </div>

          {/* Mini week */}
          <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', marginBottom: 10 }}>{selectedWeekLabel}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
              {weekCalendar.map((day, i) => {
                const isPast = day.date < realToday
                const dayNum = day.date ? parseInt(day.date.split('-')[2], 10) : i + 1
                const dayLetter = ['L', 'M', 'X', 'J', 'V', 'S', 'D'][i] ?? day.label.slice(0, 1).toUpperCase()
                const dayMain = day.missions.filter(m => m.role === 'main')
                const dayDone = dayMain.length > 0 && dayMain.every(m => m.status === 'done')
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: '#94a3b8' }}>{dayLetter}</span>
                    <div style={{ position: 'relative' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: day.isToday ? '#2563eb' : isPast ? '#0f172a' : '#f1f5f9', color: day.isToday || isPast ? 'white' : '#64748b' }}>{dayNum}</div>
                      {dayDone && (
                        <span style={{ position: 'absolute', top: -3, right: -3, width: 13, height: 13, borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid white' }}>
                          <Check size={8} color="white" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Mi liga */}
          <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#334155' }}>Mi liga</div>
              <button
                onClick={openFullRanking}
                style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Clasificación →
              </button>
            </div>
            <LigaSection ligas={ligas} loading={ligaLoading} onCreateLiga={createLiga} onJoinLiga={joinLiga} />
            {globalTop && globalTop.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Top 5 Global</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {globalTop.map(entry => (
                    <RankingRow key={entry.rank} rank={entry.rank} name={entry.name} xp={entry.xp} isMe={entry.isCurrentUser} theme="light" />
                  ))}
                </div>
                {globalMyRank != null && globalMyRank > 5 && (
                  <p className="mt-2 text-center text-[11px] font-bold text-slate-400">Tu puesto: #{globalMyRank}</p>
                )}
                {globalNextTarget && (
                  <p className="mt-1 text-center text-[11px] font-bold text-slate-400">
                    Te faltan <span className="font-black text-blue-600">{globalNextTarget.xpNeeded.toLocaleString('es-ES')} XP</span> para adelantar a {globalNextTarget.name}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Avance por asignatura */}
          {(subjectProgress.matematicas_ii != null || subjectProgress.matematicas_ccss != null || subjectProgress.lengua != null || subjectProgress.historia_espana != null || subjectProgress.fisica != null || subjectProgress.quimica != null) && (
            <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', marginBottom: 10 }}>Tu avance</div>
              {([
                { subject: 'matematicas_ii',   label: 'Matemáticas II',  total: 9,  color: '#2563eb' },
                { subject: 'historia_espana',  label: 'Historia España', total: 10, color: '#b45309' },
                { subject: 'lengua',           label: 'Lengua',          total: 8,  color: '#0891b2' },
                { subject: 'matematicas_ccss', label: 'Mat. CCSS',       total: 6,  color: '#7c3aed' },
                { subject: 'fisica',           label: 'Física',          total: 57, color: '#0f766e' },
                { subject: 'quimica',          label: 'Química',         total: 68, color: '#65a30d' },
              ] as const).filter(({ subject }) => subjectProgress[subject] != null).map(({ subject, label, total, color }) => {
                const done = subjectProgress[subject] ?? 0
                const pct = Math.min(100, Math.round((done / total) * 100))
                return (
                  <div key={subject} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: '#334155' }}>{label}</span>
                      <span style={{ fontWeight: 600, color: '#94a3b8' }}>{done}/{total}</span>
                    </div>
                    <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: color, width: `${pct}%`, transition: 'width 500ms' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Nota proyectada */}
          {filteredProjection && filteredProjection.length > 0 && (
            <div style={{ padding: 16 }}>
              <NotaProyectadaCard projections={filteredProjection} heroAsignatura={heroAsignatura} />
            </div>
          )}

          <button onClick={() => setShowAddSubjectModal(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: 10, fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'none', border: 'none', borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>+ Añadir asignatura</button>
        </div>
      </div>

      {/* ── MODALS ── */}
      <AnimatePresence>
        {showNotSeenConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="kairo-subtle-backdrop fixed inset-0 z-50 grid place-items-center p-4">
            <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }} className="kairo-modal-card w-full max-w-sm p-6">
              <h3 className="text-lg font-black text-slate-950">¿Aún no lo has dado en clase?</h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">Lo guardamos para más adelante. Hoy te daremos una alternativa para que no pierdas el ritmo.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowNotSeenConfirm(false)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-500">Cancelar</button>
                <button onClick={() => { setShowNotSeenConfirm(false); markNotSeenHero() }} className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white">Confirmar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{showExamForm && <ExamModal subjects={onboardingSubjects} draft={examDraft} setDraft={setExamDraft} onClose={resetExamDraft} onSave={saveExam} editing={Boolean(editingExamId)} curriculum={curriculumItems.length ? curriculumItems : FALLBACK_CURRICULUM} saving={savingExam} />}</AnimatePresence>
      <AnimatePresence>{showCalendarEditor && <CalendarEditorOverlay calendar={calendar} weekStartISO={selectedWeekStart} exams={exams} subjects={onboardingSubjects} curriculum={curriculumItems} planId={caminoPlanId} externalBusyByDate={externalBusyByDate} conflicts={calendarConflicts} reorganizeStatus={calendarReorganizeStatus} onReorganize={reorganizeCalendarConflicts} onEditorWeekChange={weekStart => { applyWeekNavigation(weekStart); setCalendarAvailabilityRefreshKey(key => key + 1) }} onNavigateWeek={generateWeek} onClose={() => setShowCalendarEditor(false)} onAddExam={() => { setShowCalendarEditor(false); openNewExam() }} onPersist={updated => { const weekStart = weekStartForDate(updated[0]?.date ?? selectedWeekStart); saveWeekCache(weekStart, updated); setCalendar(current => mergeWeekIntoCalendar(current, weekStart, updated)); setCalendarAvailabilityRefreshKey(key => key + 1) }} onSave={updated => { const weekStart = weekStartForDate(updated[0]?.date ?? selectedWeekStart); saveWeekCache(weekStart, updated); setCalendar(current => mergeWeekIntoCalendar(current, weekStart, updated)); setShowCalendarEditor(false); setCalendarAvailabilityRefreshKey(key => key + 1) }} />}</AnimatePresence>
      <AnimatePresence>
        {leagueUpgrade && (() => {
          const upgradedDiv = DIVISIONS.find(d => d.name === leagueUpgrade.to) ?? DIVISIONS[DIVISIONS.length - 1]
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="kairo-subtle-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }} className="kairo-modal-card w-full max-w-sm p-6">
                <div className="mb-4 rounded-2xl px-4 py-5 text-center" style={{ background: upgradedDiv.bg }}>
                  <p className="text-3xl font-black" style={{ color: upgradedDiv.text }}>🏆 {leagueUpgrade.to}</p>
                  <p className="mt-1 text-sm font-bold" style={{ color: upgradedDiv.text, opacity: 0.75 }}>Nueva división</p>
                </div>
                <h2 className="text-center text-lg font-black text-slate-950">¡Has subido de división!</h2>
                <p className="mt-1 text-center text-sm font-semibold text-slate-500">De <strong className="text-slate-700">{leagueUpgrade.from}</strong> a <strong style={{ color: upgradedDiv.text }}>{leagueUpgrade.to}</strong>. Sigue así.</p>
                <button
                  type="button"
                  onClick={() => setLeagueUpgrade(null)}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black text-white"
                  style={{ background: upgradedDiv.bar }}
                >
                  ¡A por más XP!
                </button>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>
      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} onAnimationComplete={() => setTimeout(() => setToast(null), 1600)} className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-[0_12px_30px_rgba(15,23,42,.24)]">{toast}</motion.div>}</AnimatePresence>
      <AnimatePresence>{showAddSubjectModal && onboarding && <AddSubjectModal currentSubjects={onboarding.subjects} onClose={() => setShowAddSubjectModal(false)} onAdd={addSubject} loading={addSubjectLoading} />}</AnimatePresence>
      {/* Antes vivía dentro del panel derecho (className="hidden lg:flex" en
          RIGHT PANEL más arriba) — un display:none en el ancestro oculta
          también a sus descendientes aunque sean position:fixed, así que el
          modal nunca podía pintarse en mobile/tablet ni disparándolo desde
          otro sitio. Renderizado aquí, al nivel de los demás modales, queda
          siempre disponible sin importar el ancho de pantalla. */}
      <AnimatePresence>{showFullRanking && fullRankingToken && <FullRankingModal token={fullRankingToken} onClose={() => setShowFullRanking(false)} />}</AnimatePresence>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f4f7fb' }}>
      <style>{`
        .camino-target-label {
          display: block;
          color: #64748b;
          font-size: 8.5px;
          font-weight: 900;
          letter-spacing: .1em;
          line-height: 1.2;
          text-transform: uppercase;
        }
        .camino-target-objective .camino-target-label { color: #2563eb; }
        .camino-target-metrics {
          display: flex;
          align-items: center;
          gap: 18px;
          margin-left: auto;
        }
        .camino-target-metrics > div { min-width: 58px; }
        .camino-target-metrics strong {
          display: block;
          margin-top: 2px;
          color: #0f172a;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
        }
        .camino-target-metrics strong.is-below { color: #b45309; }
        .camino-target-metrics strong.is-above { color: #047857; }
        .camino-reason-list {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 10px;
        }
        .camino-reason-chip {
          display: inline-flex;
          align-items: center;
          min-height: 25px;
          max-width: 100%;
          border: 1px solid rgba(203,213,225,.9);
          border-radius: 999px;
          background: #f8fafc;
          box-shadow: inset 1px 1px 3px rgba(15,23,42,.06), inset -1px -1px 3px rgba(255,255,255,.95);
          color: #475569;
          font-size: 10.5px;
          font-weight: 800;
          line-height: 1.25;
          padding: 5px 10px;
        }
        .camino-reason-chip--primary {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
          font-weight: 900;
        }
        .camino-reason-chip--primary.camino-reason-chip--urgent {
          border-color: #fed7aa;
          background: linear-gradient(145deg,#fff7ed,#ffedd5);
          box-shadow: 0 4px 10px rgba(234,88,12,.12), inset 0 1px 0 rgba(255,255,255,.92);
          color: #c2410c;
        }
        .camino-reason-chip--orientation {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .camino-why-now {
          width: fit-content;
          max-width: 100%;
          margin-top: 8px;
          border: 1px solid rgba(219,234,254,.8);
          border-radius: 10px;
          background: rgba(255,255,255,.58);
          backdrop-filter: blur(10px);
          color: #64748b;
          font-size: 11px;
        }
        .camino-why-now summary {
          cursor: pointer;
          list-style-position: inside;
          padding: 6px 9px;
          color: #475569;
          font-weight: 850;
        }
        .camino-why-now[open] { width: 100%; }
        .camino-why-now p {
          margin: 0;
          border-top: 1px solid rgba(219,234,254,.72);
          padding: 8px 10px 9px;
          line-height: 1.45;
        }

        /* iPad/tablet: el hero (340px, pensado para escritorio) solo tenía
           un recorte para móvil (max-width:767px) — en tablet se quedaba a
           altura completa, dejando muy poco sitio para el contenido real
           debajo. */
        @media (min-width: 768px) and (max-width: 1024px) {
          .camino-hero { height: 260px !important; }
          .camino-hero-days { font-size: 78px !important; }
          .camino-hero-overlay { padding: 22px 26px !important; }
        }

        @media (max-width: 767px) {
          .camino-hero { height: 200px !important; }
          .camino-hero-days { font-size: 64px !important; }
          .camino-hero-overlay { padding: 16px 20px !important; }
          .camino-header { padding: 10px 14px !important; flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .camino-header-title { font-size: 16px !important; }
          .camino-header-actions { width: 100% !important; overflow-x: auto !important; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .camino-header-actions::-webkit-scrollbar { display: none; }
          .camino-mission-card { flex-wrap: wrap !important; padding: 14px 16px !important; }
          .camino-mission-number { font-size: 22px !important; width: 36px !important; }
          .camino-main-body { flex-basis: calc(100% - 52px) !important; }
          .camino-main-action {
            width: calc(100% - 52px) !important;
            margin-left: 52px !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
          }
          .camino-main-action > a,
          .camino-main-action > span:not(:first-child) { justify-content: center; min-width: 0; }
          .camino-target-card { align-items: flex-end !important; }
          .camino-target-objective { flex-basis: 100%; }
          .camino-target-metrics { order: 2; margin-left: 0; gap: 15px; }
          .camino-target-card > a { order: 3; }
        }

        @media (max-width: 420px) {
          .camino-mission-card { margin-left: 12px !important; margin-right: 12px !important; gap: 12px !important; }
          .camino-main-body { flex-basis: calc(100% - 48px) !important; }
          .camino-main-action { width: calc(100% - 48px) !important; margin-left: 48px !important; }
          .camino-target-metrics { width: 100%; justify-content: space-between; }
          .camino-target-card > a { margin-top: 1px; }
        }
      `}</style>
      <SidebarNav />
      <div className="kairo-page-scroll" style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </div>
  )
}

type BlockEntry = { bloque: string; nota_proyectada: number; num_entries: number; avg_max_pts: number | null }
type ProjectionEntry = { asignatura: string; nota_proyectada: number | null; num_entries: number; recent_entries: number; confidence: 'low' | 'medium' | 'high'; trend_7d: number | null; bloques: BlockEntry[] }

function gradeColors(nota: number, confidence: 'low' | 'medium' | 'high'): { text: string; bar: string; bg: string } {
  if (confidence === 'low') return { text: '#64748b', bar: '#94a3b8', bg: '#f8fafc' }
  if (nota >= 7) return { text: '#15803d', bar: '#16a34a', bg: '#f0fdf4' }
  if (nota >= 5) return { text: '#b45309', bar: '#d97706', bg: '#fffbeb' }
  if (nota >= 4) return { text: '#92400e', bar: '#d97706', bg: '#fffbeb' }
  // nota < 4: neutral dark
  return { text: '#1e293b', bar: '#94a3b8', bg: '#f8fafc' }
}

function NotaProyectadaCard({ projections, heroAsignatura }: { projections: ProjectionEntry[]; heroAsignatura: string | null }) {
  const hero = projections.find(p => p.asignatura === heroAsignatura) ?? projections[0] ?? null
  const rest = projections.filter(p => p !== hero)

  if (!hero) return null

  const heroNota = hero.nota_proyectada
  const heroBloques = hero.bloques ?? []
  const bestBloque = heroBloques.find(b => b.num_entries >= 1)?.bloque
  const subLabel = subjectLabelFromSlug(hero.asignatura)
  const subtitle = bestBloque ? `${subLabel} · ${bestBloque}` : subLabel
  const trend = hero.trend_7d
  const hasTrend = trend !== null && Math.abs(trend) >= 0.1

  return (
    <>
      <p style={{ fontSize: 11, fontWeight: 900, color: '#334155', marginBottom: 10 }}>Nota proyectada PAU</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {hero.confidence === 'low' ? (
            <>
              <p style={{ fontSize: 18, fontWeight: 900, color: '#64748b', lineHeight: 1, margin: 0 }}>Aún afinando</p>
              <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                {Math.max(1, 3 - hero.recent_entries)} ejercicio{3 - hero.recent_entries !== 1 ? 's' : ''} más
              </p>
            </>
          ) : heroNota !== null ? (
            <>
              <span style={{ fontSize: 32, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>{heroNota.toFixed(1)}</span>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{subtitle}</div>
            </>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>Sin datos</span>
          )}
        </div>
        {heroNota !== null && hero.confidence !== 'low' && (
          <div style={{ textAlign: 'right' }}>
            {hasTrend ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: trend! > 0 ? '#16a34a' : '#dc2626' }}>
                  {trend! > 0 ? '▲' : '▼'} {trend! > 0 ? '+' : ''}{trend!.toFixed(1)}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>esta semana</div>
              </>
            ) : (
              <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>estable</div>
            )}
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {rest.map(p => {
            const nota = p.nota_proyectada
            const colors = nota !== null && p.confidence !== 'low' ? gradeColors(nota, p.confidence) : null
            return (
              <div key={p.asignatura} style={{ display: 'flex', alignItems: 'center', gap: 5, borderRadius: 99, border: '1px solid #f1f5f9', background: '#f8fafc', padding: '4px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>{subjectLabelFromSlug(p.asignatura)}</span>
                {p.confidence === 'low' ? (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#cbd5e1' }}>—</span>
                ) : nota !== null && colors ? (
                  <span style={{ fontSize: 10, fontWeight: 900, color: colors.text }}>{nota.toFixed(1)}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function CourseDirectory({ groups }: { groups: Array<{ subject: string; blocks: Array<{ block: string; items: CurriculumItem[] }> }> }) {
  const [open, setOpen] = useState(false)
  const [selectedSubject, setSelectedSubject] = useState(groups[0]?.subject ?? '')
  const [selectedBlock, setSelectedBlock] = useState(groups[0]?.blocks[0]?.block ?? '')
  const activeGroup = groups.find(group => group.subject === selectedSubject) ?? groups[0]
  const activeBlock = activeGroup?.blocks.find(block => block.block === selectedBlock) ?? activeGroup?.blocks[0]
  return (
    <section className="kairo-soft-panel mb-5 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Temario guiado</p>
          <h2 className="text-xl font-black text-slate-950">Explorar temas</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Elige asignatura, bloque y tema cuando quieras entrar manualmente a una ruta de aprendizaje.</p>
        </div>
        <button onClick={() => setOpen(value => !value)} className="kairo-soft-control inline-flex items-center gap-2 px-4 py-2 text-sm font-black text-blue-700"><BookOpen size={16} /> {open ? 'Cerrar cursos' : 'Ver cursos'}</button>
      </div>
      {groups.length ? (
        <div>
          <div className="flex flex-wrap gap-2">
            {groups.map(group => (
              <button key={group.subject} onClick={() => { setSelectedSubject(group.subject); setSelectedBlock(group.blocks[0]?.block ?? ''); setOpen(true) }} className="rounded-full border px-3 py-1.5 text-xs font-black transition hover:-translate-y-0.5" style={{ borderColor: selectedSubject === group.subject ? themeFor(group.subject).text : themeFor(group.subject).border, background: selectedSubject === group.subject ? themeFor(group.subject).bg : '#ffffff', color: themeFor(group.subject).text }}>
                {group.subject}
              </button>
            ))}
          </div>
          {!open && <p className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-4 py-4 text-sm font-bold text-blue-800">Tu calendario ya te lleva al tema que toca. Abre cursos sólo cuando quieras buscar manualmente un bloque concreto.</p>}
          {open && activeGroup && (
            <article className="kairo-quiet-card mt-4 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: themeFor(activeGroup.subject).text }} />
                <h3 className="text-base font-black text-slate-900">{activeGroup.subject}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeGroup.blocks.map(block => (
                  <button key={`${activeGroup.subject}-${block.block}`} onClick={() => setSelectedBlock(block.block)} className="rounded-2xl border border-white bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm transition hover:-translate-y-0.5" style={{ borderColor: activeBlock?.block === block.block ? themeFor(activeGroup.subject).border : '#ffffff' }}>
                    {block.block}
                  </button>
                ))}
              </div>
              {activeBlock && <div className="mt-3 rounded-2xl border border-white bg-white p-3">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{activeBlock.block}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeBlock.items.map(item => {
                    const href = courseHrefForItem(item)
                    const className = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition'
                    const style = { borderColor: themeFor(item.subject).border, background: themeFor(item.subject).bg, color: themeFor(item.subject).text }
                    return href ? (
                      <a key={`${item.subjectSlug}-${item.blockSlug}-${item.topicSlug}`} href={href} className={`${className} hover:-translate-y-0.5`} style={style}>
                        {item.topic}
                        <ArrowRight size={12} />
                      </a>
                    ) : (
                      <span key={`${item.subjectSlug}-${item.blockSlug}-${item.topicSlug}`} className={`${className} cursor-not-allowed opacity-60`} style={style}>
                        {item.topic}
                      </span>
                    )
                  })}
                </div>
              </div>}
            </article>
          )}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-4 py-4 text-sm font-bold text-blue-800">Completa tus asignaturas para ver el temario guiado.</p>
      )}
    </section>
  )
}

// El calendario que carga fetchCaminoCalendar en el padre solo trae
// scheduled_date >= hoy (a propósito, para el dashboard principal, que no
// necesita días ya pasados) — así que si hoy es, p.ej., miércoles, lunes y
// martes de la semana actual nunca llegan a `calendar`, y por tanto tampoco
// al draft de este editor: esos días ni siquiera existían como pestaña. No
// era un problema de layout/overflow (el grid de abajo ya soporta 7
// columnas) — el array de entrada tenía menos de 7 días. Se completan aquí
// con entradas vacías (sin misiones) para que los 7 días de la semana
// existan siempre como pestaña navegable, tanto si ya pasaron como si
// todavía no se ha generado nada para ellos (fin de semana).
function fillWeekGaps(weekStartISO: string, days: DayPlan[]): DayPlan[] {
  const byDate = new Map(days.map(day => [day.date, day]))
  const today = todayMadrid()
  return Array.from({ length: 7 }, (_, i) => {
    const date = toISO(addDays(dateFromISO(weekStartISO), i))
    return byDate.get(date) ?? { date, label: calendarDayLabel(date), isToday: date === today, missions: [] }
  })
}

function CalendarEditorOverlay({ calendar, weekStartISO, exams, subjects, curriculum, planId, externalBusyByDate, conflicts, reorganizeStatus, onReorganize, onEditorWeekChange, onNavigateWeek, onClose, onAddExam, onPersist, onSave }: { calendar: DayPlan[]; weekStartISO: string; exams: StudentExam[]; subjects: string[]; curriculum: CurriculumItem[]; planId: CaminoPlanId; externalBusyByDate: ExternalBusyByDate; conflicts: CalendarConflict[]; reorganizeStatus: 'idle' | 'saving' | 'done' | 'error'; onReorganize: () => void; onEditorWeekChange: (weekStartISO: string) => void; onNavigateWeek: (weekStartISO: string) => DayPlan[]; onClose: () => void; onAddExam: () => void; onPersist: (calendar: DayPlan[]) => void; onSave: (calendar: DayPlan[]) => void }) {
  const safeSubjects: string[] = subjects
  // `calendar` is the whole multi-week calendar loaded in the parent, not
  // just this week — seeding the editor's draft from it directly (instead of
  // filtering to weekStartISO like onNavigateWeek already does) showed every
  // loaded week stacked on open. Only a subsequent Ant/Hoy/Sig click (which
  // does filter) or a lucky reload where the parent happened to have just one
  // week loaded made it look "fixed".
  const initialWeek = fillWeekGaps(weekStartISO, onNavigateWeek(weekStartISO))
  const initialSelectedDate = initialWeek.find(d => d.isToday)?.date ?? initialWeek[0]?.date ?? weekStartISO
  const [draft, setDraft] = useState<DayPlan[]>(() => initialWeek.map(day => ({ ...day, missions: day.missions.map(mission => ({ ...mission })) })))
  const [newMission, setNewMission] = useState({ day: initialSelectedDate, subject: safeSubjects[0] ?? 'Matemáticas II', kind: 'concept_explanation' as MissionKind, topic: '', minutes: DEFAULT_MISSION_DURATION_MINUTES, startTime: '', bonus: false })
  const [draggedMissionId, setDraggedMissionId] = useState<string | null>(null)
  const [editorNotice, setEditorNotice] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [editorWeekStart, setEditorWeekStart] = useState(weekStartISO)
  const [missionPanelOpen, setMissionPanelOpen] = useState(false)
  const [selectedDayDate, setSelectedDayDate] = useState<string>(() => initialSelectedDate)
  const [calendarView, setCalendarView] = useState<'week' | 'month'>('week')
  const [monthCursor, setMonthCursor] = useState(() => monthStartISO(initialSelectedDate))
  const topics = curriculumForSubject(newMission.subject, curriculum)
  const orderedDraft = draft.slice().sort((a, b) => a.date.localeCompare(b.date))
  const selectedDay = orderedDraft.find(d => d.date === selectedDayDate) ?? orderedDraft[0]
  const mainMissionCount = orderedDraft.reduce((total, day) => total + day.missions.filter(mission => mission.role === 'main').length, 0)
  const bonusMissions = orderedDraft.flatMap(day => day.missions.filter(mission => mission.role === 'bonus').map(mission => ({ mission, day })))
  const selectedDayBusy = selectedDay ? externalBusyByDate[selectedDay.date] ?? [] : []
  const selectedDayConflicts = selectedDay ? conflicts.filter(conflict => conflict.date === selectedDay.date) : []
  const newMissionEndTime = addMinutesToHHMM(newMission.startTime || null, newMission.minutes)
  const newMissionDay = draft.find(day => day.date === newMission.day)
  const newMissionKairoBusy = (newMissionDay?.missions ?? [])
    .flatMap(mission => mission.startTime && mission.endTime ? [{ start: mission.startTime.slice(0, 5), end: mission.endTime.slice(0, 5) }] : [])
  const newMissionExternalBusy = externalBusyByDate[newMission.day] ?? []
  const timeConflictNotice = (() => {
    if (!newMission.startTime || !newMissionEndTime) return null
    const requested = { start: newMission.startTime, end: newMissionEndTime }
    const kairoConflict = newMissionKairoBusy.some(slot => localTimeConflict(requested, slot))
    const externalConflict = newMissionExternalBusy.some(slot => localTimeConflict(requested, slot))
    if (!kairoConflict && !externalConflict) return null
    return {
      type: kairoConflict ? 'kairo' as const : 'external' as const,
      suggestedStart: nextFreeStart(newMission.startTime, newMission.minutes, [...newMissionKairoBusy, ...newMissionExternalBusy]),
    }
  })()
  const monthGrid = buildMonthGrid(monthCursor)
  const debugCalendarEditor = (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') console.debug(...args)
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  function cloneWeek(days: DayPlan[]) {
    return days.map(day => ({ ...day, missions: day.missions.map(mission => ({ ...mission })) }))
  }

  function navigateEditorWeek(nextWeekStart: string) {
    const nextWeek = onNavigateWeek(nextWeekStart)
    const nextDraft = fillWeekGaps(nextWeekStart, cloneWeek(nextWeek))
    const nextSelectedDate = nextDraft.find(d => d.isToday)?.date ?? nextDraft[0]?.date ?? nextWeekStart
    setEditorWeekStart(nextWeekStart)
    setDraft(nextDraft)
    setNewMission(current => ({ ...current, day: nextSelectedDate }))
    setDraggedMissionId(null)
    setSelectedDayDate(nextSelectedDate)
    setMonthCursor(monthStartISO(nextSelectedDate))
    setSaveState('idle')
    onEditorWeekChange(nextWeekStart)
  }

  function selectEditorDay(dateISO: string) {
    const nextWeekStart = weekStartForDate(dateISO)
    if (nextWeekStart !== editorWeekStart) {
      const nextWeek = fillWeekGaps(nextWeekStart, cloneWeek(onNavigateWeek(nextWeekStart)))
      setEditorWeekStart(nextWeekStart)
      setDraft(nextWeek)
      onEditorWeekChange(nextWeekStart)
    }
    setSelectedDayDate(dateISO)
    setMonthCursor(monthStartISO(dateISO))
    setNewMission(current => ({ ...current, day: dateISO }))
    setSaveState('idle')
    setEditorNotice('')
  }

  function missionsForEditorDate(dateISO: string) {
    const editorWeekEnd = toISO(addDays(dateFromISO(editorWeekStart), 6))
    return (dateISO >= editorWeekStart && dateISO <= editorWeekEnd)
      ? (draft.find(day => day.date === dateISO)?.missions ?? [])
      : (calendar.find(day => day.date === dateISO)?.missions ?? [])
  }

  function moveMission(missionId: string, nextDate: string) {
    const sourceDay = draft.find(day => day.missions.some(mission => mission.id === missionId))
    const mission = sourceDay?.missions.find(item => item.id === missionId)
    if (!sourceDay || !mission || sourceDay.date === nextDate) return
    setDraft(current => current.map(day => {
      if (day.date === sourceDay.date) return { ...day, missions: day.missions.filter(item => item.id !== missionId) }
      if (day.date === nextDate) return { ...day, missions: [...day.missions, mission] }
      return day
    }))
  }

  function updateMission(missionId: string, patch: Partial<Mission>) {
    setDraft(current => current.map(day => ({ ...day, missions: day.missions.map(mission => {
      if (mission.id !== missionId) return mission
      const next = { ...mission, ...patch }
      return { ...next, ...missionMeta(next.kind, next.subject, next.topic, next.block) }
    }) })))
  }

  function deleteMission(missionId: string) {
    setDraft(current => current.map(day => ({ ...day, missions: day.missions.filter(mission => mission.id !== missionId) })))
  }

  function openMissionForm(day?: string, suggested = false) {
    const targetDay = day ?? selectedDay?.date ?? newMission.day
    setNewMission(current => ({
      ...current,
      day: targetDay,
      subject: current.subject || safeSubjects[0] || current.subject,
      topic: suggested ? '' : current.topic,
      kind: suggested ? 'concept_explanation' : current.kind,
      minutes: DEFAULT_MISSION_DURATION_MINUTES,
      bonus: suggested ? false : current.bonus,
    }))
    setMissionPanelOpen(true)
    setSaveState('idle')
    setEditorNotice('')
  }

  function handleTopAddClick() {
    debugCalendarEditor('[calendar-editor] TOP_ADD_CLICK')
    if (missionPanelOpen) {
      setMissionPanelOpen(false)
      return
    }
    openMissionForm(selectedDay?.date)
  }

  function suggestTopicInForm() {
    debugCalendarEditor('[calendar-editor] SUGGESTED_CLICK')
    setNewMission(current => ({
      ...current,
      topic: '',
      kind: 'concept_explanation',
      minutes: DEFAULT_MISSION_DURATION_MINUTES,
      bonus: false,
    }))
  }

  async function handleFormSubmitClick() {
    debugCalendarEditor('[calendar-editor] FORM_SUBMIT_CLICK')
    await addMission()
  }

  // The only UI path that persists a new editor mission is the form submit
  // button. Header/day shortcuts only prepare this shared form state.
  async function addMission(overrides: Partial<typeof newMission> = {}) {
    debugCalendarEditor('[calendar-editor] ADD_MISSION_HANDLER_ENTER')
    if (saveState === 'saving') return
    const effective = { ...newMission, ...overrides }
    if (!effective.subject || !effective.day) return
    setSaveState('saving')
    setEditorNotice('')
    const effectiveTopics = curriculumForSubject(effective.subject, curriculum)
    const item = effectiveTopics.find(topic => topic.topic === effective.topic) ?? effectiveTopics[0]
    const subject = effective.subject
    const topic = item?.topic ?? effective.topic
    const cache: CalendarWeekCache = { [calendar[0]?.date ?? currentWeekStartISO()]: draft }
    const requestedKind = effective.kind
    const kind = requestedKind === 'mock_exam' && !canScheduleSimulation(null, planId, effective.day, cache)
      ? 'evau_practice'
      : requestedKind
    if (requestedKind === 'mock_exam' && kind !== 'mock_exam') setEditorNotice('Has alcanzado el límite de simulacros de tu plan este mes. Te proponemos ejercicios PAU del mismo tema.')
    const duplicate = draft
      .find(day => day.date === effective.day)
      ?.missions.some(mission =>
        mission.subject === subject
        && mission.kind === kind
        && (mission.topic ?? '') === (topic ?? '')
        && (mission.startTime ?? '') === (effective.startTime || '')
      )
    if (duplicate) {
      setEditorNotice('Esta misión ya está añadida en el borrador.')
      setSaveState('error')
      return
    }
    const endTime = addMinutesToHHMM(effective.startTime || null, effective.minutes)
    if (effective.startTime && !endTime) {
      setEditorNotice('La misión no puede terminar después de medianoche.')
      setSaveState('error')
      return
    }
    if (effective.startTime && endTime) {
      const requested = { start: effective.startTime, end: endTime }
      const kairoBusy = (draft.find(day => day.date === effective.day)?.missions ?? [])
        .flatMap(mission => mission.startTime && mission.endTime ? [{ start: mission.startTime.slice(0, 5), end: mission.endTime.slice(0, 5) }] : [])
      const externalBusy = externalBusyByDate[effective.day] ?? []
      const kairoConflict = kairoBusy.some(slot => localTimeConflict(requested, slot))
      const externalConflict = externalBusy.some(slot => localTimeConflict(requested, slot))
      if (kairoConflict || externalConflict) {
        const suggestedStart = nextFreeStart(effective.startTime, effective.minutes, [...kairoBusy, ...externalBusy])
        setEditorNotice(`${kairoConflict ? 'Ese horario ya está ocupado.' : 'Ese horario coincide con un evento de tu calendario.'}${suggestedStart ? ` Siguiente hueco disponible: ${suggestedStart}.` : ''}`)
        setNewMission(current => ({ ...current, day: effective.day, startTime: effective.startTime }))
        setSaveState('error')
        return
      }
    }
    const meta = missionMeta(kind, subject, topic, item?.block, item?.planTopic)
    const title = titleFor(kind, subject, item ?? undefined)
    const requestKey = `${effective.day}:${normalizeSubjectSlug(subject)}:${dbMissionTypeFromKind(kind)}:${title}:${effective.startTime || 'no-time'}:${effective.minutes}:${effective.bonus ? 'bonus' : 'main'}`
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setEditorNotice('Inicia sesión para guardar cambios.')
        setSaveState('error')
        return
      }
      debugCalendarEditor('[calendar-editor] FETCH_START')
      const response = await fetch('/api/camino/calendar-editor/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          scheduledDate: effective.day,
          subject,
          kind,
          missionType: dbMissionTypeFromKind(kind),
          role: effective.bonus ? 'bonus' : 'main',
          title,
          blockKey: item?.block ?? null,
          blockSlug: item?.blockSlug ?? (item?.block ? textSlug(item.block) : null),
          topicSlug: item?.topicSlug ?? (topic ? textSlug(topic) : null),
          estimatedMinutes: effective.minutes,
          startTime: effective.startTime || null,
          requestKey,
          metadata: mergeMissionMetadata(undefined, {
            manual_editor: true,
            estimated_minutes: effective.minutes,
            start_time: effective.startTime || undefined,
            end_time: endTime || undefined,
          }),
        }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; mission?: CaminoCalRow; error?: string; code?: string; conflictType?: 'kairo' | 'external'; suggestedStart?: string | null; calendarSync?: string } | null
      if (!response.ok || !payload?.ok || !payload.mission?.id) {
        if (payload?.code === 'TIME_CONFLICT') {
          setEditorNotice(`${payload.conflictType === 'external' ? 'Ese horario coincide con un evento de tu calendario.' : 'Ese horario ya está ocupado.'}${payload.suggestedStart ? ` Siguiente hueco disponible: ${payload.suggestedStart}.` : ''}`)
          setSaveState('error')
          return
        }
        throw new Error(payload?.error ?? 'calendar_editor_save_failed')
      }
      if (draft.some(day => day.missions.some(mission => mission.calendarRowId === payload.mission!.id))) {
        setSaveState('saved')
        return
      }
      const persistedMission = {
        ...calRowToMission(payload.mission),
        kind,
        reason: requestedKind === 'mock_exam' && kind !== 'mock_exam' ? 'Simulacro sustituido por límite mensual: práctica PAU del mismo tema.' : item ? `${item.block} · añadida por el alumno.` : 'Añadida manualmente por el alumno.',
        href: meta.href,
        target: meta.target,
        source: 'camino_pau' as const,
        xpPolicy: 'after_correction' as const,
      }
      const updatedDraft = draft.map(day => day.date === effective.day ? { ...day, missions: [...day.missions, persistedMission] } : day)
      setDraft(updatedDraft)
      onPersist(updatedDraft)
      if (payload.calendarSync === 'error') {
        setEditorNotice('Guardado en Kairo. No se pudo sincronizar con Google Calendar · Reintentar')
        setSaveState('error')
      } else {
        setSaveState('saved')
      }
    } catch {
      setSaveState('error')
      setEditorNotice('No se ha podido guardar. Reintentar.')
    }
  }

  const kindOptions: Array<{ value: MissionKind; label: string }> = [
    { value: 'concept_explanation', label: 'Explicación' },
    { value: 'guided_practice', label: 'Ejercicio guiado' },
    { value: 'evau_practice', label: 'Ejercicio PAU' },
    { value: 'mock_exam', label: 'Simulacro' },
  ]

  async function handleSave() {
    if (saveState === 'saving') return
    setSaveState('saving')
    setEditorNotice('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) {
        setSaveState('error')
        setEditorNotice('Inicia sesión para guardar cambios.')
        return
      }
      const userId = session.user.id

      const draftRowIds = new Set(draft.flatMap(day => day.missions.flatMap(mission => mission.calendarRowId ? [mission.calendarRowId] : [])))
      const editorWeekEnd = toISO(addDays(dateFromISO(editorWeekStart), 6))
      const removedIds = calendar
        .filter(day => day.date >= editorWeekStart && day.date <= editorWeekEnd)
        .flatMap(day => day.missions.flatMap(mission => mission.calendarRowId && !draftRowIds.has(mission.calendarRowId) ? [mission.calendarRowId] : []))
      for (const missionId of removedIds) {
        const response = await fetch('/api/camino/calendar-editor/mission', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ missionId }),
        })
        if (!response.ok) throw new Error('calendar_editor_delete_failed')
      }

      // UPDATE missions that already exist in DB
      const toUpdate = draft.flatMap(day =>
        day.missions
          .filter(m => m.calendarRowId)
          .map(m => ({
            id: m.calendarRowId!,
            scheduled_date: day.date,
            is_main: m.role === 'main',
            is_bonus: m.role !== 'main',
            title: m.title,
            locked: true,
            start_time: m.startTime ?? (typeof m.metadata?.start_time === 'string' ? m.metadata.start_time : null),
            end_time: m.endTime ?? (typeof m.metadata?.end_time === 'string' ? m.metadata.end_time : null),
          }))
      )
      const existingRowsById = new Map<string, {
        scheduled_date: string | null
        start_time: string | null
        end_time: string | null
        manual_reschedule_count: number | null
        metadata: Record<string, unknown> | null
      }>()
      const updateIds = toUpdate.map(item => item.id)
      if (updateIds.length > 0) {
        const { data: existingRows, error: existingRowsError } = await supabase
          .from('camino_calendar')
          .select('id, scheduled_date, start_time, end_time, manual_reschedule_count, metadata')
          .in('id', updateIds)
        if (existingRowsError) throw existingRowsError
        for (const row of existingRows ?? []) {
          existingRowsById.set(row.id, {
            scheduled_date: row.scheduled_date ?? null,
            start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
            end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
            manual_reschedule_count: typeof row.manual_reschedule_count === 'number' ? row.manual_reschedule_count : 0,
            metadata: typeof row.metadata === 'object' && row.metadata ? row.metadata as Record<string, unknown> : null,
          })
        }
      }
      const updateResults = await Promise.all(toUpdate.map(({ id, ...fields }) =>
        {
          const previous = existingRowsById.get(id)
          const nextStart = fields.start_time ? String(fields.start_time).slice(0, 5) : null
          const nextEnd = fields.end_time ? String(fields.end_time).slice(0, 5) : null
          const scheduleChanged = Boolean(previous) && (
            previous!.scheduled_date !== fields.scheduled_date ||
            previous!.start_time !== nextStart ||
            previous!.end_time !== nextEnd
          )
          const patch = scheduleChanged
            ? {
                ...fields,
                manual_reschedule_count: (previous?.manual_reschedule_count ?? 0) + 1,
                metadata: mergeMissionMetadata(previous?.metadata ?? undefined, {
                  calendar_manual_rescheduled_at: new Date().toISOString(),
                  calendar_manual_rescheduled_from: {
                    date: previous?.scheduled_date ?? null,
                    start: previous?.start_time ?? null,
                    end: previous?.end_time ?? null,
                  },
                  calendar_manual_rescheduled_to: {
                    date: fields.scheduled_date,
                    start: nextStart,
                    end: nextEnd,
                  },
                }),
              }
            : fields
          return supabase.from('camino_calendar').update(patch).eq('id', id)
        },
      ))
      const updateError = updateResults.find(result => result.error)?.error
      if (updateError) throw updateError
      await Promise.all(toUpdate.map(async ({ id, ...fields }) => {
        const previous = existingRowsById.get(id)
        const nextStart = fields.start_time ? String(fields.start_time).slice(0, 5) : null
        const nextEnd = fields.end_time ? String(fields.end_time).slice(0, 5) : null
        const scheduleChanged = Boolean(previous) && (
          previous!.scheduled_date !== fields.scheduled_date ||
          previous!.start_time !== nextStart ||
          previous!.end_time !== nextEnd
        )
        if (!scheduleChanged) return
        try {
          await supabase.from('camino_mission_events').insert({
            user_id: userId,
            mission_id: id,
            event_type: 'rescheduled_manual',
            idempotency_key: `manual-reschedule:${id}:${fields.scheduled_date}:${nextStart ?? 'no-start'}:${nextEnd ?? 'no-end'}`,
            metadata: {
              from: { date: previous?.scheduled_date ?? null, start: previous?.start_time ?? null, end: previous?.end_time ?? null },
              to: { date: fields.scheduled_date, start: nextStart, end: nextEnd },
            },
          })
        } catch {
          // Best-effort: the mission save is authoritative; telemetry can retry later.
        }
      }))

      // INSERT new missions (no calendarRowId yet)
      type InsertEntry = { missionId: string; row: Record<string, unknown> }
      const insertEntries: InsertEntry[] = draft.flatMap(day =>
        day.missions
          .filter(m => !m.calendarRowId)
          .map(m => {
            const subjectRaw = m.subjectSlug ?? normalizeSubjectSlug(m.subject)
            const blockKey = m.blockKey ?? m.block ?? null
            const blockSlug = blockKey ? textSlug(blockKey) : null
            const startTime = m.startTime ?? (typeof m.metadata?.start_time === 'string' ? m.metadata.start_time : null)
            const endTime = m.endTime ?? (typeof m.metadata?.end_time === 'string' ? m.metadata.end_time : null)
            return {
              missionId: m.id,
              row: {
                user_id: userId,
                scheduled_date: day.date,
                subject: subjectRaw,
                title: m.title,
                block_key: blockKey,
                block_slug: blockSlug,
                is_main: m.role === 'main',
                is_bonus: m.role !== 'main',
                status: 'pending',
                mission_type: dbMissionTypeFromKind(m.kind, m.missionType),
                source: 'manual',
                locked: true,
                generated_by: 'calendar_editor',
                v2_sort_order: m.v2SortOrder ?? null,
                start_time: startTime || null,
                end_time: endTime || null,
                metadata: mergeMissionMetadata(m.metadata, {
                  manual_editor: true,
                  estimated_minutes: m.estimatedMinutes,
                  calendar_sync_status: startTime && endTime ? 'pending' : 'pending_no_time',
                }),
              },
            }
          })
      )

      let updatedDraft = draft
      if (insertEntries.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('camino_calendar')
          .insert(insertEntries.map(e => e.row))
          .select('id, start_time, end_time')
        if (insertError) throw insertError

        // Map returned IDs back to draft missions by insertion order.
        const idMap = new Map<string, string>()
        if (inserted) {
          insertEntries.forEach((entry, i) => {
            if (inserted[i]?.id) idMap.set(entry.missionId, inserted[i].id)
          })
        }
        updatedDraft = draft.map(day => ({
          ...day,
          missions: day.missions.map(m => {
            if (m.calendarRowId) return m
            const newId = idMap.get(m.id)
            return newId ? { ...m, calendarRowId: newId } : m
          }),
        }))
      }
      onPersist(updatedDraft)

      const syncResponse = await fetch('/api/calendar/google/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const syncPayload = await syncResponse.json().catch(() => null) as { ok?: boolean; failed?: number } | null
      if (!syncResponse.ok || !syncPayload?.ok || (syncPayload.failed ?? 0) > 0) {
        setSaveState('error')
        setEditorNotice('Guardado en Kairo. No se pudo sincronizar con Google Calendar · Reintentar')
        return
      }
      setSaveState('saved')
      await new Promise(resolve => setTimeout(resolve, 250))
      onSave(updatedDraft)
    } catch {
      setSaveState('error')
      setEditorNotice('No se ha podido guardar. Reintentar.')
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-2 backdrop-blur-[3px] sm:p-4" style={{ overscrollBehavior: 'contain' }}>
      <motion.section
        initial={{ opacity: 0, y: 14, scale: 0.987 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.987 }}
        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        className="kairo-glass flex w-full flex-col overflow-hidden rounded-2xl"
        style={{ width: 'min(96vw, 1400px)', height: 'min(92dvh, 920px)', boxShadow: '0 6px 18px rgba(15,23,42,0.14), 0 30px 90px rgba(15,23,42,0.28)' }}
      >
        {/* ── Dark header ── */}
        <header className="shrink-0 bg-[#0f172a] px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-[8px] font-black uppercase tracking-[.24em] text-slate-500">Camino PAU · Calendario</p>
              <h2 className="mt-1 text-[22px] font-black text-slate-100" style={{ letterSpacing: '-0.025em', lineHeight: 1 }}>
                {calendarView === 'week' ? weekRangeLabel(editorWeekStart) : monthLabel(monthCursor)}
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="kairo-inset flex items-center gap-1 rounded-lg p-1">
                <button type="button" onClick={() => setCalendarView('week')} className="rounded-md px-3 py-1.5 text-[10px] font-black transition" style={{ background: calendarView === 'week' ? 'white' : 'transparent', color: calendarView === 'week' ? '#0f172a' : '#cbd5e1' }}>Semana</button>
                <button type="button" onClick={() => setCalendarView('month')} className="rounded-md px-3 py-1.5 text-[10px] font-black transition" style={{ background: calendarView === 'month' ? 'white' : 'transparent', color: calendarView === 'month' ? '#0f172a' : '#cbd5e1' }}>Mes</button>
              </div>
              <button onClick={onAddExam} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black text-slate-400 transition hover:bg-white/[0.11]"><Plus size={13} /> Parcial</button>
              <button type="button" data-calendar-editor-action="top-add" onClick={handleTopAddClick} className="inline-flex items-center gap-1.5 rounded-lg border border-white/70 bg-white/90 px-3 py-2 text-[11px] font-black text-[#0f172a] transition hover:bg-white" style={{ boxShadow: 'var(--kairo-shadow-soft)' }}><Plus size={13} /> {missionPanelOpen ? 'Cerrar formulario' : 'Nueva misión'}</button>
            </div>
          </div>

          {calendarView === 'week' && (
          <>
          {/* Week grid — a plain grid-cols-7 never shrinks below each day's
              intrinsic content width, so on narrow phones it silently
              overflowed the header and got clipped by the section's
              overflow-hidden: only the first 3-4 days were ever reachable,
              with no scrollbar to reveal the rest. Below sm: it's a
              horizontally scrollable row of fixed-width day chips instead;
              from sm: up it's back to the original even 7-col grid. */}
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0 sm:pb-0">
            {orderedDraft.map((day, idx) => {
              const isSelected = day.date === selectedDayDate
              const isToday = day.isToday
              const dayMains = day.missions.filter(m => m.role === 'main')
              const dayBusyCount = externalBusyByDate[day.date]?.length ?? 0
              const dayConflictCount = conflicts.filter(conflict => conflict.date === day.date).length
              const dayDate = new Date(day.date + 'T12:00:00')
              const prevDate = idx > 0 ? new Date(orderedDraft[idx - 1].date + 'T12:00:00') : null
              const showMonth = idx === 0 || (prevDate && dayDate.getMonth() !== prevDate.getMonth())
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => selectEditorDay(day.date)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); if (draggedMissionId) { moveMission(draggedMissionId, day.date); selectEditorDay(day.date) }; setDraggedMissionId(null) }}
                  className="w-14 shrink-0 rounded-lg py-2.5 text-center transition-all sm:w-auto"
                  style={{
                    background: isSelected ? '#2563eb' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isSelected ? '#2563eb' : isToday ? 'rgba(37,99,235,0.4)' : 'rgba(255,255,255,0.07)'}`,
                    cursor: 'pointer',
                  }}
                >
                  <div className="mb-1 text-[8px] font-black uppercase tracking-[.12em]" style={{ color: isSelected ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.3)' }}>
                    {dayDate.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '').toUpperCase().slice(0, 3)}
                  </div>
                  <div className="text-[20px] font-bold leading-none" style={{ color: isSelected ? 'white' : isToday ? '#60a5fa' : '#cbd5e1' }}>
                    {parseInt(day.date.slice(-2), 10)}
                  </div>
                  {showMonth && (
                    <div className="mt-0.5 text-[7px] font-black uppercase tracking-[.1em]" style={{ color: isSelected ? 'rgba(255,255,255,.5)' : 'rgba(148,163,184,.55)' }}>
                      {dayDate.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}
                    </div>
                  )}
                  <div className="mt-1.5 flex justify-center gap-1" style={{ minHeight: 5 }}>
                    {dayMains.slice(0, 3).map((m, i) => (
                      <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: isSelected ? 'rgba(255,255,255,.45)' : themeFor(m.subject).text }} />
                    ))}
                  </div>
                  {(dayBusyCount > 0 || dayConflictCount > 0) && (
                    <div className="mt-1 flex justify-center gap-1">
                      {dayBusyCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: isSelected ? 'rgba(255,255,255,.6)' : '#94a3b8' }} aria-label="Ocupado" />}
                      {dayConflictCount > 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#fb923c' }} aria-label="Conflicto" />}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Week nav */}
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => navigateEditorWeek(weekOffset(editorWeekStart, -1))} aria-label="Semana anterior" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-black text-slate-400 transition hover:bg-white/[0.11]"><ChevronLeft size={13} /> Ant</button>
            <span className="flex-1 text-center text-[11px] font-black text-slate-400">{weekRangeLabel(editorWeekStart)}</span>
            <button onClick={() => navigateEditorWeek(currentWeekStartISO())} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-black text-slate-400 transition hover:bg-white/[0.11]"><RotateCcw size={11} /> Hoy</button>
            <button onClick={() => navigateEditorWeek(weekOffset(editorWeekStart, 1))} aria-label="Semana siguiente" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-black text-slate-400 transition hover:bg-white/[0.11]">Sig <ArrowRight size={13} /></button>
          </div>
          {conflicts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-orange-300/30 bg-orange-400/10 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black text-orange-100">Tu calendario ha cambiado · {conflicts.length} {conflicts.length === 1 ? 'misión afectada' : 'misiones afectadas'}</p>
                <p className="mt-0.5 text-[9px] font-bold text-orange-200/80">{conflicts[0].date} · {conflicts[0].start}–{conflicts[0].end} coincide con {conflicts[0].busyStart}–{conflicts[0].busyEnd} Ocupado</p>
              </div>
              <button type="button" onClick={onReorganize} disabled={reorganizeStatus === 'saving'} className="shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 text-[10px] font-black text-white transition hover:bg-orange-600 disabled:opacity-60">
                {reorganizeStatus === 'saving' ? 'Reorganizando...' : reorganizeStatus === 'done' ? '✓ Reorganizado' : reorganizeStatus === 'error' ? 'Reintentar' : 'Reorganizar'}
              </button>
            </div>
          )}
          </>
          )}

          {calendarView === 'month' && (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => setMonthCursor(addMonths(monthCursor, -1))} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] font-black text-slate-300 transition hover:bg-white/[0.11]"><ChevronLeft size={13} /> Ant</button>
              <span className="flex-1 text-center text-[11px] font-black text-slate-400">{monthLabel(monthCursor)}</span>
              <button type="button" onClick={() => selectEditorDay(todayMadrid())} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] font-black text-slate-300 transition hover:bg-white/[0.11]"><RotateCcw size={11} /> Hoy</button>
              <button type="button" onClick={() => setMonthCursor(addMonths(monthCursor, 1))} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] font-black text-slate-300 transition hover:bg-white/[0.11]">Sig <ArrowRight size={13} /></button>
            </div>
          )}
        </header>

        {/* ── Body ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          {calendarView === 'month' && (
            <div className="shrink-0 border-b border-[#f1f5f9] bg-white px-6 py-5">
              <div className="grid grid-cols-7 gap-1.5 text-center">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(label => (
                  <div key={label} className="pb-1 text-[9px] font-black uppercase tracking-[.14em] text-slate-400">{label}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5" style={{ gridAutoRows: 'minmax(64px, 1fr)' }}>
                {monthGrid.map(dateISO => {
                  const inMonth = dateISO.slice(0, 7) === monthCursor.slice(0, 7)
                  const isSelected = dateISO === selectedDayDate
                  const isToday = dateISO === todayMadrid()
                  const missions = missionsForEditorDate(dateISO)
                  return (
                    <button
                      key={dateISO}
                      type="button"
                      onClick={() => selectEditorDay(dateISO)}
                      className="flex min-h-16 flex-col items-stretch rounded-lg p-1.5 text-left transition-all hover:border-blue-200 hover:bg-blue-50"
                      style={{
                        background: isSelected ? '#eff6ff' : 'white',
                        border: `1.5px solid ${isSelected ? '#2563eb' : isToday ? 'rgba(37,99,235,.35)' : '#f1f5f9'}`,
                        opacity: inMonth ? 1 : 0.4,
                      }}
                    >
                      <span className="mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black" style={{ background: isToday ? '#2563eb' : 'transparent', color: isToday ? 'white' : '#334155' }}>
                        {parseInt(dateISO.slice(-2), 10)}
                      </span>
                      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                        {missions.slice(0, 2).map(mission => {
                          const theme = themeFor(mission.subject)
                          return <span key={mission.id} className="truncate rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: theme.bg, color: theme.text }}>{mission.title}</span>
                        })}
                        {missions.length > 2 && <span className="text-[9px] font-black text-slate-400">+{missions.length - 2} más</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Day header */}
          <div className="shrink-0 border-b border-[#f1f5f9] px-5 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  {selectedDay?.isToday && (
                    <span className="text-[8px] font-black uppercase tracking-[.14em] rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">Hoy</span>
                  )}
                  <span className="text-[8px] font-black uppercase tracking-[.22em] text-slate-400">
                    {selectedDay?.date ? new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long' }).replace(/^\w/, c => c.toUpperCase()) : ''}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="font-black text-slate-900 leading-none" style={{ fontSize: 34, letterSpacing: '-0.04em', lineHeight: 0.88 }}>
                    {selectedDay?.date ? parseInt(selectedDay.date.slice(-2), 10) : ''}
                  </div>
                  <div className="text-[13px] uppercase tracking-[0em]" style={{ fontWeight: 800, color: '#64748b' }}>
                    {selectedDay?.date ? new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('es-ES', { month: 'long' }) : ''}
                  </div>
                </div>
                <p className="mt-2 text-[9px] font-black uppercase tracking-[.12em] text-slate-300">
                  {(selectedDay?.missions.filter(m => m.role === 'main').length ?? 0)} principales · {(selectedDay?.missions.filter(m => m.role === 'bonus').length ?? 0)} bonus
                </p>
                {selectedDayBusy.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedDayBusy.map((slot, index) => (
                      <span key={`${slot.start}-${slot.end}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
                        <Clock3 size={11} />
                        {formatTimeRange(slot.start, slot.end)} · Ocupado
                      </span>
                    ))}
                  </div>
                )}
                {selectedDayConflicts.length > 0 && (
                  <p className="mt-2 text-[10px] font-black text-orange-600">{selectedDayConflicts.length} {selectedDayConflicts.length === 1 ? 'misión coincide' : 'misiones coinciden'} con tu disponibilidad externa.</p>
                )}
              </div>
            </div>
          </div>

          {/* Add mission panel */}
          {missionPanelOpen && (
            <div className="shrink-0 border-b border-[#dbeafe] bg-[#f8fbff] px-6 py-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-[.14em] text-slate-400">Nueva misión</p>
                <button type="button" onClick={() => setMissionPanelOpen(false)} className="rounded-lg border border-[#dbeafe] bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 transition hover:bg-blue-50">Cerrar</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Día">
                  <select value={newMission.day} onChange={e => setNewMission({ ...newMission, day: e.target.value })} className="inputish">
                    {orderedDraft.map(d => <option key={d.date} value={d.date}>{d.label}</option>)}
                  </select>
                </Field>
                <Field label="Asignatura">
                  <select value={newMission.subject} onChange={e => setNewMission({ ...newMission, subject: e.target.value, topic: '' })} className="inputish">
                    {safeSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Tema">
                  <select value={newMission.topic} onChange={e => setNewMission({ ...newMission, topic: e.target.value })} className="inputish">
                    <option value="">Sugerido</option>
                    {topics.map(t => <option key={`${t.subject}-${t.sortOrder}`} value={t.topic}>{t.block} · {t.topic}</option>)}
                  </select>
                  <button type="button" data-calendar-editor-action="suggested" onClick={suggestTopicInForm} className="mt-2 text-[10px] font-black text-blue-600 transition hover:text-blue-700">
                    Sugerir tema
                  </button>
                </Field>
                <Field label="Tipo">
                  <select value={newMission.kind} onChange={e => setNewMission({ ...newMission, kind: e.target.value as MissionKind })} className="inputish">
                    {kindOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Empieza">
                  <input type="time" value={newMission.startTime} onChange={e => setNewMission({ ...newMission, startTime: e.target.value })} className="inputish" />
                </Field>
                <div className="flex flex-col justify-end gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-black text-slate-600">
                    <input type="checkbox" checked={newMission.bonus} onChange={e => setNewMission({ ...newMission, bonus: e.target.checked })} />
                    Opcional / bonus
                  </label>
                  <button type="button" data-calendar-editor-action="form-submit" onClick={handleFormSubmitClick} disabled={!safeSubjects.length || saveState === 'saving' || Boolean(timeConflictNotice)} title="Añade esta misión al día y con los ajustes configurados arriba." className="kairo-clay-action inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-[11px] font-black text-white transition hover:brightness-105 disabled:opacity-40">
                    {saveState === 'saving' ? 'Guardando...' : saveState === 'saved' ? '✓ Guardada' : saveState === 'error' ? 'Reintentar' : <><Plus size={12} /> Añadir misión</>}
                  </button>
                </div>
              </div>
              {timeConflictNotice && (
                <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] font-bold text-orange-800">
                  <p>{timeConflictNotice.type === 'external' ? 'Ese horario coincide con un evento de tu calendario.' : 'Ese horario ya está ocupado.'}</p>
                  {timeConflictNotice.suggestedStart && (
                    <button type="button" onClick={() => setNewMission(current => ({ ...current, startTime: timeConflictNotice.suggestedStart ?? current.startTime }))} className="mt-1.5 rounded-lg bg-white px-2.5 py-1 text-[10px] font-black text-orange-700 shadow-sm">
                      Usar {timeConflictNotice.suggestedStart}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notice */}
          {editorNotice && (
            <div className="mx-6 mt-4 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] font-black text-amber-800">{editorNotice}</div>
          )}

          {/* Scrollable missions area */}
          <div
            className="flex-1 overflow-y-auto px-5 py-4"
            style={{ overscrollBehavior: 'contain' }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (draggedMissionId && selectedDay) moveMission(draggedMissionId, selectedDay.date); setDraggedMissionId(null) }}
          >
            {calendarView === 'week' && (
              <CalendarWeekTimeline
                days={orderedDraft}
                exams={exams}
                externalBusyByDate={externalBusyByDate}
                conflicts={conflicts}
                selectedDayDate={selectedDayDate}
                onSelectDay={selectEditorDay}
                onEmptySlotClick={(date, startTime) => {
                  selectEditorDay(date)
                  openMissionForm(date)
                  setNewMission(current => ({ ...current, day: date, startTime }))
                }}
                onDeleteMission={deleteMission}
                onToggleRole={(missionId, role) => updateMission(missionId, { role })}
              />
            )}
            <p className="mb-3 text-[8px] font-black uppercase tracking-[.22em] text-slate-300">Misiones principales</p>
            <div className="flex flex-col gap-2">
              {(selectedDay?.missions.filter(m => m.role === 'main') ?? []).map(mission => {
                const theme = themeFor(mission.subject)
                const conflict = missionConflictFor(mission, selectedDayConflicts)
                return (
                  <div
                    key={mission.id}
                    draggable
                    onDragStart={() => setDraggedMissionId(mission.id)}
                    onDragEnd={() => setDraggedMissionId(null)}
                    className="kairo-raised overflow-hidden rounded-xl transition-shadow hover:shadow-sm"
                    style={{ display: 'grid', gridTemplateColumns: '4px 1fr', cursor: 'grab' }}
                  >
                    <div style={{ background: theme.text }} />
                    <div className="p-3.5">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-0.5 text-[9px] font-black text-slate-500">
                          <Clock3 size={11} />
                          {formatTimeRange(mission.startTime, mission.endTime)}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[.08em]" style={{ background: theme.bg, color: theme.text }}>{mission.subject}</span>
                        <span className="rounded-full bg-slate-50 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[.1em] text-slate-400">{missionKindLabel(mission.kind, mission.missionType)}</span>
                        {conflict && <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[9px] font-black text-orange-700">Conflicto</span>}
                        <div className="ml-auto flex items-center gap-1">
                          <button type="button" onClick={() => updateMission(mission.id, { role: 'bonus' })} aria-label="Mover a bonus" className="flex h-6 w-6 items-center justify-center rounded-md border border-[#f1f5f9] bg-transparent text-slate-300 transition hover:bg-slate-50 hover:text-slate-500"><Bookmark size={12} /></button>
                          <button type="button" onClick={() => deleteMission(mission.id)} aria-label="Eliminar" className="flex h-6 w-6 items-center justify-center rounded-md border border-[#f1f5f9] bg-transparent text-red-200 transition hover:bg-red-50 hover:text-red-500"><Trash2 size={12} /></button>
                        </div>
                      </div>
                      <p className="text-[14px] font-black leading-snug text-slate-900">{mission.title}</p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <span className="text-[10px] font-semibold text-slate-400">{mission.estimatedMinutes} min</span>
                        <span className="text-[10px] font-black text-blue-600">+{mission.baseXP} XP</span>
                      </div>
                      {conflict && <p className="mt-1.5 text-[10px] font-bold text-orange-700">Coincide con {formatTimeRange(conflict.busyStart, conflict.busyEnd)} ocupado.</p>}
                      <select
                        value=""
                        onChange={e => { if (e.target.value) moveMission(mission.id, e.target.value) }}
                        className="inputish mt-2.5"
                      >
                        <option value="" disabled>Mover a otro día...</option>
                        {orderedDraft.filter(d => d.date !== selectedDay?.date).map(d => (
                          <option key={d.date} value={d.date}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}

              {(selectedDay?.missions.filter(m => m.role === 'main').length ?? 0) === 0 && (
                <div className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-[#e2e8f0] bg-[#fafbfc] px-5 py-4 text-left">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[15px] font-black text-slate-400">+</span>
                  <span className="text-[12px] font-bold text-slate-400">Sin misiones este día.</span>
                </div>
              )}
            </div>

            {/* Bonus */}
            <div className="mt-7 border-t border-[#f1f5f9] pt-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[8px] font-black uppercase tracking-[.22em] text-slate-300">Misiones extra · Bonus</p>
                <span className="rounded-full border border-[#e2e8f0] px-2.5 py-0.5 text-[9px] font-black text-slate-400">{bonusMissions.length} bonus</span>
              </div>
              {bonusMissions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {bonusMissions.map(({ mission, day: bonusDay }) => {
                    const theme = themeFor(mission.subject)
                    const conflict = missionConflictFor(mission, conflicts.filter(item => item.date === bonusDay.date))
                    return (
                      <div key={mission.id} draggable onDragStart={() => setDraggedMissionId(mission.id)} onDragEnd={() => setDraggedMissionId(null)} className="flex items-center gap-3 rounded-xl border border-[#f1f5f9] bg-[#fafbfc] px-4 py-2.5" style={{ cursor: 'grab' }}>
                        <GripVertical size={12} className="shrink-0 text-slate-300" />
                        <span className="shrink-0 text-[10px] font-black text-slate-400">{formatTimeRange(mission.startTime, mission.endTime)}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: theme.bg, color: theme.text }}>{mission.subject.split(' ')[0]}</span>
                        {conflict && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-black text-orange-700">Conflicto</span>}
                        <p className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate-700">{mission.title}</p>
                        <span className="shrink-0 text-[10px] font-semibold text-slate-400">{bonusDay.label.split(',')[0]}</span>
                        <button type="button" onClick={() => updateMission(mission.id, { role: 'main' })} aria-label="Hacer principal" className="shrink-0 rounded-md p-1.5 text-slate-300 transition hover:bg-white hover:text-[#0f172a]"><Bookmark size={13} /></button>
                        <button type="button" onClick={() => deleteMission(mission.id)} aria-label="Eliminar" className="shrink-0 rounded-md p-1.5 text-red-200 transition hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[11px] font-semibold text-[#cbd5e1]">No hay bonus opcionales esta semana.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t-2 border-[#0f172a] bg-white px-6 py-4">
          <p className="text-[11px] font-bold text-slate-400">{mainMissionCount} misiones principales · {bonusMissions.length} bonus opcionales</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-[#e2e8f0] bg-white px-5 py-2.5 text-[12px] font-black text-slate-500 transition hover:bg-slate-50">Cancelar</button>
            <button type="button" onClick={handleSave} disabled={saveState === 'saving'} className="rounded-lg bg-[#0f172a] px-5 py-2.5 text-[12px] font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
              {saveState === 'saving' ? 'Guardando...' : saveState === 'saved' ? '✓ Guardado' : saveState === 'error' ? 'Reintentar' : 'Guardar cambios'}
            </button>
          </div>
        </footer>

        <style>{`.inputish{width:100%;border-radius:8px;border:1px solid #f1f5f9;background:#fafbfc;padding:8px 12px;font-size:12px;font-weight:700;color:#334155;outline:none}.inputish:focus{border-color:#bfdbfe;background:white}`}</style>
      </motion.section>
    </motion.div>
  )
}

function formatBlockLabel(blockKey?: string): string {
  if (!blockKey) return ''
  return blockKey.replace(/^bloque-\d+-/, '').replace(/-/g, ' ')
}

function heroReason(mission: Mission, blockCompleted: number, nextMissionTitle?: string | null): string {
  if (mission.missionType === 'comment_text') {
    return 'Práctica de técnica PAU. Aparece periódicamente para que domines el comentario de texto antes del examen.'
  }
  if (mission.metadata?.plan_mode === 'rescue') {
    return 'Modo Rescate: priorizamos este tema por su peso específico en la PAU.'
  }
  if (mission.metadata?.express) {
    return 'Repaso rápido antes de entrar en materia nueva.'
  }
  const blockName = formatBlockLabel(mission.blockKey) || 'este bloque'
  if (nextMissionTitle) {
    return `Hoy refuerzas una idea clave de ${blockName}. Cuando lo entiendas, "${nextMissionTitle}" te resultará mucho más fácil.`
  }
  if (blockCompleted === 0) {
    return `Empezamos por ${blockName}. Completar esta misión desbloquea las siguientes.`
  }
  return `Sigues avanzando en ${blockName}. Llevas ${blockCompleted} misión${blockCompleted !== 1 ? 'es' : ''} completada${blockCompleted !== 1 ? 's' : ''} en este bloque.`
}

function HeroMissionCard({ mission, blockCompleted, streak, completedThisWeek, totalThisWeek, weeklyXP, onPostpone, onMarkNotSeen, hasOnboardingSubjects, nextMissionTitle, microMission }: {
  mission: Mission | null
  blockCompleted: number
  streak: number
  completedThisWeek: number
  totalThisWeek: number
  weeklyXP: number
  onPostpone: () => void
  onMarkNotSeen: () => void
  hasOnboardingSubjects: boolean
  nextMissionTitle?: string | null
  microMission?: { subject: string; subjectSlug: string; topic: string; href: string; hasCompletedItems: boolean } | null
}) {
  const [showNotSeenConfirm, setShowNotSeenConfirm] = useState(false)
  const [microDone, setMicroDone] = useState(false)
  const theme = mission ? themeFor(mission.subject) : { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' }
  const subjectUpper = (mission?.subject ?? '').toUpperCase()
  const blockLabel = formatBlockLabel(mission?.blockKey).toUpperCase()
  const headerParts = ['CAMINO PAU', subjectUpper, blockLabel].filter(Boolean)
  const target = mission ? hrefForMission(mission) : null
  const reason = mission ? heroReason(mission, blockCompleted, nextMissionTitle) : null

  return (
    <div className="kairo-soft-panel h-full overflow-hidden">
      {/* Blue header band — primary action context */}
      <div className="bg-blue-600 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {mission ? (
            <>
              <span className="rounded-full bg-white/25 px-3 py-1 text-[11px] font-black text-white">{mission.subject}</span>
              {blockLabel && <span className="text-[11px] font-semibold text-blue-200">{blockLabel}</span>}
              {!!mission.metadata?.express && <span className="rounded-full bg-amber-400/30 px-2.5 py-0.5 text-[11px] font-black text-amber-100">⚡ Repaso Express</span>}
            </>
          ) : microMission ? (
            <span className="rounded-full bg-white/25 px-3 py-1 text-[11px] font-black text-white">{microMission.subject}</span>
          ) : (
            <span className="text-[11px] font-black text-blue-200">Camino PAU</span>
          )}
        </div>
        <p className="mt-1.5 text-xs font-semibold text-blue-200">
          {mission ? 'Misión principal' : microMission ? 'Reto exprés' : 'Tu misión del día'}
        </p>
      </div>

      {/* Card body */}
      <div className="p-6">
        {mission ? (
          <>
            <h2 className="text-2xl font-black leading-tight text-slate-950">{mission.title}</h2>
            <p className="mt-1.5 text-sm font-semibold text-slate-400">{mission.estimatedMinutes} min</p>

            {reason && (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-600">{reason}</p>
              </div>
            )}

            <div className="mt-5">
              {mission.status === 'done' ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-3.5 text-sm font-black text-emerald-700"><Check size={15} /> Misión completada hoy</div>
              ) : target?.href ? (
                <a href={target.href} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-black text-white shadow-[0_6px_20px_rgba(37,99,235,0.28)] transition hover:bg-blue-700 active:scale-[0.98]">Empezar misión <ArrowRight size={15} /></a>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-3.5 text-sm font-black text-slate-400">Contenido en preparación</div>
              )}
            </div>

            {mission.status !== 'done' && (
              <div className="mt-3 flex justify-center gap-3">
                <button onClick={onPostpone} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 transition hover:bg-slate-50 active:scale-[0.97]"><RotateCcw size={12} /> Posponer</button>
                {canMarkNotSeen(mission) && (
                  <button onClick={() => setShowNotSeenConfirm(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 transition hover:bg-slate-50 active:scale-[0.97]">Aún no lo he dado</button>
                )}
              </div>
            )}
          </>
        ) : hasOnboardingSubjects && microMission ? (
          <div>
            {microDone ? (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <Check size={16} className="text-emerald-600" />
                <p className="text-sm font-black text-emerald-800">¡Reto completado! Vuelve mañana para tu próxima misión.</p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-black text-slate-950">Reto exprés de hoy</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">{microMission.topic} · repaso rápido</p>
                {microMission.hasCompletedItems && (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-600">Repaso de contenido que ya has visto. Sin afectar tu plan de mañana.</p>
                  </div>
                )}
                <div className="mt-5">
                  <a href={microMission.href} onClick={() => setMicroDone(true)} className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-black text-white shadow-[0_6px_20px_rgba(37,99,235,0.28)] transition hover:bg-blue-700 active:scale-[0.98]">
                    Empezar reto <ArrowRight size={15} />
                  </a>
                </div>
              </>
            )}
          </div>
        ) : (
          <div>
            {hasOnboardingSubjects ? (
              <>
                <h2 className="text-xl font-black text-slate-950">Explora tu primer tema</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">Tu plan aún está generándose. Mientras tanto, empieza a explorar.</p>
                <div className="mt-5">
                  <a href="#explorar" className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-black text-white shadow-[0_6px_20px_rgba(37,99,235,0.28)] transition hover:bg-blue-700 active:scale-[0.98]">
                    Ver temas disponibles <ArrowRight size={15} />
                  </a>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-black text-slate-400">Completa tu onboarding para empezar</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">Configura tu perfil y construiremos tu Camino PAU.</p>
              </>
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
          <div className="text-center">
            <p className="text-lg font-black text-slate-900">{streak > 0 ? `🔥 ${streak}` : '—'}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{streak > 0 ? 'días de racha' : 'Empieza hoy'}</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-black text-slate-900">{completedThisWeek}<span className="text-sm font-semibold text-slate-400">/{totalThisWeek}</span></p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">misiones esta semana</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-black text-slate-900">{weeklyXP > 0 ? `+${weeklyXP}` : '—'}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{weeklyXP > 0 ? 'XP esta semana' : 'Gana XP al completar'}</p>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showNotSeenConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="kairo-subtle-backdrop fixed inset-0 z-50 grid place-items-center p-4">
            <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }} className="kairo-modal-card w-full max-w-sm p-6">
              <h3 className="text-lg font-black text-slate-950">¿Aún no lo has dado en clase?</h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">Lo guardamos para más adelante. Hoy te daremos una alternativa para que no pierdas el ritmo.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowNotSeenConfirm(false)} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-500">Cancelar</button>
                <button onClick={() => { setShowNotSeenConfirm(false); onMarkNotSeen() }} className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white">Confirmar</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function shortSubjectLabel(subject: string): string {
  const s = subject.toLowerCase()
  if (s.includes('matemát')) return 'Mates'
  if (s.includes('historia')) return 'Historia'
  if (s.includes('inglés') || s.includes('ingles')) return 'Inglés'
  if (s.includes('física') || s.includes('fisica')) return 'Física'
  if (s.includes('química') || s.includes('quimica')) return 'Química'
  if (s.includes('biolog')) return 'Bio'
  return subject.split(' ')[0]
}

function compactDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }).replace('.', '')
}

const PARTIAL_SIM_SUBJECT: Record<string, string> = {
  matematicas_ii: 'mates', matematicas_ccss: 'matematicas_ccss', historia_espana: 'historia',
  fisica: 'fisica', quimica: 'quimica', biologia: 'biologia', ingles: 'ingles', lengua: 'lengua',
}
const PARTIAL_BLOCK_DISPLAY: Record<string, string> = {
  Algebra: 'Álgebra', Analisis: 'Análisis', Geometria: 'Geometría', Probabilidad: 'Probabilidad',
}

function PartialExamBanner({ exam, today, completedToday = false, missionId }: { exam: StudentExam; today: string; completedToday?: boolean; missionId?: string }) {
  const daysDiff = Math.round(
    (new Date(exam.date + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86400000
  )
  const subjectSlug = SUBJECT_SLUGS[exam.subject] ?? exam.subject
  const simSubject = PARTIAL_SIM_SUBJECT[subjectSlug] ?? subjectSlug
  const blockDisplay = exam.block ? (PARTIAL_BLOCK_DISPLAY[exam.block] ?? exam.block) : ''
  // missionId (si esta práctica corresponde a la misión de "Prep. parcial"
  // ya programada hoy en el calendario) se reenvía para que, al entregarla,
  // /api/simulacro pueda marcar esa misma misión como completada — igual
  // que si se hubiera empezado desde la tarjeta del calendario en vez de
  // desde este banner.
  const missionParam = missionId ? `&missionId=${encodeURIComponent(missionId)}` : ''
  // examId: deja que /api/practica-parcial reutilice la práctica de hoy
  // para este Parcial (aunque este banner no comparta missionId con la
  // tarjeta de calendario) y filtre por sus exam_topics si es Historia.
  const examParam = `&examId=${encodeURIComponent(exam.id)}`
  const href = exam.block
    ? `/simulacros/practica/nueva?subject=${simSubject}&block=${encodeURIComponent(exam.block)}&source=camino_partial${missionParam}${examParam}`
    : `/simulacros/practica/nueva?subject=${simSubject}&source=camino_partial${missionParam}${examParam}`
  // Simulacro completo (90 min, generateSimulacro) para este mismo examen —
  // antes no existía ningún enlace real con exam_id hacia /simulacros; este
  // es ese punto de entrada. examScope decide si se filtra solo por los
  // temas elegidos con chips ('parcial') o por todo lo completado hasta la
  // fecha en Camino PAU ('global') — ver resolveExamHistoriaTopics.
  const simulacroHref = `/simulacros?subject=${simSubject}&examId=${encodeURIComponent(exam.id)}&examScope=${exam.examScope ?? 'parcial'}&source=camino_partial_simulacro`
  // Distinción visual de alcance: azul (#2563eb, ya el acento por defecto de
  // Camino) para 'parcial', morado (#7c3aed, el mismo tono que ya usa el
  // resto de la app para XP/bonus) para 'global' — se recalcula en cada
  // render a partir de exam.examScope, así que cambiarlo al editar el
  // examen se refleja al instante sin ningún estado aparte.
  const isGlobalScope = exam.examScope === 'global'
  const scopeColor = isGlobalScope ? '#7c3aed' : '#2563eb'
  const scopeBadge = (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.06em', color: scopeColor, background: isGlobalScope ? '#f5f3ff' : '#eff6ff', border: `1px solid ${scopeColor}33` }}>
      {isGlobalScope ? 'Global' : 'Parcial'}
    </span>
  )

  if (daysDiff === 0) {
    return (
      <div style={{ borderRadius: 14, border: '1px solid #e2e8f0', borderLeft: '3px solid #0f172a', background: '#0f172a', padding: '16px 20px' }}>
        <p style={{ fontSize: 15, fontWeight: 900, color: 'white', margin: 0 }}>¡Hoy es tu parcial de {exam.subject}!</p>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0', fontWeight: 600 }}>Ya has preparado todo lo necesario. ¡Mucho ánimo!</p>
      </div>
    )
  }

  // La práctica de hoy para este parcial ya está entregada — insistir con
  // "Empezar práctica" llevaba a crear una sesión nueva y descubrir al
  // corregirla que ya se había entregado (ver hrefForMission/DayCard).
  if (completedToday) {
    return (
      <div style={{ borderRadius: 14, border: '1px solid #bbf7d0', borderLeft: '3px solid #059669', background: '#ecfdf5', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#059669', margin: 0 }}>Próximo parcial</p>
          {scopeBadge}
        </div>
        <p style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', margin: '6px 0 4px', lineHeight: 1.3 }}>
          {daysDiff === 1 ? 'Mañana' : `En ${daysDiff} días`}
          {exam.subject ? ` · ${exam.subject}` : ''}
          {blockDisplay ? ` · ${blockDisplay}` : ''}
        </p>
        <p style={{ fontSize: 12, color: '#059669', margin: '0 0 12px', fontWeight: 700 }}>✓ Ya has practicado hoy para este parcial.</p>
        <a
          href={simulacroHref}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1.5px solid #059669', background: 'white', color: '#059669', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
        >
          Simulacro completo <ArrowRight size={13} />
        </a>
      </div>
    )
  }

  return (
    <div style={{ borderRadius: 14, border: '1px solid #e2e8f0', borderLeft: `3px solid ${scopeColor}`, background: 'white', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: scopeColor, margin: 0 }}>Próximo parcial</p>
        {scopeBadge}
      </div>
      <p style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', margin: '6px 0 4px', lineHeight: 1.3 }}>
        {daysDiff === 1 ? 'Mañana' : `En ${daysDiff} días`}
        {exam.subject ? ` · ${exam.subject}` : ''}
        {blockDisplay ? ` · ${blockDisplay}` : ''}
      </p>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px', fontWeight: 600 }}>Kairo ha ajustado esta semana para que llegues preparado.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <a
          href={href}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, background: '#2563eb', color: 'white', fontSize: 12, fontWeight: 800, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,.22)' }}
        >
          Empezar práctica <ArrowRight size={13} />
        </a>
        <a
          href={simulacroHref}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: '1.5px solid #2563eb', background: 'white', color: '#2563eb', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
        >
          Simulacro completo <ArrowRight size={13} />
        </a>
      </div>
    </div>
  )
}

// Personalization for "Repaso libre" days (the empty days the week widget
// above already labels that way). Reuses perfiles.custom_instructions —
// the exact same field Ajustes → Personalización IA and Parciales
// (plan-intensity) already read — instead of a parallel notes store, so
// writing here, in Ajustes, or in the monthly calendar's notes field all
// edit the same thing. "Sugiéreme qué repasar" calls a small AI endpoint
// (mirroring plan-intensity's pattern) that actually reads those
// instructions to pick a subject and a focus note, with a deterministic
// fallback if the AI call fails.
function FreeReviewPanel({ subjects }: { subjects: string[] }) {
  const [notes, setNotes] = useState('')
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [options, setOptions] = useState<FreeReviewOption[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loadingSuggestion, setLoadingSuggestion] = useState(false)
  const [addingKey, setAddingKey] = useState('')
  const [addedKeys, setAddedKeys] = useState<string[]>([])
  const [addErrorKey, setAddErrorKey] = useState('')
  const [addInfoByKey, setAddInfoByKey] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token
      if (!token) return
      try {
        const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok || cancelled) return
        const json = await res.json() as { custom_instructions?: string }
        if (!cancelled) setNotes(json.custom_instructions ?? '')
      } finally {
        if (!cancelled) setNotesLoaded(true)
      }
    })
    return () => { cancelled = true }
  }, [])

  // Recupera la sugerencia de hoy si el alumno ya la pidió antes y volvió a
  // esta pantalla (p. ej. tras navegar a Exámenes y volver) — sin esto, un
  // simple remount de FreeReviewPanel la perdía aunque siguiera siendo el
  // mismo día.
  useEffect(() => {
    const saved = loadJson<FreeReviewSuggestion | null>(FREE_REVIEW_SUGGESTION_KEY, null)
    if (saved && saved.date === todayMadrid() && saved.options.length > 0) {
      setOptions(saved.options)
      setSelectedIndex(Math.min(saved.selectedIndex, saved.options.length - 1))
      setAddedKeys(saved.addedKeys ?? [])
    }
  }, [])

  function suggestionKey(opt: FreeReviewOption) {
    return `${todayMadrid()}:${subjectSlug(opt.subject)}:${textSlug(opt.focusNote || opt.subject)}`
  }

  function saveSuggestion(nextOptions: FreeReviewOption[], nextSelectedIndex: number, nextAddedKeys = addedKeys) {
    saveJson(FREE_REVIEW_SUGGESTION_KEY, {
      date: todayMadrid(),
      options: nextOptions,
      selectedIndex: nextSelectedIndex,
      addedKeys: nextAddedKeys,
    } satisfies FreeReviewSuggestion)
  }

  async function suggest() {
    if (subjects.length === 0 || loadingSuggestion) return
    setLoadingSuggestion(true)
    setError('')
    setOptions([])
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) { setError('Inicia sesión para pedir una sugerencia.'); return }
      // Save the notes first so this suggestion — and everywhere else that
      // reads custom_instructions — sees the latest text, not stale state.
      setSaving(true)
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ custom_instructions: notes }),
      }).catch(() => undefined)
      setSaving(false)
      const res = await fetch('/api/camino/free-review-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subjects }),
      })
      if (!res.ok) { setError('No se ha podido generar una sugerencia. Inténtalo de nuevo.'); return }
      const json = await res.json() as { options?: FreeReviewOption[] }
      if (json.options && json.options.length > 0) {
        setOptions(json.options)
        setSelectedIndex(0)
        setAddedKeys([])
        setAddErrorKey('')
        saveSuggestion(json.options, 0, [])
      } else setError('No se ha podido generar una sugerencia. Inténtalo de nuevo.')
    } catch {
      setError('No se ha podido generar una sugerencia. Revisa la conexión.')
    } finally {
      setLoadingSuggestion(false)
    }
  }

  function selectOption(index: number) {
    setSelectedIndex(index)
    saveSuggestion(options, index)
  }

  async function addSuggestedMission() {
    const suggestion = options[selectedIndex]
    if (!suggestion) return
    const key = suggestionKey(suggestion)
    if (addingKey || addedKeys.includes(key)) return
    setAddingKey(key)
    setAddErrorKey('')
    setAddInfoByKey(current => ({ ...current, [key]: '' }))
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) { setAddErrorKey(key); return }
      const res = await fetch('/api/camino/free-review-suggestion/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject: suggestion.subject, focusNote: suggestion.focusNote, date: todayMadrid() }),
      })
      if (!res.ok) { setAddErrorKey(key); return }
      const json = await res.json() as { calendarSync?: string }
      const nextAddedKeys = Array.from(new Set([...addedKeys, key]))
      setAddedKeys(nextAddedKeys)
      if (json.calendarSync === 'pending_no_time') {
        setAddInfoByKey(current => ({ ...current, [key]: 'Añadida en Kairo; se sincronizará cuando tenga hora.' }))
      }
      saveSuggestion(options, selectedIndex, nextAddedKeys)
    } catch {
      setAddErrorKey(key)
    } finally {
      setAddingKey('')
    }
  }

  if (subjects.length === 0) return null

  const suggestion = options[selectedIndex] ?? null
  const caminoSlug = suggestion ? subjectSlug(suggestion.subject) : null
  const examSlug = suggestion ? (CAMINO_TO_SIM_SUBJECT[subjectSlug(suggestion.subject)] ?? subjectSlug(suggestion.subject)) : null
  const examSearchTerm = suggestion
    ? (suggestion.focusNote || suggestion.subject).replace(/^repasa\s+/i, '').slice(0, 140)
    : ''
  const selectedSuggestionKey = suggestion ? suggestionKey(suggestion) : ''
  const selectedAdded = !!selectedSuggestionKey && addedKeys.includes(selectedSuggestionKey)
  const selectedAdding = !!selectedSuggestionKey && addingKey === selectedSuggestionKey
  const selectedAddError = !!selectedSuggestionKey && addErrorKey === selectedSuggestionKey
  const selectedAddInfo = selectedSuggestionKey ? addInfoByKey[selectedSuggestionKey] : ''

  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[.12em] text-slate-400">Personaliza tu repaso libre</p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value.slice(0, 600))}
        placeholder={notesLoaded ? 'Ej: "en mis días libres quiero repasar más Historia", "prefiero ejercicios cortos"...' : 'Cargando…'}
        disabled={!notesLoaded}
        rows={2}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-blue-200 disabled:opacity-60"
        style={{ resize: 'vertical' }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-semibold text-slate-400">Mismo campo que Ajustes → Personalización IA.</p>
        <button
          onClick={suggest}
          disabled={loadingSuggestion || saving || !notesLoaded}
          className="shrink-0 rounded-lg bg-[#0f172a] px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-40"
        >
          {loadingSuggestion || saving ? 'Pensando…' : 'Sugiéreme qué repasar'}
        </button>
      </div>
      {error && <p className="mt-2 text-[10px] font-bold text-red-500">{error}</p>}
      {options.length > 0 && (
        <div className="mt-2">
          <p className="mb-1.5 text-[9px] font-black uppercase tracking-[.1em]" style={{ color: CONTENT_TYPE_COLORS.suggestion.text }}>💡 3 opciones — elige una</p>
          <div className="grid gap-1.5">
            {options.map((opt, i) => {
              const active = i === selectedIndex
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectOption(i)}
                  className="rounded-xl px-3 py-2 text-left transition"
                  style={{
                    background: active ? CONTENT_TYPE_COLORS.suggestion.bg : 'white',
                    border: `1px solid ${active ? CONTENT_TYPE_COLORS.suggestion.border : '#e2e8f0'}`,
                  }}
                >
                  <p className="text-[11px] font-black" style={{ color: active ? CONTENT_TYPE_COLORS.suggestion.text : '#334155' }}>{opt.subject}</p>
                  {opt.focusNote && <p className="mt-0.5 text-[10px] font-semibold" style={{ color: active ? CONTENT_TYPE_COLORS.suggestion.text : '#94a3b8', opacity: active ? 0.85 : 1 }}>{opt.focusNote}</p>}
                </button>
              )
            })}
          </div>
          {suggestion && (
            <div className="mt-2">
              <p className="mb-1.5 text-[9px] font-black uppercase tracking-[.1em] text-slate-400">
                ¿Cómo repasas &quot;{suggestion.subject}&quot;?
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={addSuggestedMission}
                  disabled={selectedAdding || selectedAdded}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black disabled:cursor-default disabled:opacity-80"
                  style={{ background: selectedAdded ? '#ecfdf5' : CONTENT_TYPE_COLORS.suggestion.text, color: selectedAdded ? '#047857' : 'white', border: selectedAdded ? '1px solid #bbf7d0' : 'none' }}
                >
                  {selectedAdding ? <Loader2 size={12} className="animate-spin" /> : selectedAdded ? <Check size={12} /> : <Plus size={12} />}
                  {selectedAdding ? 'Añadiendo...' : selectedAdded ? 'Añadida' : selectedAddError ? 'No se ha podido añadir. Reintentar' : 'Añadir misión sugerida'}
                </button>
                {examSlug && (
                  <a
                    href={`/examenes?subject=${encodeURIComponent(examSlug)}&search=${encodeURIComponent(examSearchTerm)}&source=camino_free_review`}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black"
                    style={{ background: CONTENT_TYPE_COLORS.suggestion.text, color: 'white' }}
                  >
                    📝 Ejercicios de Exámenes
                  </a>
                )}
                {caminoSlug && (
                  <a
                    href={`/zona/cursos?subject=${encodeURIComponent(caminoSlug)}&source=camino_free_review`}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black"
                    style={{ background: 'white', color: CONTENT_TYPE_COLORS.suggestion.text, border: `1px solid ${CONTENT_TYPE_COLORS.suggestion.border}` }}
                  >
                    📘 Hacer el curso
                  </a>
                )}
              </div>
              {selectedAddInfo && <p className="mt-1.5 text-[9px] font-bold text-slate-500">{selectedAddInfo}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimeRange(start?: string | null, end?: string | null) {
  return start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : 'Sin hora'
}

function timeToMinutes(value?: string | null) {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return null
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return Math.max(0, Math.min(24 * 60, hours * 60 + minutes))
}

function minutesToHHMM(totalMinutes: number) {
  const minutes = Math.max(0, Math.min(24 * 60 - 1, totalMinutes))
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function snapMinutes(totalMinutes: number, step = 15) {
  return Math.max(0, Math.min(24 * 60 - step, Math.round(totalMinutes / step) * step))
}

function localTimeConflict(a: { start: string; end: string }, b: { start: string; end: string }) {
  const aStart = timeToMinutes(a.start)
  const aEnd = timeToMinutes(a.end)
  const bStart = timeToMinutes(b.start)
  const bEnd = timeToMinutes(b.end)
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd)
}

function nextFreeStart(startTime: string, durationMinutes: number, busy: { start: string; end: string }[]) {
  const start = timeToMinutes(startTime)
  if (start === null) return null
  for (let cursor = snapMinutes(start); cursor + durationMinutes <= 24 * 60; cursor += 15) {
    const candidateStart = minutesToHHMM(cursor)
    const candidateEnd = addMinutesToHHMM(candidateStart, durationMinutes)
    if (candidateEnd && !busy.some(slot => localTimeConflict({ start: candidateStart, end: candidateEnd }, slot))) return candidateStart
  }
  return null
}

function missionConflictFor(mission: Mission, conflicts: CalendarConflict[]) {
  const rowId = mission.calendarRowId ?? mission.id
  return conflicts.find(conflict => conflict.missionId === rowId)
}

type TimelineKairoBlock = {
  id: string
  kind: 'mission'
  mission: Mission
  date: string
  start: number
  end: number
  hasConflict: boolean
}

type TimelineBusyBlock = {
  id: string
  kind: 'busy'
  date: string
  start: number
  end: number
}

type TimelineBlock = TimelineKairoBlock | TimelineBusyBlock
type PositionedTimelineBlock = TimelineBlock & { lane: number; laneCount: number }

const TIMELINE_PX_PER_MINUTE = 1.2
const TIMELINE_MIN_BLOCK_HEIGHT = 28

function buildTimelineRange(days: DayPlan[], externalBusyByDate: ExternalBusyByDate) {
  const times: number[] = []
  for (const day of days) {
    for (const mission of day.missions) {
      const start = timeToMinutes(mission.startTime)
      const end = timeToMinutes(mission.endTime)
      if (start !== null && end !== null && end > start) times.push(start, end)
    }
    for (const slot of externalBusyByDate[day.date] ?? []) {
      const start = timeToMinutes(slot.start)
      const end = timeToMinutes(slot.end)
      if (start !== null && end !== null && end > start) times.push(start, end)
    }
  }
  if (!times.length) return { start: 8 * 60, end: 22 * 60 }
  const start = Math.max(7 * 60, Math.floor((Math.min(...times) - 45) / 60) * 60)
  const end = Math.min(23 * 60, Math.ceil((Math.max(...times) + 45) / 60) * 60)
  return end - start < 180 ? { start: Math.max(0, start - 60), end: Math.min(24 * 60, start + 240) } : { start, end }
}

function buildTimelineBlocks(days: DayPlan[], externalBusyByDate: ExternalBusyByDate, conflicts: CalendarConflict[]) {
  const blocksByDate = new Map<string, TimelineBlock[]>()
  for (const day of days) {
    const blocks: TimelineBlock[] = []
    for (const mission of day.missions) {
      const start = timeToMinutes(mission.startTime)
      const end = timeToMinutes(mission.endTime)
      if (start === null || end === null || end <= start) continue
      blocks.push({ id: `mission-${mission.id}`, kind: 'mission', mission, date: day.date, start, end, hasConflict: Boolean(missionConflictFor(mission, conflicts)) })
    }
    for (const [index, slot] of (externalBusyByDate[day.date] ?? []).entries()) {
      const start = timeToMinutes(slot.start)
      const end = timeToMinutes(slot.end)
      if (start === null || end === null || end <= start) continue
      blocks.push({ id: `busy-${day.date}-${slot.start}-${slot.end}-${index}`, kind: 'busy', date: day.date, start, end })
    }
    blocksByDate.set(day.date, blocks.sort((a, b) => a.start - b.start || b.end - a.end))
  }
  return blocksByDate
}

function positionTimelineBlocks(blocks: TimelineBlock[]): PositionedTimelineBlock[] {
  const laneEnds: number[] = []
  const positioned = blocks.map(block => {
    const lane = laneEnds.findIndex(end => end <= block.start)
    const nextLane = lane >= 0 ? lane : laneEnds.length
    laneEnds[nextLane] = block.end
    return { ...block, lane: nextLane, laneCount: 1 }
  })
  const laneCount = Math.max(1, laneEnds.length)
  return positioned.map(block => ({ ...block, laneCount }))
}

function CalendarWeekTimeline({ days, exams, externalBusyByDate, conflicts, selectedDayDate, onSelectDay, onEmptySlotClick, onDeleteMission, onToggleRole }: { days: DayPlan[]; exams: StudentExam[]; externalBusyByDate: ExternalBusyByDate; conflicts: CalendarConflict[]; selectedDayDate: string | null; onSelectDay: (date: string) => void; onEmptySlotClick: (date: string, startTime: string) => void; onDeleteMission: (missionId: string) => void; onToggleRole: (missionId: string, role: MissionRole) => void }) {
  const range = buildTimelineRange(days, externalBusyByDate)
  const height = Math.max(360, (range.end - range.start) * TIMELINE_PX_PER_MINUTE)
  const hours = Array.from({ length: Math.floor((range.end - range.start) / 60) + 1 }, (_, index) => range.start + index * 60)
  const blocksByDate = buildTimelineBlocks(days, externalBusyByDate, conflicts)
  const unprogrammed = days.map(day => ({ day, missions: day.missions.filter(mission => timeToMinutes(mission.startTime) === null || timeToMinutes(mission.endTime) === null) })).filter(item => item.missions.length > 0)

  return (
    <section className="mb-5 rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[.22em] text-slate-400">Semana temporal</p>
          <p className="mt-1 text-xs font-bold text-slate-500">Misiones Kairo y disponibilidad externa, sin detalles privados.</p>
        </div>
        {conflicts.length > 0 && <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black text-orange-700">{conflicts.length} conflicto{conflicts.length !== 1 ? 's' : ''}</span>}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid border-b border-slate-100 bg-slate-50/80" style={{ gridTemplateColumns: '56px repeat(7, minmax(104px, 1fr))' }}>
            <div className="px-2 py-2 text-[9px] font-black uppercase tracking-[.12em] text-slate-300">Hora</div>
            {days.map(day => {
              const dayConflicts = conflicts.filter(conflict => conflict.date === day.date).length
              return (
                <button key={day.date} type="button" onClick={() => onSelectDay(day.date)} className="border-l border-slate-100 px-2 py-2 text-left transition hover:bg-blue-50" style={{ background: selectedDayDate === day.date ? '#eff6ff' : 'transparent' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[.1em] text-slate-500">{compactDayLabel(day.date)}</span>
                    {dayConflicts > 0 && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-black text-orange-700">!</span>}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, minmax(104px, 1fr))' }}>
            <div className="relative bg-slate-50/50" style={{ height }}>
              {hours.map(hour => (
                <div key={hour} className="absolute right-2 text-[10px] font-bold text-slate-400" style={{ top: Math.max(0, (hour - range.start) * TIMELINE_PX_PER_MINUTE - 7) }}>
                  {minutesToHHMM(hour)}
                </div>
              ))}
            </div>
            {days.map(day => {
              const positioned = positionTimelineBlocks(blocksByDate.get(day.date) ?? [])
              return (
                <div
                  key={day.date}
                  role="button"
                  tabIndex={0}
                  className="relative border-l border-slate-100 bg-white text-left transition hover:bg-blue-50/30"
                  style={{ height }}
                  onClick={event => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const minutes = snapMinutes(range.start + ((event.clientY - rect.top) / TIMELINE_PX_PER_MINUTE))
                    onEmptySlotClick(day.date, minutesToHHMM(minutes))
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onEmptySlotClick(day.date, minutesToHHMM(range.start))
                    }
                  }}
                >
                  {hours.map(hour => (
                    <div key={hour} className="absolute left-0 right-0 border-t border-slate-100" style={{ top: (hour - range.start) * TIMELINE_PX_PER_MINUTE }} />
                  ))}
                  {exams.filter(exam => exam.date === day.date).map((exam, index) => (
                    <div key={exam.id} className="absolute left-1 right-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-black text-amber-800" style={{ top: 4 + index * 24 }}>
                      Parcial · {exam.subject}
                    </div>
                  ))}
                  {positioned.map(block => {
                    const top = Math.max(0, (block.start - range.start) * TIMELINE_PX_PER_MINUTE)
                    const blockHeight = Math.max(TIMELINE_MIN_BLOCK_HEIGHT, (block.end - block.start) * TIMELINE_PX_PER_MINUTE)
                    const width = 100 / block.laneCount
                    const left = block.lane * width
                    if (block.kind === 'busy') {
                      return (
                        <div key={block.id} className="absolute rounded-lg border border-slate-200 bg-slate-100/70 px-2 py-1 text-[9px] font-bold text-slate-400" style={{ top, height: blockHeight, left: `calc(${left}% + 4px)`, width: `calc(${width}% - 8px)` }} onClick={event => event.stopPropagation()}>
                          <div>{formatTimeRange(minutesToHHMM(block.start), minutesToHHMM(block.end))}</div>
                          <div>Ocupado</div>
                        </div>
                      )
                    }
                    const theme = themeFor(block.mission.subject)
                    return (
                      <div key={block.id} className="absolute overflow-hidden rounded-lg border bg-white px-2 py-1 shadow-sm" style={{ top, height: blockHeight, left: `calc(${left}% + 4px)`, width: `calc(${width}% - 8px)`, borderColor: block.hasConflict ? '#fdba74' : theme.border }} onClick={event => { event.stopPropagation(); onSelectDay(day.date) }}>
                        <div className="flex items-center gap-1 text-[9px] font-black" style={{ color: block.hasConflict ? '#c2410c' : theme.text }}>
                          <span>{formatTimeRange(block.mission.startTime, block.mission.endTime)}</span>
                          {block.hasConflict && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] text-orange-700">Conflicto</span>}
                        </div>
                        <div className="truncate text-[10px] font-black" style={{ color: theme.text }}>{block.mission.subject}</div>
                        {blockHeight >= 54 && <div className="truncate text-[10px] font-bold text-slate-700">{block.mission.title}</div>}
                        {blockHeight >= 62 && (
                          <div className="mt-1 flex gap-1">
                            <button type="button" onClick={event => { event.stopPropagation(); onToggleRole(block.mission.id, block.mission.role === 'main' ? 'bonus' : 'main') }} className="rounded bg-slate-50 px-1.5 py-0.5 text-[8px] font-black text-slate-500">{block.mission.role === 'main' ? 'Bonus' : 'Principal'}</button>
                            <button type="button" onClick={event => { event.stopPropagation(); onDeleteMission(block.mission.id) }} className="rounded bg-red-50 px-1.5 py-0.5 text-[8px] font-black text-red-500">Eliminar</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {unprogrammed.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-2 text-[8px] font-black uppercase tracking-[.22em] text-slate-400">Sin programar</p>
          <div className="flex flex-wrap gap-2">
            {unprogrammed.flatMap(({ day, missions }) => missions.map(mission => (
              <button key={`${day.date}-${mission.id}`} type="button" onClick={() => { onSelectDay(day.date); onEmptySlotClick(day.date, '') }} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-bold text-slate-600">
                <span className="font-black text-slate-400">{compactDayLabel(day.date)} · Sin hora</span>
                <span className="block max-w-[220px] truncate">{mission.subject} · {mission.title}</span>
              </button>
            )))}
          </div>
        </div>
      )}
    </section>
  )
}

function CompactWeekView({ days, exams, initialExpandedDate = null, externalBusyByDate, conflicts }: { days: DayPlan[]; exams: StudentExam[]; initialExpandedDate?: string | null; externalBusyByDate: ExternalBusyByDate; conflicts: CalendarConflict[] }) {
  // Only used as the useState initializer, not a live-controlled prop: this
  // component remounts fresh every time the parent's "Ver semana completa"
  // toggle opens it (conditional render, not display:none), so seeding from
  // the day just clicked in the mini week strip above is enough to land
  // straight on that day without lifting the whole accordion state up.
  const [expandedDate, setExpandedDate] = useState<string | null>(initialExpandedDate)
  // Solo lectura: la sugerencia la genera/guarda FreeReviewPanel. Se lee una
  // vez al montar — este widget no necesita reaccionar en vivo a que el
  // alumno pida una sugerencia nueva mientras está abierto.
  const [freeReviewSuggestion] = useState<FreeReviewSuggestion | null>(() => {
    const saved = loadJson<FreeReviewSuggestion | null>(FREE_REVIEW_SUGGESTION_KEY, null)
    return saved && saved.date === todayMadrid() && saved.options.length > 0 ? saved : null
  })
  const selectedFreeReviewOption = freeReviewSuggestion?.options[freeReviewSuggestion.selectedIndex] ?? freeReviewSuggestion?.options[0] ?? null
  return (
    <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
      {days.map(day => {
        // Igual que en DayCard: el trabajo hecho por iniciativa propia
        // (metadata.free_initiative) cuenta como actividad real del día,
        // aunque se guarde como misión 'bonus' — si no, ese día se seguía
        // viendo como "Repaso libre" pese a haber trabajo real.
        const main = day.missions.filter(m => m.role === 'main' || m.metadata?.free_initiative)
        const done = main.length > 0 && main.every(m => m.status === 'done')
        const subjects = [...new Set(main.map(m => m.subject))]
        const subjectLabel = subjects.length ? subjects.map(shortSubjectLabel).join(', ') : 'Repaso libre'
        const missionCount = main.length
        const busyCount = externalBusyByDate[day.date]?.length ?? 0
        const conflictCount = conflicts.filter(conflict => conflict.date === day.date).length
        const isExpanded = expandedDate === day.date
        const isToday = day.isToday
        // La sugerencia es un añadido opcional al lado de "Repaso libre", no
        // lo sustituye — solo se muestra si el día sigue sin misiones
        // asignadas (si mientras tanto se le asignó una, ya no aplica).
        const showSuggestion = isToday && missionCount === 0 && Boolean(freeReviewSuggestion)
        return (
          <div key={day.date}>
            <button
              onClick={() => setExpandedDate(isExpanded ? null : day.date)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${isToday ? 'bg-blue-50/60' : 'bg-white'}`}
            >
              <span className={`flex w-24 shrink-0 items-center gap-1.5 text-xs font-black capitalize ${isToday ? 'text-blue-700' : 'text-slate-500'}`}>
                {compactDayLabel(day.date)}
                {isToday && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-label="Hoy" />}
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-700">{subjectLabel}</span>
              {isToday && <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">Hoy</span>}
              {main.some(m => m.missionType === 'partial_practice') && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">Prep. parcial</span>
              )}
              {busyCount > 0 && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{busyCount} ocupado{busyCount !== 1 ? 's' : ''}</span>
              )}
              {conflictCount > 0 && (
                <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">Conflicto</span>
              )}
              <span className={`shrink-0 text-xs font-bold ${done ? 'text-emerald-600' : missionCount === 0 ? 'text-slate-300' : 'text-slate-400'}`}>
                {done ? '✅ Hecho' : missionCount === 0 ? 'Repaso libre' : `${missionCount} misión${missionCount !== 1 ? 'es' : ''}`}
              </span>
              {showSuggestion && (
                <span
                  className="shrink-0 truncate rounded-full px-2 py-0.5 text-[10px] font-black"
                  style={{
                    maxWidth: 130,
                    background: CONTENT_TYPE_COLORS.suggestion.bg,
                    color: CONTENT_TYPE_COLORS.suggestion.text,
                    border: `1px solid ${CONTENT_TYPE_COLORS.suggestion.border}`,
                  }}
                  title={`Sugerencia opcional: ${selectedFreeReviewOption?.subject}${selectedFreeReviewOption?.focusNote ? ` — ${selectedFreeReviewOption.focusNote}` : ''}`}
                >
                  💡 {shortSubjectLabel(selectedFreeReviewOption?.subject ?? '')}
                </span>
              )}
              <ChevronDown size={13} className={`shrink-0 text-slate-300 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            {isExpanded && (
              <div className="border-t border-slate-100 bg-slate-50/50 p-3">
                <DayCard day={day} exams={exams.filter(e => e.date === day.date)} externalBusy={externalBusyByDate[day.date] ?? []} conflicts={conflicts.filter(conflict => conflict.date === day.date)} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WeeklyGoalCard({ completed, target }: { completed: number; target: number }) {
  const [open, setOpen] = useState(false)
  const remaining = Math.max(0, target - completed)
  return (
    <div className="kairo-soft-panel p-5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left">
        <span>
          <span className="block text-lg font-black text-slate-950">Ranking y divisiones</span>
          <span className="mt-1 block text-sm font-semibold text-slate-500">Consulta tu posición cuando quieras.</span>
        </span>
        <ChevronDown className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-5 rounded-3xl bg-slate-50 p-4">
              <p className="text-sm font-black text-slate-800">Tu objetivo semanal</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {remaining === 0 ? '¡Has completado tu objetivo de la semana! 🎉' : `Completa ${remaining} misión${remaining !== 1 ? 'es' : ''} más esta semana.`}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MissionRow({ mission, onPostpone, onComplete, compact = false }: { mission: Mission; onPostpone: (id: string) => void; onComplete?: (mission: Mission) => void; compact?: boolean }) {
  const theme = themeFor(mission.subject)
  const target = hrefForMission(mission)
  return <div className={`rounded-2xl border p-4 ${mission.status === 'done' ? 'bg-emerald-50 border-emerald-100' : 'bg-white'}`} style={{ borderColor: mission.status === 'done' ? '#bbf7d0' : theme.border }}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full px-2.5 py-1 text-[11px] font-black" style={{ background: theme.bg, color: theme.text }}>{mission.subject}</span><span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400"><Clock3 size={12} /> {mission.estimatedMinutes} min</span>{mission.block && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">{mission.block}</span>}{mission.missionType === 'review' && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700">Repaso</span>}{mission.metadata?.free_initiative ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">✎ Por tu cuenta</span> : mission.role === 'bonus' && <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700">Bonus</span>}{!!mission.metadata?.express && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">⚡ Repaso Express</span>}</div><h3 className={`${compact ? 'text-sm' : 'text-base'} font-black text-slate-900`}>{mission.title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{mission.reason}</p>{target.fallback && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">Todavía no hemos preparado este contenido.</p>}</div><div className="flex shrink-0 flex-wrap gap-2">{mission.status === 'done' ? <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><Check size={13} /> Completada</span> : target.href ? <a href={target.href} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">Ir a practicar <ArrowRight size={13} /></a> : <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-400">Sin pantalla</span>}{mission.status !== 'done' && mission.calendarRowId && onComplete && <button onClick={() => onComplete(mission)} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700"><Check size={13} /> Hecha</button>}{mission.status !== 'done' && mission.role === 'main' && <button onClick={() => onPostpone(mission.id)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500"><RotateCcw size={13} /> Posponer</button>}</div></div></div>
}

function DayCard({ day, exams, externalBusy, conflicts }: { day: DayPlan; exams: StudentExam[]; externalBusy: ExternalBusySlot[]; conflicts: CalendarConflict[] }) {
  // Las misiones 'bonus' con metadata.free_initiative (trabajo hecho por
  // iniciativa propia, ver /api/camino/complete-mission) cuentan aquí igual
  // que una misión 'main' — si no, un día donde el alumno solo trabajó por
  // su cuenta se veía como "Descanso o repaso libre" pese a haber hecho
  // algo real.
  const main = day.missions.filter(mission => mission.role === 'main' || mission.metadata?.free_initiative)
  const done = main.length > 0 && main.every(mission => mission.status === 'done')
  return (
    <article className={`min-h-[210px] rounded-3xl border p-3 ${day.isToday ? 'border-blue-300 bg-blue-50/70' : 'border-slate-100 bg-slate-50/80'}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-sm font-black capitalize ${day.isToday ? 'text-blue-800' : 'text-slate-900'}`}>{day.label}</h3>
        <div className="flex items-center gap-1.5">
          {day.isToday && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">Hoy</span>}
          {done && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">Hecho</span>}
        </div>
      </div>

      {exams.map(exam => <p key={exam.id} className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800">Parcial: {exam.subject} · {exam.block || exam.topic || priorityLabel(exam.priority)}</p>)}

      {externalBusy.length > 0 && (
        <div className="mb-2 grid gap-1.5">
          {externalBusy.map((slot, index) => (
            <div key={`${slot.start}-${slot.end}-${index}`} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100/80 px-3 py-2 text-[11px] font-black text-slate-500">
              <Clock3 size={12} />
              <span>{formatTimeRange(slot.start, slot.end)} · Ocupado</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        {main.length ? main.map(mission => {
          const target = hrefForMission(mission)
          const conflict = missionConflictFor(mission, conflicts)
          const content = (
            <>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                  <Clock3 size={11} />
                  {formatTimeRange(mission.startTime, mission.endTime)}
                </span>
                {conflict && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">Conflicto</span>}
              </div>
              <p className="text-[11px] font-black" style={{ color: themeFor(mission.subject).text }}>{mission.subject}{mission.topic ? ` · ${mission.topic}` : ''}</p>
              {mission.missionType === 'partial_practice' && <span className="mb-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">Prep. parcial</span>}
              {!!mission.metadata?.free_initiative && <span className="mb-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">✎ Por tu cuenta</span>}
              <p className={`mt-1 text-xs font-bold ${mission.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{mission.title}</p>
              {conflict && <p className="mt-1 text-[10px] font-bold text-orange-700">Coincide con {formatTimeRange(conflict.busyStart, conflict.busyEnd)} ocupado.</p>}
              <p className="mt-2 text-[11px] font-bold text-slate-400">{mission.status === 'done' ? 'Completada' : target.href ? 'Ir a practicar' : 'Todavía no hemos preparado este contenido.'}</p>
            </>
          )
          return target.href
            ? <a key={mission.id} href={target.href} className="rounded-2xl border bg-white p-3 text-left transition hover:-translate-y-0.5" style={{ borderColor: conflict ? '#fdba74' : themeFor(mission.subject).border }}>{content}</a>
            : <div key={mission.id} className="rounded-2xl border bg-white p-3 text-left" style={{ borderColor: conflict ? '#fdba74' : themeFor(mission.subject).border }}>{content}</div>
        }) : <p className="text-xs font-semibold text-slate-400">Descanso o repaso libre.</p>}
      </div>
    </article>
  )
}

type ExamDraft = { subject: string; date: string; block: string; topic: string; topicIds: string[]; examScope: ExamScope; name: string; priority: ExamPriority; confidence: ExamConfidence; content: string }

function ExamModal({ subjects, draft, setDraft, onClose, onSave, editing, curriculum, saving }: { subjects: string[]; draft: ExamDraft; setDraft: (draft: ExamDraft) => void; onClose: () => void; onSave: () => void; editing: boolean; curriculum: CurriculumItem[]; saving: boolean }) {
  const PRIORITIES: { value: ExamPriority; label: string; active: { bg: string; text: string; border: string } }[] = [
    { value: 'baja',     label: 'Baja',     active: { bg: '#f0fdf4', text: '#15803d', border: '#86efac' } },
    { value: 'normal',   label: 'Normal',   active: { bg: '#eff6ff', text: '#2563eb', border: '#93c5fd' } },
    { value: 'alta',     label: 'Alta',     active: { bg: '#fff7ed', text: '#c2410c', border: '#fdba74' } },
    { value: 'muy_alta', label: 'Muy alta', active: { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' } },
  ]
  const CONFIDENCE_OPTIONS: { value: ExamConfidence; label: string }[] = [
    { value: 'bajo', label: 'Voy mal' },
    { value: 'medio', label: 'Voy regular' },
    { value: 'alto', label: 'Voy bien' },
  ]
  const blockOptions = examBlockOptionsForSubject(draft.subject, curriculum)
  const isCustomBlock = draft.block !== '' && !blockOptions.includes(draft.block)
  // Only Historia has topicSlugs populated in its exercise data so far
  // (examenesHistoria) and a real curriculum_topics catalogue behind it —
  // Mates/Lengua/Física keep the free-text "Tema" field for now, one
  // subject at a time.
  const isHistoria = normalizeSubjectSlug(draft.subject) === 'historia_espana'
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="kairo-subtle-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
    >
      <motion.div
        initial={{ scale: 0.97, y: 14 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 14 }}
        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white"
        style={{ maxHeight: 'min(88dvh, 720px)', boxShadow: '0 2px 4px rgba(0,0,0,0.04), 0 20px 60px rgba(15,23,42,0.18), 0 4px 16px rgba(15,23,42,0.08)' }}
      >
        {/* Header */}
        <div className="shrink-0 bg-[#0f172a] px-6 py-5">
          <p className="text-[8px] font-black uppercase tracking-[.24em] text-slate-500">Camino PAU · Calendario</p>
          <h2 className="mt-1 font-black text-slate-100" style={{ fontSize: 22, letterSpacing: '-0.025em', lineHeight: 1 }}>
            {editing ? 'Editar parcial' : 'Añadir parcial'}
          </h2>
          <p className="mt-2 text-[12px] font-semibold text-slate-400">Camino ajustará tus misiones para preparar este bloque.</p>
        </div>

        {/* Body — the only part that scrolls, so the header and the
            Guardar footer below stay pinned on screen no matter how long
            the form gets or how much the mobile keyboard shrinks the
            viewport. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-3">
            <Field label="Asignatura">
              <select value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} className="em-input">
                {subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Fecha del examen">
              <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} className="em-input" />
            </Field>
            <div className={isHistoria ? '' : 'grid grid-cols-2 gap-3'}>
              <Field label="Bloque">
                {blockOptions.length > 0 ? (
                  <select
                    value={isCustomBlock ? '__custom__' : draft.block}
                    onChange={e => setDraft({ ...draft, block: e.target.value === '__custom__' ? '' : e.target.value })}
                    className="em-input"
                  >
                    <option value="" disabled>Elige un bloque…</option>
                    {blockOptions.map(b => <option key={b} value={b}>{b}</option>)}
                    <option value="__custom__">Otro (especificar)</option>
                  </select>
                ) : (
                  <input value={draft.block} onChange={e => setDraft({ ...draft, block: e.target.value })} placeholder="Álgebra, Análisis..." className="em-input" />
                )}
              </Field>
              {!isHistoria && (
                <Field label="Tema (opcional)">
                  <input value={draft.topic} onChange={e => setDraft({ ...draft, topic: e.target.value })} placeholder="Matrices, Gauss..." className="em-input" />
                </Field>
              )}
            </div>
            {isHistoria && (
              <Field label="Alcance del examen">
                <div style={{ display: 'flex', gap: 8 }}>
                  {([
                    { value: 'parcial' as ExamScope, label: 'Parcial', hint: 'Solo los temas que elijas' },
                    { value: 'global' as ExamScope, label: 'Global', hint: 'Todo lo que ya llevas visto' },
                  ]).map(opt => {
                    const active = draft.examScope === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDraft({ ...draft, examScope: opt.value })}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          borderRadius: 10,
                          border: `1.5px solid ${active ? '#2563eb' : '#e2e8f0'}`,
                          background: active ? '#eff6ff' : '#fafbfc',
                          padding: '8px 12px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 900, color: active ? '#2563eb' : '#334155' }}>{opt.label}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginTop: 1 }}>{opt.hint}</div>
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}
            {isHistoria && draft.examScope === 'parcial' && (
              <Field label={`Temas${draft.topicIds.length > 0 ? ` (${draft.topicIds.length} seleccionados)` : ''}`}>
                <HistoriaTopicChips
                  selectedIds={draft.topicIds}
                  onChange={ids => setDraft({ ...draft, topicIds: ids })}
                  blockFilter={draft.block}
                />
                {draft.topicIds.length === 0 && (
                  <p style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: '#dc2626' }}>Elige al menos un tema.</p>
                )}
              </Field>
            )}
            {isHistoria && draft.examScope === 'global' && (
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748b', lineHeight: 1.4 }}>
                El Simulacro y las prácticas de este examen cubrirán todos los temas que ya tengas completados en Camino PAU hasta ese momento — no hace falta elegir chips.
              </p>
            )}
            {blockOptions.length > 0 && isCustomBlock && (
              <Field label="Bloque (especifica)">
                <input value={draft.block} onChange={e => setDraft({ ...draft, block: e.target.value })} placeholder="Álgebra, Análisis..." className="em-input" autoFocus />
              </Field>
            )}
            <Field label="Nombre (opcional)">
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Parcial 1, Examen tema 3..." className="em-input" />
            </Field>
            <Field label="¿Qué entra exactamente? (opcional)">
              <textarea
                value={draft.content}
                onChange={e => setDraft({ ...draft, content: e.target.value.slice(0, 500) })}
                placeholder="Ej: matrices y determinantes, sistemas por Gauss, no entra Cramer..."
                className="em-input"
                rows={2}
                style={{ resize: 'vertical', fontFamily: 'inherit' }}
              />
            </Field>
            <div>
              <p className="mb-2 text-[9px] font-black uppercase tracking-[.14em] text-slate-400">Prioridad</p>
              <div className="grid grid-cols-4 gap-1.5">
                {PRIORITIES.map(p => {
                  const active = draft.priority === p.value
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setDraft({ ...draft, priority: p.value })}
                      className="rounded-lg py-2 text-center text-[10px] font-black transition-all"
                      style={{
                        background: active ? p.active.bg : '#fafbfc',
                        color: active ? p.active.text : '#94a3b8',
                        border: `1.5px solid ${active ? p.active.border : '#f1f5f9'}`,
                      }}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[9px] font-black uppercase tracking-[.14em] text-slate-400">¿Cómo vas en esta asignatura?</p>
              <div className="grid grid-cols-3 gap-1.5">
                {CONFIDENCE_OPTIONS.map(c => {
                  const active = draft.confidence === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setDraft({ ...draft, confidence: c.value })}
                      className="rounded-lg py-2 text-center text-[10px] font-black transition-all"
                      style={{
                        background: active ? '#eff6ff' : '#fafbfc',
                        color: active ? '#2563eb' : '#94a3b8',
                        border: `1.5px solid ${active ? '#93c5fd' : '#f1f5f9'}`,
                      }}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[10px] font-semibold text-slate-400">Usamos esto para calcular cuántas horas de repaso necesitas.</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t-2 border-[#0f172a] px-6 py-4">
          <p className="text-[10px] font-semibold text-slate-400">Tus misiones se adaptarán al parcial.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-[12px] font-black text-slate-500 transition hover:bg-slate-50">
              Cancelar
            </button>
            <button onClick={onSave} disabled={saving || (isHistoria && draft.examScope === 'parcial' && draft.topicIds.length === 0)} className="rounded-lg bg-[#0f172a] px-4 py-2 text-[12px] font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
              {saving ? 'Calculando plan…' : editing ? 'Guardar cambios' : 'Guardar parcial'}
            </button>
          </div>
        </div>

        <style>{`.em-input{width:100%;border-radius:8px;border:1px solid #f1f5f9;background:#fafbfc;padding:8px 12px;font-size:13px;font-weight:700;color:#334155;outline:none}.em-input:focus{border-color:#bfdbfe;background:white}`}</style>
      </motion.div>
    </motion.div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>{children}</label> }
function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-2xl bg-white p-3"><div className="mb-1 flex items-center gap-1.5 text-blue-700">{icon}<span className="text-[10px] font-black uppercase tracking-[0.12em]">{label}</span></div><p className="text-sm font-black text-slate-900">{value}</p></div> }

function LigaSection({ ligas, loading, onCreateLiga, onJoinLiga }: { ligas: LigaInfo[]; loading: boolean; onCreateLiga: (nombre: string) => Promise<{ error?: string }>; onJoinLiga: (codigo: string) => Promise<{ error?: string }> }) {
  const [mode, setMode] = useState<'idle' | 'creating' | 'joining'>('idle')
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const activeIndex = Math.min(selectedIndex, Math.max(0, ligas.length - 1))
  const activeLiga = ligas[activeIndex] ?? null
  const canAddMore = ligas.length < MAX_LIGAS_PER_USER

  async function handleCreate() {
    if (!nombre.trim()) return
    setBusy(true); setErr(null)
    const result = await onCreateLiga(nombre.trim())
    setBusy(false)
    if (result.error) { setErr(result.error); return }
    setMode('idle'); setNombre(''); setSelectedIndex(ligas.length)
  }

  async function handleJoin() {
    if (!codigo.trim()) return
    setBusy(true); setErr(null)
    const result = await onJoinLiga(codigo.trim())
    setBusy(false)
    if (result.error) { setErr(result.error); return }
    setMode('idle'); setCodigo(''); setSelectedIndex(ligas.length)
  }

  function copyLink() {
    if (!activeLiga) return
    navigator.clipboard.writeText(`${window.location.origin}/liga/${activeLiga.codigo}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <p className="text-xs font-bold text-slate-400">Cargando ligas…</p>

  if (mode === 'creating') return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Crear liga</p>
      <div className="flex gap-2">
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre de la liga" maxLength={40} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white" onKeyDown={e => e.key === 'Enter' && handleCreate()} />
        <button onClick={handleCreate} disabled={busy || !nombre.trim()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? '…' : 'Crear'}</button>
        <button onClick={() => { setMode('idle'); setErr(null) }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500">×</button>
      </div>
      {err && <p className="mt-1.5 text-[11px] font-bold text-red-500">{err}</p>}
    </div>
  )

  if (mode === 'joining') return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Unirme a una liga</p>
      <div className="flex gap-2">
        <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} placeholder="Código (ej. AB3K7M)" maxLength={10} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white" onKeyDown={e => e.key === 'Enter' && handleJoin()} />
        <button onClick={handleJoin} disabled={busy || !codigo.trim()} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? '…' : 'Entrar'}</button>
        <button onClick={() => { setMode('idle'); setErr(null) }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500">×</button>
      </div>
      {err && <p className="mt-1.5 text-[11px] font-bold text-red-500">{err}</p>}
    </div>
  )

  if (ligas.length === 0) return (
    <div>
      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Mi liga</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setMode('creating'); setErr(null) }} className="inline-flex items-center gap-1 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">
          + Crear liga
        </button>
        <button onClick={() => { setMode('joining'); setErr(null) }} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">
          Unirme a una liga
        </button>
      </div>
    </div>
  )

  const ranked = activeLiga
    ? [...activeLiga.miembros].sort((a, b) => b.total_xp - a.total_xp).map((m, i) => ({ ...m, rank: i + 1 }))
    : []

  return (
    <div>
      {ligas.length > 1 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {ligas.map((l, i) => (
            <button
              key={l.id}
              onClick={() => setSelectedIndex(i)}
              className="rounded-full px-2.5 py-1 text-[10.5px] font-black transition"
              style={{ background: i === activeIndex ? '#2563eb' : '#f1f5f9', color: i === activeIndex ? 'white' : '#64748b' }}
            >
              {l.nombre}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: '#334155' }}>{activeLiga?.nombre}</div>
        <button
          onClick={copyLink}
          style={{ fontSize: 10, fontWeight: 800, color: copied ? '#16a34a' : '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {copied ? '✓ Copiado' : 'Compartir liga'}
        </button>
      </div>
      {ranked.map(m => (
        <RankingRow key={m.user_id} rank={m.rank} name={m.name} xp={m.total_xp} isMe={m.name === 'Tú'} theme="light" />
      ))}
      {canAddMore && (
        <div className="mt-2.5 flex items-center gap-2">
          <button onClick={() => { setMode('creating'); setErr(null) }} className="text-[10.5px] font-black text-blue-700">+ Crear otra liga</button>
          <span className="text-slate-300">·</span>
          <button onClick={() => { setMode('joining'); setErr(null) }} className="text-[10.5px] font-black text-slate-500">Unirme a otra</button>
        </div>
      )}
    </div>
  )
}

const ADDABLE_SUBJECT_OPTS = [
  { id: 'Matemáticas II', color: '#2563eb', bg: '#eff6ff' },
  { id: 'Matemáticas CCSS', color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'Lengua Castellana', color: '#0891b2', bg: '#ecfeff' },
  { id: 'Historia de España', color: '#b45309', bg: '#fff7ed' },
  { id: 'Historia de la Filosofía', color: '#c026d3', bg: '#fdf4ff' },
  { id: 'Inglés', color: '#dc2626', bg: '#fef2f2' },
  { id: 'Física', color: '#0f766e', bg: '#f0fdfa' },
  { id: 'Química', color: '#65a30d', bg: '#f7fee7' },
  { id: 'Economía de la Empresa', color: '#ea580c', bg: '#fff7ed' },
]

function AddSubjectModal({ currentSubjects, onClose, onAdd, loading }: {
  currentSubjects: string[]
  onClose: () => void
  onAdd: (subject: string) => void
  loading: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const available = ADDABLE_SUBJECT_OPTS.filter(s => !currentSubjects.includes(s.id))

  if (available.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="kairo-subtle-backdrop fixed inset-0 z-50 grid place-items-center p-4">
        <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }} className="kairo-modal-card w-full max-w-md p-6">
          <h2 className="text-xl font-black text-slate-950">Todas las asignaturas añadidas</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">Ya tienes todas las asignaturas disponibles en tu Camino PAU.</p>
          <div className="mt-6 flex justify-end"><button onClick={onClose} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white">Cerrar</button></div>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="kairo-subtle-backdrop fixed inset-0 z-50 grid place-items-center p-4">
      <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }} className="kairo-modal-card w-full max-w-md p-6">
        <h2 className="text-xl font-black text-slate-950">Añadir asignatura</h2>
        <p className="mt-1 text-sm font-semibold text-slate-500">Selecciona una asignatura para añadir a tu Camino PAU. Las misiones aparecerán a partir de mañana.</p>
        <div className="mt-5 grid gap-2">
          {available.map(subj => (
            <button key={subj.id} onClick={() => setSelected(subj.id)} className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition ${selected === subj.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-200'}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black" style={{ background: subj.bg, color: subj.color }}>{subj.id.slice(0, 2)}</span>
              <span className="text-sm font-black text-slate-800">{subj.id}</span>
              {selected === subj.id && <Check size={16} className="ml-auto text-blue-600" />}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-500">Cancelar</button>
          <button onClick={() => selected && onAdd(selected)} disabled={!selected || loading} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
            {loading ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Añadiendo...</> : 'Añadir asignatura'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
