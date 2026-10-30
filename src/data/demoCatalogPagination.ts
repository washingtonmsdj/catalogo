import { categories, models } from './mockCatalog'
import type { CatalogFolder, CatalogFranchise, CatalogModel } from '../types/catalog'

const demoEnabled = import.meta.env.VITE_CATALOG_MODE === 'demo'
const additionalFranchises: Record<string, string[]> = demoEnabled ? {
  games: ['Arcade Legends', 'Reinos do Norte', 'Lendas do Combate', 'Mundos Fantásticos'],
  anime: ['Lendas Orientais', 'Crônicas Celestes', 'Clãs do Horizonte', 'Espadas do Destino'],
  movies: ['Órbita Distante', 'Reinos da Magia', 'Aventuras do Tempo', 'Mundos Cinematográficos'],
  comics: ['Heróis Urbanos', 'Universo Cósmico', 'Vigilantes da Cidade', 'Equipes Extraordinárias'],
  horror: ['Noites de Névoa', 'Criaturas da Escuridão', 'Lendas da Meia-noite', 'Mansões Misteriosas'],
  tokusatsu: ['Defensores Gigantes', 'Patrulha Estelar', 'Heróis Transformáveis', 'Monstros Colossais'],
  originals: ['Coleção Solaris', 'Ateliê Neo Edo', 'Mundos Originais', 'Edições de Artista'],
  other: ['Peças de Exposição', 'Miniaturas Diversas', 'Coleções Especiais', 'Modelos de Estúdio'],
} : {}

const productLineNames = demoEnabled ? ['Linha Prime', 'Edição Especial', 'Art Scale', 'Coleção Clássica'] : []
const demoMaterials = demoEnabled ? ['Resina', 'PVC', 'Vinil', 'Impressão 3D'] : []
const seedPools = new Map<string, CatalogModel[]>()
const franchisePools = new Map<string, string[]>()
type DemoFolderGroup = { id: string; label: string; children: Array<{ id: string; label: string }> }
const sharedFolderGroups: DemoFolderGroup[] = [
  { id: 'personagens', label: 'Personagens', children: [{ id: 'herois', label: 'Heróis' }, { id: 'viloes', label: 'Vilões' }, { id: 'aliados', label: 'Aliados' }] },
  { id: 'criaturas', label: 'Criaturas', children: [{ id: 'chefes', label: 'Chefes' }, { id: 'monstros', label: 'Monstros' }, { id: 'companheiros', label: 'Companheiros' }] },
  { id: 'pecas', label: 'Peças e cenários', children: [{ id: 'armas', label: 'Armas' }, { id: 'armaduras', label: 'Armaduras' }, { id: 'dioramas', label: 'Dioramas' }] },
]
const folderGroupsByCategory: Record<string, DemoFolderGroup[]> = demoEnabled ? {
  all: sharedFolderGroups,
  games: sharedFolderGroups,
  anime: [
    { id: 'personagens', label: 'Personagens', children: [{ id: 'protagonistas', label: 'Protagonistas' }, { id: 'rivais', label: 'Rivais' }, { id: 'aliados', label: 'Aliados' }] },
    { id: 'grupos', label: 'Grupos e equipes', children: [{ id: 'equipes', label: 'Equipes' }, { id: 'familias', label: 'Famílias' }, { id: 'mestres', label: 'Mestres' }] },
    { id: 'cenas', label: 'Cenas e cenários', children: [{ id: 'batalhas', label: 'Batalhas' }, { id: 'locais', label: 'Locais' }, { id: 'dioramas', label: 'Dioramas' }] },
  ],
  movies: sharedFolderGroups,
  comics: sharedFolderGroups,
  horror: sharedFolderGroups,
  tokusatsu: sharedFolderGroups,
  originals: sharedFolderGroups,
  other: sharedFolderGroups,
} : {}
const modelTotal = categories.find((item) => item.id === 'all')?.count ?? 0

type DemoSegment = { category: string; start: number; count: number }
type DemoModelParts = {
  index: number
  segment: DemoSegment
  position: number
  seed: CatalogModel
  franchise: string
  folderPath: string
  isSeedModel: boolean
  collection: string
  material: string
  heightCm: number
}
const segments: DemoSegment[] = []
let nextStart = 0
for (const category of categories) {
  if (category.id === 'all' || category.count <= 0) continue
  segments.push({ category: category.id, start: nextStart, count: category.count })
  nextStart += category.count
}

function segmentFor(index: number) {
  return segments.find((segment) => index >= segment.start && index < segment.start + segment.count)
}

function franchisePool(category: string) {
  const cached = franchisePools.get(category)
  if (cached) return cached
  const seeds = models.filter((model) => model.category === category).map((model) => model.franchise)
  const pool = [...new Set([...seeds, ...(additionalFranchises[category] ?? [])])]
  franchisePools.set(category, pool)
  return pool
}

