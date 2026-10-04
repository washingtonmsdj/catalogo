import { BRAND_NAME } from '../config/brand'
import type { CatalogModel, ModelRouteStatus } from '../types/catalog'

type ModelDetailDialogProps = {
  open: boolean
  routeStatus: ModelRouteStatus
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
  routeStatus,
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
  if (!open) return null

  if (routeStatus !== 'ready' || model.id === 'loading') {
    const state = routeStatus === 'not_found'
      ? {
          eyebrow: 'LINK NÃO ENCONTRADO',
          title: 'Modelo não encontrado',
          description: 'Este endereço não corresponde a um modelo publicado. O catálogo foi preservado e nenhum outro item foi aberto no lugar dele.',
        }
      : routeStatus === 'error'
        ? {
            eyebrow: 'FALHA AO ABRIR',
            title: 'Não foi possível carregar o modelo',
            description: 'A API não conseguiu confirmar este modelo agora. Feche o detalhe e tente novamente sem perder o ponto atual do catálogo.',
          }
        : {
            eyebrow: 'ABRINDO MODELO',
            title: 'Carregando detalhe',
            description: 'Validando o link e buscando os dados publicados do modelo.',
          }

    return (
      <div className="model-detail-backdrop" onMouseDown={onClose}>
        <section
          className="model-detail-sheet model-detail-sheet--route-state"
          role="dialog"
          aria-modal="true"
          aria-labelledby="model-detail-route-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="model-detail-head">
            <div>
              <span>DETALHE DO MODELO</span>
              <strong>LINK DIRETO</strong>
            </div>
            <button type="button" aria-label="Fechar detalhe do modelo" onClick={onClose}>×</button>
          </header>
          <div className="model-detail-route-state" aria-live="polite">
            <span>{state.eyebrow}</span>
            <h2 id="model-detail-route-title">{state.title}</h2>
            <p>{state.description}</p>
            {routeStatus !== 'loading' && <button type="button" onClick={onClose}>Voltar ao catálogo</button>}
          </div>
        </section>
      </div>
    )
  }

  const path = readablePath(model)
  const supportingStat = model.heightCm > 0
    ? { value: `${model.heightCm} cm`, label: 'altura' }
    : model.material.trim()
      ? { value: model.material, label: 'material' }
      : model.collection.trim()
        ? { value: model.collection, label: 'coleção' }
        : { value: model.franchise || 'Catálogo', label: 'franquia' }

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
            <strong>{model.franchise || BRAND_NAME}</strong>
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
            <div><strong>{categoryLabel || 'Catálogo'}</strong><span>categoria</span></div>
            <div><strong>{supportingStat.value}</strong><span>{supportingStat.label}</span></div>
          </div>

          <p className="model-detail-description">
            {model.description || `Modelo disponível no catálogo ${BRAND_NAME}. Consulte a galeria para ver as imagens cadastradas e adicione à sua lista para solicitar informações.`}
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
