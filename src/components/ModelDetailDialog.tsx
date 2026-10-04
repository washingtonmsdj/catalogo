import type { CatalogModel } from '../types/catalog'

type ModelDetailDialogProps = {
  open: boolean
  model: CatalogModel
  categoryLabel: string
  favorite: boolean
  compared: boolean
  quoted: boolean
  onClose: () => void
  onOpenGallery: () => void
  onToggleFavorite: () => void
  onToggleCompare: () => void
  onToggleQuote: () => void
}

function readablePath(model: CatalogModel) {
  return model.folderPath || model.collection || ''
}

export function ModelDetailDialog({
  open,
  model,
  categoryLabel,
  favorite,
  compared,
  quoted,
  onClose,
  onOpenGallery,
  onToggleFavorite,
  onToggleCompare,
  onToggleQuote,
}: ModelDetailDialogProps) {
  if (!open || model.id === 'loading') return null

  const path = readablePath(model)

  return (
    <div className="model-detail-backdrop" onMouseDown={onClose}>
      <section
        className="model-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="model-detail-head">
          <div>
            <span>DETALHE DO MODELO</span>
            <strong>{model.code}</strong>
          </div>
          <button type="button" aria-label="Fechar detalhe do modelo" onClick={onClose}>×</button>
        </header>

        <div className="model-detail-media">
          {model.coverUrl
            ? <img src={model.coverUrl} alt={model.name} decoding="async" fetchPriority="high" />
            : <span className="model-detail-media__fallback">{model.name.slice(0, 1)}</span>}
          <span className="model-detail-media__shade" />
          <div className="model-detail-media__meta">
            <span>{categoryLabel || 'Catálogo'}</span>
            <strong>{model.franchise || 'Tonecos Studios'}</strong>
          </div>
        </div>

        <div className="model-detail-body">
          <div className="model-detail-title">
            <span>{model.franchise || categoryLabel || 'Catálogo'}</span>
            <h2 id="model-detail-title">{model.name}</h2>
            {path && <p>{path}</p>}
          </div>

          <div className="model-detail-stats" aria-label="Informações do modelo">
            <div><strong>{model.galleryCount || 1}</strong><span>{model.galleryCount === 1 ? 'imagem' : 'imagens'}</span></div>
            <div><strong>{model.material || 'Sob consulta'}</strong><span>material</span></div>
            <div><strong>{model.heightCm > 0 ? `${model.heightCm} cm` : 'Sob consulta'}</strong><span>altura</span></div>
          </div>

          <p className="model-detail-description">
            {model.description || 'Modelo disponível no catálogo Tonecos Studios. Consulte a galeria para ver as imagens cadastradas e adicione à sua lista para solicitar informações.'}
          </p>

          <div className="model-detail-actions">
            <button type="button" className="model-detail-primary" onClick={onOpenGallery}>
              Ver galeria <span>›</span>
            </button>
            <button type="button" className={favorite ? 'is-active' : ''} aria-pressed={favorite} onClick={onToggleFavorite}>
              {favorite ? '♥ Favoritado' : '♡ Favoritar'}
            </button>
            <button type="button" className={compared ? 'is-active' : ''} aria-pressed={compared} onClick={onToggleCompare}>
              {compared ? '✓ Comparando' : 'Comparar'}
            </button>
            <button type="button" className={quoted ? 'is-active' : ''} aria-pressed={quoted} onClick={onToggleQuote}>
              {quoted ? '✓ Na minha lista' : '+ Minha lista'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
