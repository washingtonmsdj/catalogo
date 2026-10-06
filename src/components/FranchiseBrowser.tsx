import { useEffect, useMemo, useRef, useState } from 'react'
import { models as demoModels } from '../data/mockCatalog'
import { listCatalogFranchises, type CatalogRuntimeMode } from '../services/catalogApi'
import type { CatalogCategory, CatalogFranchise } from '../types/catalog'

const DISCOVERY_LIMIT = 48
const SEARCH_MIN_LENGTH = 3
const numberFormatter = new Intl.NumberFormat('pt-BR')

type Props = {
  open: boolean
  mode: CatalogRuntimeMode
  categories: CatalogCategory[]
  activeCategory: string
  onClose: () => void
  onSelectCategory: (category: string) => void
  onSelectFranchise: (category: string, franchise: string) => void
}

function demoFranchises(category: string, query: string): CatalogFranchise[] {
  const needle = query.trim().toLocaleLowerCase('pt-BR')
  const scoped = category === 'all' ? demoModels : demoModels.filter((model) => model.category === category)
  const grouped = new Map<string, CatalogFranchise>()

  for (const model of scoped) {
    const id = model.franchise
    const existing = grouped.get(id)
    if (existing) existing.count += 1
    else grouped.set(id, { id, label: model.franchise, count: 1, category: model.category })
  }

  return [...grouped.values()]
    .filter((item) => !needle || item.label.toLocaleLowerCase('pt-BR').includes(needle))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, DISCOVERY_LIMIT)
}

export function FranchiseBrowser({
  open,
  mode,
  categories,
  activeCategory,
  onClose,
  onSelectCategory,
  onSelectFranchise,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState(activeCategory)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CatalogFranchise[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    if (!open) return
    setCategory(activeCategory)
    setQuery('')
    setError('')
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, activeCategory])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const demoItems = useMemo(() => demoFranchises(category, query), [category, query])
  const queryLength = Array.from(query.trim()).length
  const searchPending = mode === 'live' && queryLength > 0 && queryLength < SEARCH_MIN_LENGTH

  useEffect(() => {
    if (!open || mode !== 'live') return
    if (queryLength > 0 && queryLength < SEARCH_MIN_LENGTH) {
      setLoading(false)
      setError('')
      setItems([])
      setTruncated(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      listCatalogFranchises(category, DISCOVERY_LIMIT, query.trim() || undefined)
        .then((page) => {
          if (cancelled) return
          setItems(page.items)
          setTruncated(page.truncated)
        })
        .catch(() => {
          if (cancelled) return
          setItems([])
          setTruncated(false)
          setError('Não foi possível carregar as franquias agora.')
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, query.trim() ? 220 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, mode, category, query, queryLength])

  if (!open) return null

  const needle = query.trim().toLocaleLowerCase('pt-BR')
  const visible = mode === 'live'
    ? items.filter((item) => !needle || item.label.toLocaleLowerCase('pt-BR').includes(needle))
    : demoItems
  const selectedCategoryLabel = categories.find((item) => item.id === category)?.label ?? 'Todos'

  function chooseCategory(next: string) {
    setCategory(next)
    setQuery('')
  }

  function chooseFranchise(item: CatalogFranchise) {
    onSelectFranchise(item.category, item.id)
    onClose()
  }

  function showCategory() {
    onSelectCategory(category)
    onClose()
  }

  return (
    <div className="modal-backdrop explorer-backdrop" onMouseDown={onClose}>
      <section className="explorer-modal" role="dialog" aria-modal="true" aria-labelledby="explorer-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head explorer-head">
          <div>
            <span>NAVEGADOR DO ACERVO</span>
            <h2 id="explorer-title">Explorar franquias</h2>
            <p>Escolha uma categoria e encontre rapidamente uma coleção sem percorrer milhares de modelos.</p>
          </div>
          <button type="button" aria-label="Fechar navegador" onClick={onClose}>×</button>
        </div>

        <div className="explorer-toolbar">
          <label className={`explorer-search ${searchPending ? 'is-pending' : ''}`}>
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar franquia, série ou universo..."
              aria-label="Buscar franquias"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca">×</button>}
          </label>
          <button type="button" className="explorer-category-action" onClick={showCategory}>
            Ver todos em {selectedCategoryLabel} <span>›</span>
          </button>
        </div>

        <div className="explorer-categories" aria-label="Categorias do navegador">
          {categories.map((item) => (
            <button
              type="button"
              key={item.id}
              className={category === item.id ? 'is-active' : ''}
              aria-pressed={category === item.id}
              onClick={() => chooseCategory(item.id)}
            >
              <span>{item.label}</span>
              <strong>{numberFormatter.format(item.count)}</strong>
            </button>
          ))}
        </div>

        <div className="explorer-results" aria-busy={loading}>
          <div className="explorer-results__head">
            <div>
              <span>{selectedCategoryLabel}</span>
              <strong>{searchPending ? `Digite ${SEARCH_MIN_LENGTH}+ caracteres` : query.trim() ? `Resultados para “${query.trim()}”` : 'Franquias em destaque'}</strong>
            </div>
            <small>{loading ? 'Carregando…' : searchPending ? 'Busca indexada' : `${visible.length} exibidas`}</small>
          </div>

          {error && <p className="runtime-alert" role="alert">{error}</p>}

          {searchPending ? (
            <div className="explorer-empty explorer-empty--hint">
              <span>⌕</span>
              <strong>Continue digitando</strong>
              <p>Use pelo menos {SEARCH_MIN_LENGTH} caracteres para pesquisar rapidamente em todas as franquias.</p>
            </div>
          ) : !loading && !error && visible.length === 0 ? (
            <div className="explorer-empty">
              <span>⌕</span>
              <strong>Nenhuma franquia encontrada</strong>
              <p>Tente outro termo ou volte para “Todos”.</p>
              <button type="button" onClick={() => { setQuery(''); setCategory('all') }}>Limpar recorte</button>
            </div>
          ) : (
            <div className="explorer-grid">
              {visible.map((item, index) => (
                <button type="button" key={`${item.category}:${item.id}`} onClick={() => chooseFranchise(item)}>
                  <span className="explorer-grid__rank">{String(index + 1).padStart(2, '0')}</span>
                  <span className="explorer-grid__body">
                    <strong>{item.label}</strong>
                    <small>{categories.find((entry) => entry.id === item.category)?.label ?? item.category}</small>
                  </span>
                  <span className="explorer-grid__count">
                    <strong>{numberFormatter.format(item.count)}</strong>
                    <small>modelos</small>
                  </span>
                  <span className="explorer-grid__arrow">›</span>
                </button>
              ))}
            </div>
          )}

          {truncated && !loading && !searchPending && (
            <div className="explorer-more">Mostrando as {DISCOVERY_LIMIT} franquias de maior volume neste recorte. Refine a busca para localizar outras coleções.</div>
          )}
        </div>
      </section>
    </div>
  )
}
