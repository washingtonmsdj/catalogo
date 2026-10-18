import type { QuoteSubmitResult } from './quotes'

export const LAST_LIVE_QUOTE_RECEIPT_KEY = 'tonecos:last-live-quote-receipt'
const LIVE_REFERENCE = /^TCS-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/

export type LiveQuoteReceipt = {
  version: 1
  reference: string
  modelCount: number
  receivedAt: string
}
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Only successful live responses yield a persistent receipt. Demo never does. */
export function receiptFromQuoteSubmission(
  result: QuoteSubmitResult,
  count: number,
  time: Date = new Date(),
): LiveQuoteReceipt | null {
  if (result.mode !== 'live' || !LIVE_REFERENCE.test(result.reference)) return null
  if (!Number.isInteger(count) || count < 1 || count > 50 || !Number.isFinite(time.getTime())) return null
  return { version: 1, reference: result.reference, modelCount: count, receivedAt: time.toISOString() }
}

export function parseLiveQuoteReceipt(raw: string | null): LiveQuoteReceipt | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const v = parsed as Record<string, unknown>
    if (v.version !== 1 || typeof v.reference !== 'string' || !LIVE_REFERENCE.test(v.reference)
      || typeof v.modelCount !== 'number' || !Number.isInteger(v.modelCount) || v.modelCount < 1 || v.modelCount > 50
      || typeof v.receivedAt !== 'string') return null
    const date = new Date(v.receivedAt)
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== v.receivedAt) return null
    return { version: 1, reference: v.reference, modelCount: v.modelCount as number, receivedAt: v.receivedAt }
  } catch { return null }
}

export function readLastLiveQuoteReceipt(storage: ReceiptStorage = localStorage): LiveQuoteReceipt | null {
  try { return parseLiveQuoteReceipt(storage.getItem(LAST_LIVE_QUOTE_RECEIPT_KEY)) }
  catch { return null }
}
export function saveLastLiveQuoteReceipt(receipt: LiveQuoteReceipt, storage: ReceiptStorage = localStorage): boolean {
  const validated = parseLiveQuoteReceipt(JSON.stringify(receipt))
  if (!validated) return false
  try { storage.setItem(LAST_LIVE_QUOTE_RECEIPT_KEY, JSON.stringify(validated)); return true }
  catch { return false }
}
export function clearLastLiveQuoteReceipt(storage: ReceiptStorage = localStorage): boolean {
  try { storage.removeItem(LAST_LIVE_QUOTE_RECEIPT_KEY); return true }
  catch { return false }
}
