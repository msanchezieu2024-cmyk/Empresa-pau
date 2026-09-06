'use client'

import { useId, useMemo, useState } from 'react'
import { ArrowLeft, Check, Search, ShieldCheck, X } from 'lucide-react'
import { degreeOfferDetail, groupOrientationTargets, searchDegreeGroups, searchDegreeOfferings } from './catalog'
import type { OrientationTarget } from './data'
import styles from './orientation.module.css'

export default function TargetCombobox({ targets, selectedId, selectedDegreeKey, onDegreeSelect, onSelect }: {
  targets: OrientationTarget[]
  selectedId: string
  selectedDegreeKey: string
  onDegreeSelect: (key: string) => void
  onSelect: (id: string) => void
}) {
  const degreeListId = useId()
  const offerListId = useId()
  const offerHeadingId = useId()
  const [degreeQuery, setDegreeQuery] = useState('')
  const [offerQuery, setOfferQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const groups = useMemo(() => groupOrientationTargets(targets), [targets])
  const selected = targets.find(item => item.id === selectedId) ?? null
  const selectedGroup = groups.find(group => group.key === selectedDegreeKey)
    ?? groups.find(group => group.offerings.some(item => item.id === selectedId))
    ?? null
  const degreeResults = useMemo(() => searchDegreeGroups(groups, degreeQuery).slice(0, 12), [degreeQuery, groups])
  const offers = useMemo(() => selectedGroup ? searchDegreeOfferings(selectedGroup, offerQuery) : [], [offerQuery, selectedGroup])

  function chooseDegree(key: string) {
    onDegreeSelect(key)
    setDegreeQuery('')
    setOfferQuery('')
    setOpen(false)
    setActiveIndex(0)
  }

  function changeDegree() {
    onDegreeSelect('')
    setOfferQuery('')
    setOpen(true)
    setActiveIndex(0)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(current => Math.min(degreeResults.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(current => Math.max(0, current - 1))
    } else if (event.key === 'Enter' && open && degreeResults[activeIndex]) {
      event.preventDefault()
      chooseDegree(degreeResults[activeIndex].key)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.targetChooser} data-selected-id={selectedId} data-degree-group={selectedGroup?.key ?? ''}>
      {!selectedGroup ? (
        <div className={styles.degreeStage}>
          <label className={styles.searchField}>
            <span><b>1</b> ¿Qué quieres estudiar?</span>
            <div className={styles.searchInputWrap}>
              <Search size={17} aria-hidden="true" />
              <input
                role="combobox"
                aria-label="Buscar grado"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={degreeListId}
                aria-activedescendant={open && degreeResults[activeIndex] ? `${degreeListId}-${activeIndex}` : undefined}
                value={degreeQuery}
                placeholder="Ej. economía, psicolo, análisis datos…"
                onFocus={() => setOpen(true)}
                onChange={event => { setDegreeQuery(event.target.value); setOpen(true); setActiveIndex(0) }}
                onKeyDown={onKeyDown}
              />
              {degreeQuery && <button type="button" aria-label="Limpiar búsqueda" onClick={() => { setDegreeQuery(''); setActiveIndex(0) }}><X size={15} /></button>}
            </div>
          </label>

          {open && (
            <div className={styles.comboboxPanel} id={degreeListId} role="listbox" aria-label="Resultados de titulaciones">
              <div className={styles.resultsMeta}><span><b>1</b> Grados</span><small>{degreeResults.length ? `${degreeResults.length} mejores coincidencias` : 'Sin coincidencias'}</small></div>
              {degreeResults.length ? degreeResults.map((group, resultIndex) => (
                <button
                  type="button"
                  id={`${degreeListId}-${resultIndex}`}
                  role="option"
                  aria-selected={false}
                  data-offering-ids={group.offerings.map(item => item.id).join(' ')}
                  className={resultIndex === activeIndex ? styles.activeResult : ''}
                  key={group.key}
                  onMouseEnter={() => setActiveIndex(resultIndex)}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => chooseDegree(group.key)}
                >
                  <span><strong>{group.name}</strong><small>{group.universityCount === 1 ? 'Disponible en 1 universidad' : `Disponible en ${group.universityCount} universidades`}</small></span>
                </button>
              )) : <div className={styles.comboEmpty}>Prueba con menos palabras o revisa el nombre del grado.</div>}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.chosenDegree}>
          <div><strong>{selectedGroup.name}</strong><span>{selectedGroup.offerings.length === 1 ? '1 oferta oficial' : `${selectedGroup.offerings.length} ofertas oficiales`}</span></div>
          <button type="button" onClick={changeDegree}><ArrowLeft size={14} /> Cambiar grado</button>
        </div>
      )}

      {selectedGroup && (
        <section className={styles.offerStage} aria-labelledby={offerHeadingId}>
          <div className={styles.offerStageHeading}>
            <div><b>2</b><span><strong id={offerHeadingId}>¿Dónde quieres estudiarlo?</strong><small>Elige la oferta oficial, universidad o centro.</small></span></div>
            {selectedGroup.offerings.length > 4 && <label className={styles.offerSearch}><Search size={14} /><input aria-label="Buscar universidad o centro" value={offerQuery} onChange={event => setOfferQuery(event.target.value)} placeholder="Universidad o campus" /></label>}
          </div>
          <div className={styles.offerList} id={offerListId} role="listbox" aria-label={`Ofertas de ${selectedGroup.name}`}>
            {offers.map(offer => {
              const detail = degreeOfferDetail(offer)
              return (
                <button type="button" role="option" aria-selected={offer.id === selectedId} data-degree-id={offer.degreeId ?? ''} data-university-id={offer.universityId ?? ''} key={offer.id} onClick={() => onSelect(offer.id)}>
                  <span><strong>{offer.universityAcronym ?? offer.university}</strong><small>{offer.university}</small>{detail && <small className={styles.offerCampus}>{detail}</small>}</span>
                  <span className={styles.resultReference}><small title="Nota de referencia oficial"><ShieldCheck size={14} /><span className={styles.srOnly}>Nota de referencia</span></small><b>{offer.referenceScore.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</b>{offer.id === selectedId && <Check size={15} />}</span>
                </button>
              )
            })}
            {!offers.length && <div className={styles.comboEmpty}>No hay ofertas que coincidan con esa universidad o centro.</div>}
          </div>
        </section>
      )}

      {selected && (
        <div className={styles.selectedTarget}>
          <div className={styles.selectedTargetIcon}><Check size={16} /></div>
          <div><strong>{selected.degree}</strong><span>{selected.universityAcronym ? `${selected.universityAcronym} · ` : ''}{selected.university}</span></div>
          <div className={styles.selectedScore}><small>Referencia {selected.source.academicYear}</small><b>{selected.referenceScore.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</b></div>
        </div>
      )}
    </div>
  )
}
