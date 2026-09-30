import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  COLLECTION_STORAGE_KEY,
  MAX_COLLECTION_MODELS,
  MAX_COLLECTION_NAME,
  MAX_COLLECTIONS,
  createCollection,
  loadCollections,
  parseCollectionsBackup,
  renameCollection,
  saveCollections,
  serializeCollectionsBackup,
  toggleCollectionModel,
  type UserCollection,
} from '../services/collections'

type KnownModel = { name: string; slug: string }
type CollectionSort = 'added' | 'name'

type LocalSources = {
  known: Record<string, KnownModel>
  recent: string[]
  favorites: string[]
}

function loadIds(key: string, max = 100) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))).slice(0, max)
  } catch {
    return []
  }
}

function loadKnown(): Record<string, KnownModel> {
  try {
    const parsed = JSON.parse(localStorage.getItem('tonecos:known-models') ?? '{}') as Record<string, string | KnownModel>
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, value]) => {
      if (typeof value === 'string') return [[id, { name: value, slug: '' }]]
      if (!value || typeof value.name !== 'string') return []
      return [[id, { name: value.name, slug: typeof value.slug === 'string' ? value.slug : '' }]]
    }))
  } catch {
    return {}
  }
}

function loadSources(): LocalSources {
  return {
    known: loadKnown(),
    recent: loadIds('tonecos:recent-models', 12),
    favorites: loadIds('tonecos:favorites', 100),
  }
}

function newerCollection(current: UserCollection, incoming: UserCollection) {
  const currentTime = Date.parse(current.updatedAt)
  const incomingTime = Date.parse(incoming.updatedAt)
  if (Number.isFinite(incomingTime) && (!Number.isFinite(currentTime) || incomingTime > currentTime)) return incoming
  return current
}

function mergeCollections(current: UserCollection[], incoming: UserCollection[]) {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    const existing = byId.get(item.id)
    byId.set(item.id, existing ? newerCollection(existing, item) : item)
  }
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, MAX_COLLECTIONS)
}

function normalizedSearch(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR')
}

