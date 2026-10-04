import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { useCatalogRuntime } from '../hooks/useCatalogRuntime'
import { CatalogSidebarTree } from './CatalogSidebarTree'
import type { CatalogCategory, CatalogFranchise, CatalogModel } from '../types/catalog'

const formatter = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

function imageCountLabel(count: number) {
  return `${formatter.format(count)} ${count === 1 ? 'imagem' : 'imagens'}`
}

type CatalogRuntime = ReturnType<typeof useCatalogRuntime>

type CatalogHomeProps = {
  catalog: CatalogRuntime
  searchInputRef: RefObject<HTMLInputElement | null>
  favorites: string[]
  quoteList: string[]
  onOpenExplorer: () => void
  onOpenUpdates: () => void
  onOpenFavorites: () => void
  onOpenQuote: () => void
  onOpenModel: (model: CatalogModel) => void
  onToggleFavorite: (id: string) => void
}

type IconName = 'home' | 'star' | 'clock' | 'layers' | 'search' | 'heart' | 'grid' | 'chevron' | 'plus' | 'sliders'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    layers: <><path d="m12 3 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    heart: <path d="M20.5 8.8c0 5.6-8.5 11.2-8.5 11.2S3.5 14.4 3.5 8.8A4.8 4.8 0 0 1 12 5.7a4.8 4.8 0 0 1 8.5 3.1Z" />,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    plus: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  }
  return <svg className="storefront-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}
