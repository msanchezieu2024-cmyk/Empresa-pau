import Link from 'next/link'
import { Bebas_Neue, DM_Mono } from 'next/font/google'
import { Check, X } from 'lucide-react'
import {
  PLATFORM_STRUCTURED_EXERCISES_LABEL,
  PLATFORM_STRUCTURED_EXERCISES_LONG_TEXT,
} from '@/app/lib/platformStats'
import { getPlanPriceDisplay, getPublicPlanDefinitions } from '@/app/lib/pricing'
import LandingAuthProvider from './LandingAuthState'
import { NavLoginLink, BottomCta, HeroFreeLink, PricingPlanCta, PricingSectionTracker, StickyMobileCta } from './LandingCta'
import { ClayHeroCta, ClayHeroMiniCards } from './LandingClayPilotHero'
import RevealOnScroll from '@/app/components/ui/RevealOnScroll'
import { SUBJECT_OPTS } from '@/app/lib/subjectCatalog'

const bebas  = Bebas_Neue({ weight: '400', subsets: ['latin'] })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'] })

// ── Data ───────────────────────────────────────────────────────────────────────

const STATS = [
  { value: PLATFORM_STRUCTURED_EXERCISES_LABEL,  label: PLATFORM_STRUCTURED_EXERCISES_LONG_TEXT },
  { value: '38',    label: 'Semanas de currículum PAU' },
  { value: '10+',   label: 'Años de exámenes oficiales' },
]

const STEPS = [
  { n: '01', title: 'Recibe tu Camino PAU',            desc: 'Misiones diarias de 15 min calculadas a partir de tu fecha de examen y asignaturas.' },
  { n: '02', title: 'Resuelve exámenes reales',        desc: 'Exámenes oficiales de Madrid y Cataluña 2015–2025. A mano, como en el examen real.' },
  { n: '03', title: 'La IA te corrige en 30 segundos', desc: 'Subes una foto. Rúbrica oficial exacta. Nota, desglose, y cómo mejorar.' },
]

const TESTIMONIALS = [
  {
    name: 'María G.',   city: 'Madrid, 18 años',
    score: '8,4 en Mat. II',  prev: 'Antes: 5,1',
    quote: 'El desglose por apartados es lo mejor. Supe exactamente en qué fallaba y no volví a cometer el mismo error. Subí tres puntos en dos meses.',
  },
  {
    name: 'Carlos M.',  city: 'Alcalá de Henares, 17 años',
    score: '9,2 en Historia', prev: 'Sin academia',
    quote: 'Sin dinero para academia. Solo Kairo y la biblioteca municipal. El plan semanal me dijo qué estudiar cada día.',
  },
  {
    name: 'Lucía P.',   city: 'Leganés, 18 años',
    score: '8,8 en Física',   prev: 'Empezó 4 semanas antes',
    quote: 'Empecé justo un mes antes de la PAU. La corrección me explicó todo y fui mejorando rápido.',
  },
]

type CompareRow =
  | { label: string; kairo: boolean;  academia: boolean;  solo: boolean }
  | { label: string; kairo: string;   academia: string;   solo: string  }

const COMPARE_ROWS: CompareRow[] = [
  { label: 'Exámenes PAU Madrid y Cataluña', kairo: true,            academia: true,        solo: true  },
  { label: 'Corrección instantánea por IA',  kairo: true,            academia: false,       solo: false },
  { label: 'Desglose por apartado/criterio', kairo: true,            academia: false,       solo: false },
  { label: 'Plan de estudio personalizado',  kairo: true,            academia: false,       solo: false },
  { label: 'Disponible 24 horas al día',     kairo: true,            academia: false,       solo: true  },
  { label: 'Chat con tutor IA',              kairo: true,            academia: false,       solo: false },
  { label: 'Historial de progreso',          kairo: true,            academia: false,       solo: false },
  { label: 'Precio mensual',                 kairo: `${getPlanPriceDisplay('free')} / ${getPlanPriceDisplay('premium')}`,  academia: '100–200€',  solo: 'Gratis' },
]

