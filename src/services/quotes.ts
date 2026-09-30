export type QuotePayload = {
  name: string
  email: string
  notes: string
  modelIds: string[]
}

export type QuoteSubmitResult = {
  id: string
  mode: 'live' | 'demo'
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export async function submitQuoteRequest(payload: QuotePayload): Promise<QuoteSubmitResult> {
  if (!apiBase) {
    return { id: `demo-${crypto.randomUUID()}`, mode: 'demo' }
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

  const body = await response.json() as { id: string }
  return { id: body.id, mode: 'live' }
}