function ModelCard({ model, favorite, active, priority = false, categoryLabel, onSelect, onFavorite }: {
  model: CatalogModel
  favorite: boolean
  active?: boolean
  priority?: boolean
  categoryLabel?: string
  onSelect: () => void
  onFavorite: () => void
}) {
  return (
    <article className={`storefront-model-card ${active ? 'is-active' : ''}`}>
      <button type="button" className="storefront-model-card__main" onClick={onSelect}>
        <div className="storefront-model-card__media">
          {model.coverUrl ? <img src={model.coverUrl} alt="" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" /> : <span className="storefront-model-card__fallback">{model.name.slice(0, 1)}</span>}
          <span className="storefront-model-card__shade" />
          {categoryLabel && <span className="storefront-model-card__category">{categoryLabel}</span>}
        </div>
        <span className="storefront-model-card__copy">
          <strong>{model.name}</strong>
          <small>{model.franchise || 'Catálogo'}</small>
          <span className="storefront-model-card__meta"><b>{model.code}</b><i aria-hidden="true" /><span>{imageCountLabel(model.galleryCount)}</span></span>
        </span>
      </button>
      <button type="button" className={`storefront-model-card__heart ${favorite ? 'is-active' : ''}`} onClick={onFavorite} aria-label={favorite ? `Remover ${model.name} dos favoritos` : `Favoritar ${model.name}`} aria-pressed={favorite}>
        <Icon name="heart" />
      </button>
    </article>
  )
}

function FranchiseMark({ item }: { item: CatalogFranchise }) {
  const fallback = item.label.trim().slice(0, 1).toLocaleUpperCase('pt-BR') || '•'
  return (
    <span className={`storefront-franchise-list__mark ${item.coverUrl ? 'has-image' : ''}`} aria-hidden="true">
      {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" decoding="async" /> : <span>{fallback}</span>}
    </span>
  )
}

function CategoryTile({ category, cover, active, onSelect }: {
  category: CatalogCategory
  cover?: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={`storefront-category-tile ${active ? 'is-active' : ''}`} onClick={onSelect}>
      {cover && <img src={cover} alt="" loading="lazy" decoding="async" />}
      <span className="storefront-category-tile__shade" />
      <span><strong>{category.label}</strong><small>{formatter.format(category.count)} modelos</small></span>
      <i><Icon name="chevron" /></i>
    </button>
  )
}

export function CatalogHome({ catalog, searchInputRef, favorites, quoteList, onOpenExplorer, onOpenUpdates, onOpenFavorites, onOpenQuote, onOpenModel, onToggleFavorite }: CatalogHomeProps) {
  const [franchiseFilter, setFranchiseFilter] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedFranchiseKey, setExpandedFranchiseKey] = useState<string | null>(null)
  const selected = catalog.selected
  const models = catalog.models
  const catalogTotal = catalog.categories.find((item) => item.id === 'all')?.count ?? catalog.totalCount
  const featuredModels = models.slice(0, 6)
  const secondaryModels = models.slice(6, 10).length ? models.slice(6, 10) : models.slice(0, 4)
  const categoryTiles = catalog.categories.filter((item) => item.id !== 'all').slice(0, 6)
  const visibleFranchises = useMemo(() => catalog.franchises.filter((item) => item.label.toLocaleLowerCase('pt-BR').includes(franchiseFilter.trim().toLocaleLowerCase('pt-BR'))), [catalog.franchises, franchiseFilter])
  const franchiseCards = catalog.franchises.slice(0, 4)
  const categoryLabels = useMemo(() => new Map(catalog.categories.map((item) => [item.id, item.label])), [catalog.categories])
  const heroCampaignCategory = catalog.categories.find((item) => item.id === 'games') ?? catalog.categories.find((item) => item.id !== 'all')
  const heroCampaignCover = heroCampaignCategory?.coverUrl

  useEffect(() => {
    if (catalog.franchise === 'all') return
    const current = catalog.franchises.find((item) => item.id === catalog.franchise && item.category === catalog.category)
    if (current) setExpandedFranchiseKey(`${current.category}:${current.id}`)
  }, [catalog.category, catalog.franchise, catalog.franchises])

  function selectModel(model: CatalogModel) {
    onOpenModel(model)
  }

  function exploreHeroCampaign() {
    if (heroCampaignCategory) catalog.setCategory(heroCampaignCategory.id)
    window.requestAnimationFrame(() => {
      document.querySelector('#destaques')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    })
  }

  function coverForCategory(category: CatalogCategory) {
    return category.coverUrl ?? models.find((model) => model.category === category.id && model.coverUrl)?.coverUrl
  }

  function coverForFranchise(item: CatalogFranchise) {
    return item.coverUrl ?? models.find((model) => model.franchise === item.label && model.coverUrl)?.coverUrl
  }

  function franchiseKey(item: CatalogFranchise) {
    return `${item.category}:${item.id}`
  }

  function toggleFranchise(item: CatalogFranchise) {
    const key = franchiseKey(item)
    setExpandedFranchiseKey((current) => current === key ? null : key)
  }

  function selectFranchise(item: CatalogFranchise) {
    setExpandedFranchiseKey(franchiseKey(item))
    if (catalog.category !== item.category) catalog.setCategory(item.category)
    catalog.setFranchise(item.id)
  }

  function selectFranchiseFolder(item: CatalogFranchise, folder: string) {
    if (catalog.category !== item.category) catalog.setCategory(item.category)
    if (catalog.franchise !== item.id) catalog.setFranchise(item.id)
    catalog.setFolder(folder)
  }
  return (
    <div className={`storefront-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      <aside className="storefront-sidebar">
        <div className="storefront-brand">
          <span className="storefront-brand__mark" aria-hidden="true"><i /><b /></span>
          <span><strong>STLForge</strong><small>Catálogo</small></span>
          <button type="button" className="storefront-sidebar__collapse" aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'} aria-pressed={sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? '››' : '‹‹'}</button>
        </div>

        <nav className="storefront-sidebar__nav" aria-label="Navegação do catálogo">
          <a href="#catalogo" className="is-active"><Icon name="home" /><span>Catálogo</span></a>
          <a href="#destaques"><Icon name="star" /><span>Em destaque</span></a>
          <button type="button" onClick={onOpenUpdates}><Icon name="clock" /><span>Recém adicionados</span></button>
          <a href="#colecoes"><Icon name="layers" /><span>Coleções</span><b>{catalog.franchises.length}</b></a>
          <button type="button" onClick={onOpenFavorites}><Icon name="heart" /><span>Favoritos</span><b>{favorites.length}</b></button>
        </nav>

        <div className="storefront-sidebar__section-head"><span>Franquias</span><button type="button" onClick={onOpenExplorer} aria-label="Explorar todas as franquias">+</button></div>
        <label className="storefront-franchise-search"><Icon name="search" /><input value={franchiseFilter} onChange={(event) => setFranchiseFilter(event.target.value)} placeholder="Buscar franquias..." /></label>

        <div className="storefront-franchise-list">
          {visibleFranchises.slice(0, 12).map((item) => {
            const key = franchiseKey(item)
            const active = catalog.franchise === item.id && catalog.category === item.category
            const expanded = expandedFranchiseKey === key && catalog.mode === 'live'
            return (
              <div className={`storefront-franchise-entry ${active ? 'is-active' : ''} ${expanded ? 'is-expanded' : ''}`} key={key}>
                <div className="storefront-franchise-row">
                  <button type="button" className="storefront-franchise-select" aria-current={active ? 'page' : undefined} onClick={() => selectFranchise(item)}>
                    <FranchiseMark item={item} /><strong>{item.label}</strong><small>{formatter.format(item.count)}</small>
                  </button>
                  <button type="button" className="storefront-franchise-expand" aria-label={`${expanded ? 'Recolher' : 'Expandir'} estrutura de ${item.label}`} aria-expanded={expanded} disabled={catalog.mode !== 'live'} onClick={() => toggleFranchise(item)}>
                    <Icon name="chevron" />
                  </button>
                </div>
                {expanded && (
                  <CatalogSidebarTree
                    key={key}
                    category={item.category}
                    franchise={item.id}
                    activeFolder={active ? catalog.folder : ''}
                    trail={active ? catalog.folderTrail : []}
                    onSelectFolder={(folder) => selectFranchiseFolder(item, folder)}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="storefront-sidebar__summary">
          <Icon name="grid" /><div><strong>{formatter.format(catalogTotal)}</strong><span>modelos no acervo</span></div>
          <button type="button" onClick={onOpenExplorer}>Explorar tudo <Icon name="chevron" /></button>
        </div>
      </aside>

      <div className="storefront-main">
        <header className="storefront-topbar">
          <nav aria-label="Navegação principal"><a href="#catalogo" className="is-active">Explorar</a><a href="#colecoes">Coleções</a><button type="button" onClick={onOpenUpdates}>Novos</button><button type="button" onClick={onOpenQuote}>Minha lista <b>{quoteList.length}</b></button></nav>
          <label className={`storefront-search ${catalog.searchPending ? 'is-pending' : ''}`}><Icon name="search" /><input ref={searchInputRef} value={catalog.search} onChange={(event) => catalog.setSearch(event.target.value)} placeholder="Buscar modelos, personagens, franquias..." aria-label="Buscar no catálogo" /><kbd>Ctrl</kbd><kbd>K</kbd></label>
          <div className="storefront-topbar__status"><span className={catalog.mode === 'live' ? 'is-live' : ''} /><strong>{catalog.mode === 'live' ? 'Catálogo online' : 'Prévia local'}</strong></div>
        </header>
        <main id="catalogo" className="storefront-content" aria-busy={catalog.loading}>
          {catalog.error && <div className="storefront-alert" role="alert">{catalog.error}</div>}

          <section className="storefront-hero" aria-label="Destaque editorial do catálogo">
            <div className="storefront-hero__backdrop">
              {heroCampaignCover && <>
                <span className="storefront-hero__mobile-media" style={{ backgroundImage: `url("${heroCampaignCover}")` }} aria-hidden="true" />
                <img className="storefront-hero__backdrop-blur" src={heroCampaignCover} alt="" loading="eager" fetchPriority="high" decoding="async" />
                <img className="storefront-hero__backdrop-subject" src={heroCampaignCover} alt="" loading="eager" fetchPriority="high" decoding="async" />
              </>}
            </div>
            <div className="storefront-hero__copy">
              <span className="storefront-hero__eyebrow"><Icon name="star" /> Destaque editorial</span>
              <h1>Explore o catálogo com uma <em>experiência visual premium.</em></h1>
              <p>Descubra modelos organizados por franquias, personagens e categorias, com destaques editoriais que ajudam a navegar pelo acervo sem interromper sua exploração.</p>
              <div className="storefront-hero__actions">
                <button type="button" className="storefront-button storefront-button--primary" onClick={exploreHeroCampaign}>Explorar coleção <Icon name="chevron" /></button>
                <button type="button" className="storefront-button storefront-button--ghost" onClick={onOpenExplorer}><Icon name="grid" /> Ver franquias</button>
              </div>
            </div>
            <div className="storefront-hero__feature">
              <span>COLEÇÃO EM DESTAQUE</span>
              <strong>{heroCampaignCategory?.label ?? 'Acervo Tonecos'}</strong>
              <p>{formatter.format(heroCampaignCategory?.count ?? catalogTotal)} modelos organizados para explorar.</p>
            </div>
          </section>

          <div className="storefront-filterbar" aria-label="Categorias do catálogo">
            <div className="storefront-filterbar__rail">
              {catalog.categories.slice(0, 12).map((item) => <button type="button" key={item.id} className={catalog.category === item.id ? 'is-active' : ''} onClick={() => catalog.setCategory(item.id)}>{item.label}</button>)}
            </div>
            <button type="button" className="storefront-filterbar__filters" onClick={onOpenExplorer}><Icon name="sliders" /> Filtros <Icon name="chevron" /></button>
          </div>

          {catalog.hasActiveFilters && (
            <div className="storefront-active-filters">
              <span>Recorte atual</span>
              {catalog.category !== 'all' && <button type="button" onClick={() => catalog.setCategory('all')}>{catalog.categories.find((item) => item.id === catalog.category)?.label ?? catalog.category} ×</button>}
              {catalog.franchise !== 'all' && <button type="button" onClick={() => catalog.setFranchise('all')}>{catalog.franchises.find((item) => item.id === catalog.franchise)?.label ?? selected.franchise} ×</button>}
              {catalog.folder && <button type="button" onClick={() => catalog.setFolder('')}>{catalog.folderLabel || catalog.folder.split('/').at(-1)} ×</button>}
              {catalog.search.trim() && <button type="button" onClick={() => catalog.setSearch('')}>“{catalog.search.trim()}” ×</button>}
              <button type="button" className="storefront-active-filters__clear" onClick={catalog.resetDiscovery}>Limpar tudo</button>
            </div>
          )}
          <section id="destaques" className="storefront-section">
            <div className="storefront-section__head"><div><span className="storefront-section__icon"><Icon name="star" /></span><div><h2>Em destaque</h2><p>Modelos do recorte atual para explorar.</p></div></div><button type="button" onClick={onOpenExplorer}>Ver todos <Icon name="chevron" /></button></div>
            {featuredModels.length ? <div className="storefront-model-grid">{featuredModels.map((model, index) => <ModelCard key={model.id} model={model} favorite={favorites.includes(model.id)} priority={index < 6} categoryLabel={categoryLabels.get(model.category)} onSelect={() => selectModel(model)} onFavorite={() => onToggleFavorite(model.id)} />)}</div> : <div className="storefront-empty"><strong>Nenhum modelo neste recorte</strong><span>Remova filtros ou altere a busca para voltar ao acervo.</span><button type="button" onClick={catalog.resetDiscovery}>Limpar filtros</button></div>}
          </section>

          <section className="storefront-section storefront-section--categories">
            <div className="storefront-section__head"><div><span className="storefront-section__icon"><Icon name="grid" /></span><div><h2>Categorias</h2><p>Explore o acervo por temática.</p></div></div><button type="button" onClick={onOpenExplorer}>Ver todas <Icon name="chevron" /></button></div>
            <div className="storefront-category-grid">{categoryTiles.map((category) => <CategoryTile key={category.id} category={category} cover={coverForCategory(category)} active={catalog.category === category.id} onSelect={() => catalog.setCategory(category.id)} />)}</div>
          </section>

          <div className="storefront-lower-grid">
            <section id="colecoes" className="storefront-section storefront-section--compact">
              <div className="storefront-section__head"><div><span className="storefront-section__icon"><Icon name="layers" /></span><div><h2>Coleções populares</h2><p>Navegue pelas coleções organizadas.</p></div></div><button type="button" onClick={onOpenExplorer}>Ver todas <Icon name="chevron" /></button></div>
              <div className="storefront-franchise-cards">{franchiseCards.map((item) => {
                const cover = coverForFranchise(item)
                return <button type="button" key={`${item.category}:${item.id}`} onClick={() => selectFranchise(item)}>{cover && <img src={cover} alt="" loading="lazy" decoding="async" />}<span className="storefront-franchise-cards__shade" /><span><strong>{item.label}</strong><small>{formatter.format(item.count)} modelos</small></span><i><Icon name="chevron" /></i></button>
              })}</div>
            </section>

            <section className="storefront-section storefront-section--compact">
              <div className="storefront-section__head"><div><span className="storefront-section__icon"><Icon name="plus" /></span><div><h2>Mais para explorar</h2><p>Continue navegando no recorte atual.</p></div></div><div className="storefront-pager"><button type="button" disabled={!catalog.hasPreviousPage} onClick={catalog.goPreviousPage}>‹</button><button type="button" disabled={!catalog.hasNextPage} onClick={catalog.goNextPage}>›</button></div></div>
              <div className="storefront-mini-grid">{secondaryModels.map((model) => <ModelCard key={model.id} model={model} favorite={favorites.includes(model.id)} categoryLabel={categoryLabels.get(model.category)} onSelect={() => selectModel(model)} onFavorite={() => onToggleFavorite(model.id)} />)}</div>
            </section>
          </div>

          <footer className="storefront-footer"><span><b className={catalog.mode === 'live' ? 'is-live' : ''} />{catalog.mode === 'live' ? 'Catálogo online' : 'Prévia local'}</span><strong>{formatter.format(catalogTotal)} modelos organizados</strong><button type="button" onClick={onOpenQuote}>Minha lista <b>{quoteList.length}</b> <Icon name="chevron" /></button></footer>
        </main>
      </div>
    </div>
  )
}