function folderGroups(category: string) {
  return folderGroupsByCategory[category] ?? []
}

function demoFolderPath(category: string, position: number, franchiseCount: number) {
  const groups = folderGroups(category)
  if (!groups.length) return ''
  const group = groups[Math.floor(position / Math.max(1, franchiseCount)) % groups.length]
  const childIndex = Math.floor(position / (Math.max(1, franchiseCount) * groups.length)) % group.children.length
  return `${group.id}/${group.children[childIndex].id}`
}

function folderLabel(category: string, path: string) {
  const parts = path.split('/').filter(Boolean)
  const groups = folderGroups(category)
  if (parts.length === 1) return groups.find((group) => group.id === parts[0])?.label ?? parts[0]
  return groups.find((group) => group.id === parts[0])?.children.find((child) => child.id === parts[1])?.label ?? parts.at(-1) ?? path
}

function modelPartsAt(index: number, segment = segmentFor(index)): DemoModelParts | undefined {
  if (!segment) return undefined

  const position = index - segment.start
  const pool = seedPool(segment.category)
  if (!pool.length) return undefined
  const seed = pool[position % pool.length]
  const franchises = franchisePool(segment.category)
  const franchise = franchises[position % franchises.length] ?? seed.franchise
  const folderPath = demoFolderPath(segment.category, position, franchises.length)
  const isSeedModel = position < pool.length && seed.category === segment.category && seed.franchise === franchise
  if (isSeedModel) {
    return { index, segment, position, seed, franchise, folderPath, isSeedModel,
      collection: seed.collection, material: seed.material, heightCm: seed.heightCm }
  }

  return {
    index,
    segment,
    position,
    seed,
    franchise,
    folderPath,
    isSeedModel,
    collection: productLineNames[position % productLineNames.length],
    material: demoMaterials[(position + Math.floor(position / productLineNames.length)) % demoMaterials.length],
    heightCm: Math.max(1, seed.heightCm + ((position % 5) - 2) * 2),
  }
}

function modelFromParts(parts: DemoModelParts): CatalogModel {
  if (parts.isSeedModel) return { ...parts.seed, folderPath: parts.folderPath }
  const suffix = String(parts.index + 1).padStart(6, '0')
  return {
    ...parts.seed,
    id: `demo-model-${suffix}`,
    slug: `${parts.seed.slug}-demo-${suffix}`,
    code: `TS-D${suffix}`,
    name: `${parts.seed.name} · ${suffix}`,
    franchise: parts.franchise,
    category: parts.segment.category,
    collection: parts.collection,
    material: parts.material,
    heightCm: parts.heightCm,
    folderPath: parts.folderPath,
    demoArtworkIndex: parts.seed.demoArtworkIndex ?? parts.index % 12,
  }
}

const normalizedTextCache = new Map<string, string>()
const seedSearchFields = new WeakMap<CatalogModel, { name: string; tags: string }>()

