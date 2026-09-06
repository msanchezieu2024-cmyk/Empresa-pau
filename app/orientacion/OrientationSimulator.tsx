'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, ExternalLink, GraduationCap, Info, RefreshCw, RotateCcw, Target, X } from 'lucide-react'
import SidebarNav from '@/app/components/SidebarNav'
import ClayThemeScope from '@/components/clay/ClayThemeScope'
import { useClayThemePreference } from '@/components/clay/useClayThemePreference'
import { supabase } from '@/app/lib/supabase'
import { calculateAccessPathScore } from './access-paths/calculation'
import AccessPathInputs from './access-paths/AccessPathInputs'
import AccessPathSelector from './access-paths/AccessPathSelector'
import { ACCESS_PATH_IDS, createDefaultAccessScenarios, createEmptyStoredSubjectInputs, getAccessPath } from './access-paths/model'
import { ACCESS_PATH_STORAGE_KEY, CAMINO_ORIENTATION_CONTEXT_KEY, applyStoredSubjectInputs, createCaminoOrientationContext, parseAccessPathStorage, subjectInputsFromScenarios } from './access-paths/storage'
import type { AccessPathId, StoredSubjectInputs } from './access-paths/types'
import { LatestStateAutosave, type AutosaveStatus } from './autosave'
import { availableCatalogTargets, findSavedTarget, groupOrientationTargets, mergeSubjectInputs } from './catalog'
import { ORIENTATION_COMMUNITIES, ORIENTATION_COMMUNITY_STORAGE_KEY, communitySlug, normalizeOrientationCommunity, type OrientationCommunity } from './community'
import CorrectionGuide from './CorrectionGuide'
import { ORIENTATION_FIXTURES, type AdmissionSubject, type OfficialCriterion, type OrientationTarget, type SavedOrientationTarget } from './data'
import GradeControl from './GradeControl'
import { classifyOpportunity, rankOpportunities } from './opportunities'
import { loadOrientationState, persistOrientationState, persistOrientationTarget } from './persistence'
import { createOrientationState, mergeStoredSubjectInputs, orientationStateContentKey, ORIENTATION_STATE_STORAGE_KEY, parseOrientationState, reconcileOrientationStates, toAccessPathStorage, type OrientationExploration, type OrientationStateV1 } from './state'
import TargetCombobox from './TargetCombobox'
import UniversityExplorer from './UniversityExplorer'
import styles from './orientation.module.css'

// Misma imagen Higgsfield que la ficha de tema de Camino: Orientación entra en
// la misma familia visual que el resto del interior.
const ORIENTATION_HERO_IMG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3FE1qfsmGuEldtlzta7SsGkWNIV/hf_20260727_125450_f5670e8f-277d-470e-82b0-58dd6db26d4b.png'

const formatGrade = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatReference = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
type SubjectsByPath = Record<AccessPathId, AdmissionSubject[]>

function createEmptySubjectsByPath(): SubjectsByPath {
  return { spanish_bachillerato: [], bachibac: [], ib: [], international: [] }
}

