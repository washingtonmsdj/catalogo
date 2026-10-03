import { useEffect, useState } from 'react'
import { checkCatalogApi, getCatalogRuntimeMode, listCatalogCategories } from '../services/catalogApi'

type PublicationState = 'checking' | 'ready' | 'publishing' | 'unavailable'

function catalogTotal(items: Array<{ id: string; count: number }>) {
  const all = items.find((item) => item.id === 'all')
  if (all) return Number(all.count) || 0
  return items.reduce((total, item) => total + (Number(item.count) || 0), 0)
}

export function CatalogPublicationBanner() {
  const [state, setState] = useState<PublicationState>('checking')

  useEffect(() => {
    if (getCatalogRuntimeMode() !== 'live') {
      setState('ready')
      return
    }

    let cancelled = false
    async function refresh() {
      try {
        const [health, categories] = await Promise.all([checkCatalogApi(), listCatalogCategories()])
        if (cancelled) return
        if (!health.ok) {
          setState('unavailable')
          return
        }
        setState(catalogTotal(categories) > 0 ? 'ready' : 'publishing')
      } catch {
        if (!cancelled) setState('unavailable')
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  if (state !== 'publishing') return null

  return (
    <div className="catalog-publication-banner" role="status" aria-live="polite">
      <span className="catalog-publication-banner__pulse" aria-hidden="true" />
      <div>
        <strong>Publicação do acervo em andamento</strong>
        <p>A infraestrutura já está online. Os modelos e imagens estão sendo publicados de forma validada e aparecerão aqui assim que o lote estiver completo.</p>
      </div>
    </div>
  )
}