function normalizeSearchTerm(value: string) {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeDemoText(value: string) {
  const cached = normalizedTextCache.get(value)
  if (cached !== undefined) return cached
  const normalized = normalizeSearchTerm(value)
  normalizedTextCache.set(value, normalized)
  return normalized
}

function demoSearchMatches(parts: DemoModelParts, needle: string) {
  let seedFields = seedSearchFields.get(parts.seed)
  if (!seedFields) {
    seedFields = { name: normalizeDemoText(parts.seed.name), tags: normalizeDemoText(parts.seed.tags.join(' ')) }
    seedSearchFields.set(parts.seed, seedFields)
  }
  const franchise = normalizeDemoText(parts.franchise)
  const collection = normalizeDemoText(parts.collection)
  const material = normalizeDemoText(parts.material)
  const folder = normalizeDemoText(parts.folderPath.replaceAll('/', ' '))
  if (material.includes(needle) || collection.includes(needle) || seedFields.name.includes(needle)
    || franchise.includes(needle) || folder.includes(needle) || seedFields.tags.includes(needle)) return true
  const suffix = parts.isSeedModel ? '' : String(parts.index + 1).padStart(6, '0')
  if (suffix.includes(needle)) return true
  return `${seedFields.name}${parts.isSeedModel ? '' : ` · ${suffix}`} ${franchise} ${collection} ${material} ${folder} ${seedFields.tags}`.includes(needle)
}

function seedPool(category: string) {
  const cached = seedPools.get(category)
  if (cached) return cached
  const scoped = models.filter((model) => model.category === category)
  const pool = scoped.length ? scoped : models
  seedPools.set(category, pool)
  return pool
}

export function demoCatalogSize() {
  return modelTotal
}

export function demoFranchises(category: string): CatalogFranchise[] {
  const counts = new Map<string, number>()
  for (const segment of segments) {
    if (category !== 'all' && segment.category !== category) continue
    const pool = franchisePool(segment.category)
    if (!pool.length) continue
    const evenShare = Math.floor(segment.count / pool.length)
    const remainder = segment.count % pool.length
    for (const [index, label] of pool.entries()) {
      counts.set(label, (counts.get(label) ?? 0) + evenShare + (index < remainder ? 1 : 0))
    }
  }

  return Array.from(counts, ([label, count]) => ({ id: label, label, count, category }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

export function listDemoFolders(category: string, franchise: string, parent?: string) {
  const groups = folderGroups(category)
  const scopedSegments = category === 'all' ? segments : segments.filter((item) => item.category === category)
  if (!scopedSegments.length || franchise === 'all' || !groups.length) return { current: null, trail: [], items: [] as CatalogFolder[] }

  const parentPath = parent?.trim().replace(/^\/+|\/+$/g, '') ?? ''
  const counts = new Map<string, { count: number; hasChildren: boolean }>()
  let currentCount = 0

  for (const segment of scopedSegments) {
    const pool = franchisePool(segment.category)
    const pathCategory = category === 'all' ? 'all' : segment.category
    for (let position = 0; position < segment.count; position += 1) {
      if (pool[position % pool.length] !== franchise) continue
      const path = demoFolderPath(pathCategory, position, pool.length)
      if (!path || (parentPath && path !== parentPath && !path.startsWith(`${parentPath}/`))) continue
      if (parentPath) currentCount += 1
      const relative = parentPath ? path.slice(parentPath.length + 1) : path
      const [id, ...remaining] = relative.split('/')
      const existing = counts.get(id) ?? { count: 0, hasChildren: false }
      existing.count += 1
      existing.hasChildren ||= remaining.length > 0
      counts.set(id, existing)
    }
  }

  const items = [...counts].map(([id, value]) => ({
    id: parentPath ? `${parentPath}/${id}` : id,
    label: folderLabel(category, parentPath ? `${parentPath}/${id}` : id),
    count: value.count,
    hasChildren: value.hasChildren,
  }))
  const trail = parentPath.split('/').filter(Boolean).map((_, index, parts) => {
    const id = parts.slice(0, index + 1).join('/')
    return { id, label: folderLabel(category, id) }
  })
  const current = parentPath ? { id: parentPath, label: folderLabel(category, parentPath), count: currentCount } : null
  return { current, trail, items }
}

export function demoModelAt(index: number): CatalogModel | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= modelTotal) return undefined
  const parts = modelPartsAt(index)
  return parts ? modelFromParts(parts) : undefined
}

export function listDemoModels(query: {
  category: string
  franchise: string
  folder?: string
  search: string
  material?: string
  collection?: string
  minHeight?: number
  maxHeight?: number
  pageIndex: number
  limit: number
}) {
  const needle = normalizeSearchTerm(query.search.trim())
  const normalizedMaterial = query.material?.trim() ? normalizeSearchTerm(query.material.trim()) : undefined
  const normalizedCollection = query.collection?.trim() ? normalizeSearchTerm(query.collection.trim()) : undefined
  const pageStart = Math.max(0, query.pageIndex) * query.limit
  const items: CatalogModel[] = []
  let totalApprox = 0

  if (!needle && query.franchise === 'all' && !query.folder && !query.material && !query.collection && !query.minHeight && !query.maxHeight) {
    const includedSegments = segments.filter((segment) => query.category === 'all' || query.category === segment.category)
    totalApprox = includedSegments.reduce((total, segment) => total + segment.count, 0)
    let skip = pageStart
    for (const segment of includedSegments) {
      if (skip >= segment.count) {
        skip -= segment.count
        continue
      }
      for (let position = skip; position < segment.count && items.length < query.limit; position += 1) {
        const model = demoModelAt(segment.start + position)
        if (model) items.push(model)
      }
      skip = 0
      if (items.length >= query.limit) break
    }
    return { items, totalApprox }
  }

  for (const segment of segments) {
    if (query.category !== 'all' && query.category !== segment.category) continue
    for (let position = 0; position < segment.count; position += 1) {
      const index = segment.start + position
      const parts = modelPartsAt(index, segment)
      if (!parts) continue
      if (query.franchise !== 'all' && parts.franchise !== query.franchise) continue
      if (query.folder && parts.folderPath !== query.folder && !parts.folderPath.startsWith(`${query.folder}/`)) continue
      if (normalizedMaterial && !normalizeDemoText(parts.material).includes(normalizedMaterial)) continue
      if (normalizedCollection && !normalizeDemoText(parts.collection).includes(normalizedCollection)) continue
      if (query.minHeight && parts.heightCm < query.minHeight) continue
      if (query.maxHeight && parts.heightCm > query.maxHeight) continue
      if (needle && !demoSearchMatches(parts, needle)) continue

      if (totalApprox >= pageStart && items.length < query.limit) {
        items.push(modelFromParts(parts))
      }
      totalApprox += 1
    }
  }

  return { items, totalApprox }
}