export default function OrientationSimulator() {
  const [officialTargets, setOfficialTargets] = useState<OrientationTarget[]>([])
  const [criteria, setCriteria] = useState<OfficialCriterion[]>([])
  const [savedTarget, setSavedTarget] = useState<SavedOrientationTarget | null>(null)
  const [community, setCommunity] = useState<OrientationCommunity>('Madrid')
  const [selectedDegreeKey, setSelectedDegreeKey] = useState('')
  const [targetId, setTargetId] = useState('')
  const [accessPath, setAccessPath] = useState<AccessPathId>('spanish_bachillerato')
  const [scenarios, setScenarios] = useState(createDefaultAccessScenarios)
  const [subjectsByPath, setSubjectsByPath] = useState<SubjectsByPath>(createEmptySubjectsByPath)
  const [stateReady, setStateReady] = useState(false)
  const [stateUpdatedAt, setStateUpdatedAt] = useState('1970-01-01T00:00:00.000Z')
  const [authenticated, setAuthenticated] = useState(false)
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle')
  const storedSubjectInputs = useRef<StoredSubjectInputs>(createEmptyStoredSubjectInputs())
  const accessTokenRef = useRef<string | null>(null)
  const autosaveRef = useRef<LatestStateAutosave<OrientationStateV1> | null>(null)
  const queuedContentRef = useRef('')
  const currentContentRef = useRef('')
  const loadSequenceRef = useRef(0)
  const [showMethod, setShowMethod] = useState(false)
  const [activeTab, setActiveTab] = useState<'objetivo' | 'universidades' | 'correccion'>('objetivo')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [catalogAvailable, setCatalogAvailable] = useState<boolean | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const { theme: clayTheme } = useClayThemePreference()

  const targets = useMemo(() => availableCatalogTargets(officialTargets, ORIENTATION_FIXTURES, catalogAvailable === true), [officialTargets, catalogAvailable])
  const target = targets.find(item => item.id === targetId) ?? null
  const subjects = subjectsByPath[accessPath]
  const scenario = scenarios[accessPath]
  const pathDefinition = getAccessPath(accessPath, community)
  const calculation = useMemo(() => calculateAccessPathScore(scenario, subjects, community), [community, scenario, subjects])
  const score = calculation.finalScore
  const difference = target && calculation.complete ? score - target.referenceScore : 0
  const degreeGroups = useMemo(() => groupOrientationTargets(targets), [targets])
  const selectedDegree = degreeGroups.find(group => group.key === selectedDegreeKey) ?? null
  const alternatives = useMemo(() => rankOpportunities(officialTargets.filter(item => item.id !== targetId), score, savedTarget).slice(0, 4), [officialTargets, score, savedTarget, targetId])

  function markStateChanged() {
    setStateUpdatedAt(new Date().toISOString())
  }

  function selectTarget(id: string, availableTargets = targets, changedByUser = true) {
    const nextTarget = availableTargets.find(item => item.id === id)
    setTargetId(id)
    setSubjectsByPath(current => Object.fromEntries(ACCESS_PATH_IDS.map(pathId => {
      if (!nextTarget) return [pathId, []]
      const merged = mergeSubjectInputs(nextTarget.subjects, current[pathId])
      return [pathId, current[pathId].length ? merged : applyStoredSubjectInputs(merged, storedSubjectInputs.current[pathId])]
    })) as SubjectsByPath)
    setSaveState('idle')
    if (changedByUser) markStateChanged()
  }

  const loadOrientation = useCallback(async (requestedCommunity: OrientationCommunity, exploration: OrientationExploration | null, accessToken: string | null) => {
    const requestSequence = ++loadSequenceRef.current
    try {
      const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      const endpoint = `/api/orientation?community=${communitySlug(requestedCommunity)}`
      const response = await fetch(endpoint, { headers })
      if (!response.ok) throw new Error('orientation-api')
      const payload = await response.json() as { community?: OrientationCommunity; targets?: OrientationTarget[]; criteria?: OfficialCriterion[]; savedTarget?: SavedOrientationTarget | null; catalogAvailable?: boolean }
      if (requestSequence !== loadSequenceRef.current) return
      const realTargets = payload.targets ?? []
      const allTargets = availableCatalogTargets(realTargets, ORIENTATION_FIXTURES, payload.catalogAvailable !== false)
      setOfficialTargets(realTargets)
      setCriteria(payload.criteria ?? [])
      setSavedTarget(payload.savedTarget ?? null)
      setCatalogAvailable(payload.catalogAvailable ?? true)
      if (payload.community) setCommunity(payload.community)
      const activeCommunity = payload.community ?? requestedCommunity
      const groups = groupOrientationTargets(allTargets)
      const exploredHere = exploration?.community === activeCommunity
      const exploredTarget = exploredHere && exploration.degreeId && exploration.universityId
        ? allTargets.find(item => item.degreeId === exploration.degreeId && item.universityId === exploration.universityId) ?? null
        : null
      const exploredGroup = exploredHere
        ? groups.find(group => group.key === exploration.degreeGroupKey)
          ?? groups.find(group => group.offerings.some(item => item.id === exploredTarget?.id))
          ?? null
        : null
      function restoreTarget(nextTarget: OrientationTarget) {
        setTargetId(nextTarget.id)
        setSubjectsByPath(Object.fromEntries(ACCESS_PATH_IDS.map(pathId => [pathId, applyStoredSubjectInputs(nextTarget.subjects, storedSubjectInputs.current[pathId])])) as SubjectsByPath)
        setSaveState('idle')
      }
      if (exploredGroup) setSelectedDegreeKey(exploredGroup.key)
      else setSelectedDegreeKey('')
      if (exploredTarget) {
        restoreTarget(exploredTarget)
      } else {
        setTargetId('')
        setSubjectsByPath(createEmptySubjectsByPath())
      }

      const savedCommunity = normalizeOrientationCommunity(payload.savedTarget?.community)
      const canRestoreLegacyTarget = Boolean(payload.savedTarget?.degreeId && payload.savedTarget?.universityId && !savedCommunity)
      if (!exploredHere && payload.savedTarget && (savedCommunity === activeCommunity || canRestoreLegacyTarget)) {
        const match = findSavedTarget(allTargets, payload.savedTarget)
        if (match) {
          const group = groups.find(item => item.offerings.some(offering => offering.id === match.id))
          setSelectedDegreeKey(group?.key ?? '')
          restoreTarget(match)
        }
      }
      setLoadState('ready')
    } catch {
      if (requestSequence !== loadSequenceRef.current) return
      setOfficialTargets([])
      setCriteria([])
      setCatalogAvailable(false)
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    function applyState(state: OrientationStateV1) {
      storedSubjectInputs.current = state.subjectInputs
      setCommunity(state.activeCommunity)
      setAccessPath(state.activeAccessPath)
      setScenarios(state.scenarios)
      setSelectedDegreeKey(state.exploration.community === state.activeCommunity ? state.exploration.degreeGroupKey ?? '' : '')
      setTargetId('')
      setSubjectsByPath(createEmptySubjectsByPath())
      setStateUpdatedAt(state.updatedAt)
    }
    async function bootstrap() {
      const preferred = normalizeOrientationCommunity(window.localStorage.getItem(ORIENTATION_COMMUNITY_STORAGE_KEY) ?? window.localStorage.getItem('kairo_ccaa')) ?? 'Madrid'
      const unifiedLocal = parseOrientationState(window.localStorage.getItem(ORIENTATION_STATE_STORAGE_KEY))
      const legacyAccess = parseAccessPathStorage(window.localStorage.getItem(ACCESS_PATH_STORAGE_KEY))
      const localState = unifiedLocal ?? createOrientationState(preferred, legacyAccess, '1970-01-01T00:00:00.000Z')
      applyState(localState)

      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      const accessToken = data.session?.access_token ?? null
      accessTokenRef.current = accessToken
      setAuthenticated(Boolean(accessToken))
      let serverState: OrientationStateV1 | null = null
      if (accessToken) {
        try {
          serverState = await loadOrientationState(accessToken)
        } catch {
          setAutosaveStatus('error')
        }
      }
      if (cancelled) return
      const chosen = reconcileOrientationStates(localState, serverState) ?? localState
      applyState(chosen)
      if (serverState && orientationStateContentKey(chosen) === orientationStateContentKey(serverState)) {
        queuedContentRef.current = orientationStateContentKey(serverState)
      }
      await loadOrientation(chosen.activeCommunity, unifiedLocal || serverState ? chosen.exploration : null, accessToken)
      if (!cancelled) setStateReady(true)
    }
    void bootstrap()
    return () => { cancelled = true; loadSequenceRef.current += 1 }
  }, [loadOrientation])

  useEffect(() => {
    const autosave = new LatestStateAutosave<OrientationStateV1>(async state => {
      const saved = await persistOrientationState(accessTokenRef.current, state)
      if (!saved) return
      if (currentContentRef.current === orientationStateContentKey(saved)) {
        window.localStorage.setItem(ORIENTATION_STATE_STORAGE_KEY, JSON.stringify(saved))
      }
    }, setAutosaveStatus, 750)
    autosaveRef.current = autosave
    return () => { autosave.dispose(); autosaveRef.current = null }
  }, [])

  useEffect(() => {
    if (!stateReady) return
    const visibleInputs = subjectInputsFromScenarios(subjectsByPath)
    const subjectInputs = mergeStoredSubjectInputs(storedSubjectInputs.current, visibleInputs)
    storedSubjectInputs.current = subjectInputs
    const state: OrientationStateV1 = {
      version: 1,
      updatedAt: stateUpdatedAt,
      activeCommunity: community,
      activeAccessPath: accessPath,
      exploration: {
        community,
        degreeGroupKey: selectedDegree?.key ?? null,
        degreeName: selectedDegree?.name ?? null,
        degreeId: target?.degreeId ?? null,
        universityId: target?.universityId ?? null,
      },
      scenarios,
      subjectInputs,
    }
    const contentKey = orientationStateContentKey(state)
    currentContentRef.current = contentKey
    window.localStorage.setItem(ORIENTATION_STATE_STORAGE_KEY, JSON.stringify(state))
    window.localStorage.setItem(ACCESS_PATH_STORAGE_KEY, JSON.stringify(toAccessPathStorage(state)))
    window.localStorage.setItem(ORIENTATION_COMMUNITY_STORAGE_KEY, community)
    if (authenticated && contentKey !== queuedContentRef.current) {
      queuedContentRef.current = contentKey
      autosaveRef.current?.update(state)
    }
  }, [accessPath, authenticated, community, scenarios, selectedDegree, stateReady, stateUpdatedAt, subjectsByPath, target])

  useEffect(() => {
    if (!showMethod) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowMethod(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [showMethod])

  function updateSubject(id: string, patch: Partial<AdmissionSubject>) {
    setSubjectsByPath(current => ({ ...current, [accessPath]: current[accessPath].map(subject => subject.id === id ? { ...subject, ...patch } : subject) }))
    markStateChanged()
  }

  function retryLoad() {
    setLoadState('loading')
    setCatalogAvailable(null)
    void loadOrientation(community, {
      community,
      degreeGroupKey: selectedDegree?.key ?? null,
      degreeName: selectedDegree?.name ?? null,
      degreeId: target?.degreeId ?? null,
      universityId: target?.universityId ?? null,
    }, accessTokenRef.current)
  }

  function changeCommunity(nextCommunity: OrientationCommunity) {
    if (nextCommunity === community) return
    setCommunity(nextCommunity)
    window.localStorage.setItem(ORIENTATION_COMMUNITY_STORAGE_KEY, nextCommunity)
    setSelectedDegreeKey('')
    setTargetId('')
    setSubjectsByPath(createEmptySubjectsByPath())
    setOfficialTargets([])
    setCriteria([])
    setLoadState('loading')
    setCatalogAvailable(null)
    setSaveState('idle')
    markStateChanged()
    void loadOrientation(nextCommunity, null, accessTokenRef.current)
  }

  function resetScenario() {
    const defaults = createDefaultAccessScenarios()
    setScenarios(current => ({ ...current, [accessPath]: defaults[accessPath] }))
    setSubjectsByPath(current => ({ ...current, [accessPath]: target?.subjects.map(subject => ({ ...subject })) ?? [] }))
    markStateChanged()
  }

  function chooseDegree(key: string) {
    setSelectedDegreeKey(key)
    setTargetId('')
    setSubjectsByPath(createEmptySubjectsByPath())
    setSaveState('idle')
    markStateChanged()
  }

  async function saveAndOpenCamino() {
    if (!target) return
    setSaveState('saving')
    try {
      await autosaveRef.current?.flush()
      const { data } = await supabase.auth.getSession()
      if (!data.session) { setSaveState('error'); return }
      const saved = await persistOrientationTarget(data.session.access_token, target)
      if (!saved) { setSaveState('error'); return }
      setSavedTarget({ degreeId: target.degreeId, universityId: target.universityId, degree: target.degree, university: target.university, community: target.community, admissionScore: target.referenceScore, sourceType: target.source.type, updatedAt: new Date().toISOString() })
      const caminoContext = createCaminoOrientationContext(accessPath, target, calculation.complete ? score : null, calculation.complete ? difference : null, subjects, scenario, calculation.complete)
      window.localStorage.setItem(CAMINO_ORIENTATION_CONTEXT_KEY, JSON.stringify(caminoContext))
      window.location.assign('/camino')
    } catch {
      setSaveState('error')
    }
  }

  const recommendations = subjects.filter(subject => subject.enabled && subject.defaultGrade >= 5 && subject.defaultGrade < 10)
    .sort((a, b) => b.weighting - a.weighting || a.defaultGrade - b.defaultGrade).slice(0, 2)
    .map(subject => ({ ...subject, nextGrade: Math.min(10, subject.defaultGrade + 1), gain: (Math.min(10, subject.defaultGrade + 1) - subject.defaultGrade) * subject.weighting }))
  const prioritySubjects = subjects.filter(subject => subject.weighting === 0.2 || subject.enabled).slice(0, 8)
  const visibleSubjects = prioritySubjects.length ? prioritySubjects : subjects.slice(0, 4)
  const secondarySubjects = subjects.filter(subject => !visibleSubjects.some(visible => visible.id === subject.id))

  function updateScenario(nextScenario: typeof scenario) {
    setScenarios(current => ({ ...current, [accessPath]: nextScenario }))
    setSaveState('idle')
    markStateChanged()
  }

  function renderSubject(subject: AdmissionSubject) {
    return (
      <div className={`${styles.subjectRow} ${!subject.enabled ? styles.disabledSubject : ''}`} key={subject.id}>
        <div className={styles.subjectMeta}><button role="switch" aria-checked={subject.enabled} aria-label={`${subject.enabled ? 'Desactivar' : 'Activar'} ${subject.name}`} className={styles.toggle} onClick={() => updateSubject(subject.id, { enabled: !subject.enabled })}><span><Check size={14} /></span></button><div><b>{subject.name}</b><span>Pondera ×{subject.weighting.toLocaleString('es-ES')}{subject.ruleNote ? ` · ${subject.ruleNote}` : ''}</span></div></div>
        <GradeControl id={`subject-${subject.id}`} label={`Nota de ${subject.name}`} value={subject.defaultGrade} disabled={!subject.enabled} onChange={value => updateSubject(subject.id, { defaultGrade: value })} />
      </div>
    )
  }

  const headings = {
    objetivo: ['Mi objetivo', 'Elige, simula y convierte tu meta en un siguiente paso claro.'],
    universidades: ['Explorar grados', 'Filtra el catálogo oficial según lo que buscas y tu escenario.'],
    correccion: ['Cómo se corrige', 'Baremos oficiales explicados sin mezclar fuente e interpretación.'],
  } as const

  const pct = (value: number) => Math.max(0, Math.min(100, ((value - 5) / 9) * 100))
  const statusPositive = calculation.complete && difference >= 0
  const statusHeadline = calculation.complete
    ? difference >= 0 ? `Por encima de la referencia · +${formatGrade(difference)}` : `Te faltan ${formatGrade(Math.abs(difference))} puntos`
    : 'Completa los requisitos de tu vía'

  const TABS = [
    { id: 'objetivo', label: 'Mi objetivo', Icon: Target },
    { id: 'universidades', label: 'Explorar grados', Icon: GraduationCap },
    { id: 'correccion', label: 'Cómo se corrige', Icon: BookOpen },
  ] as const

  return (
    <ClayThemeScope theme={clayTheme} className={styles.appShell}>
      <SidebarNav />
      <div className={styles.column}>
        {/* Hero a sangre con el mismo tratamiento que La Zona y Simulacros */}
        <div className={styles.heroBand}>
          <img className={styles.heroImage} src={ORIENTATION_HERO_IMG} alt="" loading="eager" />
          <div className={styles.heroOverlay}>
            <div>
              <h1 className={styles.heroTitle}>{headings[activeTab][0]}</h1>
              <p className={styles.heroCaption}>{headings[activeTab][1]}</p>
            </div>
          </div>
        </div>

        <nav className={styles.tabs} aria-label="Secciones de Orientación">
          {TABS.map(({ id, label, Icon }) => <button key={id} aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}><Icon size={14} /> {label}</button>)}
          {activeTab === 'objetivo' && <button className={styles.methodButton} onClick={() => setShowMethod(true)}><Info size={14} /> ¿Cómo se calcula?</button>}
        </nav>

      <main className={styles.page}>
        <section className={styles.communityBar} aria-label="Comunidad del catálogo">
          <div><b>Consulta el sistema que te corresponde</b></div>
          <div className={styles.communitySwitch} role="group" aria-label="Selecciona comunidad">
            {ORIENTATION_COMMUNITIES.map(item => <button key={item} type="button" aria-pressed={community === item} onClick={() => changeCommunity(item)}>{item}</button>)}
          </div>
          <span>{community === 'Cataluña' ? 'Datos oficiales de preinscripción 2026' : 'Distrito único · curso 2026-2027'}</span>
        </section>
        {community === 'Cataluña' && <p className={styles.communityNote}><Info size={14} /> La nota de referencia es la del último estudiante que obtuvo plaza en la 1.ª asignación de junio de 2026; orienta, pero no garantiza admisión.</p>}

        {savedTarget?.community && normalizeOrientationCommunity(savedTarget.community) !== community && (
          <div className={styles.savedElsewhere}><Info size={14} /> Tu objetivo guardado está en {normalizeOrientationCommunity(savedTarget.community)}. Puedes explorar {community} sin sustituirlo.</div>
        )}

        {activeTab === 'objetivo' && savedTarget && (
          <section className={styles.savedTarget}>
            <div><Check size={16} /><span><small>Objetivo guardado</small><b>{savedTarget.degree} · {savedTarget.university}</b></span></div>
            <strong>{formatReference(savedTarget.admissionScore)}</strong>
            <button onClick={() => { setSelectedDegreeKey(''); setTargetId(''); setSubjectsByPath(createEmptySubjectsByPath()); markStateChanged() }}>Cambiar</button>
          </section>
        )}

        {activeTab === 'universidades' ? <UniversityExplorer targets={officialTargets} estimatedScore={calculation.complete ? score : null} loadState={loadState} onRetry={retryLoad} /> : activeTab === 'correccion' ? <CorrectionGuide community={community} databaseCriteria={criteria} /> : (
          <>
            {target && (
              <section className={styles.scoreBar} aria-live="polite" aria-label="Tu distancia al objetivo">
                <div className={styles.scoreDial} style={{ '--dial': calculation.complete ? pct(score) / 100 : 0 } as React.CSSProperties}><span className={styles.scoreDialInner}><Target size={16} /></span></div>
                <div className={styles.scoreNow}>
                  <span>Tu nota</span>
                  <b key={`${accessPath}-${score}`}>{calculation.complete ? <>{formatGrade(score)}<small> / 14</small></> : 'Pendiente'}</b>
                  <small>{calculation.complete ? `${formatGrade(calculation.baseScore)} base + ${formatGrade(calculation.weightedPoints)} admisión` : 'Falta completar tu vía'}</small>
                </div>
                <div className={styles.scoreRef}><span>Referencia</span><b>{formatReference(target.referenceScore)}</b><small>{target.referenceLabel}</small></div>
                {calculation.complete ? (
                  <div className={styles.goalChart} aria-label={`Tu nota estimada es ${formatGrade(score)} sobre 14; referencia ${formatReference(target.referenceScore)}`}>
                    <div className={styles.chartLabels}><span>5</span><span>14</span></div>
                    <div className={styles.track}>
                      <div className={styles.trackFill} style={{ '--fill': pct(score) / 100 } as React.CSSProperties} />
                      <div className={`${styles.marker} ${styles.yourMarker}`} style={{ left: `${pct(score)}%` }}><span>Tú</span></div>
                      <div className={`${styles.marker} ${styles.targetMarker}`} style={{ left: `${pct(target.referenceScore)}%` }}><span>Meta</span></div>
                    </div>
                  </div>
                ) : <p className={styles.scoreBarPending}>{calculation.incompleteReason ?? 'Completa los requisitos de tu vía para ver la distancia.'}</p>}
                <span className={`${styles.scorePill} ${statusPositive ? styles.positive : ''}`}>{statusPositive ? <Check size={14} /> : <Target size={14} />} {statusHeadline}</span>
                <a className={styles.scoreCta} href="#paso-4">Llevar a Camino <ArrowRight size={14} /></a>
              </section>
            )}

            <div className={styles.workspace}>
              <nav className={styles.railColumn} aria-label="Pasos para definir tu objetivo">
                <ol className={styles.stepRail}>
                  <li className={styles.flowActive}><a href="#paso-1"><b>1</b><span>Elige objetivo</span></a></li>
                  <li className={target ? styles.flowActive : ''}><a href="#paso-2"><b>2</b><span>Ajusta notas</span></a></li>
                  <li className={target ? styles.flowActive : ''}><a href="#paso-3"><b>3</b><span>Qué mejorar</span></a></li>
                  <li className={target ? styles.flowActive : ''}><a href="#paso-4"><b>4</b><span>Llévalo a Camino</span></a></li>
                  <li className={target && calculation.complete ? styles.flowActive : ''}><a href="#paso-5"><b>5</b><span>Alternativas</span></a></li>
                </ol>
                <p className={styles.railNote}><Info size={14} /><span>Simulación orientativa: no garantiza la admisión.</span></p>
              </nav>

              <div className={styles.stack}>
                <section className={styles.targetPicker} id="paso-1">
                  <div className={styles.pickerTitle}><span className={styles.stepNo}>1</span><div><b>Define tu objetivo</b><span>Elige el grado y después la oferta oficial donde quieres estudiarlo.</span></div></div>
                  {stateReady && (
                    <div className={styles.autosaveIndicator} data-state={authenticated ? autosaveStatus : 'local'} aria-live="polite">
                      {!authenticated ? 'Guardado en este dispositivo' : autosaveStatus === 'saving' ? 'Guardando cambios…' : autosaveStatus === 'error' ? <><span>Cambios pendientes</span><button type="button" onClick={() => autosaveRef.current?.retry()}><RefreshCw size={14} /> Reintentar</button></> : autosaveStatus === 'saved' ? <><Check size={14} /> Guardado</> : 'Sin cambios pendientes'}
                    </div>
                  )}
                  {loadState === 'loading' ? <div className={styles.selectSkeleton} /> : <TargetCombobox targets={targets} selectedId={targetId} selectedDegreeKey={selectedDegreeKey} onDegreeSelect={chooseDegree} onSelect={selectTarget} />}
                  <AccessPathSelector value={accessPath} onChange={pathId => { setAccessPath(pathId); setSaveState('idle'); markStateChanged() }} />
                </section>
                {catalogAvailable === false && <div className={styles.fallbackNotice}><Info size={14} /><span>No se pudo leer el catálogo verificado. No mostraremos datos demo hasta poder confirmar la fuente oficial.</span><button onClick={retryLoad}><RefreshCw size={14} /> Reintentar</button></div>}

                {!target ? <section className={styles.emptyState}><div><Target size={24} /></div><h2>Empieza por un grado.</h2><p>En cuanto lo elijas verás la referencia, tu escenario y el cambio con más impacto.</p></section> : (
                  <>
                    <section className={styles.controlsPanel} id="paso-2">
                      <div className={styles.sectionHeading}><div><span className={styles.stepNo}>2</span><h2>Ajusta tu escenario</h2></div><button onClick={resetScenario}><RotateCcw size={14} /> Restablecer</button></div>
                      <AccessPathInputs community={community} scenario={scenario} onChange={updateScenario} />
                      <div className={styles.subjectsHeading}><div><b>Materias que pueden subir tu nota</b><span>Solo cuentan las dos mejores aportaciones aprobadas, activas y válidas para tu vía.</span></div></div>
                      {subjects.length ? <>{visibleSubjects.map(renderSubject)}{secondarySubjects.length > 0 && <details className={styles.secondarySubjects}><summary>Ver {secondarySubjects.length} materias con menor ponderación</summary>{secondarySubjects.map(renderSubject)}</details>}</> : <p className={styles.noWeightings}>No hay ponderaciones verificadas para este objetivo.</p>}
                    </section>

                    <section className={styles.recommendations} id="paso-3" aria-live="polite">
                      <div><span className={styles.stepNo}>3</span><h2>Qué mejorar</h2></div>
                      <div className={`${styles.status} ${statusPositive ? styles.positive : ''}`}>{statusPositive ? <Check size={16} /> : <Target size={16} />}<div><b>{statusHeadline}</b><span>{calculation.incompleteReason ?? 'Es una simulación, no una garantía de admisión.'}</span></div></div>
                      {target.source.type === 'official' && target.source.url && <a className={styles.sourceLink} href={target.source.url} target="_blank" rel="noreferrer">OFICIAL · {target.source.label} <ExternalLink size={14} /></a>}
                      {recommendations.length ? recommendations.map(item => <div className={styles.recommendation} key={item.id}><div><b>{item.name}</b><span>Si subes {formatGrade(item.defaultGrade)} → {formatGrade(item.nextGrade)}</span></div><strong>+{formatGrade(item.gain)}</strong></div>) : <p>Activa o ajusta una materia para comparar el impacto.</p>}
                    </section>

                    <section className={styles.caminoCard} id="paso-4">
                      <div><span className={styles.stepNo}>4</span><h2>Llévalo a Camino</h2><p>Guardamos este objetivo y ajustamos tu plan de estudio a esta meta.</p></div>
                      <button className={`${styles.caminoCta} kairo-clay-action`} onClick={saveAndOpenCamino} disabled={saveState === 'saving'}><span>{saveState === 'saving' ? 'Guardando…' : savedTarget ? 'Actualizar objetivo en Camino' : 'Guardar y usar en Camino'}</span><ArrowRight size={16} /></button>
                      {saveState === 'error' && <p className={styles.saveError}>No se pudo guardar. Revisa tu sesión y vuelve a intentarlo.</p>}
                    </section>

                    {calculation.complete && <section className={styles.alternatives} id="paso-5" aria-label="Alternativas con tu nota actual">
                      <div className={styles.alternativesHeading}><div><span className={styles.stepNo}>5</span><h2>Opciones cerca de tu escenario</h2><p>Referencias ordenadas por distancia a tu nota actual.</p></div><button onClick={() => setActiveTab('universidades')}>Explorar {officialTargets.length} <ArrowRight size={14} /></button></div>
                      <div className={styles.alternativeGrid}>{alternatives.map(item => { const category = classifyOpportunity(score, item.referenceScore); return <article key={item.id}><div><GraduationCap size={16} /><span>{category === 'above' ? 'Por encima' : category === 'close' ? 'Cerca' : 'Por debajo'}</span></div><h3>{item.degree}</h3><p>{item.universityAcronym ?? item.university}</p><strong>{formatReference(item.referenceScore)}</strong></article> })}</div>
                      <p className={styles.opportunityDisclaimer}>Las notas de corte son históricas y pueden variar. Estar por encima no garantiza la admisión.</p>
                    </section>}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      </div>

      {showMethod && <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => event.target === event.currentTarget && setShowMethod(false)}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="method-title"><button className={styles.closeButton} aria-label="Cerrar" onClick={() => setShowMethod(false)}><X size={16} /></button><div className={styles.modalIcon}><Info size={20} /></div><h2 id="method-title">¿Cómo se calcula {pathDefinition.shortLabel}?</h2><p>{pathDefinition.officialSummary}</p><div className={styles.formula}>{calculation.formulaParts.map((part, index) => <div key={`${part.value}-${index}`}><b>{part.value}</b><span>{part.label}</span></div>)}</div><div className={styles.modalNotice}><Info size={16} /><span>Las referencias históricas orientan, pero no garantizan admisión. La acreditación oficial siempre prevalece sobre la simulación.</span></div></section></div>}
    </ClayThemeScope>
  )
}
