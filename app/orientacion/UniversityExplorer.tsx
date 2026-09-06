'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Filter, GraduationCap, RotateCcw, Search, ShieldCheck, Target, TrendingUp } from 'lucide-react'
import type { OrientationTarget } from './data'
import { buildCatalogSearchIndex } from './catalog'
import { classifyOpportunity, opportunityDifference } from './opportunities'
import { filterUniversityExplorerIndex, type ReferenceBand, type SituationFilter } from './university-filters'
import styles from './orientation.module.css'

const PAGE_SIZE = 18
const formatGrade = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatReference = (value: number) => value.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

const situationMeta = {
  above: { label: 'Por encima de la referencia', icon: Check },
  close: { label: 'Cerca de la referencia', icon: Target },
  improve: { label: 'Por debajo de la referencia', icon: TrendingUp },
}

export default function UniversityExplorer({ targets, estimatedScore, loadState, onRetry }: { targets: OrientationTarget[]; estimatedScore: number | null; loadState: 'loading' | 'ready' | 'error'; onRetry: () => void }) {
  const [search, setSearch] = useState('')
  const [universityId, setUniversityId] = useState('')
  const [referenceBand, setReferenceBand] = useState<ReferenceBand>('all')
  const [situation, setSituation] = useState<SituationFilter>('all')
  const [subjectCode, setSubjectCode] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [expandedId, setExpandedId] = useState('')

  const universities = useMemo(() => [...new Map(targets.map(item => [item.universityId, { id: item.universityId!, acronym: item.universityAcronym, name: item.university }])).values()].sort((a, b) => (a.acronym ?? a.name).localeCompare(b.acronym ?? b.name, 'es')), [targets])
  const subjects = useMemo(() => [...new Map(targets.flatMap(item => item.subjects).filter(item => item.weighting === 0.2).map(item => [item.subjectCode, item.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [targets])
  const searchIndex = useMemo(() => buildCatalogSearchIndex(targets), [targets])
  const filtered = useMemo(() => filterUniversityExplorerIndex(searchIndex, { search, universityId, referenceBand, situation, subjectCode }, estimatedScore), [searchIndex, search, universityId, referenceBand, situation, subjectCode, estimatedScore])
  const visible = filtered.slice(0, visibleCount)
  const hasFilters = Boolean(search || universityId || referenceBand !== 'all' || situation !== 'all' || subjectCode)

  function changed(callback: () => void) { callback(); setVisibleCount(PAGE_SIZE) }
  function clearFilters() { setSearch(''); setUniversityId(''); setReferenceBand('all'); setSituation('all'); setSubjectCode(''); setVisibleCount(PAGE_SIZE) }

  return (
    <section className={styles.explorer} aria-labelledby="explorer-title">
      <div className={styles.explorerHero}>
        <div><h2 id="explorer-title">Encuentra grados que encajan contigo</h2><p>Filtra {targets.length} referencias por universidad, nota y materias que ponderan 0,2.</p></div>
        <div className={styles.currentEstimate}><span>Con tu nota actual</span><strong>{estimatedScore === null ? 'Pendiente' : <>{formatGrade(estimatedScore)} <small>/ 14</small></>}</strong><small>{estimatedScore === null ? 'Completa tu vía en Mi objetivo' : 'El orden y la situación cambian en vivo'}</small></div>
      </div>

      <div className={styles.filterPanel}>
        <div className={styles.filterPanelTitle}><span><Filter size={15} /> Afinar resultados</span>{hasFilters && <button type="button" onClick={clearFilters}><RotateCcw size={13} /> Limpiar</button>}</div>
        <label className={styles.wideFilter}><span>Grado</span><div className={styles.filterInput}><Search size={15} /><input aria-label="Buscar grado en universidades" value={search} onChange={event => changed(() => setSearch(event.target.value))} placeholder="Psicología, datos, ingeniería…" /></div></label>
        <FilterSelect label="Universidad" value={universityId} onChange={value => changed(() => setUniversityId(value))}><option value="">Todas</option>{universities.map(item => <option key={item.id} value={item.id}>{item.acronym ? `${item.acronym} · ` : ''}{item.name}</option>)}</FilterSelect>
        <FilterSelect label="Nota de referencia" value={referenceBand} onChange={value => changed(() => setReferenceBand(value as ReferenceBand))}><option value="all">Cualquier nota</option><option value="up-to-8">Hasta 8</option><option value="8-10">8–10</option><option value="10-12">10–12</option><option value="12-13">12–13</option><option value="13-plus">13+</option></FilterSelect>
        <FilterSelect label="Con mi nota" value={situation} disabled={estimatedScore === null} onChange={value => changed(() => setSituation(value as SituationFilter))}><option value="all">{estimatedScore === null ? 'Completa primero tu vía' : 'Todas las situaciones'}</option><option value="above">Por encima</option><option value="close">Cerca (≤ 0,50)</option><option value="improve">Por debajo</option></FilterSelect>
        <FilterSelect label="Pondera 0,2" value={subjectCode} onChange={value => changed(() => setSubjectCode(value))}><option value="">Cualquier asignatura</option>{subjects.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</FilterSelect>
      </div>

      <div className={styles.resultsHeader}><div><strong>{filtered.length}</strong><span>grados verificados</span></div><small>Las ramas de conocimiento no se muestran porque el catálogo actual no incluye ese dato oficial.</small></div>

      {loadState === 'loading' ? <div className={styles.skeletonList}><i /><i /><i /></div> : loadState === 'error' ? <div className={styles.filteredEmpty}><ShieldCheck size={23} /><span>No se pudo cargar el catálogo verificado.</span><button onClick={onRetry}>Reintentar</button></div> : visible.length ? (
        <div className={styles.degreeGrid}>
          {visible.map(item => {
            const category = estimatedScore === null ? null : classifyOpportunity(estimatedScore, item.referenceScore) as keyof typeof situationMeta
            const meta = category ? situationMeta[category] : null
            const Icon = meta?.icon
            const difference = estimatedScore === null ? null : opportunityDifference(estimatedScore, item.referenceScore)
            const importantSubjects = item.subjects.filter(subject => subject.weighting === 0.2).slice(0, 4)
            const expanded = expandedId === item.id
            return (
              <article className={`${styles.degreeCard} ${category ? styles[`degree_${category}`] : ''}`} key={item.id}>
                <div className={styles.degreeTop}><div className={styles.degreeIcon}><GraduationCap size={17} /></div>{meta && Icon && <span className={styles.situationBadge}><Icon size={11} /> {meta.label}</span>}</div>
                <h3>{item.degree}</h3><p>{item.universityAcronym ? `${item.universityAcronym} · ` : ''}{item.university}</p>
                <div className={styles.degreeScores}><div><span>Nota referencia</span><b>{formatReference(item.referenceScore)}</b></div><div><span>Tu escenario</span><b>{estimatedScore === null ? '—' : formatGrade(estimatedScore)}</b></div></div>
                {difference !== null && <strong className={styles.degreeDifference}>{difference >= 0 ? `+${formatGrade(difference)} sobre la referencia` : `${formatGrade(Math.abs(difference))} puntos por debajo`}</strong>}
                {importantSubjects.length > 0 && <div className={styles.weightingPreview}>{importantSubjects.slice(0, 2).map(subject => <span key={subject.id}>{subject.name} · 0,2</span>)}</div>}
                <button type="button" className={styles.detailsButton} aria-expanded={expanded} onClick={() => setExpandedId(expanded ? '' : item.id)}>Ver detalles <ChevronDown size={14} /></button>
                {expanded && <div className={styles.degreeDetails}><span>Ponderaciones 0,2</span>{importantSubjects.length ? <ul>{importantSubjects.map(subject => <li key={subject.id}>{subject.name}</li>)}</ul> : <p>Sin materias a 0,2 verificadas.</p>}<a href={item.source.url!} target="_blank" rel="noreferrer">Ver fuente oficial <ExternalLink size={12} /></a></div>}
              </article>
            )
          })}
        </div>
      ) : <div className={styles.filteredEmpty}><Target size={22} /><span>No hay grados con esta combinación.</span><button onClick={clearFilters}>Limpiar filtros</button></div>}
      {visibleCount < filtered.length && <button className={styles.showMoreButton} onClick={() => setVisibleCount(current => current + PAGE_SIZE)}>Ver más grados</button>}
      <p className={styles.opportunityDisclaimer}>Las notas son referencias históricas y pueden variar. Estar por encima no garantiza la admisión.</p>
    </section>
  )
}

function FilterSelect({ label, value, onChange, children, disabled = false }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return <label className={styles.filterSelect}><span>{label}</span><span className={styles.nativeSelectWrap}><select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{children}</select><ChevronDown size={14} /></span></label>
}
