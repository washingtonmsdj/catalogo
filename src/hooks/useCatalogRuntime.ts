import { useEffect, useMemo, useState } from 'react'
import { categories as demoCategories, models as demoModels } from '../data/mockCatalog'
import {
  checkCatalogApi,
  getCatalogModel,
  getCatalogRuntimeMode,
  listCatalogCategories,
  listCatalogFranchises,
  listCatalogImages,
  listCatalogModels,
  toCatalogImage,
} from '../services/catalogApi'
import type { CatalogModelCard } from '../services/catalogRepository'
import type { CatalogCategory, CatalogFranchise, CatalogImage, CatalogModel } from '../types/catalog'

const MODEL_PAGE_SIZE = 24
const GALLERY_PAGE_SIZE = 12

const emptyModel: CatalogModel = {
  id: 'loading',
  slug: 'loading',
  code: '—',
  name: 'Carregando catálogo',
  franchise: '',
  category: 'all',
  collection: '',
  material: '—',
  heightCm: 0,
  galleryCount: 0,
  description: '',
  tags: [],
  accent: '#8f7a5c',
  images: [],
}

function cardToModel(card: CatalogModelCard): CatalogModel {
  return {
    ...card,
    material: 'Sob consulta',
    heightCm: 0,
    description: '',
    tags: [],
    images: [],
  }
}

