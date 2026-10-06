import { useEffect, useMemo, useState } from 'react'
import type { KnownModelSummary } from '../services/knownModelCache'

type Props = {
  open: boolean
  ids: string[]
  knownModels: Record<string, KnownModelSummary>
  onClose: () => void
  onOpenModel: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
  onAddAllToQuote: () => void
}

export function FavoritesDialog({
  open,
  ids,
  knownModels,
  onClose,
  onOpenModel,
  onRemove,
  onClear,
  onAddAllToQuote,
}: Props) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const visibleIds = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR')
    if (!needle) return ids
    return ids.filter((id) => {
      const known = knownModels[id]
      return `${known?.name ?? ''} ${known?.slug ?? ''} ${id}`.toLocaleLowerCase('pt-BR').includes(needle)
    })
  }, [ids, knownModels, query])

  if (!open) return null

  return (
    <div className="modal-backdrop favorites-backdrop" onMouseDown={onClose}>
      <section
        className="favorites-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorites-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head favorites-head">
          <div>
            <span>COLEÇÃO PESSOAL</span>
            <h2 id="favorites-title">Favoritos</h2>
            <p>{ids.length ? `${ids.length} modelo${ids.length === 1 ? '' : 's'} salvo${ids.length === 1 ? '' : 's'} neste navegador.` : 'Nenhum modelo favoritado ainda.'}</p>
          </div>
          <button type="button" aria-label="Fechar favoritos" onClick={onClose}>×</button>
        </div>

        {!ids.length ? (
          <div className="favorites-empty">
            <strong>LISTA VAZIA</strong>
            <p>Use “♡ Favoritar” nos modelos que quiser guardar para consultar depois.</p>
            <button type="button" onClick={onClose}>Voltar ao catálogo</button>
          </div>
        ) : (
          <>
            <div className="favorites-toolbar">
              <label>
                <span>Buscar nos favoritos</span>
                <div>
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nome do modelo..."
                    aria-label="Buscar nos favoritos"
                  />
                  {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca">×</button>}
                </div>
              </label>
              <strong>{visibleIds.length}/{ids.length}</strong>
            </div>

            <div className="favorites-list" aria-live="polite">
              {visibleIds.map((id, index) => {
                const known = knownModels[id]
                const canOpen = Boolean(known?.slug)
                return (
                  <article key={id}>
                    <span className="favorites-list__index">{String(index + 1).padStart(2, '0')}</span>
                    <button
                      type="button"
                      className="favorites-list__open"
                      disabled={!canOpen}
                      onClick={() => onOpenModel(id)}
                    >
                      <strong>{known?.name ?? 'Modelo salvo'}</strong>
                      <small>{canOpen ? 'Abrir ficha do modelo' : 'Ficha temporariamente indisponível'}</small>
                    </button>
                    <button
                      type="button"
                      className="favorites-list__remove"
                      aria-label={`Remover ${known?.name ?? id} dos favoritos`}
                      onClick={() => onRemove(id)}
                    >
                      ×
                    </button>
                  </article>
                )
              })}
              {!visibleIds.length && (
                <div className="favorites-no-results">
                  <strong>Nenhum favorito encontrado</strong>
                  <span>Tente outro nome ou limpe a busca.</span>
                  <button type="button" onClick={() => setQuery('')}>Limpar busca</button>
                </div>
              )}
            </div>

            <footer className="favorites-footer">
              <div>
                <strong>{ids.length} salvo{ids.length === 1 ? '' : 's'}</strong>
                <span>Favoritos ficam apenas neste navegador.</span>
              </div>
              <div>
                <button type="button" className="share-action" onClick={onClear}>Limpar favoritos</button>
                <button type="button" className="primary-action" onClick={onAddAllToQuote}>
                  Adicionar ao orçamento <span>›</span>
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
