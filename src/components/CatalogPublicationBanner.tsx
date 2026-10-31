type CategoryCount = { id: string; count: number }

type CatalogPublicationBannerProps = {
  mode: 'live' | 'demo'
  apiHealthy: boolean
  loading: boolean
  categories: CategoryCount[]
}

function catalogTotal(items: CategoryCount[]) {
  const all = items.find((item) => item.id === 'all')
  if (all) return Number(all.count) || 0
  return items.reduce((total, item) => total + (Number(item.count) || 0), 0)
}

/**
 * The canonical runtime fetches categories. Never poll health or categories here:
 * the old banner duplicated D1 queries for each visitor every minute.
 */
export function CatalogPublicationBanner({ mode, apiHealthy, loading, categories }: CatalogPublicationBannerProps) {
  if (mode !== 'live' || loading || !apiHealthy || catalogTotal(categories) > 0) return null

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