// Derivado de SUBJECT_OPTS (app/components/onboarding/OnboardingFlow.tsx) —
// misma fuente que decide qué asignaturas puede elegir un alumno real en el
// onboarding, para que esta lista de marketing nunca vuelva a quedarse
// desincronizada (antes tenía Matemáticas CCSS como "Pronto" ya activa, y le
// faltaban Historia de la Filosofía, Inglés y Economía de la Empresa).
const SUBJECTS = SUBJECT_OPTS.map(s => ({ label: s.label, ready: s.betaStatus === 'enabled' }))

const PLANS = getPublicPlanDefinitions()

// ── Component ──────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const B = bebas.style.fontFamily
  const M = dmMono.style.fontFamily

  return (
    <LandingAuthProvider>
    <div style={{ fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)', background: '#f9f9f9', color: '#1c1c1c' }}>

      <style>{`
        /* ── Reset ── */
        .v4c-root *, .v4c-root *::before, .v4c-root *::after { box-sizing: border-box; }

        /* ── Nav ── */
        .v4c-nav-link:hover  { color: #fff !important; }
        .v4c-btn-nav         { transition: background 140ms; }
        .v4c-btn-nav:hover   { background: rgba(255,255,255,.1) !important; }

        /* ── Hero CTA circle ── */
        .v4c-cta-circle {
          transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .v4c-cta-circle:hover  { transform: scale(1.06); }
        .v4c-cta-circle:active { transform: scale(.97); }

        /* ── Mini cards hide on small screens ── */
        .v4c-mini-cards { pointer-events: none; }

        /* ── Alternating blocks ── */
        .v4c-block {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 520px;
        }
        .v4c-copy {
          padding: 80px 72px;
          display: flex; flex-direction: column; justify-content: center;
        }
        .v4c-data {
          display: flex; flex-direction: column; justify-content: center;
          padding: 80px 72px;
          border-left: 1px solid #e0e0e0;
        }
        .v4c-dark .v4c-data  { border-left-color: rgba(255,255,255,.07); }
        .v4c-light .v4c-copy { border-left: none; }
        .v4c-dark .v4c-copy  { border-left: none; }

        /* ── Stats grid ── */
        .v4c-stats { display: grid; grid-template-columns: 1fr 1fr; }
        .v4c-stat  { padding: 24px; border-bottom: 1px solid #e0e0e0; border-right: 1px solid #e0e0e0; }
        .v4c-stat:nth-child(2n) { border-right: none; }
        .v4c-stat:nth-child(3), .v4c-stat:nth-child(4) { border-bottom: none; }
        .v4c-stat:last-child { border-right: none; }
        .v4c-dark .v4c-stat { border-color: rgba(255,255,255,.08); }

        /* ── Steps list ── */
        .v4c-steps { display: flex; flex-direction: column; }
        .v4c-step  {
          display: grid; grid-template-columns: 32px 1fr; gap: 0 16px;
          padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,.06); align-items: start;
        }
        .v4c-step:first-child { padding-top: 0; }
        .v4c-step:last-child  { border-bottom: none; }

        /* ── Full-width sections ── */
        .v4c-full { padding: 80px 72px; }
        .v4c-full-inner { max-width: 1040px; margin: 0 auto; }

        /* ── Compare table ── */
        .v4c-cmp-grid {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          border-top: 1px solid #e0e0e0;
        }
        .v4c-cmp-row { display: contents; }
        .v4c-cmp-row > * {
          padding: 14px 0;
          border-bottom: 1px solid #e0e0e0;
          display: flex; align-items: center;
        }
        .v4c-cmp-head > * {
          padding: 10px 0 10px;
          border-bottom: 2px solid #e0e0e0;
        }

        /* ── Pricing ── */
        .v4c-p-cols {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          align-items: stretch;
        }
        .v4c-p-col {
          display: flex; flex-direction: column; min-width: 0; padding: 28px;
          border: 1px solid rgba(255,255,255,.12); border-radius: 26px;
          background: linear-gradient(145deg,rgba(255,255,255,.09),rgba(255,255,255,.035));
          box-shadow: 14px 18px 40px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.13);
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        }
        .v4c-p-col--featured {
          border-color: rgba(147,197,253,.55);
          background: linear-gradient(145deg,rgba(37,99,235,.94),rgba(47,124,246,.8));
          box-shadow: 0 24px 54px rgba(37,99,235,.26), inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(0,0,0,.14);
        }
        .v4c-p-value { min-height: 66px; }

        /* ── CTA split block ── */
        .v4c-cta-split  { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #e0e0e0; }
        .v4c-cta-left   { padding: 80px 72px; background: #f9f9f9; display: flex; flex-direction: column; justify-content: center; }
        .v4c-cta-right  { padding: 80px 72px; background: #111; display: flex; align-items: center; justify-content: center; }
        .v4c-cta-circle-inv {
          width: 150px; height: 150px; border-radius: 50%;
          border: 1.5px solid rgba(255,255,255,.35);
          display: flex; align-items: center; justify-content: center;
          text-decoration: none; flex-direction: column; gap: 4px;
          transition: border-color 160ms, transform 160ms cubic-bezier(0.23,1,0.32,1), background 160ms;
        }
        .v4c-cta-circle-inv:hover  { border-color: #fff; transform: scale(1.05); background: rgba(255,255,255,.06); }
        .v4c-cta-circle-inv:active { transform: scale(.97); }

        /* ── Footer links ── */
        .v4c-footer-link:hover { color: #fff !important; }

        /* ── Mid-page CTA ── */
        .v4c-mid-cta:hover { background: #1c1c1c !important; color: #fff !important; }

        /* ── Nav scroll-aware (dark ↔ light) ── */
        #v4c-nav {
          transition: background 300ms cubic-bezier(0.23,1,0.32,1),
                      border-bottom-color 300ms cubic-bezier(0.23,1,0.32,1);
          border-bottom: 1px solid transparent;
        }
        #v4c-nav.v4c-on-light {
          background: rgba(249,249,249,0.88) !important;
          border-bottom-color: #e8e8e8;
        }
        #v4c-nav-logo {
          transition: filter 300ms cubic-bezier(0.23,1,0.32,1);
        }
        #v4c-nav.v4c-on-light #v4c-nav-logo { filter: invert(1); }
        #v4c-nav.v4c-on-light .v4c-nav-link { color: rgba(28,28,28,.5) !important; }
        #v4c-nav.v4c-on-light .v4c-nav-link:hover { color: #1c1c1c !important; }
        #v4c-nav.v4c-on-light .v4c-btn-nav {
          border-color: rgba(28,28,28,.3) !important;
          color: #1c1c1c !important;
        }
        #v4c-nav.v4c-on-light .v4c-btn-nav:hover {
          background: rgba(0,0,0,.06) !important;
        }

        @media (prefers-reduced-motion: reduce) {
          #v4c-nav, #v4c-nav-logo { transition: none !important; }
        }

        /* ── Responsive ── */
        @media (max-width: 900px) {
          .v4c-block      { grid-template-columns: 1fr; }
          .v4c-copy, .v4c-data { padding: 52px 28px; }
          .v4c-data       { border-left: none !important; border-top: 1px solid #e0e0e0; }
          .v4c-dark .v4c-data  { border-top-color: rgba(255,255,255,.07); }

          .v4c-full       { padding: 56px 28px; }

          .v4c-cmp-grid { grid-template-columns: 1.6fr 1fr 1fr 1fr; font-size: 12px; }

          .v4c-p-cols     { grid-template-columns: 1fr; }
          .v4c-p-col      { padding: 26px !important; }
          .v4c-p-col--featured { order: -1; }
          .v4c-p-value { min-height: 0; }

          .v4c-cta-split  { grid-template-columns: 1fr; }
          .v4c-cta-left, .v4c-cta-right { padding: 56px 28px; }

          .v4c-mini-cards { display: none !important; }

          nav { padding: 0 20px !important; }
          footer { padding: 28px 24px !important; flex-direction: column !important; align-items: flex-start !important; }
        }

        @media (prefers-reduced-motion: reduce) {
          .v4c-cta-circle, .v4c-cta-circle-inv { transition: none !important; }
        }

        /* ── Hero entrance ── */
        @keyframes v4c-hero-in {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .v4c-hero-in { animation: v4c-hero-in 0.9s cubic-bezier(0.22,1,0.36,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .v4c-hero-in { animation: none !important; }
        }

        /* ── Sticky mobile CTA ── */
        .v4c-sticky-cta {
          display: none;
        }
        @media (max-width: 640px) {
          .v4c-sticky-cta {
            display: block;
            position: fixed;
            left: 12px; right: 12px;
            bottom: calc(12px + env(safe-area-inset-bottom, 0px));
            z-index: 90;
            padding: 6px;
            background: rgba(17,17,17,.9);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border-radius: 999px;
            box-shadow: 0 10px 30px rgba(0,0,0,.35);
          }
        }
      `}</style>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav id="v4c-nav" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 54,
        background: 'rgba(17,17,17,0.82)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}>
        <Link href="/" aria-label="Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="v4c-nav-logo" src="/brand/kairo-logo-white.png" alt="Kairo" loading="eager" style={{ height: 32, width: 'auto', display: 'block' }} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href="/precios" className="v4c-nav-link" style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.5)', textDecoration: 'none', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Precios
          </Link>
          {/* Waitlist del Curso PAU: hasta ahora la página existía pero no la
              enlazaba nadie desde el sitio. Va en blanco pleno, no en el gris
              de "Precios", porque es la acción que la landing quiere empujar. */}
          <Link href="/waitlist" className="v4c-nav-link" style={{ fontSize: 11, fontWeight: 500, color: '#fff', textDecoration: 'none', letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Reserva tu plaza
          </Link>
          <NavLoginLink />
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section style={{ height: '100vh', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

        {/* Background: image + filter + gradient overlay */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {/* El PNG original pesaba 1,6 MB para una foto sin transparencia.
              Estas dos WebP son 55 KB y 28 KB; el móvil solo pide la pequeña.
              eslint-disable-next-line @next/next/no-img-element */}
          <picture>
            <source
              media="(max-width: 759px)"
              srcSet="/brand/hero-notebook-sm.webp"
              type="image/webp"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/hero-notebook.webp"
              alt=""
              aria-hidden
              fetchPriority="high"
              style={{
                width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                filter: 'saturate(1.8) brightness(1.2) hue-rotate(-10deg) contrast(1.1)',
              }}
            />
          </picture>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(17,17,17,.72) 0%, rgba(17,17,17,.55) 50%, rgba(17,17,17,.9) 100%)' }} />
        </div>

        {/* Hero text */}
        <div className="v4c-hero-in" style={{ position: 'relative', zIndex: 10, textAlign: 'center', padding: '0 32px' }}>
          <p style={{ fontFamily: M, fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.35)', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 18 }}>
            Selectividad · Madrid · 2026
          </p>
          <h1 style={{ fontFamily: B, fontSize: 'clamp(72px, 14vw, 184px)', lineHeight: .92, letterSpacing: '.01em', color: '#fff', marginBottom: 40 }}>
            Prepara<span style={{ display: 'block', letterSpacing: '-.01em' }}>la PAU.</span>
          </h1>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <ClayHeroCta />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <HeroFreeLink />
            <Link href="#como-funciona" style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.35)', letterSpacing: '.12em', textTransform: 'uppercase', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,.15)', paddingBottom: 2, display: 'inline-block' }}>
              Ver cómo funciona
            </Link>
          </div>
        </div>

        {/* Mini cards — piloto claymorfismo (ver app/landing/LandingClayPilotHero.tsx) */}
        <div className="v4c-mini-cards" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, padding: '0 48px 24px' }}>
          <ClayHeroMiniCards />
        </div>
      </section>

      {/* ── Block 1: El problema (light) ─────────────────────────────────────── */}
      <RevealOnScroll as="div">
      <div data-theme="light" className="v4c-block v4c-light" style={{ background: '#f9f9f9' }}>
        <div className="v4c-copy">
          <span style={{ fontFamily: M, fontSize: 10, color: '#999', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20, display: 'block' }}>El problema</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4vw, 52px)', letterSpacing: '.01em', color: '#1c1c1c', lineHeight: .95, marginBottom: 20 }}>
            Lo que tenías antes no funcionaba.
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: '#5a5a5a', maxWidth: '44ch' }}>
            Las academias cuestan hasta 200 € al mes. Los PDFs de exámenes no te corrigen. La IA genérica no usa la rúbrica oficial. Kairo resuelve exactamente eso.
          </p>
        </div>
        <div className="v4c-data">
          <div className="v4c-stats">
            {STATS.map((s, i) => (
              <div key={i} className="v4c-stat">
                <p style={{ fontFamily: B, fontSize: 44, color: '#1c1c1c', letterSpacing: '.01em', lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontFamily: M, fontSize: 9, color: '#999', letterSpacing: '.12em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      </RevealOnScroll>

      {/* ── Block 2: Cómo funciona (dark) ────────────────────────────────────── */}
      <RevealOnScroll as="div">
      <div id="como-funciona" className="v4c-block v4c-dark" style={{ background: '#111' }}>
        <div className="v4c-copy">
          <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20, display: 'block' }}>Cómo funciona</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4vw, 52px)', letterSpacing: '.01em', color: '#fff', lineHeight: .95, marginBottom: 20 }}>
            Tres pasos. Quince minutos.
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(255,255,255,.5)', maxWidth: '44ch' }}>
            Sin academia. Sin horarios fijos. Desde el móvil, en el autobús, cuando tú puedas.
          </p>
        </div>
        <div className="v4c-data">
          <div className="v4c-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="v4c-step">
                <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.2)', paddingTop: 2 }}>{s.n}</span>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{s.title}</p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', lineHeight: 1.6 }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </RevealOnScroll>

      {/* ── Block 3: La corrección (light) ───────────────────────────────────── */}
      <RevealOnScroll as="div">
      <div data-theme="light" className="v4c-block v4c-light" style={{ background: '#f9f9f9' }}>
        <div className="v4c-copy">
          <span style={{ fontFamily: M, fontSize: 10, color: '#999', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20, display: 'block' }}>La corrección</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4vw, 52px)', letterSpacing: '.01em', color: '#1c1c1c', lineHeight: .95, marginBottom: 20 }}>
            La rúbrica del profesor. En tu móvil.
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: '#5a5a5a', maxWidth: '44ch' }}>
            No es corrección automática genérica. Es la rúbrica oficial de tu comunidad aplicada respuesta a respuesta, con el mismo criterio que usará tu corrector en junio.
          </p>
        </div>
        <div className="v4c-data" style={{ background: '#f3f3f3', padding: '56px 48px' }}>
          {/* Mock correction UI */}
          <div style={{ border: '1px solid #e0e0e0', overflow: 'hidden' }}>
            <div style={{ background: '#111', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 5 }}>
                {[0, 1, 2].map((i) => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,.2)' }} />)}
              </div>
              <span style={{ fontFamily: M, fontSize: 9, color: 'rgba(255,255,255,.4)', letterSpacing: '.1em', marginLeft: 'auto' }}>Kairo · Corrección</span>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#1c1c1c', marginBottom: 8, lineHeight: 1.4 }}>
                Matemáticas II · Madrid 2023<br />Bloque análisis · Ejercicio 2a
              </p>
              <p style={{ fontSize: 11, color: '#5a5a5a', marginBottom: 16 }}>Calcula f&apos;(x) y estudia la monotonía de f(x) = x³·ln(x)</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: B, fontSize: 36, color: '#1c1c1c', letterSpacing: '.01em', lineHeight: 1 }}>7,8</span>
                <span style={{ fontFamily: M, fontSize: 11, color: '#999' }}>/ 10 pts</span>
              </div>
              <div style={{ height: 2, background: '#e0e0e0', marginBottom: 12 }}>
                <div style={{ height: 2, background: '#1c1c1c', width: '78%' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  { item: 'Derivada calculada', pts: '3,0 / 3,0' },
                  { item: 'Puntos críticos',    pts: '2,0 / 2,0' },
                  { item: 'Tabla de monotonía', pts: '1,8 / 3,0' },
                ].map((row) => (
                  <div key={row.item} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#5a5a5a' }}>{row.item}</span>
                    <span style={{ fontFamily: M, color: '#1c1c1c', fontSize: 10 }}>{row.pts}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 6, paddingTop: 6, borderTop: '1px solid #eee' }}>
                  <span style={{ color: '#aaa', fontSize: 10 }}>Falta intervalo (0, 1/e)</span>
                  <span style={{ fontFamily: M, color: '#aaa', fontSize: 10 }}>−1,2</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </RevealOnScroll>

      {/* ── Block 4: Prueba social (dark) ────────────────────────────────────── */}
      <RevealOnScroll as="div">
      <div className="v4c-block v4c-dark" style={{ background: '#111' }}>
        <div className="v4c-copy">
          <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 20, display: 'block' }}>Resultados</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4vw, 52px)', letterSpacing: '.01em', color: '#fff', lineHeight: .95, marginBottom: 20 }}>
            Los que lo usaron.
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(255,255,255,.5)', maxWidth: '44ch' }}>
            Estudiantes de 2º de bachillerato de Madrid y Cataluña preparando la PAU de 2024.
          </p>
        </div>
        <div className="v4c-data" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {TESTIMONIALS.map((t, i) => (
            <div key={t.name} style={{ paddingBottom: 24, paddingTop: i > 0 ? 24 : 0, borderBottom: i < TESTIMONIALS.length - 1 ? '1px solid rgba(255,255,255,.08)' : 'none' }}>
              <p style={{ fontSize: 14, lineHeight: 1.75, color: 'rgba(255,255,255,.8)', fontWeight: 300, marginBottom: 14 }}>
                &ldquo;{t.quote}&rdquo;
              </p>
              <p style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.35)', letterSpacing: '.06em' }}>
                <strong style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.75)', display: 'block', letterSpacing: 0, marginBottom: 2 }}>
                  {t.name} — {t.city}
                </strong>
                {t.score} · {t.prev}
              </p>
            </div>
          ))}
        </div>
      </div>
      </RevealOnScroll>

      {/* ── Mid-page CTA strip ────────────────────────────────────────────────── */}
      <RevealOnScroll as="div">
      <div style={{ background: '#f9f9f9', padding: '48px 72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20, borderTop: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
        <p style={{ fontFamily: bebas.style.fontFamily, fontSize: 'clamp(22px, 3vw, 32px)', letterSpacing: '.01em', color: '#1c1c1c', margin: 0 }}>
          ¿Listo para subir nota este trimestre?
        </p>
        <Link
          href="#como-funciona"
          className="v4c-mid-cta"
          style={{ padding: '12px 28px', border: '1px solid #1c1c1c', borderRadius: 999, fontFamily: dmMono.style.fontFamily, fontSize: 11, color: '#1c1c1c', textDecoration: 'none', letterSpacing: '.08em', textTransform: 'uppercase', transition: 'background 140ms, color 140ms' }}
        >
          Empieza gratis →
        </Link>
      </div>
      </RevealOnScroll>

      {/* ── Comparison table (light, full-width) ─────────────────────────────── */}
      <RevealOnScroll as="div">
      <section data-theme="light" className="v4c-full" style={{ background: '#f9f9f9' }}>
        <div className="v4c-full-inner">
          <span style={{ fontFamily: M, fontSize: 10, color: '#999', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 16, display: 'block' }}>Por qué Kairo</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4vw, 52px)', letterSpacing: '.01em', color: '#1c1c1c', lineHeight: .95, marginBottom: 40 }}>
            Kairo vs cómo estudias ahora.
          </h2>
          <div className="v4c-cmp-grid">
            {/* Header */}
            <div className="v4c-cmp-head" style={{ display: 'contents' }}>
              <div style={{ padding: '10px 0 10px', borderBottom: '2px solid #e0e0e0' }} />
              <div style={{ padding: '10px 0 10px', borderBottom: '2px solid #e0e0e0', fontFamily: M, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1c1c1c', justifyContent: 'center' }}>Kairo</div>
              <div style={{ padding: '10px 0 10px', borderBottom: '2px solid #e0e0e0', fontFamily: M, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#999', justifyContent: 'center' }}>Academia</div>
              <div style={{ padding: '10px 0 10px', borderBottom: '2px solid #e0e0e0', fontFamily: M, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#999', justifyContent: 'center' }}>Por tu cuenta</div>
            </div>
            {/* Rows */}
            {COMPARE_ROWS.map((row, i) => (
              <div key={i} className="v4c-cmp-row">
                <div style={{ fontSize: 13, color: '#1c1c1c', paddingRight: 16, borderBottom: i < COMPARE_ROWS.length - 1 ? '1px solid #e0e0e0' : 'none', padding: '14px 16px 14px 0' }}>
                  {row.label}
                </div>
                {(['kairo', 'academia', 'solo'] as const).map((col) => {
                  const val = row[col]
                  return (
                    <div key={col} style={{ justifyContent: 'center', borderBottom: i < COMPARE_ROWS.length - 1 ? '1px solid #e0e0e0' : 'none', padding: '14px 0' }}>
                      {typeof val === 'string'
                        ? <span style={{ fontFamily: M, fontSize: 11, color: col === 'kairo' ? '#1c1c1c' : '#999' }}>{val}</span>
                        : val
                          ? <Check size={14} style={{ color: '#1c1c1c', opacity: col === 'kairo' ? 1 : 0.4 }} />
                          : <X size={13} style={{ color: '#ddd' }} />
                      }
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
      </RevealOnScroll>

      {/* ── Subjects (dark, full-width) ──────────────────────────────────────── */}
      <RevealOnScroll as="div">
      <section className="v4c-full" style={{ background: '#111' }}>
        <div className="v4c-full-inner">
          <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 16, display: 'block' }}>Asignaturas</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4vw, 52px)', letterSpacing: '.01em', color: '#fff', lineHeight: .95, marginBottom: 32 }}>
            Las materias de la EBAU.
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {SUBJECTS.map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', border: '1px solid rgba(255,255,255,.1)', background: s.ready ? 'rgba(255,255,255,.06)' : 'transparent' }}>
                <span style={{ fontSize: 13, color: s.ready ? '#fff' : 'rgba(255,255,255,.35)' }}>{s.label}</span>
                <span style={{ fontFamily: M, fontSize: 9, color: s.ready ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.2)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  {s.ready ? '● Disponible' : '○ Pronto'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
      </RevealOnScroll>

      {/* ── Pricing (dark full-width) ─────────────────────────────────────────── */}
      <PricingSectionTracker>
      <RevealOnScroll as="div">
      <div data-testid="landing-pricing" style={{ background: '#111', padding: '80px 72px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(147,197,253,.75)', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 14, display: 'block' }}>Planes claros</span>
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 5vw, 60px)', letterSpacing: '.01em', color: '#fff', lineHeight: .95, marginBottom: 14 }}>Elige cuánto acompañamiento necesitas.</h2>
          <p style={{ maxWidth: 610, color: 'rgba(255,255,255,.5)', fontSize: 14, lineHeight: 1.65, marginBottom: 42 }}>Primero el valor, después los límites. Premium es la opción completa para el curso; Free te deja probar Kairo y Curso PAU evita la renovación mensual.</p>
          <div className="v4c-p-cols">
            {PLANS.map((plan) => (
              <div data-testid={`landing-pricing-card-${plan.id}`} key={plan.id} className={`v4c-p-col${plan.highlighted ? ' v4c-p-col--featured' : ''}`}>
                {plan.highlighted && (
                  <p style={{ fontFamily: M, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.8)', letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 10 }}>
                    ● Recomendado
                  </p>
                )}
                <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 14, display: 'block' }}>{plan.name}</span>
                <h3 className="v4c-p-value" style={{ fontSize: 20, color: '#fff', lineHeight: 1.2, letterSpacing: '-.02em', marginBottom: 18 }}>{plan.valueProposition}</h3>
                <p style={{ fontFamily: B, fontSize: 52, color: '#fff', letterSpacing: '.01em', lineHeight: 1, marginBottom: 2 }}>{plan.priceDisplay}</p>
                <span style={{ fontFamily: M, fontSize: 9, color: 'rgba(255,255,255,.48)', marginBottom: 24, display: 'block' }}>{plan.periodDisplay}</span>
                <div style={{ height: 1, background: 'rgba(255,255,255,.08)', marginBottom: 18 }} />
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, padding: 0, flex: 1 }}>
                  {plan.highlights.slice(0, 5).map((b) => (
                    <li key={b} style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', lineHeight: 1.4, paddingLeft: 10, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0, color: 'rgba(255,255,255,.18)', fontSize: 10 }}>—</span>
                      {b}
                    </li>
                  ))}
                </ul>
                <PricingPlanCta planId={plan.id} isFree={plan.id === 'free'} cta={plan.ctaLabel} checkoutPlan={plan.checkoutPlanId ?? undefined} />
              </div>
            ))}
          </div>
          <p style={{ marginTop: 32, fontFamily: M, fontSize: 9, color: 'rgba(255,255,255,.2)', letterSpacing: '.06em' }}>
            IVA incluido. Los límites se reinician al comenzar cada mes.{' '}
            <Link href="/precios" style={{ color: 'rgba(255,255,255,.45)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              Comparar planes y condiciones →
            </Link>
          </p>
        </div>
      </div>
      </RevealOnScroll>
      </PricingSectionTracker>

      {/* ── CTA split block ───────────────────────────────────────────────────── */}
      <RevealOnScroll as="div">
      <div className="v4c-cta-split">
        <div data-theme="light" className="v4c-cta-left">
          <h2 style={{ fontFamily: B, fontSize: 'clamp(36px, 4.5vw, 60px)', letterSpacing: '.01em', color: '#1c1c1c', lineHeight: .95, marginBottom: 16 }}>
            Sin academia.<br />Sin horario.<br />Sin excusas.
          </h2>
          <p style={{ fontSize: 14, color: '#5a5a5a', maxWidth: '34ch', lineHeight: 1.7 }}>
            Empieza gratis, sin tarjeta. Cancela cuando quieras si pasas a Premium.
          </p>
        </div>
        <div className="v4c-cta-right">
          <BottomCta />
        </div>
      </div>
      </RevealOnScroll>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#111', padding: '32px 72px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, borderTop: '1px solid rgba(255,255,255,.07)' }}>
        <Link href="/" aria-label="Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kairo-logo-white.png" alt="Kairo" loading="lazy" decoding="async" style={{ height: 28, width: 'auto', display: 'block' }} />
        </Link>
        <ul style={{ display: 'flex', gap: 20, listStyle: 'none', flexWrap: 'wrap', padding: 0, margin: 0 }}>
          {[
            { label: 'Exámenes',   href: '/examenes'          },
            { label: 'Camino PAU', href: '/camino'            },
            { label: 'Simulacros', href: '/simulacros'        },
            { label: 'Precios',    href: '/precios'           },
            { label: 'Ayuda',      href: '/ayuda'             },
            { label: 'Contacto',   href: '/contacto'          },
            { label: 'Privacidad',  href: '/legal/privacidad'   },
            { label: 'Términos',    href: '/legal/terminos'     },
            { label: 'Aviso legal', href: '/legal/aviso-legal'  },
          ].map(({ label, href }) => (
            <li key={label}>
              <Link href={href} className="v4c-footer-link" style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.3)', textDecoration: 'none', letterSpacing: '.06em', textTransform: 'uppercase', transition: 'color 140ms' }}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <span style={{ fontFamily: M, fontSize: 10, color: 'rgba(255,255,255,.18)' }}>© 2026 KAIRO · Beta privada · Madrid y Cataluña</span>
      </footer>

      {/* ── Nav scroll script ────────────────────────────────────────────────── */}
      <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var nav = document.getElementById('v4c-nav');
  if (!nav) return;
  var NAV_H = 54;
  function check() {
    var els = document.querySelectorAll('[data-theme="light"]');
    var onLight = false;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.top < NAV_H && r.bottom > 0) { onLight = true; break; }
    }
    nav.classList.toggle('v4c-on-light', onLight);
  }
  window.addEventListener('scroll', check, { passive: true });
  check();
})();
      `}} />

      <StickyMobileCta />

    </div>
    </LandingAuthProvider>
  )
}