function demoFranchises(category: string): CatalogFranchise[] {
  const scoped = category === 'all' ? demoModels : demoModels.filter((model) => model.category === category)
  const counts = new Map<string, number>()
  for (const model of scoped) counts.set(model.franchise, (counts.get(model.franchise) ?? 0) + 1)
  return Array.from(counts, ([label, count]) => ({ id: label, label, count, category }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

function slugFromHash() {
  if (!window.location.hash.startsWith('#modelo=')) return ''
  try {
    return decodeURIComponent(window.location.hash.slice(8))
  } catch {
    return ''
  }
}

export function useCatalogRuntime(initialSlug = '') {
  const mode = getCatalogRuntimeMode()
  const [routeSlug, setRouteSlug] = useState(initialSlug)
  const [category, setCategoryState] = useState('all')
  const [franchise, setFranchiseState] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedId, setSelectedId] = useState(() => demoModels.find((model) => model.slug === initialSlug)?.id ?? demoModels[0].id)
  const [liveCategories, setLiveCategories] = useState<CatalogCategory[]>([])
  const [liveFranchises, setLiveFranchises] = useState<CatalogFranchise[]>([])
  const [liveModels, setLiveModels] = useState<CatalogModel[]>([])
  const [selectedDetail, setSelectedDetail] = useState<CatalogModel | null>(null)
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(mode === 'live')
  const [error, setError] = useState('')
  const [apiHealthy, setApiHealthy] = useState(mode === 'demo')

  useEffect(() => {
    const syncRoute = () => setRouteSlug(slugFromHash())
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), mode === 'live' ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [mode, search])

  useEffect(() => {
    if (mode !== 'live') return
    let cancelled = false
    setLoading(true)
    Promise.all([checkCatalogApi(), listCatalogCategories()])
      .then(([health, items]) => {
        if (cancelled) return
        setApiHealthy(health.ok)
        setLiveCategories(items)
        setError(health.ok ? '' : 'A API do catálogo não respondeu ao health check.')
      })
      .catch(() => {
        if (!cancelled) {
          setApiHealthy(false)
          setError('Não foi possível carregar a taxonomia do catálogo.')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode])

  useEffect(() => {
    if (mode !== 'live') return
    let cancelled = false
    listCatalogFranchises(category)
      .then((items) => { if (!cancelled) setLiveFranchises(items) })
      .catch(() => { if (!cancelled) setLiveFranchises([]) })
    return () => { cancelled = true }
  }, [mode, category])

  useEffect(() => {
    setCursorStack([undefined])
    setPageIndex(0)
    setSelectedDetail(null)
  }, [category, franchise, debouncedSearch])

  const currentCursor = cursorStack[pageIndex]

  useEffect(() => {
    if (mode !== 'live') return
    let cancelled = false
    setLoading(true)
    setError('')
    listCatalogModels({
      category,
      franchise,
      search: debouncedSearch || undefined,
      cursor: currentCursor,
      limit: MODEL_PAGE_SIZE,
    })
      .then((page) => {
        if (cancelled) return
        const items = page.items.map(cardToModel)
        setLiveModels(items)
        setNextCursor(page.nextCursor)
        if (!items.length) {
          setSelectedDetail(null)
          return
        }
        if (!items.some((model) => model.id === selectedId)) {
          setSelectedDetail(null)
          setSelectedId(items[0].id)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLiveModels([])
          setNextCursor(null)
          setSelectedDetail(null)
          setError('Não foi possível carregar esta página do catálogo.')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, category, franchise, debouncedSearch, currentCursor, selectedId])

  useEffect(() => {
    if (!routeSlug) return
    if (mode === 'demo') {
      const model = demoModels.find((item) => item.slug === routeSlug)
      if (model) setSelectedId(model.id)
      return
    }

    let cancelled = false
    getCatalogModel(routeSlug).then((model) => {
      if (cancelled || !model) return
      setSelectedDetail(model)
      setSelectedId(model.id)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [mode, routeSlug])

  useEffect(() => {
    if (mode !== 'live') return
    const card = liveModels.find((model) => model.id === selectedId)
    if (!card) return
    let cancelled = false
    getCatalogModel(card.slug).then((model) => {
      if (!cancelled && model) setSelectedDetail(model)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [mode, selectedId, liveModels])

  const demoVisibleModels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR')
    return demoModels.filter((model) => {
      const matchesCategory = category === 'all' || model.category === category
      const matchesFranchise = franchise === 'all' || model.franchise === franchise
      const haystack = `${model.name} ${model.franchise} ${model.collection} ${model.tags.join(' ')}`.toLocaleLowerCase('pt-BR')
      return matchesCategory && matchesFranchise && (!needle || haystack.includes(needle))
    })
  }, [category, franchise, search])

  const categories = mode === 'live' ? liveCategories : demoCategories
  const franchises = mode === 'live' ? liveFranchises : demoFranchises(category)
  const models = mode === 'live' ? liveModels : demoVisibleModels
  const selected = mode === 'live'
    ? selectedDetail ?? liveModels.find((model) => model.id === selectedId) ?? liveModels[0] ?? emptyModel
    : demoModels.find((model) => model.id === selectedId) ?? demoVisibleModels[0] ?? demoModels[0]

  useEffect(() => {
    if (mode === 'demo' && demoVisibleModels.length && !demoVisibleModels.some((model) => model.id === selectedId)) {
      setSelectedId(demoVisibleModels[0].id)
    }
  }, [mode, demoVisibleModels, selectedId])

  function setCategory(next: string) {
    setCategoryState(next)
    setFranchiseState('all')
    setSelectedDetail(null)
  }

  function setFranchise(next: string) {
    setFranchiseState(next)
    setSelectedDetail(null)
  }

  function goNextPage() {
    if (mode !== 'live' || !nextCursor) return
    const nextPage = pageIndex + 1
    setCursorStack((current) => [...current.slice(0, nextPage), nextCursor])
    setPageIndex(nextPage)
    setSelectedDetail(null)
  }

  function goPreviousPage() {
    if (mode !== 'live' || pageIndex === 0) return
    setPageIndex((current) => Math.max(0, current - 1))
    setSelectedDetail(null)
  }

  const totalCount = categories.find((item) => item.id === category)?.count ?? categories[0]?.count ?? models.length

  return {
    mode,
    apiHealthy,
    category,
    franchise,
    search,
    setCategory,
    setFranchise,
    setSearch,
    categories,
    franchises,
    models,
    selected,
    selectedId,
    setSelectedId,
    pageIndex,
    totalCount,
    hasPreviousPage: mode === 'live' && pageIndex > 0,
    hasNextPage: mode === 'live' && Boolean(nextCursor),
    goNextPage,
    goPreviousPage,
    loading,
    error,
  }
}

export function useModelGallery(mode: 'demo' | 'live', selected: CatalogModel, open: boolean) {
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [liveItems, setLiveItems] = useState<CatalogImage[]>([])
  const [liveTotal, setLiveTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setCursorStack([undefined])
    setPageIndex(0)
    setNextCursor(null)
    setLiveItems([])
    setLiveTotal(0)
    setError('')
  }, [selected.id])

  const cursor = cursorStack[pageIndex]

  useEffect(() => {
    if (mode !== 'live' || !open || selected.id === 'loading') return
    let cancelled = false
    setLoading(true)
    setError('')
    listCatalogImages(selected.slug, { cursor, limit: GALLERY_PAGE_SIZE })
      .then((page) => {
        if (cancelled) return
        setLiveItems(page.items.map(toCatalogImage))
        setLiveTotal(page.total)
        setNextCursor(page.nextCursor)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar esta página da galeria.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, open, selected.id, selected.slug, cursor])

  const demoTotal = selected.galleryCount
  const demoStart = pageIndex * GALLERY_PAGE_SIZE
  const demoLength = Math.max(0, Math.min(GALLERY_PAGE_SIZE, demoTotal - demoStart))
  const demoItems = useMemo<CatalogImage[]>(() => Array.from({ length: demoLength }, (_, index) => {
    const position = demoStart + index
    const source = selected.images[position]
    return source ?? {
      id: `demo-${selected.id}-${position}`,
      width: 0,
      height: 0,
      bytes: 0,
      role: position === 0 ? 'cover' : 'gallery',
      qualityScore: Math.max(1, 100 - position),
    }
  }), [demoLength, demoStart, selected])

  const total = mode === 'live' ? liveTotal : demoTotal
  const items = mode === 'live' ? liveItems : demoItems
  const totalPages = Math.max(1, Math.ceil(total / GALLERY_PAGE_SIZE))

  function nextPage() {
    if (mode === 'live') {
      if (!nextCursor) return
      const nextPageIndex = pageIndex + 1
      setCursorStack((current) => [...current.slice(0, nextPageIndex), nextCursor])
      setPageIndex(nextPageIndex)
      return
    }
    setPageIndex((current) => Math.min(totalPages - 1, current + 1))
  }

  function previousPage() {
    setPageIndex((current) => Math.max(0, current - 1))
  }

  return {
    items,
    total,
    pageIndex,
    totalPages,
    hasPreviousPage: pageIndex > 0,
    hasNextPage: mode === 'live' ? Boolean(nextCursor) : pageIndex < totalPages - 1,
    nextPage,
    previousPage,
    loading,
    error,
  }
}
