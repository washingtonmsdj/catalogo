export type QuotePayload = {
  name: string
  email: string
  notes: string
  modelIds: string[]
  turnstileToken?: string
}

export type QuoteSubmitResult = {
  id: string
  reference: string
  mode: 'live' | 'demo'
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

function demoReference() {
  const compact = crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()
  return `DEMO-${compact.match(/.{1,4}/g)?.join('-') ?? compact}`
}

export async function submitQuoteRequest(payload: QuotePayload): Promise<QuoteSubmitResult> {
  if (!apiBase) {
    return { id: `demo-${crypto.randomUUID()}`, reference: demoReference(), mode: 'demo' }
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

  const body = await response.json() as { id: string; reference: string }
  return { id: body.id, reference: body.reference, mode: 'live' }
}
