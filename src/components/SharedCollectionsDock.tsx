import { FormEvent, useEffect, useMemo, useState } from 'react'
import { TurnstileWidget, isTurnstileConfigured } from './TurnstileWidget'
import {
  MAX_COLLECTIONS,
  loadCollections,
  saveCollections,
  type UserCollection,
} from '../services/collections'
import {
  createSharedCollection,
  fetchSharedCollection,
  isSharedCollectionsLive,
  sharedCollectionPublicUrl,
  type SharedCollection,
} from '../services/sharedCollections'

type KnownModel = { name: string; slug: string }

function loadKnownModels(): Record<string, KnownModel> {
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

function saveSharedKnownModels(shared: SharedCollection) {
  const known = loadKnownModels()
  for (const item of shared.items) known[item.id] = { name: item.name, slug: item.slug }
  localStorage.setItem('tonecos:known-models', JSON.stringify(known))
}

function collectionFromShare(shared: SharedCollection): UserCollection {
  const now = new Date().toISOString()
  return {
    id: `shared:${shared.code}`,
    name: shared.name,
    modelIds: shared.items.map((item) => item.id),
    createdAt: shared.createdAt || now,
    updatedAt: now,
  }
}

function readableExpiration(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '30 dias'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date)
}

export function SharedCollectionsDock() {
  const live = isSharedCollectionsLive()
  const [open, setOpen] = useState(false)
  const [collections, setCollections] = useState<UserCollection[]>(loadCollections)
  const [selectedId, setSelectedId] = useState('')
  const [shareResult, setShareResult] = useState<SharedCollection | null>(null)
  const [incoming, setIncoming] = useState<SharedCollection | null>(null)
  const [loadingIncoming, setLoadingIncoming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const sync = () => {
      const current = loadCollections()
      setCollections(current)
      setSelectedId((id) => current.some((item) => item.id === id) ? id : current[0]?.id ?? '')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get('colecao')?.trim()
    if (!code) return
    setOpen(true)
    setLoadingIncoming(true)
    setError('')
    if (!live) {
      setLoadingIncoming(false)
      setError('Este link precisa da API online do catálogo para ser aberto.')
      return
    }
    let cancelled = false
    fetchSharedCollection(code)
      .then((shared) => {
        if (cancelled) return
        setIncoming(shared)
        saveSharedKnownModels(shared)
      })
      .catch((reason) => {
        if (cancelled) return
        const codeValue = reason instanceof Error ? reason.message : ''
        setError(codeValue === 'shared_collection_not_found'
          ? 'Esta coleção não existe ou o link já expirou.'
          : 'Não foi possível abrir esta coleção agora.')
      })
      .finally(() => { if (!cancelled) setLoadingIncoming(false) })
    return () => { cancelled = true }
  }, [live])

  useEffect(() => {
    if (!open) return
    const current = loadCollections()
    setCollections(current)
    setSelectedId((id) => current.some((item) => item.id === id) ? id : current[0]?.id ?? '')
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const selected = useMemo(() => collections.find((item) => item.id === selectedId) ?? null, [collections, selectedId])
  const shareUrl = shareResult ? sharedCollectionPublicUrl(shareResult.code) : ''

  function openShare() {
    setIncoming(null)
    setShareResult(null)
    setMessage('')
    setError('')
    setOpen(true)
  }

  async function submitShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !selected.modelIds.length) return
    if (!live) { setError('Compartilhamento por link ainda não está disponível neste ambiente.'); return }
    if (!isTurnstileConfigured()) { setError('A proteção anti-bot do compartilhamento ainda não foi configurada.'); return }
    const form = new FormData(event.currentTarget)
    const token = String(form.get('shareTurnstileToken') ?? '').trim()
    if (!token) { setError('Conclua a verificação anti-bot antes de criar o link.'); return }
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const shared = await createSharedCollection(selected.name, selected.modelIds, token)
      setShareResult(shared)
      setMessage(shared.deduplicated ? 'Este conteúdo já tinha um link válido; ele foi reutilizado.' : 'Link criado com sucesso.')
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : ''
      if (code === 'invalid_models') setError('Um ou mais modelos desta coleção não estão publicados no catálogo online.')
      else if (code === 'turnstile_failed') setError('A verificação anti-bot expirou ou não foi aceita. Tente novamente.')
      else if (code === 'share_protection_not_configured') setError('O compartilhamento ainda não foi habilitado no servidor.')
      else setError('Não foi possível criar o link agora. Sua coleção local não foi alterada.')
      setResetKey((value) => value + 1)
    } finally {
      setSubmitting(false)
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setMessage('Link copiado para a área de transferência.')
    } catch {
      setError('Não foi possível copiar automaticamente neste navegador.')
    }
  }

  function importIncoming() {
    if (!incoming) return
    const imported = collectionFromShare(incoming)
    const current = loadCollections()
    const existingIndex = current.findIndex((item) => item.id === imported.id)
    if (existingIndex < 0 && current.length >= MAX_COLLECTIONS) {
      setError(`Você já atingiu o limite de ${MAX_COLLECTIONS} coleções locais. Exclua uma antes de salvar esta.`)
      return
    }
    const next = existingIndex >= 0
      ? current.map((item, index) => index === existingIndex ? imported : item)
      : [imported, ...current]
    saveCollections(next)
    saveSharedKnownModels(incoming)
    setCollections(next)
    setSelectedId(imported.id)
    window.dispatchEvent(new StorageEvent('storage', { key: 'tonecos:collections' }))
    setMessage(existingIndex >= 0 ? 'Coleção compartilhada atualizada nas suas listas.' : 'Coleção salva nas suas listas locais.')
    setError('')
  }

  function openSharedModel(slug: string) {
    setOpen(false)
    window.location.hash = `modelo=${encodeURIComponent(slug)}`
  }

  return (
    <>
      <button type="button" className="collections-share-trigger" onClick={openShare} aria-label="Compartilhar uma coleção">↗</button>
      {open && <div className="modal-backdrop collections-share-backdrop" onMouseDown={() => setOpen(false)}>
        <section className="collections-share-modal" role="dialog" aria-modal="true" aria-labelledby="shared-collections-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-head"><div><span>LINK DE COLEÇÃO</span><h2 id="shared-collections-title">{incoming ? incoming.name : 'Compartilhar coleção'}</h2><p>{incoming ? 'Seleção compartilhada por link público temporário.' : 'Crie um link curto sem expor sua lista inteira na URL.'}</p></div><button type="button" aria-label="Fechar compartilhamento" onClick={() => setOpen(false)}>×</button></div>

          {loadingIncoming ? <div className="collections-share-state"><strong>CARREGANDO COLEÇÃO</strong><p>Buscando a seleção compartilhada…</p></div> : incoming ? <div className="collections-share-body">
            <div className="collections-share-summary"><div><span>Modelos disponíveis</span><strong>{incoming.availableCount}/{incoming.itemCount}</strong></div><div><span>Link válido até</span><strong>{readableExpiration(incoming.expiresAt)}</strong></div></div>
            {incoming.availableCount < incoming.itemCount && <p className="collections-share-warning">Alguns modelos desta seleção não estão mais publicados e foram omitidos.</p>}
            <div className="collections-share-items">{incoming.items.map((item, index) => <button type="button" key={item.id} onClick={() => openSharedModel(item.slug)}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.name}</strong><small>{item.franchise} · {item.category}</small></div><em>abrir ↗</em></button>)}</div>
            <button type="button" className="primary-action" disabled={!incoming.items.length} onClick={importIncoming}>Salvar em minhas coleções <span>›</span></button>
          </div> : <div className="collections-share-body">
            {!live ? <div className="collections-share-state"><strong>COMPARTILHAMENTO INDISPONÍVEL</strong><p>A interface local continua funcionando, mas links curtos exigem a API Cloudflare online.</p></div> : !collections.length ? <div className="collections-share-state"><strong>NENHUMA COLEÇÃO</strong><p>Crie uma coleção primeiro e depois volte aqui para gerar o link.</p></div> : <>
              <form className="collections-share-form" onSubmit={submitShare}>
                <label>Coleção<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShareResult(null); setMessage(''); setError('') }}>{collections.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.modelIds.length} modelo{item.modelIds.length === 1 ? '' : 's'}</option>)}</select></label>
                <div className="collections-share-privacy"><strong>O que será publicado</strong><p>Somente o nome da coleção e as referências dos modelos. Nenhum nome de cliente, e-mail ou dado do navegador é incluído.</p></div>
                {selected && !selected.modelIds.length && <p className="collections-share-warning">Adicione pelo menos um modelo antes de compartilhar.</p>}
                {!shareResult && isTurnstileConfigured() && <TurnstileWidget action="collection-share" fieldName="shareTurnstileToken" resetKey={resetKey} />}
                {!shareResult && <button type="submit" className="primary-action" disabled={!selected?.modelIds.length || submitting || !isTurnstileConfigured()}>{submitting ? 'Criando link…' : 'Criar link por 30 dias'} <span>›</span></button>}
              </form>
              {shareResult && <div className="collections-share-result"><span>LINK PRONTO · EXPIRA EM {readableExpiration(shareResult.expiresAt).toUpperCase()}</span><div><input readOnly value={shareUrl} aria-label="Link público da coleção" /><button type="button" onClick={copyShareLink}>Copiar link</button></div><small>Qualquer pessoa com este link poderá visualizar esta seleção até a data de expiração.</small></div>}
            </>}
          </div>}
          {error && <div className="collections-share-feedback is-error" role="alert">{error}</div>}
          {message && <div className="collections-share-feedback" role="status">{message}</div>}
        </section>
      </div>}
    </>
  )
}
