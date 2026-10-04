import { useEffect, useState } from 'react'
import { listRecentCatalogModels, type CatalogRuntimeMode } from '../services/catalogApi'
import type { CatalogModelCard } from '../services/catalogRepository'

type KnownModelSummary = {
  name: string
  slug: string
}

type CatalogUpdatesDialogProps = {
  open: boolean
  mode: CatalogRuntimeMode
  viewedIds: string[]
  knownModels: Record<string, KnownModelSummary>
  onClose: () => void
  onOpenRecentModel: (model: CatalogModelCard) => void
  onOpenViewedModel: (id: string) => void
  onClearViewed: () => void
}

const formatter = new Intl.NumberFormat('pt-BR')
const RECENT_LIMIT = 12

export function CatalogUpdatesDialog({
  open,
  mode,
  viewedIds,
  knownModels,
  onClose,
  onOpenRecentModel,
  onOpenViewedModel,
  onClearViewed,
}: CatalogUpdatesDialogProps) {
  const [tab, setTab] = useState<'new' | 'viewed'>('new')
  const [items, setItems] = useState<CatalogModelCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setTab('new')
      return
    }
    if (mode !== 'live') {
      setItems([])
      setError('')
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    listRecentCatalogModels(RECENT_LIMIT)
      .then((models) => {
        if (!cancelled) setItems(models)
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          setError('Não foi possível carregar os modelos adicionados recentemente.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, mode])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="quote-modal catalog-updates-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-updates-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span>ATUALIZAÇÕES DO CATÁLOGO</span>
            <h2 id="catalog-updates-title">Descobrir modelos</h2>
            <p>Veja o que entrou no acervo ou retome modelos que você abriu neste navegador.</p>
          </div>
          <button type="button" aria-label="Fechar atualizações" onClick={onClose}>×</button>
        </div>

        <div className="catalog-updates-tabs" role="tablist" aria-label="Atualizações do catálogo">
          <button type="button" role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'is-active' : ''} onClick={() => setTab('new')}>
            Recém adicionados
          </button>
          <button type="button" role="tab" aria-selected={tab === 'viewed'} className={tab === 'viewed' ? 'is-active' : ''} onClick={() => setTab('viewed')}>
            Vistos recentemente <b>{viewedIds.length}</b>
          </button>
        </div>

        {tab === 'new' ? (
          <div className="catalog-updates-panel" role="tabpanel">
            {mode !== 'live' && <div className="catalog-updates-empty"><strong>PRÉVIA LOCAL</strong><span>A lista de novos modelos usa a data de publicação do catálogo online.</span></div>}
            {error && <p className="catalog-updates-error" role="alert">{error}</p>}
            {loading && <div className="catalog-updates-empty"><strong>CARREGANDO</strong><span>Buscando as últimas entradas publicadas...</span></div>}
            {!loading && mode === 'live' && !error && items.length === 0 && <div className="catalog-updates-empty"><strong>SEM NOVIDADES</strong><span>Nenhum modelo publicado foi encontrado.</span></div>}
            {!loading && items.length > 0 && (
              <div className="catalog-updates-grid">
                {items.map((model, index) => (
                  <button type="button" key={model.id} className="catalog-update-card" onClick={() => onOpenRecentModel(model)}>
                    <span className="catalog-update-card__media">
                      {model.coverUrl
                        ? <img src={model.coverUrl} alt="" loading={index < 4 ? 'eager' : 'lazy'} decoding="async" />
                        : <span>{model.name.slice(0, 1)}</span>}
                    </span>
                    <span className="catalog-update-card__copy">
                      <small>{model.franchise || 'Catálogo'}</small>
                      <strong>{model.name}</strong>
                      <em>{formatter.format(model.galleryCount)} {model.galleryCount === 1 ? 'imagem' : 'imagens'} · {model.code}</em>
                    </span>
                    <span className="catalog-update-card__arrow">›</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="catalog-updates-panel" role="tabpanel">
            {viewedIds.length ? (
              <>
                <div className="catalog-viewed-list">
                  {viewedIds.map((id, index) => (
                    <button type="button" key={id} disabled={!knownModels[id]?.slug} onClick={() => onOpenViewedModel(id)}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{knownModels[id]?.name ?? id}</strong>
                      <small>abrir modelo ›</small>
                    </button>
                  ))}
                </div>
                <div className="catalog-updates-footer">
                  <span>Histórico salvo somente neste navegador.</span>
                  <button type="button" onClick={onClearViewed}>Limpar histórico</button>
                </div>
              </>
            ) : (
              <div className="catalog-updates-empty">
                <strong>NENHUM MODELO VISTO</strong>
                <span>Os modelos que você abrir aparecerão aqui para acesso rápido.</span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
