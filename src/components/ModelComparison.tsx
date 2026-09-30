import { useEffect, useMemo, useState } from 'react'
import { models as demoModels } from '../data/mockCatalog'
import { getCatalogModel } from '../services/catalogApi'
import type { CatalogModel } from '../types/catalog'

export type ComparisonKnownModel = {
  name: string
  slug: string
}

type Props = {
  open: boolean
  mode: 'demo' | 'live'
  ids: string[]
  knownModels: Record<string, ComparisonKnownModel>
  onClose: () => void
  onRemove: (id: string) => void
  onClear: () => void
  onOpenModel: (id: string) => void
  onAddToQuote: (ids: string[]) => void
}

function valueOrFallback(value: string | number | null | undefined, fallback = 'Sob consulta') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

export function ModelComparison({ open, mode, ids, knownModels, onClose, onRemove, onClear, onOpenModel, onAddToQuote }: Props) {
  const [models, setModels] = useState<CatalogModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError('')

    if (!ids.length) {
      setModels([])
      setLoading(false)
      return
    }

    if (mode === 'demo') {
      const byId = new Map(demoModels.map((model) => [model.id, model]))
      setModels(ids.map((id) => byId.get(id)).filter((model): model is CatalogModel => Boolean(model)))
      setLoading(false)
      return
    }

    setLoading(true)
    Promise.all(ids.map(async (id) => {
      const slug = knownModels[id]?.slug
      if (!slug) return null
      try {
        return await getCatalogModel(slug)
      } catch {
        return null
      }
    })).then((items) => {
      if (cancelled) return
      const loaded = items.filter((model): model is CatalogModel => Boolean(model))
      setModels(loaded)
      if (loaded.length !== ids.length) setError('Alguns modelos não puderam ser carregados agora. A seleção foi preservada.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [open, mode, ids, knownModels])

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  if (!open) return null

  return (
    <div className="modal-backdrop comparison-backdrop" onMouseDown={onClose}>
      <section className="comparison-modal" role="dialog" aria-modal="true" aria-labelledby="comparison-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head comparison-modal__head">
          <div>
            <span>COMPARADOR DE MODELOS</span>
            <h2 id="comparison-title">Comparação lado a lado</h2>
            <p>{ids.length ? `${ids.length}/4 modelos selecionados. Compare especificações sem alterar seu orçamento.` : 'Selecione de 2 a 4 modelos para comparar.'}</p>
          </div>
          <button type="button" aria-label="Fechar comparador" onClick={onClose}>×</button>
        </div>

        {error && <p className="runtime-alert comparison-alert" role="alert">{error}</p>}
        {loading && <div className="comparison-loading" role="status">Carregando fichas dos modelos…</div>}

        {!loading && !ids.length && (
          <div className="comparison-empty">
            <strong>NENHUM MODELO NA COMPARAÇÃO</strong>
            <p>Abra um personagem e use “Comparar”. A seleção fica salva apenas neste navegador.</p>
            <button type="button" onClick={onClose}>Voltar ao catálogo</button>
          </div>
        )}

        {!loading && ids.length > 0 && (
          <>
            <div className="comparison-scroll">
              <div className="comparison-grid" style={{ '--compare-cols': Math.max(2, ids.length) } as React.CSSProperties}>
                <div className="comparison-label comparison-label--hero">Modelo</div>
                {ids.map((id) => {
                  const model = modelById.get(id)
                  const known = knownModels[id]
                  return (
                    <article className="comparison-card" key={id}>
                      <button type="button" className="comparison-remove" onClick={() => onRemove(id)} aria-label={`Remover ${model?.name ?? known?.name ?? id} da comparação`}>×</button>
                      <div className={`comparison-cover ${model?.coverUrl ? 'has-image' : ''}`}>
                        {model?.coverUrl ? <img src={model.coverUrl} alt={model.name} loading="lazy" decoding="async" /> : <span>TS</span>}
                      </div>
                      <strong>{model?.name ?? known?.name ?? 'Modelo indisponível'}</strong>
                      <small>{model?.franchise ?? 'Detalhes temporariamente indisponíveis'}</small>
                      <button type="button" className="comparison-open" disabled={!known?.slug} onClick={() => onOpenModel(id)}>Abrir ficha ↗</button>
                    </article>
                  )
                })}

                <div className="comparison-label">Franquia</div>
                {ids.map((id) => <div className="comparison-value" key={`franchise-${id}`}>{valueOrFallback(modelById.get(id)?.franchise)}</div>)}

                <div className="comparison-label">Coleção</div>
                {ids.map((id) => <div className="comparison-value" key={`collection-${id}`}>{valueOrFallback(modelById.get(id)?.collection)}</div>)}

                <div className="comparison-label">Altura aprox.</div>
                {ids.map((id) => { const height = modelById.get(id)?.heightCm; return <div className="comparison-value" key={`height-${id}`}>{height && height > 0 ? `${height} cm` : 'Sob consulta'}</div> })}

                <div className="comparison-label">Material</div>
                {ids.map((id) => <div className="comparison-value" key={`material-${id}`}>{valueOrFallback(modelById.get(id)?.material)}</div>)}

                <div className="comparison-label">Imagens</div>
                {ids.map((id) => <div className="comparison-value comparison-value--accent" key={`gallery-${id}`}>{modelById.get(id) ? `${modelById.get(id)!.galleryCount} vistas` : '—'}</div>)}

                <div className="comparison-label">Código</div>
                {ids.map((id) => <div className="comparison-value comparison-value--code" key={`code-${id}`}>{valueOrFallback(modelById.get(id)?.code, '—')}</div>)}
              </div>
            </div>

            <div className="comparison-footer">
              <div><strong>{ids.length < 2 ? 'Adicione mais um modelo para uma comparação completa.' : `${ids.length} modelos prontos para comparação.`}</strong><span>Máximo de 4 por vez para manter a leitura clara.</span></div>
              <div className="comparison-footer__actions"><button type="button" className="share-action" onClick={onClear}>Limpar</button><button type="button" className="primary-action" onClick={() => onAddToQuote(ids)}>Adicionar ao orçamento <span>›</span></button></div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
