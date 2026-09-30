export type QuotePayload = {
  name: string
  email: string
  notes: string
  modelIds: string[]
  turnstileToken?: string
}

export type QuoteSubmitResult = {
  reference: string
  mode: 'live' | 'demo'
  deduplicated?: boolean
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

function demoReference() {
  const compact = crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()
  return `DEMO-${compact.match(/.{1,4}/g)?.join('-') ?? compact}`
}

export async function submitQuoteRequest(payload: QuotePayload): Promise<QuoteSubmitResult> {
  if (!apiBase) {
    return { reference: demoReference(), mode: 'demo', deduplicated: false }
  }

  const response = await fetch(`${apiBase}/api/quotes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `quote_submit_failed_${response.status}`)
  }

  const body = await response.json() as { reference: string; deduplicated?: boolean }
  if (!body.reference) throw new Error('quote_reference_missing')
  return { reference: body.reference, mode: 'live', deduplicated: body.deduplicated === true }
}
