import type { FormEventHandler } from 'react'
import { TurnstileWidget, isTurnstileConfigured } from './TurnstileWidget'
import type { KnownModelSummary } from '../services/knownModelCache'

type Props = {
  open: boolean
  ids: string[]
  knownModels: Record<string, KnownModelSummary>
  maxItems: number
  mode: 'demo' | 'live'
  sent: boolean
  quoteMode: 'live' | 'demo' | null
  quoteReference: string
  submittedQuoteCount: number
  submitting: boolean
  error: string
  turnstileResetKey: number
  onClose: () => void
  onRemove: (id: string) => void
  onOpenModel: (id: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onDismissSuccess: () => void
}

export function QuoteDialog({
  open,
  ids,
  knownModels,
  maxItems,
  mode,
  sent,
  quoteMode,
  quoteReference,
  submittedQuoteCount,
  submitting,
  error,
  turnstileResetKey,
  onClose,
  onRemove,
  onOpenModel,
  onSubmit,
  onDismissSuccess,
}: Props) {
  if (!open) return null

  return (
    <div className="modal-backdrop quote-request-backdrop" onMouseDown={onClose}>
      <section
        className="quote-request-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quote-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head quote-request-head">
          <div>
            <span>{sent ? 'SOLICITAÇÃO' : 'MINHA LISTA'}</span>
            <h2 id="quote-title">{sent ? 'Solicitação registrada' : 'Solicitar orçamento'}</h2>
            <p>{sent ? 'Guarde o protocolo para referência.' : 'Revise os modelos selecionados antes de enviar.'}</p>
          </div>
          <button type="button" aria-label="Fechar formulário" onClick={onClose}>×</button>
        </div>

        {sent ? (
          <div className="quote-request-success">
            <span className="quote-request-success__mark" aria-hidden="true">✓</span>
            <strong>SOLICITAÇÃO REGISTRADA</strong>
            <p>{quoteMode === 'live'
              ? 'Sua solicitação foi enviada com sucesso. Guarde o protocolo abaixo para referência.'
              : 'Esta prévia não envia pedidos reais. O protocolo abaixo demonstra a confirmação em produção.'}</p>
            {quoteReference && (
              <div className="quote-receipt">
                <span>{quoteMode === 'live' ? 'PROTOCOLO' : 'PROTOCOLO DEMO'}</span>
                <code>{quoteReference}</code>
                <small>{submittedQuoteCount} modelo{submittedQuoteCount === 1 ? '' : 's'} nesta solicitação</small>
              </div>
            )}
            <button type="button" className="primary-action" onClick={onDismissSuccess}>Voltar ao catálogo <span>›</span></button>
          </div>
        ) : (
          <form className="quote-request-form" onSubmit={onSubmit}>
            <section className="quote-request-selection" aria-labelledby="quote-selection-title">
              <div className="quote-request-selection__head">
                <div>
                  <span>SELEÇÃO</span>
                  <strong id="quote-selection-title">Modelos no pedido</strong>
                </div>
                <b>{ids.length}/{maxItems}</b>
              </div>

              {ids.length ? (
                <div className="quote-request-items">
                  {ids.map((id, index) => (
                    <article key={id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <button
                        type="button"
                        className="quote-request-item__open"
                        disabled={!knownModels[id]?.slug}
                        onClick={() => onOpenModel(id)}
                      >
                        <strong>{knownModels[id]?.name ?? 'Modelo selecionado'}</strong>
                        <small>{knownModels[id]?.slug ? 'Abrir ficha para revisar ↗' : 'Referência preservada'}</small>
                      </button>
                      <button
                        type="button"
                        className="quote-request-item__remove"
                        aria-label={`Remover ${knownModels[id]?.name ?? id} da solicitação`}
                        onClick={() => onRemove(id)}
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="quote-request-empty">
                  <strong>Nenhum modelo selecionado</strong>
                  <span>Feche esta janela e use “+ Minha lista” nas fichas que quiser consultar.</span>
                </div>
              )}
            </section>

            <section className="quote-request-fields">
              <div className="quote-request-fields__grid">
                <label>
                  Nome completo
                  <input required autoComplete="name" maxLength={120} name="name" placeholder="Seu nome" />
                </label>
                <label>
                  E-mail
                  <input required autoComplete="email" maxLength={254} type="email" name="email" placeholder="voce@email.com" />
                </label>
              </div>

              <label>
                Observações
                <textarea maxLength={4000} name="notes" rows={4} placeholder="Quantidade, tamanho desejado, acabamento ou outras informações..." />
              </label>

              {mode === 'live' && <TurnstileWidget resetKey={turnstileResetKey} />}
              {error && <p className="quote-request-error" role="alert">{error}</p>}

              <div className="quote-request-submit">
                <span>{ids.length ? 'Sua seleção fica salva neste navegador até o envio.' : 'Adicione pelo menos um modelo para enviar.'}</span>
                <button
                  className="primary-action"
                  type="submit"
                  disabled={!ids.length || submitting || (mode === 'live' && !isTurnstileConfigured())}
                >
                  {submitting ? 'Enviando...' : 'Enviar solicitação'} <span>›</span>
                </button>
              </div>
            </section>
          </form>
        )}
      </section>
    </div>
  )
}
