import { FormEvent, useEffect, useRef, useState } from 'react'
import { FranchiseBrowser } from './components/FranchiseBrowser'
import { ModelComparison } from './components/ModelComparison'
import { TurnstileWidget, isTurnstileConfigured } from './components/TurnstileWidget'
import { useCatalogRuntime, useModelGallery } from './hooks/useCatalogRuntime'
import { discoveryShareUrl } from './services/catalogNavigation'
import { submitQuoteRequest } from './services/quotes'
import type { CatalogImage, CatalogModel } from './types/catalog'

const formatter = new Intl.NumberFormat('pt-BR')
const MAX_QUOTE_ITEMS = 50
const MAX_COMPARE_MODELS = 4
const GALLERY_PAGE_SIZE = 12
const MAX_RECENT_MODELS = 12

type KnownModel = {
  name: string
  slug: string
}

type PreviewPageTarget = 'first' | 'last' | null
type GalleryPageToken = number | 'gap-left' | 'gap-right'

function initialSlugFromHash() {
  if (!window.location.hash.startsWith('#modelo=')) return ''
  try {
    return decodeURIComponent(window.location.hash.slice(8))
  } catch {
    return ''
  }
}

function galleryPageTokens(pageIndex: number, totalPages: number): GalleryPageToken[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index)
  const visible = new Set([0, totalPages - 1, pageIndex - 1, pageIndex, pageIndex + 1])
  const pages = Array.from(visible).filter((page) => page >= 0 && page < totalPages).sort((a, b) => a - b)
  const tokens: GalleryPageToken[] = []
  pages.forEach((page, index) => {
    const previous = pages[index - 1]
    if (index > 0 && page - previous > 1) tokens.push(page < pageIndex ? 'gap-left' : 'gap-right')
    tokens.push(page)
  })
  return tokens
}

function loadStoredIds(key: string, maxItems = 100) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))).slice(0, maxItems)
  } catch {
    return []
  }
}

function ModelArt({ model, compact = false, angle = 0 }: { model: CatalogModel; compact?: boolean; angle?: number }) {
  return (
    <div className={`model-art ${compact ? 'model-art--compact' : ''}`} style={{ '--accent': model.accent } as React.CSSProperties}>
      {model.coverUrl ? (
        <img className="model-art__image" src={model.coverUrl} alt={model.name} loading={compact ? 'lazy' : 'eager'} decoding="async" />
      ) : (
        <>
          <div className="model-art__halo" />
          <div className="model-art__figure" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}>
            <span className="model-art__head" /><span className="model-art__shoulders" /><span className="model-art__torso" />
            <span className="model-art__leg model-art__leg--left" /><span className="model-art__leg model-art__leg--right" /><span className="model-art__weapon" />
          </div>
          <div className="model-art__base" />
        </>
      )}
      <div className="model-art__grain" />
    </div>
  )
}

function GalleryArt({ image, model, angle = 0 }: { image: CatalogImage; model: CatalogModel; angle?: number }) {
  if (image.url) return <div className="gallery-real-image"><img src={image.url} alt={`${model.name} — vista`} loading="lazy" decoding="async" /></div>
  return <ModelArt model={model} compact angle={angle} />
}

function loadKnownModels(): Record<string, KnownModel> {
  try {
    const stored = JSON.parse(localStorage.getItem('tonecos:known-models') ?? '{}') as Record<string, string | KnownModel>
    return Object.fromEntries(Object.entries(stored).map(([id, value]) => [id, typeof value === 'string' ? { name: value, slug: '' } : value]))
  } catch { return {} }
}

