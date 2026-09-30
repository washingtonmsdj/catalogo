import { FormEvent, useEffect, useMemo, useState } from 'react'
import { categories, models } from './data/mockCatalog'
import type { CatalogModel } from './types/catalog'

const formatter = new Intl.NumberFormat('pt-BR')

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

function ArcadeButton({ children, active = false, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return <button className={`arcade-button ${active ? 'is-active' : ''}`} onClick={onClick}>{children}</button>
}

export default function App() {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(models[0].id)
  const [favorites, setFavorites] = useState<string[]>(() => JSON.parse(localStorage.getItem('tonecos:favorites') ?? '[]'))
  const [quoteList, setQuoteList] = useState<string[]>(() => JSON.parse(localStorage.getItem('tonecos:quote') ?? '[]'))
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [sent, setSent] = useState(false)

  const visibleModels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR')
    return models.filter((model) => {
      const matchesCategory = category === 'all' || model.category === category
      const haystack = `${model.name} ${model.franchise} ${model.tags.join(' ')}`.toLocaleLowerCase('pt-BR')
      return matchesCategory && (!needle || haystack.includes(needle))
    })
  }, [category, search])

  const selected = models.find((model) => model.id === selectedId) ?? visibleModels[0] ?? models[0]
  const selectedIndex = Math.max(0, visibleModels.findIndex((model) => model.id === selected.id))

  useEffect(() => localStorage.setItem('tonecos:favorites', JSON.stringify(favorites)), [favorites])
  useEffect(() => localStorage.setItem('tonecos:quote', JSON.stringify(quoteList)), [quoteList])

  useEffect(() => {
    if (visibleModels.length && !visibleModels.some((model) => model.id === selectedId)) setSelectedId(visibleModels[0].id)
  }, [visibleModels, selectedId])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowRight' && visibleModels.length) setSelectedId(visibleModels[(selectedIndex + 1) % visibleModels.length].id)
      if (event.key === 'ArrowLeft' && visibleModels.length) setSelectedId(visibleModels[(selectedIndex - 1 + visibleModels.length) % visibleModels.length].id)
      if (event.key.toLowerCase() === 'f') toggleFavorite(selected.id)
      if (event.key.toLowerCase() === 'a') setGalleryOpen(true)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

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

  function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSent(true)
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
          <button onClick={() => setCategory('all')}>Categorias</button>
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

      <main id="catalogo" className="catalog-layout">
        <aside className="category-panel panel">
          <div className="panel-title"><span>Categorias</span><small>{formatter.format(categories[0].count)}</small></div>
          <div className="category-list">
            {categories.map((item) => (
              <button key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>
                <span className="category-mark">{category === item.id ? '◆' : '◇'}</span>
                <strong>{item.label}</strong>
                <em>{formatter.format(item.count)}</em>
              </button>
            ))}
          </div>
          <div className="scale-note">
            <span className="scale-note__eyebrow">ARQUIVO PREPARADO PARA</span>
            <strong>100.000+</strong>
            <p>Busca paginada. Nenhuma tela carrega o acervo inteiro.</p>
          </div>
        </aside>

        <section className="selection-stage panel">
          <button className="stage-arrow stage-arrow--left" onClick={() => navigate(-1)} aria-label="Anterior">‹</button>
          <div className="stage-visual">
            <div className="stage-watermark">{selected.name.toUpperCase()}</div>
            <div className="stage-index">{String(selectedIndex + 1).padStart(3, '0')} / {formatter.format(categories.find((item) => item.id === category)?.count ?? categories[0].count)}</div>
            <ModelArt model={selected} />
            <button className="gallery-badge" onClick={() => setGalleryOpen(true)}>
              <strong>{selected.galleryCount}</strong><span>IMAGENS</span><small>abrir galeria</small>
            </button>
          </div>
          <button className="stage-arrow stage-arrow--right" onClick={() => navigate(1)} aria-label="Próximo">›</button>
        </section>

        <aside className="detail-panel panel">
          <div className="detail-counter">MODELO {selected.code}</div>
          <h1>{selected.name}</h1>
          <p className="franchise">{selected.franchise}</p>
          <div className="breadcrumb"><span>{selected.category}</span><b>›</b><span>{selected.collection}</span><b>›</b><span>{selected.name}</span></div>
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
          <button className="primary-action" onClick={() => { toggleQuote(selected.id); setQuoteOpen(true) }}>Solicitar orçamento <span>›</span></button>
        </aside>

        <section className="roster panel" aria-label="Seleção de modelos">
          <div className="roster-header">
            <div><strong>SELECIONE O MODELO</strong><span>{visibleModels.length ? `${visibleModels.length} demonstrativos nesta página` : 'Nenhum resultado'}</span></div>
            <div className="roster-hint">← → navegar · A galeria · F favoritar</div>
          </div>
          <div className="roster-track">
            {visibleModels.map((model, index) => (
              <button key={model.id} className={`roster-card ${model.id === selected.id ? 'is-active' : ''}`} onClick={() => setSelectedId(model.id)}>
                <ModelArt model={model} compact angle={(index % 3) - 1} />
                <span className="roster-card__index">{String(index + 1).padStart(3, '0')}</span>
                <span className="roster-card__name">{model.name}</span>
                <span className="roster-card__gallery">{model.galleryCount} fotos</span>
              </button>
            ))}
          </div>
          <div className="roster-pagination">
            <span>PÁG. 1 / 8.354</span><button disabled>‹</button><button>›</button>
          </div>
        </section>
      </main>

      <footer className="control-bar">
        <div><kbd>← →</kbd><span>Navegar</span></div>
        <div><kbd>ENTER</kbd><span>Detalhes</span></div>
        <div><kbd>A</kbd><span>Galeria</span></div>
        <div><kbd>F</kbd><span>Favoritar</span></div>
        <div className="control-bar__status"><span>Arquitetura preparada para catálogo massivo</span><strong>100K+</strong></div>
      </footer>

      {galleryOpen && (
        <div className="modal-backdrop" onMouseDown={() => setGalleryOpen(false)}>
          <section className="gallery-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>GALERIA DO MODELO</span><h2>{selected.name}</h2><p>{selected.galleryCount} imagens disponíveis neste modelo</p></div><button onClick={() => setGalleryOpen(false)}>×</button></div>
            <div className="gallery-grid">
              {Array.from({ length: Math.min(12, selected.galleryCount) }, (_, index) => (
                <button key={index} className={index === 0 ? 'is-cover' : ''}>
                  <ModelArt model={selected} compact angle={((index % 5) - 2) * 3} />
                  <span>{index === 0 ? 'CAPA · MELHOR QUALIDADE' : `VISTA ${String(index + 1).padStart(2, '0')}`}</span>
                </button>
              ))}
            </div>
            <div className="gallery-footer"><span>A imagem de capa é escolhida automaticamente pela melhor qualidade entre duplicatas.</span><button>Carregar mais imagens</button></div>
          </section>
        </div>
      )}

      {quoteOpen && (
        <div className="modal-backdrop" onMouseDown={() => setQuoteOpen(false)}>
          <section className="quote-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span>FORMULÁRIO</span><h2>Solicitar orçamento</h2><p>Sem WhatsApp. Você recebe a solicitação pelo sistema.</p></div><button onClick={() => setQuoteOpen(false)}>×</button></div>
            {sent ? (
              <div className="success-state"><strong>SOLICITAÇÃO REGISTRADA</strong><p>Protótipo visual: a próxima etapa conectará este formulário ao backend.</p><button onClick={() => { setSent(false); setQuoteOpen(false) }}>Voltar ao catálogo</button></div>
            ) : (
              <form onSubmit={submitQuote}>
                <label>Nome completo<input required name="name" placeholder="Seu nome" /></label>
                <label>E-mail<input required type="email" name="email" placeholder="voce@email.com" /></label>
                <div className="quote-selected"><span>Itens selecionados</span><strong>{quoteList.length}</strong></div>
                <div className="quote-chips">{quoteList.map((id) => { const model = models.find((item) => item.id === id); return model ? <button type="button" key={id} onClick={() => toggleQuote(id)}>{model.name} ×</button> : null })}</div>
                <label>Observações<textarea name="notes" rows={5} placeholder="Quantidade, tamanho desejado, acabamento ou outras informações..." /></label>
                <button className="primary-action" type="submit" disabled={!quoteList.length}>Enviar solicitação <span>›</span></button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