export function CollectionsDock() {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [collections, setCollections] = useState<UserCollection[]>(loadCollections)
  const [activeId, setActiveId] = useState('')
  const [sources, setSources] = useState<LocalSources>(loadSources)
  const [newName, setNewName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [collectionQuery, setCollectionQuery] = useState('')
  const [collectionSort, setCollectionSort] = useState<CollectionSort>('added')
  const [message, setMessage] = useState('')

  useEffect(() => saveCollections(collections), [collections])

  useEffect(() => {
    const syncCollections = (event: StorageEvent) => {
      if (event.key !== COLLECTION_STORAGE_KEY) return
      setCollections(loadCollections())
    }
    window.addEventListener('storage', syncCollections)
    return () => window.removeEventListener('storage', syncCollections)
  }, [])

  useEffect(() => {
    if (!open) return
    const freshCollections = loadCollections()
    const freshSources = loadSources()
    const nextActive = freshCollections.find((item) => item.id === activeId) ?? freshCollections[0] ?? null
    setCollections(freshCollections)
    setSources(freshSources)
    setMessage('')
    setActiveId(nextActive?.id ?? '')
    setRenameValue(nextActive?.name ?? '')
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const active = collections.find((item) => item.id === activeId) ?? null
  const currentModelId = sources.recent[0] ?? ''
  const candidateIds = useMemo(() => Array.from(new Set([...sources.recent, ...sources.favorites])).filter((id) => !active?.modelIds.includes(id)).slice(0, 24), [sources, active])
  const visibleCollectionIds = useMemo(() => {
    if (!active) return []
    const query = normalizedSearch(collectionQuery)
    const filtered = active.modelIds.filter((id) => {
      if (!query) return true
      const name = sources.known[id]?.name ?? ''
      return normalizedSearch(name).includes(query) || normalizedSearch(id).includes(query)
    })
    if (collectionSort === 'name') {
      return [...filtered].sort((left, right) => (sources.known[left]?.name ?? left).localeCompare(sources.known[right]?.name ?? right, 'pt-BR', { sensitivity: 'base' }))
    }
    return filtered
  }, [active, collectionQuery, collectionSort, sources.known])

  function persist(next: UserCollection[]) {
    setCollections(next)
    saveCollections(next)
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (collections.length >= MAX_COLLECTIONS) { setMessage(`Limite de ${MAX_COLLECTIONS} coleções neste navegador.`); return }
    try {
      const created = createCollection(newName)
      persist([created, ...collections])
      setActiveId(created.id)
      setRenameValue(created.name)
      setCollectionQuery('')
      setNewName('')
      setMessage('Coleção criada.')
    } catch {
      setMessage('Digite um nome para criar a coleção.')
    }
  }

  function updateActive(transform: (collection: UserCollection) => UserCollection) {
    if (!active) return
    try {
      persist(collections.map((item) => item.id === active.id ? transform(item) : item))
      setMessage('Coleção atualizada.')
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'collection_model_limit' ? `Cada coleção aceita até ${MAX_COLLECTION_MODELS} modelos.` : 'Não foi possível atualizar a coleção.')
    }
  }

  function selectCollection(id: string) {
    const item = collections.find((collection) => collection.id === id)
    setActiveId(id)
    setRenameValue(item?.name ?? '')
    setCollectionQuery('')
    setMessage('')
  }

  function handleRename() {
    if (!active) return
    try {
      const renamed = renameCollection(active, renameValue)
      persist(collections.map((item) => item.id === active.id ? renamed : item))
      setRenameValue(renamed.name)
      setMessage('Nome atualizado.')
    } catch {
      setMessage('O nome da coleção não pode ficar vazio.')
    }
  }

  function deleteActive() {
    if (!active) return
    const remaining = collections.filter((item) => item.id !== active.id)
    persist(remaining)
    setActiveId(remaining[0]?.id ?? '')
    setRenameValue(remaining[0]?.name ?? '')
    setCollectionQuery('')
    setMessage('Coleção excluída deste navegador.')
  }

  function exportBackup() {
    const blob = new Blob([serializeCollectionsBackup(collections)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    anchor.href = url
    anchor.download = `tonecos-colecoes-${date}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setMessage(`${collections.length} coleção${collections.length === 1 ? '' : 'ões'} exportada${collections.length === 1 ? '' : 's'} com sucesso.`)
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 1_000_000) { setMessage('O arquivo de backup é grande demais.'); return }
    try {
      const imported = parseCollectionsBackup(await file.text())
      const merged = mergeCollections(collections, imported)
      persist(merged)
      const nextActive = merged.find((item) => item.id === activeId) ?? merged[0] ?? null
      setActiveId(nextActive?.id ?? '')
      setRenameValue(nextActive?.name ?? '')
      setCollectionQuery('')
      setMessage(`Backup importado: ${imported.length} coleção${imported.length === 1 ? '' : 'ões'} válida${imported.length === 1 ? '' : 's'}.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setMessage(code === 'collection_backup_version' ? 'Este backup pertence a uma versão incompatível.' : 'Arquivo de backup inválido ou corrompido.')
    }
  }

  async function copyCollectionList() {
    if (!active) return
    const lines = active.modelIds.map((id, index) => `${index + 1}. ${sources.known[id]?.name ?? id}`)
    const text = `${active.name}\n${active.modelIds.length} modelo${active.modelIds.length === 1 ? '' : 's'}\n\n${lines.join('\n')}`
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Lista da coleção copiada para a área de transferência.')
    } catch {
      setMessage('Não foi possível copiar a lista neste navegador.')
    }
  }

  function openModel(id: string) {
    const slug = sources.known[id]?.slug
    if (!slug) return
    setOpen(false)
    window.location.hash = `modelo=${encodeURIComponent(slug)}`
  }

  return (
    <>
      <button type="button" className="collections-dock-trigger" onClick={() => setOpen(true)} aria-label="Abrir minhas coleções">
        <span>▤</span><strong>Coleções</strong><b>{collections.length}</b>
      </button>

      {open && <div className="modal-backdrop collections-backdrop" onMouseDown={() => setOpen(false)}>
        <section className="collections-modal" role="dialog" aria-modal="true" aria-labelledby="collections-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-head collections-head"><div><span>LISTAS LOCAIS</span><h2 id="collections-title">Minhas coleções</h2><p>Organize modelos por tema, pedido ou ideia. Tudo fica somente neste navegador.</p></div><button type="button" aria-label="Fechar coleções" onClick={() => setOpen(false)}>×</button></div>

          <div className="collections-layout">
            <aside className="collections-sidebar">
              <form onSubmit={handleCreate} className="collections-create">
                <label>Nova coleção<input value={newName} maxLength={MAX_COLLECTION_NAME} onChange={(event) => setNewName(event.target.value)} placeholder="Ex.: Terror, Presentes..." /></label>
                <button type="submit" disabled={collections.length >= MAX_COLLECTIONS}>＋ Criar</button>
              </form>
              <div className="collections-backup-actions">
                <button type="button" onClick={exportBackup} disabled={!collections.length}>Exportar backup</button>
                <button type="button" onClick={() => importInputRef.current?.click()}>Importar / mesclar</button>
                <input ref={importInputRef} className="collections-import-input" type="file" accept="application/json,.json" onChange={importBackup} />
                <small>Backup JSON versionado. A importação preserva a versão mais recente de cada coleção.</small>
              </div>
              <div className="collections-list">
                {collections.map((item) => <button type="button" key={item.id} className={item.id === activeId ? 'is-active' : ''} onClick={() => selectCollection(item.id)}><strong>{item.name}</strong><span>{item.modelIds.length} modelo{item.modelIds.length === 1 ? '' : 's'}</span></button>)}
                {!collections.length && <div className="collections-empty-mini">Crie sua primeira coleção para começar.</div>}
              </div>
            </aside>

            <div className="collections-content">
              {active ? <>
                <div className="collections-toolbar">
                  <label>Nome<input value={renameValue} maxLength={MAX_COLLECTION_NAME} onChange={(event) => setRenameValue(event.target.value)} /></label>
                  <button type="button" onClick={handleRename}>Salvar nome</button>
                  <button type="button" className="is-danger" onClick={deleteActive}>Excluir</button>
                </div>

                <div className="collections-quickadd">
                  <div><strong>Adicionar modelos</strong><span>{active.modelIds.length}/{MAX_COLLECTION_MODELS}</span></div>
                  {currentModelId && !active.modelIds.includes(currentModelId) && <button type="button" className="primary-action" onClick={() => updateActive((item) => toggleCollectionModel(item, currentModelId))}>＋ Adicionar último modelo visto</button>}
                </div>

                <div className="collections-model-controls">
                  <label><span>Buscar nesta coleção</span><input type="search" value={collectionQuery} onChange={(event) => setCollectionQuery(event.target.value)} placeholder="Nome ou código do modelo" /></label>
                  <label><span>Ordenar</span><select value={collectionSort} onChange={(event) => setCollectionSort(event.target.value as CollectionSort)}><option value="added">Ordem adicionada</option><option value="name">Nome A–Z</option></select></label>
                  <button type="button" onClick={copyCollectionList} disabled={!active.modelIds.length}>Copiar lista</button>
                  <div className="collections-model-summary"><strong>{visibleCollectionIds.length}</strong><span>de {active.modelIds.length} exibidos</span></div>
                </div>

                <div className="collections-models">
                  {visibleCollectionIds.map((id) => <article key={id}><button type="button" className="collections-model-open" disabled={!sources.known[id]?.slug} onClick={() => openModel(id)}><strong>{sources.known[id]?.name ?? id}</strong><small>{sources.known[id]?.slug ? 'abrir modelo ↗' : 'modelo ainda não visitado nesta sessão'}</small></button><button type="button" className="collections-remove" aria-label={`Remover ${sources.known[id]?.name ?? id}`} onClick={() => updateActive((item) => toggleCollectionModel(item, id))}>×</button></article>)}
                  {!active.modelIds.length && <div className="collections-empty"><strong>COLEÇÃO VAZIA</strong><p>Adicione o modelo atual, um favorito ou algum item visto recentemente.</p></div>}
                  {!!active.modelIds.length && !visibleCollectionIds.length && <div className="collections-empty"><strong>NENHUM RESULTADO</strong><p>Nenhum modelo desta coleção corresponde a “{collectionQuery.trim()}”.</p><button type="button" onClick={() => setCollectionQuery('')}>Limpar busca</button></div>}
                </div>

                {!!candidateIds.length && <div className="collections-sources"><div><strong>Favoritos e recentes</strong><span>atalhos disponíveis neste navegador</span></div><div className="collections-source-chips">{candidateIds.map((id) => <button type="button" key={id} onClick={() => updateActive((item) => toggleCollectionModel(item, id))}>＋ {sources.known[id]?.name ?? id}</button>)}</div></div>}
              </> : <div className="collections-empty collections-empty--main"><strong>ORGANIZE SEU CATÁLOGO</strong><h3>Crie listas do seu jeito</h3><p>Use coleções para separar Terror, Resident Evil, presentes, pedidos futuros ou qualquer seleção pessoal sem misturar Favoritos e Orçamento.</p></div>}
            </div>
          </div>
          {message && <div className="collections-message" role="status">{message}</div>}
        </section>
      </div>}
    </>
  )
}