'use client'

import Link from 'next/link'
import { Bebas_Neue, DM_Mono } from 'next/font/google'
import { useLandingAuth } from './LandingAuthState'
import ClayThemeScope from '@/components/clay/ClayThemeScope'
import ClayCard from '@/components/clay/ClayCard'
import ClayBadge from '@/components/clay/ClayBadge'
import ClayProgressBar from '@/components/clay/ClayProgressBar'
import { useClayThemePreference } from '@/components/clay/useClayThemePreference'

const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'] })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'] })
const B = bebas.style.fontFamily
const M = dmMono.style.fontFamily

const CTA_PRESS_OFFSET = 7

// El CTA del hero va blanco con texto negro, como el HeroCta original de
// LandingCta.tsx (#fff / #111), no en el acento azul del clay: sobre el fondo
// fotográfico cálido del hero el azul competía con la imagen y se despegaba
// del resto de la landing. Son colores propios de este botón en vez de un
// cambio en --clay-accent porque ese token lo comparten insignias, barras de
// progreso y el resto del rediseño clay, que sí siguen siendo azules.
const CTA_FACE = '#ffffff'
// Canto inferior de la "pieza de plastilina": gris neutro, más oscuro que la
// cara para que el relieve se lea, igual que --clay-accent-deep hace con el
// acento. Neutro y no azulado para no reintroducir color en un botón que la
// landing quiere en blanco y negro.
const CTA_EDGE = '#c4c4c4'
// Negro fijo, no --clay-on-accent: ese token está pensado para fondo de acento
// (blanco en claro, oscuro en el tema clay oscuro) y aquí la cara es siempre
// blanca, así que el texto tiene que ser siempre oscuro.
const CTA_LABEL = '#111111'
// El subtítulo "sin tarjeta" iba a --clay-on-accent con opacity .75; sobre
// blanco necesita ser un gris explícito, como el rgba(0,0,0,.45) del original.
const CTA_LABEL_MUTED = 'rgba(0, 0, 0, 0.45)'

// Piloto de claymorfismo, solo para la sección hero de la landing (ver
// components/clay/). Sustituye el CTA circular y las mini-cards de vista
// previa por versiones clay — el fondo fotográfico y el titular del hero
// (app/landing/page.tsx) no se tocan, para mantener la identidad visual
// actual del hero. No sustituye HeroCta/mini-cards originales en el código:
// convive como componente aparte que la landing usa en su lugar mientras
// dura el piloto.
// Visitante anónimo: el CTA principal del hero lleva a la waitlist del Curso
// PAU (precio early bird congelado). Con sesión activa sigue llevando al
// Camino/onboarding como hasta ahora — quien ya es alumno no debe aterrizar en
// una lista de espera. El acceso gratis no desaparece: vive justo debajo del
// círculo, en HeroFreeLink (app/landing/LandingCta.tsx).
export function ClayHeroCta() {
  const { status, href, label } = useLandingAuth()
  const { theme } = useClayThemePreference()
  const isAuthed = status === 'authed'
  const isLoading = status === 'loading'
  // Sin el brillo interior blanco que llevan el resto de piezas clay: aquí la
  // cara ya es blanca, así que no se vería. El relieve lo dan el canto sólido
  // y la sombra proyectada sobre la foto del hero.
  const restShadow = [`0 ${CTA_PRESS_OFFSET}px 0 0 ${CTA_EDGE}`, '0 18px 30px rgba(0, 0, 0, 0.32)'].join(', ')
  const pressedShadow = `0 2px 0 0 ${CTA_EDGE}`
  return (
    <ClayThemeScope theme={theme} style={{ background: 'transparent', display: 'inline-block' }}>
      <Link
        href={isLoading ? '#' : isAuthed ? href : '/waitlist'}
        aria-disabled={isLoading}
        onClick={e => { if (isLoading) e.preventDefault() }}
        className="v4c-clay-cta-circle"
        style={{
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: CTA_FACE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
          flexDirection: 'column',
          gap: 4,
          opacity: isLoading ? 0.6 : 1,
          cursor: isLoading ? 'default' : 'pointer',
          boxShadow: restShadow,
          transform: 'translateY(0)',
          transition: 'transform 90ms ease, box-shadow 90ms ease',
        }}
        onMouseDown={e => {
          e.currentTarget.style.transform = `translateY(${CTA_PRESS_OFFSET - 2}px)`
          e.currentTarget.style.boxShadow = pressedShadow
        }}
        onMouseUp={e => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = restShadow
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = restShadow
        }}
      >
        <span style={{ fontFamily: B, fontSize: 17, letterSpacing: '.06em', color: CTA_LABEL, textAlign: 'center', lineHeight: 1.1, fontWeight: isAuthed ? 700 : undefined }}>
          {isAuthed ? label : <>Reserva<br />tu plaza</>}
        </span>
        {!isAuthed && (
          <span style={{ fontFamily: M, fontSize: 9, color: CTA_LABEL_MUTED, letterSpacing: '.1em', textTransform: 'uppercase' }}>curso PAU 2027</span>
        )}
      </Link>
    </ClayThemeScope>
  )
}

export function ClayHeroMiniCards() {
  const { theme } = useClayThemePreference()
  return (
    <ClayThemeScope theme={theme} style={{ background: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, width: '100%' }}>
      <ClayCard padding={20} radius={22} style={{ width: 220, borderRadius: '22px 22px 4px 4px' }}>
        <ClayBadge tone="neutral">Examen real</ClayBadge>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--clay-text)', margin: '12px 0' }}>
          Matemáticas II · Madrid 2023<br />Bloque análisis · Ejercicio 2
        </p>
        <p style={{ fontSize: 10, color: 'var(--clay-text-muted)', lineHeight: 1.4, margin: 0 }}>
          Calcula la derivada de f(x) = x³·ln(x) y estudia su monotonía…
        </p>
      </ClayCard>
      <ClayCard padding={20} radius={22} style={{ width: 220, borderRadius: '22px 22px 4px 4px' }}>
        <ClayBadge>Corrección IA</ClayBadge>
        <p style={{ fontFamily: M, fontSize: 26, fontWeight: 700, color: 'var(--clay-text)', lineHeight: 1, margin: '12px 0 2px' }}>
          7,8<span style={{ fontSize: 14, opacity: .55 }}>/10</span>
        </p>
        <p style={{ fontFamily: M, fontSize: 9, color: 'var(--clay-text-muted)', margin: '0 0 10px' }}>resultado sintético</p>
        <ClayProgressBar value={0.78} />
        <p style={{ fontSize: 10, color: 'var(--clay-text-muted)', lineHeight: 1.4, margin: '10px 0 0' }}>
          Derivada correcta. Signo monotonía: falta el intervalo (0,1/e). −1,2 pts.
        </p>
      </ClayCard>
    </ClayThemeScope>
  )
}
