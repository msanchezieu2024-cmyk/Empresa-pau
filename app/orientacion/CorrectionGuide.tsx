'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Clock3, ExternalLink, FileCheck2, ShieldCheck, Sparkles } from 'lucide-react'
import type { OfficialCriterion } from './data'
import type { OrientationCommunity } from './community'
import { CATALUNYA_GENERAL_CORRECTION_GUIDE, CATALUNYA_OFFICIAL_EXAM_GUIDES, GENERAL_CORRECTION_GUIDE, OFFICIAL_EXAM_GUIDES } from './exam-guides'
import OfficialCriterionCard from './OfficialCriterionCard'
import styles from './orientation.module.css'

export default function CorrectionGuide({ community, databaseCriteria }: { community: OrientationCommunity; databaseCriteria: OfficialCriterion[] }) {
  const guides = useMemo(() => community === 'Cataluña' ? [CATALUNYA_GENERAL_CORRECTION_GUIDE, ...CATALUNYA_OFFICIAL_EXAM_GUIDES] : [GENERAL_CORRECTION_GUIDE, ...OFFICIAL_EXAM_GUIDES], [community])
  const defaultGuide = community === 'Cataluña' ? CATALUNYA_GENERAL_CORRECTION_GUIDE : GENERAL_CORRECTION_GUIDE
  const [guideId, setGuideId] = useState(defaultGuide.id)
  const guide = guides.find(item => item.id === guideId) ?? guides[0]
  const relatedCriteria = useMemo(() => databaseCriteria.filter(item => item.subject === guide.subject), [databaseCriteria, guide.subject])

  return (
    <section className={styles.correctionGuide} aria-labelledby="correction-title">
      <div className={styles.correctionHero}><div><h2 id="correction-title">Cómo se corrige de verdad</h2><p>Primero el criterio oficial. Después, la traducción práctica de Kairo.</p></div><div className={styles.officialSeal}><ShieldCheck size={20} /><span><b>Fuentes oficiales</b><small>PAU {community} · 2026</small></span></div></div>

      <label className={styles.subjectSelector}><span>Asignatura</span><span className={styles.nativeSelectWrap}><select value={guide.id} onChange={event => setGuideId(event.target.value)}>{guides.map(item => <option key={item.id} value={item.id}>{item.subject}</option>)}</select><ChevronDown size={16} /></span></label>

      <div className={styles.correctionMeta}><div><Clock3 size={17} /><span><small>Duración</small><b>{guide.durationMinutes} minutos</b></span></div><div><FileCheck2 size={17} /><span><small>Puntuación</small><b>{guide.totalPoints} puntos</b></span></div><div><ShieldCheck size={17} /><span><small>Documento</small><b>{guide.examLabel}</b></span></div></div>

      <div className={styles.correctionLayout}>
        <div className={styles.officialCorrection}>
          <div className={styles.sectionKicker}><ShieldCheck size={14} /> OFICIAL</div>
          <h3>Cómo se puntúa</h3>
          <div className={styles.scoreBreakdown}>{guide.structure.map(item => <div key={item.label}><span><b>{item.label}</b>{item.detail && <small>{item.detail}</small>}</span><strong>{item.points}</strong></div>)}</div>
          <h3>Criterios oficiales de corrección</h3>
          <ul className={styles.criteriaList}>{guide.officialCriteria.map(item => <li key={item}><Check size={14} /><span>{item}</span></li>)}</ul>
          <div className={styles.rubricNotice}>{guide.formalRubric ? 'El documento denomina formalmente rúbrica a este criterio.' : 'El documento publica criterios y baremos; no los denomina rúbrica formal.'}</div>
        </div>
        <aside className={styles.kairoCorrection}>
          <div className={styles.sectionKicker}><Sparkles size={14} /> KAIRO TE LO EXPLICA</div>
          <h3>En la práctica, esto significa que…</h3>
          {guide.kairoExplanation.map((item, index) => <div className={styles.kairoTip} key={item}><b>{index + 1}</b><p>{item}</p></div>)}
        </aside>
      </div>

      {relatedCriteria.length > 0 && <div className={styles.databaseCriteria}><h3>Más criterios verificados</h3>{relatedCriteria.map(item => <OfficialCriterionCard key={item.id} criterion={item} />)}</div>}

      <footer className={styles.sourceFooter}><div><ShieldCheck size={16} /><span><b>✓ OFICIAL · {guide.organism}</b><small>{guide.sourceDocument} · Curso {guide.academicYear}</small></span></div><a href={guide.sourceUrl} target="_blank" rel="noreferrer">Ver fuente oficial <ExternalLink size={13} /></a></footer>
      <p className={styles.sourceCaveat}>{community === 'Cataluña' ? 'La Generalitat publica estructura, exámenes y correcciones por materia y tribunal. Esta guía resume únicamente los criterios oficiales enlazados.' : 'A fecha de verificación, la colección equivalente del curso 2026-2027 aún no está publicada. Se muestra el último modelo oficial disponible y se etiqueta con su curso real.'}</p>
    </section>
  )
}
