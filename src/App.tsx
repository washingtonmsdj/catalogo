import { FormEvent, useEffect, useRef, useState } from 'react'
import { TurnstileWidget, isTurnstileConfigured } from './components/TurnstileWidget'
import { useCatalogRuntime, useModelGallery } from './hooks/useCatalogRuntime'
import { submitQuoteRequest } from './services/quotes'
import type { CatalogImage, CatalogModel } from './types/catalog'

const formatter = new Intl.NumberFormat('pt-BR')
const MAX_QUOTE_ITEMS = 50

type KnownModel = {
  name: string
  slug: string
}

function initialSlugFromHash() {
  if (!window.location.hash.startsWith('#modelo=')) return ''
  try {
    return decodeURIComponent(window.location.hash.slice(8))
  } catch {
    return ''
  }
}

function ModelArt({ model, compact = false, angle = 0 }: { model: CatalogModel; compact?: boolean; angle?: number }) {
  return (
    <div className={`model-art ${compact ? 'model-art--compact' : ''}`} style={{ '--accent': model.accent } as React.CSSProperties}>
      {model.coverUrl ? (
        <img
          className="model-art__image"
          src={model.coverUrl}
          alt={model.name}
          loading={compact ? 'lazy' : 'eager'}
          decoding="async"
        />
      ) : (
        <>
          <div className="model-art__halo" />
          <div className="model-art__figure" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}>
            <span className="model-art__head" />
            <span className="model-art__shoulders" />
            <span className="model-art__torso" />
            <span className="model-art__leg model-art__leg--left" />
            <span className="model-art__leg model-art__leg--right" />
            <span className="model-art__weapon" />
          </div>
          <div className="model-art__base" />
        </>
      )}
      <div className="model-art__grain" />
    </div>
  )
}

function GalleryArt({ image, model, angle = 0 }: { image: CatalogImage; model: CatalogModel; angle?: number }) {
  if (image.url) {
    return (
      <div className="gallery-real-image">
        <img src={image.url} alt={`${model.name} — vista`} loading="lazy" decoding="async" />
      </div>
    )
  }
  return <ModelArt model={model} compact angle={angle} />
}

function loadKnownModels(): Record<string, KnownModel> {
  try {
    const stored = JSON.parse(localStorage.getItem('tonecos:known-models') ?? '{}') as Record<string, string | KnownModel>
    return Object.fromEntries(Object.entries(stored).map(([id, value]) => [
      id,
      typeof value === 'string' ? { name: value, slug: '' } : value,
    ]))
  } catch {
    return {}
  }
}