export default function App() {
  const catalog = useCatalogRuntime(initialSlugFromHash())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rosterTrackRef = useRef<HTMLDivElement>(null)
  const previewPrefetchedUrls = useRef(new Set<string>())
  const [favorites, setFavorites] = useState<string[]>(() => loadStoredIds('tonecos:favorites'))
  const [quoteList, setQuoteList] = useState<string[]>(() => loadStoredIds('tonecos:quote', MAX_QUOTE_ITEMS))
  const [compareIds, setCompareIds] = useState<string[]>(() => loadStoredIds('tonecos:compare', MAX_COMPARE_MODELS))
  const [recentIds, setRecentIds] = useState<string[]>(() => loadStoredIds('tonecos:recent-models', MAX_RECENT_MODELS))
  const [knownModels, setKnownModels] = useState<Record<string, KnownModel>>(loadKnownModels)
  const [explorerOpen, setExplorerOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<CatalogImage | null>(null)
  const [previewPageTarget, setPreviewPageTarget] = useState<PreviewPageTarget>(null)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [quoteMode, setQuoteMode] = useState<'live' | 'demo' | null>(null)
  const [quoteReference, setQuoteReference] = useState('')
  const [submittedQuoteCount, setSubmittedQuoteCount] = useState(0)
  const [quoteSubmitting, setQuoteSubmitting] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [linkCopied, setLinkCopied] = useState(false)
  const [scopeLinkCopied, setScopeLinkCopied] = useState(false)

  const gallery = useModelGallery(catalog.mode, catalog.selected, galleryOpen)
  const selected = catalog.selected
  const visibleModels = catalog.models
  const selectedIndex = visibleModels.findIndex((model) => model.id === selected.id)
  const selectedInVisiblePage = selectedIndex >= 0
  const anyModalOpen = explorerOpen || recentOpen || compareOpen || galleryOpen || Boolean(previewImage) || favoritesOpen || quoteOpen
  const noResults = !catalog.loading && visibleModels.length === 0
  const searchCharacters = Array.from(catalog.search.trim()).length
  const searchActive = Boolean(catalog.search.trim()) && !catalog.searchPending
  const expandedImageUrl = previewImage?.detailUrl ?? previewImage?.url
  const previewIndex = previewImage ? gallery.items.findIndex((image) => image.id === previewImage.id) : -1
  const canPreviewPrevious = previewIndex > 0 || (previewIndex >= 0 && gallery.hasPreviousPage)
  const canPreviewNext = previewIndex >= 0 && (previewIndex < gallery.items.length - 1 || gallery.hasNextPage)
  const previewGlobalPosition = previewIndex >= 0 ? gallery.pageIndex * GALLERY_PAGE_SIZE + previewIndex + 1 : null
  const galleryTokens = galleryPageTokens(gallery.pageIndex, gallery.totalPages)
  const galleryProgress = gallery.total > 0 ? Math.min(100, (gallery.pageEnd / gallery.total) * 100) : 0

  const categoryLabel = catalog.categories.find((item) => item.id === catalog.category)?.label ?? 'Todos'
  const franchiseLabel = catalog.franchises.find((item) => item.id === catalog.franchise)?.label ?? (catalog.franchise === 'all' ? 'Todas as franquias' : selected.franchise || catalog.franchise)
  const catalogTotal = catalog.categories.find((item) => item.id === 'all')?.count ?? catalog.totalCount
  const demoEstimatedPages = Math.max(1, Math.ceil(catalog.totalCount / 12))
  const pageLabel = catalog.mode === 'live'
    ? catalog.searchPending ? `BUSCA · DIGITE ${catalog.searchMinLength}+ CARACTERES` : searchActive ? `BUSCA · PÁG. ${catalog.pageIndex + 1}` : `PÁG. ${catalog.pageIndex + 1}`
    : searchActive ? `${formatter.format(visibleModels.length)} RESULTADOS` : `PÁG. 1 / ${formatter.format(demoEstimatedPages)}`
  const stageIndexLabel = catalog.loading ? 'CARREGANDO' : noResults ? 'SEM RESULTADOS' : !selectedInVisiblePage ? 'LINK DIRETO' : searchActive ? `${String(selectedIndex + 1).padStart(3, '0')} / ${formatter.format(visibleModels.length)} NESTA PÁG.` : `${String(selectedIndex + 1).padStart(3, '0')} / ${formatter.format(catalog.totalCount)}`

  useEffect(() => localStorage.setItem('tonecos:favorites', JSON.stringify(favorites)), [favorites])
  useEffect(() => localStorage.setItem('tonecos:quote', JSON.stringify(quoteList)), [quoteList])
  useEffect(() => localStorage.setItem('tonecos:compare', JSON.stringify(compareIds)), [compareIds])
  useEffect(() => localStorage.setItem('tonecos:recent-models', JSON.stringify(recentIds)), [recentIds])
  useEffect(() => localStorage.setItem('tonecos:known-models', JSON.stringify(knownModels)), [knownModels])

  useEffect(() => {
    const seen = [...visibleModels, selected].filter((model) => model.id !== 'loading')
    if (!seen.length) return
    setKnownModels((current) => {
      const next = { ...current }; let changed = false
      for (const model of seen) {
        const known = next[model.id]
        if (!known || known.name !== model.name || known.slug !== model.slug) { next[model.id] = { name: model.name, slug: model.slug }; changed = true }
      }
      return changed ? next : current
    })
  }, [visibleModels, selected])

  useEffect(() => {
    if (selected.id === 'loading') return
    setRecentIds((current) => [selected.id, ...current.filter((id) => id !== selected.id)].slice(0, MAX_RECENT_MODELS))
  }, [selected.id])

  useEffect(() => {
    setLinkCopied(false); setPreviewImage(null); setPreviewPageTarget(null)
    document.title = selected.id === 'loading' ? 'Catálogo — Tonecos Studios' : `${selected.name} — Tonecos Studios`
  }, [selected.id, selected.name])

  useEffect(() => {
    setScopeLinkCopied(false)
  }, [catalog.category, catalog.franchise, catalog.search])

  useEffect(() => {
    if (!selectedInVisiblePage) return
    const frame = window.requestAnimationFrame(() => {
      const activeCard = rosterTrackRef.current?.querySelector<HTMLElement>('.roster-card.is-active')
      if (!activeCard) return
      activeCard.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selected.id, selectedInVisiblePage, catalog.pageIndex])

  useEffect(() => {
    if (!previewPageTarget || gallery.loading || !gallery.items.length) return
    const target = previewPageTarget === 'first' ? gallery.items[0] : gallery.items[gallery.items.length - 1]
    setPreviewPageTarget(null); if (!target) return; prefetchPreview(target); setPreviewImage(target)
  }, [previewPageTarget, gallery.loading, gallery.items])

  useEffect(() => {
    if (!previewImage || previewIndex < 0) return
    const previous = gallery.items[previewIndex - 1]; const next = gallery.items[previewIndex + 1]
    if (previous) prefetchPreview(previous); if (next) prefetchPreview(next)
  }, [previewImage?.id, previewIndex, gallery.items])

  useEffect(() => {
    if (!anyModalOpen) return
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [anyModalOpen])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewImage) closePreview(); else if (quoteOpen) setQuoteOpen(false); else if (favoritesOpen) setFavoritesOpen(false); else if (compareOpen) setCompareOpen(false); else if (recentOpen) setRecentOpen(false); else if (galleryOpen) setGalleryOpen(false); else if (explorerOpen) setExplorerOpen(false)
        return
      }
      if (previewImage && event.key === 'ArrowRight') { event.preventDefault(); navigatePreview(1); return }
      if (previewImage && event.key === 'ArrowLeft') { event.preventDefault(); navigatePreview(-1); return }
      if (galleryOpen && !previewImage && event.key === 'PageDown') { event.preventDefault(); gallery.nextPage(); return }
      if (galleryOpen && !previewImage && event.key === 'PageUp') { event.preventDefault(); gallery.previousPage(); return }
      if (galleryOpen && !previewImage && event.key === 'Home') { event.preventDefault(); gallery.goToPage(0); return }
      if (galleryOpen && !previewImage && event.key === 'End') { event.preventDefault(); gallery.goToPage(gallery.totalPages - 1); return }
      const target = event.target
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
      if (event.key === '/' && !isTyping && !anyModalOpen) { event.preventDefault(); searchInputRef.current?.focus(); return }
      if (isTyping || anyModalOpen) return
      if (event.key === 'ArrowRight') navigate(1); if (event.key === 'ArrowLeft') navigate(-1)
      if (event.key.toLowerCase() === 'f' && selected.id !== 'loading') toggleFavorite(selected.id)
      if (event.key.toLowerCase() === 'c' && selected.id !== 'loading') toggleCompare(selected.id)
      if (event.key.toLowerCase() === 'a' && selected.id !== 'loading') setGalleryOpen(true)
      if (event.key.toLowerCase() === 'e') setExplorerOpen(true)
      if (event.key === 'Enter' && selected.id !== 'loading') window.location.hash = `modelo=${encodeURIComponent(selected.slug)}`
    }
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey)
  })

  function toggleFavorite(id: string) { setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) }
  function toggleCompare(id: string) {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= MAX_COMPARE_MODELS) { setCompareOpen(true); return current }
      return [...current, id]
    })
  }
  function safeToggleQuote(id: string) {
    setQuoteList((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= MAX_QUOTE_ITEMS) { setQuoteError(`Cada solicitação aceita até ${MAX_QUOTE_ITEMS} modelos.`); setQuoteOpen(true); return current }
      return [...current, id]
    })
  }
  function openKnownModel(id: string, close: () => void) { const slug = knownModels[id]?.slug; if (!slug) return; close(); window.location.hash = `modelo=${encodeURIComponent(slug)}` }
  function addFavoritesToQuote() { setQuoteList((current) => { const next = [...current]; for (const id of favorites) { if (next.length >= MAX_QUOTE_ITEMS) break; if (!next.includes(id)) next.push(id) } return next }); setFavoritesOpen(false); setQuoteOpen(true) }
  function addComparisonToQuote(ids: string[]) { setQuoteList((current) => { const next = [...current]; for (const id of ids) { if (next.length >= MAX_QUOTE_ITEMS) break; if (!next.includes(id)) next.push(id) } return next }); setCompareOpen(false); setQuoteOpen(true) }
  function chooseExplorerCategory(category: string) { catalog.setSearch(''); catalog.setCategory(category) }
  function chooseExplorerFranchise(category: string, franchise: string) { catalog.setSearch(''); catalog.setCategory(category); catalog.setFranchise(franchise) }
  function closePreview() { setPreviewPageTarget(null); setPreviewImage(null) }
  function prefetchPreview(image: CatalogImage) { const url = image.detailUrl; if (!url || url === image.url || previewPrefetchedUrls.current.has(url)) return; previewPrefetchedUrls.current.add(url); const preload = new Image(); preload.decoding = 'async'; preload.src = url }
  function navigatePreview(offset: number) {
    if (!previewImage || gallery.loading || previewIndex < 0) return
    const nextImage = gallery.items[previewIndex + offset]
    if (nextImage) { prefetchPreview(nextImage); setPreviewImage(nextImage); return }
    if (offset > 0 && gallery.hasNextPage) { setPreviewPageTarget('first'); gallery.nextPage(); return }
    if (offset < 0 && gallery.hasPreviousPage) { setPreviewPageTarget('last'); gallery.previousPage() }
  }
  function navigate(offset: number) {
    if (!visibleModels.length) return
    if (!selectedInVisiblePage) { catalog.setSelectedId(visibleModels[offset > 0 ? 0 : visibleModels.length - 1].id); return }
    if (offset > 0 && selectedIndex >= visibleModels.length - 1 && catalog.hasNextPage) { catalog.goNextPage(); return }
    if (offset < 0 && selectedIndex <= 0 && catalog.hasPreviousPage) { catalog.goPreviousPage(); return }
    catalog.setSelectedId(visibleModels[(selectedIndex + offset + visibleModels.length) % visibleModels.length].id)
  }

  async function copyModelLink() {
    if (selected.id === 'loading') return
    const url = new URL(window.location.href)
    url.hash = `modelo=${encodeURIComponent(selected.slug)}`
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    try { await navigator.clipboard.writeText(url.toString()); setLinkCopied(true) } catch { setLinkCopied(false) }
  }

  async function copyDiscoveryLink() {
    const url = discoveryShareUrl({ category: catalog.category, franchise: catalog.franchise, search: catalog.search })
    try { await navigator.clipboard.writeText(url); setScopeLinkCopied(true) } catch { setScopeLinkCopied(false) }
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const turnstileToken = String(data.get('turnstileToken') ?? '').trim()
    if (catalog.mode === 'live' && !isTurnstileConfigured()) { setQuoteError('A proteção do formulário ainda não foi configurada no ambiente de produção.'); return }
    if (catalog.mode === 'live' && !turnstileToken) { setQuoteError('Conclua a verificação anti-bot antes de enviar.'); return }
    const submittedCount = quoteList.length
    setQuoteSubmitting(true); setQuoteError('')
    try {
      const result = await submitQuoteRequest({ name: String(data.get('name') ?? '').trim(), email: String(data.get('email') ?? '').trim(), notes: String(data.get('notes') ?? '').trim(), modelIds: quoteList, turnstileToken })
      setQuoteMode(result.mode); setQuoteReference(result.reference); setSubmittedQuoteCount(submittedCount)
      if (result.mode === 'live') setQuoteList([])
      setSent(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setQuoteError(message === 'turnstile_failed' ? 'A verificação anti-bot expirou ou não foi aceita. Tente novamente.' : 'Não foi possível enviar agora. Sua seleção continua salva neste navegador.')
      setTurnstileResetKey((current) => current + 1)
    } finally { setQuoteSubmitting(false) }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#catalogo" aria-label="Tonecos Studios — voltar ao catálogo"><span className="brand__title">CATÁLOGO</span><span className="brand__studio">TONECOS STUDIOS</span></a>
        <nav className="topnav" aria-label="Navegação principal"><a href="#catalogo" className="is-active">Catálogo</a><button type="button" onClick={() => setExplorerOpen(true)}>Explorar</button><button type="button" onClick={() => setRecentOpen(true)}>Recentes <b>{recentIds.length}</b></button><button type="button" onClick={() => setFavoritesOpen(true)}>Favoritos <b>{favorites.length}</b></button><button type="button" onClick={() => setCompareOpen(true)}>Comparar <b>{compareIds.length}</b></button><button type="button" onClick={() => setQuoteOpen(true)}>Orçamento <b>{quoteList.length}</b></button></nav>
        <label className={`searchbox ${catalog.searchPending ? 'is-pending' : ''}`}><span aria-hidden="true">⌕</span><input ref={searchInputRef} aria-label="Buscar no catálogo" value={catalog.search} onChange={(event) => catalog.setSearch(event.target.value)} placeholder="Buscar personagem, franquia ou categoria..." /><kbd aria-hidden="true">/</kbd></label>
      </header>

      <section className="scope-strip" aria-label="Navegação hierárquica">
        <div className="scope-strip__path"><span>CATÁLOGO</span><b>›</b><strong>{categoryLabel}</strong><b>›</b><strong>{franchiseLabel}</strong><b>›</b><span>{noResults ? 'Sem resultados' : selected.name}</span></div>
        <div className="scope-strip__franchises"><button type="button" className={catalog.franchise === 'all' ? 'is-active' : ''} onClick={() => catalog.setFranchise('all')}>TODAS</button>{catalog.franchises.map((item) => <button type="button" key={`${item.category}:${item.id}`} className={catalog.franchise === item.id ? 'is-active' : ''} onClick={() => catalog.setFranchise(item.id)}>{item.label}</button>)}{catalog.franchisesTruncated && <button type="button" className="scope-strip__explore" onClick={() => setExplorerOpen(true)}>Mais franquias…</button>}</div>
      </section>

      {catalog.hasActiveFilters && <section className="discovery-status" aria-label="Filtros ativos"><div className="discovery-status__content"><span className="discovery-status__eyebrow">Recorte atual</span>{catalog.category !== 'all' && <button type="button" className="discovery-chip" onClick={() => catalog.setCategory('all')}>Categoria <strong>{categoryLabel}</strong> ×</button>}{catalog.franchise !== 'all' && <button type="button" className="discovery-chip" onClick={() => catalog.setFranchise('all')}>Franquia <strong>{franchiseLabel}</strong> ×</button>}{catalog.search.trim() && <button type="button" className="discovery-chip" onClick={() => catalog.setSearch('')}>Busca <strong>{catalog.search.trim()}</strong> ×</button>}{catalog.searchPending && <span className="discovery-status__hint">Digite mais <strong>{catalog.searchMinLength - searchCharacters}</strong> caractere{catalog.searchMinLength - searchCharacters === 1 ? '' : 's'} para pesquisar no acervo completo.</span>}</div><div className="discovery-status__actions"><button type="button" className="discovery-share" onClick={copyDiscoveryLink}>{scopeLinkCopied ? '✓ Link do recorte copiado' : '↗ Copiar recorte'}</button><button type="button" className="discovery-reset" onClick={catalog.resetDiscovery}>Limpar filtros</button></div></section>}
      {catalog.error && <div className="runtime-alert" role="alert">{catalog.error}</div>}

      <main id="catalogo" className="catalog-layout" aria-busy={catalog.loading}>
        <aside className="category-panel panel"><div className="panel-title"><span>Categorias</span><small>{formatter.format(catalogTotal)}</small></div><div className="category-list">{catalog.categories.map((item) => <button type="button" key={item.id} className={catalog.category === item.id ? 'is-active' : ''} onClick={() => catalog.setCategory(item.id)} aria-pressed={catalog.category === item.id}><span className="category-mark">{catalog.category === item.id ? '◆' : '◇'}</span><strong>{item.label}</strong><em>{formatter.format(item.count)}</em></button>)}</div><div className="scale-note"><span className="scale-note__eyebrow">ACERVO DIGITAL</span><strong>{formatter.format(catalogTotal)}</strong><p>modelos organizados por categoria, franquia e personagem para uma navegação rápida e direta.</p><button type="button" className="scale-note__explore" onClick={() => setExplorerOpen(true)}>Explorar franquias <span>›</span></button></div></aside>

        <section className="selection-stage panel"><button type="button" className="stage-arrow stage-arrow--left" disabled={!visibleModels.length || catalog.loading} onClick={() => navigate(-1)} aria-label="Modelo anterior">‹</button><div className="stage-visual">{noResults ? <div className="empty-stage" role="status"><div className="empty-stage__inner"><span className="empty-stage__mark">⌕</span><span className="empty-stage__eyebrow">Nenhuma correspondência</span><h2>Nenhum modelo neste recorte</h2><p>Remova um filtro ou limpe a busca para voltar ao acervo completo. Nenhum item foi escondido ou removido do catálogo.</p><button type="button" onClick={catalog.resetDiscovery}>Voltar ao catálogo completo</button></div></div> : <><div className="stage-watermark">{selected.name.toUpperCase()}</div><div className="stage-index" aria-live="polite">{stageIndexLabel}</div><ModelArt model={selected} /><button type="button" className="gallery-badge" disabled={selected.id === 'loading'} onClick={() => setGalleryOpen(true)}><strong>{selected.galleryCount}</strong><span>IMAGENS</span><small>abrir galeria</small></button></>}</div><button type="button" className="stage-arrow stage-arrow--right" disabled={!visibleModels.length || catalog.loading} onClick={() => navigate(1)} aria-label="Próximo modelo">›</button></section>

        <aside className="detail-panel panel">{noResults ? <div className="detail-empty"><span>Exploração do acervo</span><h2>Refine menos para descobrir mais</h2><p>Os filtros são combinados. Limpe o recorte atual para voltar às categorias e franquias disponíveis.</p><button type="button" className="share-action" onClick={catalog.resetDiscovery}>Limpar busca e filtros</button><button type="button" className="share-action" onClick={() => setExplorerOpen(true)}>Abrir navegador de franquias</button></div> : <><div className="detail-counter">MODELO {selected.code}</div><h1>{selected.name}</h1><p className="franchise">{selected.franchise}</p><div className="breadcrumb"><span>{catalog.categories.find((item) => item.id === selected.category)?.label ?? selected.category}</span><b>›</b><span>{selected.franchise}</span><b>›</b><span>{selected.name}</span></div><p className="description">{selected.description || (catalog.mode === 'live' ? 'Informações detalhadas deste modelo serão exibidas aqui.' : '')}</p><dl className="spec-table"><div><dt>Altura aprox.</dt><dd>{selected.heightCm > 0 ? `${selected.heightCm} cm` : 'Sob consulta'}</dd></div><div><dt>Material</dt><dd>{selected.material}</dd></div><div><dt>Imagens</dt><dd>{selected.galleryCount} vistas</dd></div><div><dt>Código</dt><dd>{selected.code}</dd></div></dl><div className="detail-actions detail-actions--triple"><button type="button" disabled={selected.id === 'loading'} aria-pressed={favorites.includes(selected.id)} className={favorites.includes(selected.id) ? 'is-selected' : ''} onClick={() => toggleFavorite(selected.id)}>♡ Favoritar</button><button type="button" disabled={selected.id === 'loading'} aria-pressed={compareIds.includes(selected.id)} className={compareIds.includes(selected.id) ? 'is-selected' : ''} onClick={() => toggleCompare(selected.id)}>⇄ Comparar</button><button type="button" disabled={selected.id === 'loading'} aria-pressed={quoteList.includes(selected.id)} className={quoteList.includes(selected.id) ? 'is-selected' : ''} onClick={() => safeToggleQuote(selected.id)}>＋ Lista</button></div><button type="button" className="share-action" disabled={selected.id === 'loading'} onClick={copyModelLink}>{linkCopied ? '✓ Link copiado' : '↗ Copiar link deste modelo'}</button><button type="button" className="primary-action" disabled={selected.id === 'loading'} onClick={() => { if (!quoteList.includes(selected.id)) safeToggleQuote(selected.id); setQuoteOpen(true) }}>Solicitar orçamento <span>›</span></button></>}</aside>

        <section className="roster panel" aria-label="Seleção de modelos"><div className="roster-header"><div><strong>SELECIONE O PERSONAGEM</strong><span>{catalog.loading ? 'Carregando...' : noResults ? 'Nenhum modelo neste recorte' : `${visibleModels.length} modelos neste recorte`}</span></div><div className="roster-hint">← → navegar · ENTER link · A galeria · F favoritar · C comparar · E explorar · / buscar</div></div><div className="roster-track" ref={rosterTrackRef}>{noResults ? <div className="roster-empty"><strong>Sem modelos para exibir</strong><span>Altere a busca, categoria ou franquia acima.</span></div> : visibleModels.map((model, index) => <button type="button" key={model.id} aria-pressed={model.id === selected.id} className={`roster-card ${model.id === selected.id ? 'is-active' : ''}`} onClick={() => catalog.setSelectedId(model.id)}><ModelArt model={model} compact angle={(index % 3) - 1} /><span className="roster-card__index">{String(index + 1).padStart(3, '0')}</span><span className="roster-card__name">{model.name}</span><span className="roster-card__gallery">{model.galleryCount} fotos · {model.franchise}</span></button>)}</div><div className="roster-pagination"><span>{pageLabel}</span><button type="button" aria-label="Página anterior" disabled={!catalog.hasPreviousPage} onClick={catalog.goPreviousPage}>‹</button><button type="button" aria-label="Próxima página" disabled={!catalog.hasNextPage} onClick={catalog.goNextPage}>›</button></div></section>
      </main>

      <footer className="control-bar"><div><kbd>← →</kbd><span>Navegar</span></div><div><kbd>ENTER</kbd><span>Link do modelo</span></div><div><kbd>A</kbd><span>Galeria</span></div><div><kbd>F</kbd><span>Favoritar</span></div><div><kbd>C</kbd><span>Comparar</span></div><div><kbd>E</kbd><span>Explorar</span></div><div><kbd>/</kbd><span>Buscar</span></div><div className="control-bar__status"><span>{catalog.mode === 'live' ? 'Catálogo online' : 'Prévia em atualização'}</span><strong>{catalog.mode === 'live' ? 'ONLINE' : 'PREVIEW'}</strong></div></footer>

      <FranchiseBrowser open={explorerOpen} mode={catalog.mode} categories={catalog.categories} activeCategory={catalog.category} onClose={() => setExplorerOpen(false)} onSelectCategory={chooseExplorerCategory} onSelectFranchise={chooseExplorerFranchise} />

      <ModelComparison open={compareOpen} mode={catalog.mode} ids={compareIds} knownModels={knownModels} onClose={() => setCompareOpen(false)} onRemove={(id) => setCompareIds((current) => current.filter((item) => item !== id))} onClear={() => setCompareIds([])} onOpenModel={(id) => openKnownModel(id, () => setCompareOpen(false))} onAddToQuote={addComparisonToQuote} />

      {recentOpen && <div className="modal-backdrop" onMouseDown={() => setRecentOpen(false)}><section className="quote-modal recent-modal" role="dialog" aria-modal="true" aria-labelledby="recent-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span>HISTÓRICO LOCAL</span><h2 id="recent-title">Vistos recentemente</h2><p>{recentIds.length ? `${recentIds.length} modelos recentes salvos somente neste navegador.` : 'Nenhum modelo visitado ainda.'}</p></div><button type="button" aria-label="Fechar recentes" onClick={() => setRecentOpen(false)}>×</button></div>{recentIds.length ? <><div className="recent-list">{recentIds.map((id, index) => <button type="button" key={id} disabled={!knownModels[id]?.slug} onClick={() => openKnownModel(id, () => setRecentOpen(false))}><span>{String(index + 1).padStart(2, '0')}</span><strong>{knownModels[id]?.name ?? id}</strong><small>abrir modelo ↗</small></button>)}</div><div className="recent-actions"><button className="share-action" type="button" onClick={() => setRecentIds([])}>Limpar histórico</button></div></> : <div className="success-state"><strong>SEM HISTÓRICO</strong><p>Os últimos modelos vistos aparecerão aqui automaticamente, sem necessidade de login.</p><button type="button" onClick={() => setRecentOpen(false)}>Explorar catálogo</button></div>}</section></div>}

      {galleryOpen && <div className="modal-backdrop" onMouseDown={() => setGalleryOpen(false)}><section className="gallery-modal" role="dialog" aria-modal="true" aria-labelledby="gallery-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span>GALERIA DO PERSONAGEM</span><h2 id="gallery-title">{selected.name}</h2><p>{gallery.total ? `${formatter.format(gallery.pageStart)}–${formatter.format(gallery.pageEnd)} de ${formatter.format(gallery.total)} imagens` : `${selected.galleryCount} imagens`} · página {gallery.pageIndex + 1} de {gallery.totalPages}</p></div><button type="button" aria-label="Fechar galeria" onClick={() => setGalleryOpen(false)}>×</button></div>{gallery.error && <p className="runtime-alert" role="alert">{gallery.error}</p>}<div className="gallery-grid" aria-busy={gallery.loading}>{gallery.items.map((image, localIndex) => { const canPreview = Boolean(image.detailUrl ?? image.url); return <button type="button" key={image.id} disabled={!canPreview} aria-label={canPreview ? `Ampliar imagem ${gallery.pageIndex * GALLERY_PAGE_SIZE + localIndex + 1} de ${selected.name}` : undefined} className={image.role === 'cover' ? 'is-cover' : ''} onPointerEnter={() => prefetchPreview(image)} onFocus={() => prefetchPreview(image)} onClick={() => canPreview && setPreviewImage(image)}><GalleryArt image={image} model={selected} angle={((localIndex % 5) - 2) * 3} /><span>{image.role === 'cover' ? 'CAPA · MELHOR QUALIDADE' : `VISTA ${String(gallery.pageIndex * GALLERY_PAGE_SIZE + localIndex + 1).padStart(2, '0')}`}</span></button> })}{gallery.loading && <div className="gallery-loading">Carregando imagens...</div>}{!gallery.loading && !gallery.items.length && <div className="gallery-loading">Nenhuma imagem disponível nesta página.</div>}</div><div className="gallery-collection-progress"><div><strong>{gallery.total ? `${formatter.format(gallery.pageStart)}–${formatter.format(gallery.pageEnd)}` : '0'}</strong><span>de {formatter.format(gallery.total || selected.galleryCount)} imagens</span></div><div className="gallery-collection-progress__track" aria-hidden="true"><i style={{ width: `${galleryProgress}%` }} /></div><small>PgUp/PgDn navegar · Home/End início/fim</small></div><div className="gallery-footer gallery-footer--paged"><span>Miniaturas otimizadas na grade · alta resolução carregada somente ao ampliar.</span><div className="gallery-pager"><button type="button" aria-label="Primeira página da galeria" disabled={!gallery.hasPreviousPage || gallery.loading} onClick={() => gallery.goToPage(0)}>« início</button><button type="button" aria-label="Página anterior" disabled={!gallery.hasPreviousPage || gallery.loading} onClick={gallery.previousPage}>‹</button><div className="gallery-page-rail" aria-label="Páginas da galeria">{galleryTokens.map((token) => typeof token === 'number' ? <button type="button" key={token} aria-current={token === gallery.pageIndex ? 'page' : undefined} className={token === gallery.pageIndex ? 'is-current' : ''} disabled={gallery.loading} onClick={() => gallery.goToPage(token)}>{token + 1}</button> : <span key={token} aria-hidden="true">…</span>)}</div><button type="button" aria-label="Próxima página" disabled={!gallery.hasNextPage || gallery.loading} onClick={gallery.nextPage}>›</button><button type="button" aria-label="Última página da galeria" disabled={!gallery.hasNextPage || gallery.loading} onClick={() => gallery.goToPage(gallery.totalPages - 1)}>fim »</button></div></div></section></div>}

      {expandedImageUrl && previewImage && <div className="image-lightbox-backdrop" onMouseDown={closePreview}><section className="image-lightbox" role="dialog" aria-modal="true" aria-labelledby="lightbox-title" onMouseDown={(event) => event.stopPropagation()}><div className="image-lightbox__head"><div><span>VISUALIZAÇÃO · USE ← → PARA NAVEGAR</span><h2 id="lightbox-title">{selected.name}</h2></div><button type="button" aria-label="Fechar imagem ampliada" onClick={closePreview}>×</button></div><div className="image-lightbox__stage"><button type="button" className="image-lightbox__nav image-lightbox__nav--prev" aria-label="Imagem anterior" disabled={!canPreviewPrevious || gallery.loading} onClick={() => navigatePreview(-1)}>‹</button><img src={expandedImageUrl} alt={`${selected.name} — imagem ampliada`} /><button type="button" className="image-lightbox__nav image-lightbox__nav--next" aria-label="Próxima imagem" disabled={!canPreviewNext || gallery.loading} onClick={() => navigatePreview(1)}>›</button></div><div className="image-lightbox__footer"><span className="image-lightbox__position"><strong>{previewGlobalPosition ? `${formatter.format(previewGlobalPosition)} / ${formatter.format(gallery.total || selected.galleryCount)}` : 'Imagem do catálogo'}</strong>{previewImage.width > 0 && previewImage.height > 0 && <span>{formatter.format(previewImage.width)} × {formatter.format(previewImage.height)} px</span>}</span><a href={expandedImageUrl} target="_blank" rel="noreferrer">Abrir imagem em nova aba ↗</a></div></section></div>}

      {favoritesOpen && <div className="modal-backdrop" onMouseDown={() => setFavoritesOpen(false)}><section className="quote-modal" role="dialog" aria-modal="true" aria-labelledby="favorites-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span>COLEÇÃO PESSOAL</span><h2 id="favorites-title">Favoritos</h2><p>{favorites.length ? `${favorites.length} modelos salvos neste navegador.` : 'Nenhum modelo favoritado ainda.'}</p></div><button type="button" aria-label="Fechar favoritos" onClick={() => setFavoritesOpen(false)}>×</button></div>{favorites.length ? <><div className="quote-selected"><span>Modelos salvos</span><strong>{favorites.length}</strong></div><div className="quote-chips">{favorites.map((id) => <button type="button" key={id} disabled={!knownModels[id]?.slug} onClick={() => openKnownModel(id, () => setFavoritesOpen(false))}>{knownModels[id]?.name ?? id} ↗</button>)}</div><button className="primary-action" type="button" onClick={addFavoritesToQuote}>Adicionar favoritos ao orçamento <span>›</span></button><button className="share-action" type="button" onClick={() => setFavorites([])}>Limpar favoritos</button></> : <div className="success-state"><strong>LISTA VAZIA</strong><p>Use “♡ Favoritar” nos modelos que quiser guardar para comparar ou consultar depois.</p><button type="button" onClick={() => setFavoritesOpen(false)}>Voltar ao catálogo</button></div>}</section></div>}

      {quoteOpen && <div className="modal-backdrop" onMouseDown={() => setQuoteOpen(false)}><section className="quote-modal" role="dialog" aria-modal="true" aria-labelledby="quote-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span>FORMULÁRIO</span><h2 id="quote-title">Solicitar orçamento</h2><p>Envie sua seleção pelo formulário. Não é necessário informar telefone.</p></div><button type="button" aria-label="Fechar formulário" onClick={() => setQuoteOpen(false)}>×</button></div>{sent ? <div className="success-state"><strong>SOLICITAÇÃO REGISTRADA</strong><p>{quoteMode === 'live' ? 'Sua solicitação foi enviada com sucesso. Guarde o protocolo abaixo para referência.' : 'Esta prévia não envia pedidos reais. O protocolo abaixo demonstra como será a confirmação em produção.'}</p>{quoteReference && <div className="quote-receipt"><span>{quoteMode === 'live' ? 'PROTOCOLO' : 'PROTOCOLO DEMO'}</span><code>{quoteReference}</code><small>{submittedQuoteCount} modelo{submittedQuoteCount === 1 ? '' : 's'} nesta solicitação</small></div>}<button type="button" onClick={() => { setSent(false); setQuoteOpen(false) }}>Voltar ao catálogo</button></div> : <form onSubmit={submitQuote}><label>Nome completo<input required autoComplete="name" maxLength={120} name="name" placeholder="Seu nome" /></label><label>E-mail<input required autoComplete="email" maxLength={254} type="email" name="email" placeholder="voce@email.com" /></label><div className="quote-selected"><span>Itens selecionados</span><strong>{quoteList.length}/{MAX_QUOTE_ITEMS}</strong></div><div className="quote-chips">{quoteList.map((id) => <button type="button" key={id} onClick={() => safeToggleQuote(id)}>{knownModels[id]?.name ?? id} ×</button>)}</div><label>Observações<textarea maxLength={4000} name="notes" rows={5} placeholder="Quantidade, tamanho desejado, acabamento ou outras informações..." /></label>{catalog.mode === 'live' && <TurnstileWidget resetKey={turnstileResetKey} />}{quoteError && <p role="alert">{quoteError}</p>}<button className="primary-action" type="submit" disabled={!quoteList.length || quoteSubmitting || (catalog.mode === 'live' && !isTurnstileConfigured())}>{quoteSubmitting ? 'Enviando...' : 'Enviar solicitação'} <span>›</span></button></form>}</section></div>}
    </div>
  )
}
