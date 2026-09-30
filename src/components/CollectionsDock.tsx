import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  MAX_COLLECTION_MODELS,
  MAX_COLLECTION_NAME,
  MAX_COLLECTIONS,
  createCollection,
  loadCollections,
  renameCollection,
  saveCollections,
  toggleCollectionModel,
  type UserCollection,
} from '../services/collections'

type KnownModel = { name: string; slug: string }

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

export function CollectionsDock() {
  const [open, setOpen] = useState(false)
  const [collections, setCollections] = useState<UserCollection[]>(loadCollections)
  const [activeId, setActiveId] = useState('')
  const [sources, setSources] = useState<LocalSources>(loadSources)
  const [newName, setNewName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => saveCollections(collections), [collections])

  useEffect(() => {
    if (!open) return
    const freshCollections = loadCollections()
    const freshSources = loadSources()
    setCollections(freshCollections)
    setSources(freshSources)
    setMessage('')
    setActiveId((current) => current && freshCollections.some((item) => item.id === current) ? current : freshCollections[0]?.id ?? '')
  }, [open])

  const active = collections.find((item) => item.id === activeId) ?? null
  const currentModelId = sources.recent[0] ?? ''
  const candidateIds = useMemo(() => Array.from(new Set([...sources.recent, ...sources.favorites])).filter((id) => !active?.modelIds.includes(id)).slice(0, 24), [sources, active])

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
    setMessage('')
  }

  function handleRename() {
    if (!active) return
    try {
      updateActive((item) => renameCollection(item, renameValue))
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
    setMessage('Coleção excluída deste navegador.')
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
              <div className="collections-list">
                {collections.map((item) => <button type="button" key={item.id} className={item.id === activeId ? 'is-active' : ''} onClick={() => selectCollection(item.id)}><strong>{item.name}</strong><span>{item.modelIds.length} modelo{item.modelIds.length === 1 ? '' : 's'}</span></button>)}
                {!collections.length && <div className="collections-empty-mini">Crie sua primeira coleção para começar.</div>}
              </div>
            </aside>

            <div className="collections-content">
              {active ? <>
                <div className="collections-toolbar">
                  <label>Nome<input value={renameValue || active.name} maxLength={MAX_COLLECTION_NAME} onChange={(event) => setRenameValue(event.target.value)} /></label>
                  <button type="button" onClick={handleRename}>Salvar nome</button>
                  <button type="button" className="is-danger" onClick={deleteActive}>Excluir</button>
                </div>

                <div className="collections-quickadd">
                  <div><strong>Adicionar modelos</strong><span>{active.modelIds.length}/{MAX_COLLECTION_MODELS}</span></div>
                  {currentModelId && !active.modelIds.includes(currentModelId) && <button type="button" className="primary-action" onClick={() => updateActive((item) => toggleCollectionModel(item, currentModelId))}>＋ Adicionar último modelo visto</button>}
                </div>

                <div className="collections-models">
                  {active.modelIds.map((id) => <article key={id}><button type="button" className="collections-model-open" disabled={!sources.known[id]?.slug} onClick={() => openModel(id)}><strong>{sources.known[id]?.name ?? id}</strong><small>{sources.known[id]?.slug ? 'abrir modelo ↗' : 'modelo ainda não visitado nesta sessão'}</small></button><button type="button" className="collections-remove" aria-label={`Remover ${sources.known[id]?.name ?? id}`} onClick={() => updateActive((item) => toggleCollectionModel(item, id))}>×</button></article>)}
                  {!active.modelIds.length && <div className="collections-empty"><strong>COLEÇÃO VAZIA</strong><p>Adicione o modelo atual, um favorito ou algum item visto recentemente.</p></div>}
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
