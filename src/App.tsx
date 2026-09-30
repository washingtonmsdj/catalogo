import { FormEvent, useEffect, useMemo, useState } from 'react'
import { categories, models } from './data/mockCatalog'
import { submitQuoteRequest } from './services/quotes'
import type { CatalogModel } from './types/catalog'

const formatter = new Intl.NumberFormat('pt-BR')
const GALLERY_PAGE_SIZE = 12

function ModelArt({ model, compact = false, angle = 0 }: { model: CatalogModel; compact?: boolean; angle?: number }) {
  return (
    <div className={`model-art ${compact ? 'model-art--compact' : ''}`} style={{ '--accent': model.accent } as React.CSSProperties}>
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
      <div className="model-art__grain" />
    </div>
  )
}

export default function App() {
  const initialSlug = window.location.hash.startsWith('#modelo=') ? decodeURIComponent(window.location.hash.slice(8)) : ''
  const initialModel = models.find((model) => model.slug === initialSlug) ?? models[0]
  const [category, setCategory] = useState('all')
  const [franchise, setFranchise] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(initialModel.id)
  const [favorites, setFavorites] = useState<string[]>(() => JSON.parse(localStorage.getItem('tonecos:favorites') ?? '[]'))
  const [quoteList, setQuoteList] = useState<string[]>(() => JSON.parse(localStorage.getItem('tonecos:quote') ?? '[]'))
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryPage, setGalleryPage] = useState(0)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [quoteMode, setQuoteMode] = useState<'live' | 'demo' | null>(null)
  const [quoteSubmitting, setQuoteSubmitting] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const franchiseOptions = useMemo(() => {
    const scoped = category === 'all' ? models : models.filter((model) => model.category === category)
    return Array.from(new Set(scoped.map((model) => model.franchise))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [category])

  const visibleModels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR')
    return models.filter((model) => {
      const matchesCategory = category === 'all' || model.category === category
      const matchesFranchise = franchise === 'all' || model.franchise === franchise
      const haystack = `${model.name} ${model.franchise} ${model.collection} ${model.tags.join(' ')}`.toLocaleLowerCase('pt-BR')
      return matchesCategory && matchesFranchise && (!needle || haystack.includes(needle))
    })
  }, [category, franchise, search])

  const selected = models.find((model) => model.id === selectedId) ?? visibleModels[0] ?? models[0]
  const selectedIndex = Math.max(0, visibleModels.findIndex((model) => model.id === selected.id))
  const galleryPages = Math.max(1, Math.ceil(selected.galleryCount / GALLERY_PAGE_SIZE))
  const galleryStart = galleryPage * GALLERY_PAGE_SIZE
  const galleryItems = Math.max(0, Math.min(GALLERY_PAGE_SIZE, selected.galleryCount - galleryStart))
  const estimatedModelPages = Math.max(1, Math.ceil((categories.find((item) => item.id === category)?.count ?? categories[0].count) / 12))

  useEffect(() => localStorage.setItem('tonecos:favorites', JSON.stringify(favorites)), [favorites])
  useEffect(() => localStorage.setItem('tonecos:quote', JSON.stringify(quoteList)), [quoteList])

  useEffect(() => {
    if (franchise !== 'all' && !franchiseOptions.includes(franchise)) setFranchise('all')
  }, [franchise, franchiseOptions])

  useEffect(() => {
    if (visibleModels.length && !visibleModels.some((model) => model.id === selectedId)) setSelectedId(visibleModels[0].id)
  }, [visibleModels, selectedId])

  useEffect(() => {
    setGalleryPage(0)
    setLinkCopied(false)
  }, [selected.id])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowRight' && visibleModels.length) setSelectedId(visibleModels[(selectedIndex + 1) % visibleModels.length].id)
      if (event.key === 'ArrowLeft' && visibleModels.length) setSelectedId(visibleModels[(selectedIndex - 1 + visibleModels.length) % visibleModels.length].id)
      if (event.key.toLowerCase() === 'f') toggleFavorite(selected.id)
      if (event.key.toLowerCase() === 'a') setGalleryOpen(true)
      if (event.key === 'Enter') window.location.hash = `modelo=${encodeURIComponent(selected.slug)}`
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  function setCategoryScope(next: string) {
    setCategory(next)
    setFranchise('all')
  }

  function toggleFavorite(id: string) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleQuote(id: string) {
    setQuoteList((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function navigate(offset: number) {
    if (!visibleModels.length) return
    const next = (selectedIndex + offset + visibleModels.length) % visibleModels.length
    setSelectedId(visibleModels[next].id)
  }

  async function copyModelLink() {
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
    setQuoteSubmitting(true)
    setQuoteError('')
    try {
      const result = await submitQuoteRequest({
        name: String(data.get('name') ?? '').trim(),
        email: String(data.get('email') ?? '').trim(),
        notes: String(data.get('notes') ?? '').trim(),
        modelIds: quoteList,
      })
      setQuoteMode(result.mode)
      setSent(true)
    } catch {
      setQuoteError('Não foi possível enviar agora. Sua seleção continua salva neste navegador.')
    } finally {
      setQuoteSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#catalogo" aria-label="Tonecos Studios">
          <span className="brand__title">CATÁLOGO</span>
          <span className="brand__studio">TONECOS STUDIOS</span>
        </a>
        <nav className="topnav" aria-label="Navegação principal">
          <a href="#catalogo" className="is-active">Catálogo</a>
          <button onClick={() => setCategoryScope('all')}>Categorias</button>
          <button>Favoritos <b>{favorites.length}</b></button>
          <button onClick={() => setQuoteOpen(true)}>Orçamento <b>{quoteList.length}</b></button>
        </nav>
        <label className="searchbox">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar personagem, franquia ou categoria..." />
          <kbd>/</kbd>
        </label>
        <button className="account-button">Entrar</button>
      </header>

      <section className="scope-strip" aria-label="Navegação hierárquica">
        <div className="scope-strip__path">
          <span>CATÁLOGO</span><b>›</b>
          <strong>{categories.find((item) => item.id === category)?.label ?? 'Todos'}</strong><b>›</b>
          <strong>{franchise === 'all' ? 'Todas as franquias' : franchise}</strong><b>›</b>
          <span>{selected.name}</span>
        </div>
        <div className="scope-strip__franchises">
          <button className={franchise === 'all' ? 'is-active' : ''} onClick={() => setFranchise('all')}>TODAS</button>
          {franchiseOptions.map((item) => <button key={item} className={franchise === item ? 'is-active' : ''} onClick={() => setFranchise(item)}>{item}</button>)}
        </div>
      </section>

      <main id="catalogo" className="catalog-layout">
        <aside className="category-panel panel">
          <div className="panel-title"><span>Categorias</span><small>{formatter.format(categories[0].count)}</small></div>
          <div className="category-list">
            {categories.map((item) => (
              <button key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategoryScope(item.id)}>
                <span className="category-mark">{category === item.id ? '◆' : '◇'}</span>
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
          <button className="stage-arrow stage-arrow--left" onClick={() => navigate(-1)} aria-label="Anterior">‹</button>
          <div className="stage-visual">
            <div className="stage-watermark">{selected.name.toUpperCase()}</div>
            <div className="stage-index">{String(selectedIndex + 1).padStart(3, '0')} / {formatter.format(categories.find((item) => item.id === category)?.count ?? categories[0].count)}</div>
            <ModelArt model={selected} />
            <button className="gallery-badge" onClick={() => setGalleryOpen(true)}>
              <strong>{selected.galleryCount}</strong><span>IMAGENS</span><small>abrir galeria paginada</small>
            </button>
          </div>
          <button className="stage-arrow stage-arrow--right" onClick={() => navigate(1)} aria-label="Próximo">›</button>
        </section>

        <aside className="detail-panel panel">
          <div className="detail-counter">MODELO {selected.code}</div>
          <h1>{selected.name}</h1>
          <p className="franchise">{selected.franchise}</p>
          <div className="breadcrumb"><span>{categories.find((item) => item.id === selected.category)?.label ?? selected.category}</span><b>›</b><span>{selected.franchise}</span><b>›</b><span>{selected.name}</span></div>
          <p className="description">{selected.description}</p>
          <dl className="spec-table">
            <div><dt>Altura aprox.</dt><dd>{selected.heightCm} cm</dd></div>
            <div><dt>Material</dt><dd>{selected.material}</dd></div>
            <div><dt>Imagens</dt><dd>{selected.galleryCount} vistas</dd></div>
            <div><dt>Código</dt><dd>{selected.code}</dd></div>
          </dl>
          <div className="detail-actions">
            <button className={favorites.includes(selected.id) ? 'is-selected' : ''} onClick={() => toggleFavorite(selected.id)}>♡ Favoritar</button>
            <button className={quoteList.includes(selected.id) ? 'is-selected' : ''} onClick={() => toggleQuote(selected.id)}>＋ Lista</button>
          </div>
          <button className="share-action" onClick={copyModelLink}>{linkCopied ? '✓ Link copiado' : '↗ Copiar link deste modelo'}</button>
          <button className="primary-action" onClick={() => { if (!quoteList.includes(selected.id)) toggleQuote(selected.id); setQuoteOpen(true) }}>Solicitar orçamento <span>›</span></button>
        </aside>

        <section className="roster panel" aria-label="Seleção de modelos">
          <div className="roster-header">
            <div><strong>SELECIONE O PERSONAGEM</strong><span>{visibleModels.length ? `${visibleModels.length} demonstrativos neste recorte` : 'Nenhum resultado'}</span></div>
            <div className="roster-hint">← → navegar · ENTER link · A galeria · F favoritar</div>
          </div>
          <div className="roster-track">
            {visibleModels.map((model, index) => (
              <button key={model.id} className={`roster-card ${model.id === selected.id ? 'is-active' : ''}`} onClick={() => setSelectedId(model.id)}>
                <ModelArt model={model} compact angle={(index % 3) - 1} />
                <span className="roster-card__index">{String(index + 1).padStart(3, '0')}</span>
                <span className="roster-card__name">{model.name}</span>
                <span className="roster-card__gallery">{model.galleryCount} fotos · {model.franchise}</span>
              </button>
            ))}
          </div>
          <div className="roster-pagination">
            <span>PÁG. 1 / {formatter.format(estimatedModelPages)}</span><button disabled>‹</button><button>›</button>
          </div>
        </section>
      </main>

      <footer className="control-bar">
        <div><kbd>← →</kbd><span>Navegar</span></div>
        <div><kbd>ENTER</kbd><span>Link do modelo</span></div>
        <div><kbd>A</kbd><span>Galeria</span></div>
        <div><kbd>F</kbd><span>Favoritar</span></div>
        <div className="control-bar__status"><span>Hierarquia e galerias paginadas</span><strong>100K+</strong></div>
      </footer>

      {galleryOpen && (
        <div className="modal-backdrop" onMouseDown={() => setGalleryOpen(false)}>
          <section className="gallery-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>GALERIA DO PERSONAGEM</span><h2>{selected.name}</h2><p>{selected.galleryCount} imagens · página {galleryPage + 1} de {galleryPages}</p></div><button onClick={() => setGalleryOpen(false)}>×</button></div>
            <div className="gallery-grid">
              {Array.from({ length: galleryItems }, (_, localIndex) => {
                const imageIndex = galleryStart + localIndex
                return (
                  <button key={imageIndex} className={imageIndex === 0 ? 'is-cover' : ''}>
                    <ModelArt model={selected} compact angle={((imageIndex % 5) - 2) * 3} />
                    <span>{imageIndex === 0 ? 'CAPA · MELHOR QUALIDADE' : `VISTA ${String(imageIndex + 1).padStart(2, '0')}`}</span>
                  </button>
                )
              })}
            </div>
            <div className="gallery-footer gallery-footer--paged">
              <span>A capa prioriza a versão de melhor qualidade entre imagens equivalentes.</span>
              <div><button disabled={galleryPage === 0} onClick={() => setGalleryPage((page) => Math.max(0, page - 1))}>← anterior</button><strong>{galleryPage + 1}/{galleryPages}</strong><button disabled={galleryPage >= galleryPages - 1} onClick={() => setGalleryPage((page) => Math.min(galleryPages - 1, page + 1))}>próxima →</button></div>
            </div>
          </section>
        </div>
      )}

      {quoteOpen && (
        <div className="modal-backdrop" onMouseDown={() => setQuoteOpen(false)}>
          <section className="quote-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>FORMULÁRIO</span><h2>Solicitar orçamento</h2><p>Sem WhatsApp. Você recebe a solicitação pelo sistema.</p></div><button onClick={() => setQuoteOpen(false)}>×</button></div>
            {sent ? (
              <div className="success-state"><strong>SOLICITAÇÃO REGISTRADA</strong><p>{quoteMode === 'live' ? 'Pedido enviado para o sistema.' : 'Modo demonstração ativo. Ao publicar a API, este mesmo formulário passará a gravar os pedidos sem mudar a interface.'}</p><button onClick={() => { setSent(false); setQuoteOpen(false) }}>Voltar ao catálogo</button></div>
            ) : (
              <form onSubmit={submitQuote}>
                <label>Nome completo<input required name="name" placeholder="Seu nome" /></label>
                <label>E-mail<input required type="email" name="email" placeholder="voce@email.com" /></label>
                <div className="quote-selected"><span>Itens selecionados</span><strong>{quoteList.length}</strong></div>
                <div className="quote-chips">{quoteList.map((id) => { const model = models.find((item) => item.id === id); return model ? <button type="button" key={id} onClick={() => toggleQuote(id)}>{model.name} ×</button> : null })}</div>
                <label>Observações<textarea name="notes" rows={5} placeholder="Quantidade, tamanho desejado, acabamento ou outras informações..." /></label>
                {quoteError && <p role="alert">{quoteError}</p>}
                <button className="primary-action" type="submit" disabled={!quoteList.length || quoteSubmitting}>{quoteSubmitting ? 'Enviando...' : 'Enviar solicitação'} <span>›</span></button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
