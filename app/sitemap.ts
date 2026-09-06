import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://kairo-pau.com'

// Solo rutas públicas e indexables. Las rutas de producto (/camino, /zona,
// /simulacros, /settings, /onboarding) quedan fuera a propósito: requieren
// sesión y no aportan nada en resultados de búsqueda.
const ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '',                   priority: 1.0, changeFrequency: 'weekly'  },
  { path: '/precios',           priority: 0.9, changeFrequency: 'monthly' },
  { path: '/ayuda',             priority: 0.7, changeFrequency: 'monthly' },
  { path: '/contacto',          priority: 0.6, changeFrequency: 'yearly'  },
  { path: '/waitlist',          priority: 0.9, changeFrequency: 'weekly'  },
  { path: '/legal/terminos',    priority: 0.3, changeFrequency: 'yearly'  },
  { path: '/legal/privacidad',  priority: 0.3, changeFrequency: 'yearly'  },
  { path: '/legal/aviso-legal', priority: 0.3, changeFrequency: 'yearly'  },
  { path: '/legal/reembolsos',  priority: 0.3, changeFrequency: 'yearly'  },
  { path: '/legal/ia',          priority: 0.3, changeFrequency: 'yearly'  },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }))
}