export default function App() {
  const catalog = useCatalogRuntime(initialSlugFromHash())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [favorites, setFavorites] = useState<string[]>(() => JSON.parse(localStorage.getItem('tonecos:favorites') ?? '[]'))
  const [quoteList, setQuoteList] = useState<string[]>(() => JSON.parse(localStorage.getItem('tonecos:quote') ?? '[]'))
  const [knownModels, setKnownModels] = useState<Record<string, KnownModel>>(loadKnownModels)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [quoteMode, setQuoteMode] = useState<'live' | 'demo' | null>(null)
  const [quoteSubmitting, setQuoteSubmitting] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [linkCopied, setLinkCopied] = useState(false)

  const gallery = useModelGallery(catalog.mode, catalog.selected, galleryOpen)
  const selected = catalog.selected
  const visibleModels = catalog.models
  const selectedIndex = Math.max(0, visibleModels.findIndex((model) => model.id === selected.id))
  const anyModalOpen = galleryOpen || favoritesOpen || quoteOpen

  const categoryLabel = catalog.categories.find((item) => item.id === catalog.category)?.label ?? 'Todos'
  const franchiseLabel = catalog.franchises.find((item) => item.id === catalog.franchise)?.label
    ?? (catalog.franchise === 'all' ? 'Todas as franquias' : selected.franchise || catalog.franchise)

  const demoEstimatedPages = Math.max(1, Math.ceil(catalog.totalCount / 12))
  const pageLabel = catalog.mode === 'live'
    ? `PÁG. ${catalog.pageIndex + 1}`
    : `PÁG. 1 / ${formatter.format(demoEstimatedPages)}`
  const stageIndexLabel = catalog.loading
    ? 'CARREGANDO'
    : visibleModels.length
      ? `${String(selectedIndex + 1).padStart(3, '0')} / ${formatter.format(catalog.totalCount)}`
      : 'SEM RESULTADOS'

  useEffect(() => localStorage.setItem('tonecos:favorites', JSON.stringify(favorites)), [favorites])
  useEffect(() => localStorage.setItem('tonecos:quote', JSON.stringify(quoteList)), [quoteList])
  useEffect(() => localStorage.setItem('tonecos:known-models', JSON.stringify(knownModels)), [knownModels])

  useEffect(() => {
    const seen = [...visibleModels, selected].filter((model) => model.id !== 'loading')
    if (!seen.length) return
    setKnownModels((current) => {
      const next = { ...current }
      let changed = false
      for (const model of seen) {
        const known = next[model.id]
        if (!known || known.name !== model.name || known.slug !== model.slug) {
          next[model.id] = { name: model.name, slug: model.slug }
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [visibleModels, selected])

  useEffect(() => {
    setLinkCopied(false)
    document.title = selected.id === 'loading'
      ? 'Catálogo — Tonecos Studios'
      : `${selected.name} — Tonecos Studios`
  }, [selected.id, selected.name])

  useEffect(() => {
    if (!anyModalOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [anyModalOpen])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (quoteOpen) setQuoteOpen(false)
        else if (favoritesOpen) setFavoritesOpen(false)
        else if (galleryOpen) setGalleryOpen(false)
        return
      }

      const target = event.target
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)

      if (event.key === '/' && !isTyping && !anyModalOpen) {
        event.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (isTyping || anyModalOpen) return
      if (event.key === 'ArrowRight') navigate(1)
      if (event.key === 'ArrowLeft') navigate(-1)
      if (event.key.toLowerCase() === 'f' && selected.id !== 'loading') toggleFavorite(selected.id)
      if (event.key.toLowerCase() === 'a' && selected.id !== 'loading') setGalleryOpen(true)
      if (event.key === 'Enter' && selected.id !== 'loading') window.location.hash = `modelo=${encodeURIComponent(selected.slug)}`
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  function toggleFavorite(id: string) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleQuote(id: string) {
    setQuoteList((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id) : [...current, id]
    })
  }

  function safeToggleQuote(id: string) {
    setQuoteList((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= MAX_QUOTE_ITEMS) {
        setQuoteError(`Cada solicitação aceita até ${MAX_QUOTE_ITEMS} modelos.`)
        setQuoteOpen(true)
        return current
      }
      return [...current, id]
    })
  }

  function openFavorite(id: string) {
    const slug = knownModels[id]?.slug
    if (!slug) return
    setFavoritesOpen(false)
    window.location.hash = `modelo=${encodeURIComponent(slug)}`
  }

  function addFavoritesToQuote() {
    setQuoteList((current) => {
      const next = [...current]
      for (const id of favorites) {
        if (next.length >= MAX_QUOTE_ITEMS) break
        if (!next.includes(id)) next.push(id)
      }
      return next
    })
    setFavoritesOpen(false)
    setQuoteOpen(true)
  }

  function navigate(offset: number) {
    if (!visibleModels.length) return
    if (offset > 0 && selectedIndex >= visibleModels.length - 1 && catalog.hasNextPage) {
      catalog.goNextPage()
      return
    }
    if (offset < 0 && selectedIndex <= 0 && catalog.hasPreviousPage) {
      catalog.goPreviousPage()
      return
    }
    const next = (selectedIndex + offset + visibleModels.length) % visibleModels.length
    catalog.setSelectedId(visibleModels[next].id)
  }

  async function copyModelLink() {
    if (selected.id === 'loading') return
    const url = `${window.location.origin}${window.location.pathname}#modelo=${encodeURIComponent(selected.slug)}`
    window.history.replaceState(null, '', `#modelo=${encodeURIComponent(selected.slug)}`)
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
    } catch {
      setLinkCopied(false)
    }
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const turnstileToken = String(data.get('turnstileToken') ?? '').trim()

    if (catalog.mode === 'live' && !isTurnstileConfigured()) {
      setQuoteError('A proteção do formulário ainda não foi configurada no ambiente de produção.')
      return
    }
    if (catalog.mode === 'live' && !turnstileToken) {
      setQuoteError('Conclua a verificação anti-bot antes de enviar.')
      return
    }

    setQuoteSubmitting(true)
    setQuoteError('')
    try {
      const result = await submitQuoteRequest({
        name: String(data.get('name') ?? '').trim(),
        email: String(data.get('email') ?? '').trim(),
        notes: String(data.get('notes') ?? '').trim(),
        modelIds: quoteList,
        turnstileToken,
      })
      setQuoteMode(result.mode)
      setSent(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setQuoteError(message === 'turnstile_failed'
        ? 'A verificação anti-bot expirou ou não foi aceita. Tente novamente.'
        : 'Não foi possível enviar agora. Sua seleção continua salva neste navegador.')
      setTurnstileResetKey((current) => current + 1)
    } finally {
      setQuoteSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#catalogo" aria-label="Tonecos Studios — voltar ao catálogo">
          <span className="brand__title">CATÁLOGO</span>
          <span className="brand__studio">TONECOS STUDIOS</span>
        </a>
        <nav className="topnav" aria-label="Navegação principal">
          <a href="#catalogo" className="is-active">Catálogo</a>
          <button type="button" onClick={() => catalog.setCategory('all')}>Categorias</button>
          <button type="button" onClick={() => setFavoritesOpen(true)}>Favoritos <b>{favorites.length}</b></button>
          <button type="button" onClick={() => setQuoteOpen(true)}>Orçamento <b>{quoteList.length}</b></button>
        </nav>
        <label className="searchbox">
          <span aria-hidden="true">⌕</span>
          <input ref={searchInputRef} aria-label="Buscar no catálogo" value={catalog.search} onChange={(event) => catalog.setSearch(event.target.value)} placeholder="Buscar personagem, franquia ou categoria..." />
          <kbd aria-hidden="true">/</kbd>
        </label>
      </header>

      <section className="scope-strip" aria-label="Navegação hierárquica">
        <div className="scope-strip__path">
          <span>CATÁLOGO</span><b>›</b>
          <strong>{categoryLabel}</strong><b>›</b>
          <strong>{franchiseLabel}</strong><b>›</b>
          <span>{selected.name}</span>
        </div>
        <div className="scope-strip__franchises">
          <button type="button" className={catalog.franchise === 'all' ? 'is-active' : ''} onClick={() => catalog.setFranchise('all')}>TODAS</button>
          {catalog.franchises.map((item) => (
            <button type="button" key={`${item.category}:${item.id}`} className={catalog.franchise === item.id ? 'is-active' : ''} onClick={() => catalog.setFranchise(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {catalog.error && <div className="runtime-alert" role="alert">{catalog.error}</div>}

      <main id="catalogo" className="catalog-layout" aria-busy={catalog.loading}>
        <aside className="category-panel panel">
          <div className="panel-title"><span>Categorias</span><small>{formatter.format(catalog.categories[0]?.count ?? catalog.totalCount)}</small></div>
          <div className="category-list">
            {catalog.categories.map((item) => (
              <button type="button" key={item.id} className={catalog.category === item.id ? 'is-active' : ''} onClick={() => catalog.setCategory(item.id)} aria-pressed={catalog.category === item.id}>
                <span className="category-mark">{catalog.category === item.id ? '◆' : '◇'}</span>
                <strong>{item.label}</strong>
                <em>{formatter.format(item.count)}</em>
              </button>
            ))}
          </div>
          <div className="scale-note">
            <span className="scale-note__eyebrow">ARQUIVO PREPARADO PARA</span>
            <strong>100.000+</strong>
            <p>Categoria → franquia → personagem → galeria. Nada de carregar o acervo inteiro.</p>
          </div>
        </aside>

        <section className="selection-stage panel">
          <button type="button" className="stage-arrow stage-arrow--left" disabled={!visibleModels.length || catalog.loading} onClick={() => navigate(-1)} aria-label="Modelo anterior">‹</button>
          <div className="stage-visual">
            <div className="stage-watermark">{selected.name.toUpperCase()}</div>
            <div className="stage-index" aria-live="polite">{stageIndexLabel}</div>
            <ModelArt model={selected} />
            <button type="button" className="gallery-badge" disabled={selected.id === 'loading'} onClick={() => setGalleryOpen(true)}>
              <strong>{selected.galleryCount}</strong><span>IMAGENS</span><small>abrir galeria paginada</small>
            </button>
          </div>
          <button type="button" className="stage-arrow stage-arrow--right" disabled={!visibleModels.length || catalog.loading} onClick={() => navigate(1)} aria-label="Próximo modelo">›</button>
        </section>

        <aside className="detail-panel panel">
          <div className="detail-counter">MODELO {selected.code}</div>
          <h1>{selected.name}</h1>
          <p className="franchise">{selected.franchise}</p>
          <div className="breadcrumb"><span>{catalog.categories.find((item) => item.id === selected.category)?.label ?? selected.category}</span><b>›</b><span>{selected.franchise}</span><b>›</b><span>{selected.name}</span></div>
          <p className="description">{selected.description || (catalog.mode === 'live' ? 'Informações detalhadas deste modelo serão exibidas aqui.' : '')}</p>
          <dl className="spec-table">
            <div><dt>Altura aprox.</dt><dd>{selected.heightCm > 0 ? `${selected.heightCm} cm` : 'Sob consulta'}</dd></div>
            <div><dt>Material</dt><dd>{selected.material}</dd></div>
            <div><dt>Imagens</dt><dd>{selected.galleryCount} vistas</dd></div>
            <div><dt>Código</dt><dd>{selected.code}</dd></div>
          </dl>
          <div className="detail-actions">
            <button type="button" disabled={selected.id === 'loading'} aria-pressed={favorites.includes(selected.id)} className={favorites.includes(selected.id) ? 'is-selected' : ''} onClick={() => toggleFavorite(selected.id)}>♡ Favoritar</button>
            <button type="button" disabled={selected.id === 'loading'} aria-pressed={quoteList.includes(selected.id)} className={quoteList.includes(selected.id) ? 'is-selected' : ''} onClick={() => safeToggleQuote(selected.id)}>＋ Lista</button>
          </div>
          <button type="button" className="share-action" disabled={selected.id === 'loading'} onClick={copyModelLink}>{linkCopied ? '✓ Link copiado' : '↗ Copiar link deste modelo'}</button>
          <button type="button" className="primary-action" disabled={selected.id === 'loading'} onClick={() => { if (!quoteList.includes(selected.id)) safeToggleQuote(selected.id); setQuoteOpen(true) }}>Solicitar orçamento <span>›</span></button>
        </aside>

        <section className="roster panel" aria-label="Seleção de modelos">
          <div className="roster-header">
            <div><strong>SELECIONE O PERSONAGEM</strong><span>{catalog.loading ? 'Carregando...' : `${visibleModels.length} modelos neste recorte`}</span></div>
            <div className="roster-hint">← → navegar · ENTER link · A galeria · F favoritar · / buscar</div>
          </div>
          <div className="roster-track">
            {visibleModels.map((model, index) => (
              <button type="button" key={model.id} aria-pressed={model.id === selected.id} className={`roster-card ${model.id === selected.id ? 'is-active' : ''}`} onClick={() => catalog.setSelectedId(model.id)}>
                <ModelArt model={model} compact angle={(index % 3) - 1} />
                <span className="roster-card__index">{String(index + 1).padStart(3, '0')}</span>
                <span className="roster-card__name">{model.name}</span>
                <span className="roster-card__gallery">{model.galleryCount} fotos · {model.franchise}</span>
              </button>
            ))}
          </div>
          <div className="roster-pagination">
            <span>{pageLabel}</span>
            <button type="button" aria-label="Página anterior" disabled={!catalog.hasPreviousPage} onClick={catalog.goPreviousPage}>‹</button>
            <button type="button" aria-label="Próxima página" disabled={!catalog.hasNextPage} onClick={catalog.goNextPage}>›</button>
          </div>
        </section>
      </main>

      <footer className="control-bar">
        <div><kbd>← →</kbd><span>Navegar</span></div>
        <div><kbd>ENTER</kbd><span>Link do modelo</span></div>
        <div><kbd>A</kbd><span>Galeria</span></div>
        <div><kbd>F</kbd><span>Favoritar</span></div>
        <div><kbd>/</kbd><span>Buscar</span></div>
        <div className="control-bar__status">
          <span>{catalog.mode === 'live' ? (catalog.apiHealthy ? 'Catálogo conectado à API' : 'API configurada · verificando') : 'Preview em modo demonstração'}</span>
          <strong>{catalog.mode === 'live' ? 'LIVE' : 'DEMO'}</strong>
        </div>
      </footer>

      {galleryOpen && (
        <div className="modal-backdrop" onMouseDown={() => setGalleryOpen(false)}>
          <section className="gallery-modal" role="dialog" aria-modal="true" aria-labelledby="gallery-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span>GALERIA DO PERSONAGEM</span><h2 id="gallery-title">{selected.name}</h2><p>{gallery.total || selected.galleryCount} imagens · página {gallery.pageIndex + 1} de {gallery.totalPages}</p></div>
              <button type="button" aria-label="Fechar galeria" onClick={() => setGalleryOpen(false)}>×</button>
            </div>
            {gallery.error && <p className="runtime-alert" role="alert">{gallery.error}</p>}
            <div className="gallery-grid" aria-busy={gallery.loading}>
              {gallery.items.map((image, localIndex) => (
                <button type="button" key={image.id} className={image.role === 'cover' ? 'is-cover' : ''}>
                  <GalleryArt image={image} model={selected} angle={((localIndex % 5) - 2) * 3} />
                  <span>{image.role === 'cover' ? 'CAPA · MELHOR QUALIDADE' : `VISTA ${String(gallery.pageIndex * 12 + localIndex + 1).padStart(2, '0')}`}</span>
                </button>
              ))}
              {gallery.loading && <div className="gallery-loading">Carregando imagens...</div>}
              {!gallery.loading && !gallery.items.length && <div className="gallery-loading">Nenhuma imagem disponível nesta página.</div>}
            </div>
            <div className="gallery-footer gallery-footer--paged">
              <span>A capa prioriza a versão de melhor qualidade entre imagens equivalentes.</span>
              <div>
                <button type="button" disabled={!gallery.hasPreviousPage || gallery.loading} onClick={gallery.previousPage}>← anterior</button>
                <strong>{gallery.pageIndex + 1}/{gallery.totalPages}</strong>
                <button type="button" disabled={!gallery.hasNextPage || gallery.loading} onClick={gallery.nextPage}>próxima →</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {favoritesOpen && (
        <div className="modal-backdrop" onMouseDown={() => setFavoritesOpen(false)}>
          <section className="quote-modal" role="dialog" aria-modal="true" aria-labelledby="favorites-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span>COLEÇÃO PESSOAL</span><h2 id="favorites-title">Favoritos</h2><p>{favorites.length ? `${favorites.length} modelos salvos neste navegador.` : 'Nenhum modelo favoritado ainda.'}</p></div>
              <button type="button" aria-label="Fechar favoritos" onClick={() => setFavoritesOpen(false)}>×</button>
            </div>
            {favorites.length ? (
              <>
                <div className="quote-selected"><span>Modelos salvos</span><strong>{favorites.length}</strong></div>
                <div className="quote-chips">
                  {favorites.map((id) => (
                    <button type="button" key={id} disabled={!knownModels[id]?.slug} onClick={() => openFavorite(id)}>
                      {knownModels[id]?.name ?? id} ↗
                    </button>
                  ))}
                </div>
                <button className="primary-action" type="button" onClick={addFavoritesToQuote}>Adicionar favoritos ao orçamento <span>›</span></button>
                <button className="share-action" type="button" onClick={() => setFavorites([])}>Limpar favoritos</button>
              </>
            ) : (
              <div className="success-state"><strong>LISTA VAZIA</strong><p>Use “♡ Favoritar” nos modelos que quiser guardar para comparar ou consultar depois.</p><button type="button" onClick={() => setFavoritesOpen(false)}>Voltar ao catálogo</button></div>
            )}
          </section>
        </div>
      )}

      {quoteOpen && (
        <div className="modal-backdrop" onMouseDown={() => setQuoteOpen(false)}>
          <section className="quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>FORMULÁRIO</span><h2 id="quote-title">Solicitar orçamento</h2><p>Sem WhatsApp. Você recebe a solicitação pelo sistema.</p></div><button type="button" aria-label="Fechar formulário" onClick={() => setQuoteOpen(false)}>×</button></div>
            {sent ? (
              <div className="success-state"><strong>SOLICITAÇÃO REGISTRADA</strong><p>{quoteMode === 'live' ? 'Pedido enviado para o sistema.' : 'Modo demonstração ativo. Ao publicar a API, este mesmo formulário passará a gravar os pedidos sem mudar a interface.'}</p><button type="button" onClick={() => { setSent(false); setQuoteOpen(false) }}>Voltar ao catálogo</button></div>
            ) : (
              <form onSubmit={submitQuote}>
                <label>Nome completo<input required autoComplete="name" maxLength={120} name="name" placeholder="Seu nome" /></label>
                <label>E-mail<input required autoComplete="email" maxLength={254} type="email" name="email" placeholder="voce@email.com" /></label>
                <div className="quote-selected"><span>Itens selecionados</span><strong>{quoteList.length}/{MAX_QUOTE_ITEMS}</strong></div>
                <div className="quote-chips">{quoteList.map((id) => <button type="button" key={id} onClick={() => safeToggleQuote(id)}>{knownModels[id]?.name ?? id} ×</button>)}</div>
                <label>Observações<textarea maxLength={4000} name="notes" rows={5} placeholder="Quantidade, tamanho desejado, acabamento ou outras informações..." /></label>
                {catalog.mode === 'live' && <TurnstileWidget resetKey={turnstileResetKey} />}
                {quoteError && <p role="alert">{quoteError}</p>}
                <button className="primary-action" type="submit" disabled={!quoteList.length || quoteSubmitting || (catalog.mode === 'live' && !isTurnstileConfigured())}>{quoteSubmitting ? 'Enviando...' : 'Enviar solicitação'} <span>›</span></button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
