import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LAST_LIVE_QUOTE_RECEIPT_KEY, isLiveQuoteReference, validateLiveQuoteConfirmation,
  receiptFromQuoteSubmission, parseLiveQuoteReceipt,
  readLastLiveQuoteReceipt, saveLastLiveQuoteReceipt, clearLastLiveQuoteReceipt,
} from '../src/services/quoteReceipt.ts'

const reference = 'TCS-1234-ABCD-7890-EF12-3456'
const time = new Date('2026-10-17T12:34:56.000Z')
function memoryStorage() {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

test('live API receipt persists only canonical, non-personal fields', () => {
  const receipt = receiptFromQuoteSubmission({ mode: 'live', reference }, 3, time)
  assert.deepEqual(receipt, { version: 1, reference, modelCount: 3, receivedAt: time.toISOString() })
  const storage = memoryStorage()
  assert.equal(saveLastLiveQuoteReceipt(receipt, storage), true)
  assert.deepEqual(readLastLiveQuoteReceipt(storage), receipt)
  const persisted = JSON.parse(storage.values.get(LAST_LIVE_QUOTE_RECEIPT_KEY))
  assert.deepEqual(Object.keys(persisted).sort(), ['modelCount', 'receivedAt', 'reference', 'version'])
})

test('demo mode and invalid server references never create live receipts', () => {
  assert.equal(receiptFromQuoteSubmission({ mode: 'demo', reference }, 1, time), null)
  assert.equal(receiptFromQuoteSubmission({ mode: 'live', reference: 'DEMO-1234' }, 1, time), null)
  assert.equal(receiptFromQuoteSubmission({ mode: 'live', reference }, 0, time), null)
  assert.equal(receiptFromQuoteSubmission({ mode: 'live', reference }, 51, time), null)
})

test('invalid and old-format storage is rejected, and unknown personal fields are discarded', () => {
  assert.equal(parseLiveQuoteReceipt('bad-json'), null)
  assert.equal(parseLiveQuoteReceipt(JSON.stringify({ version: 2, reference, modelCount: 1, receivedAt: time.toISOString() })), null)
  assert.equal(parseLiveQuoteReceipt(JSON.stringify({ version: 1, reference, modelCount: 1, receivedAt: 'invalid' })), null)
  const storage = memoryStorage()
  storage.setItem(LAST_LIVE_QUOTE_RECEIPT_KEY, JSON.stringify({
    version: 1, reference, modelCount: 1, receivedAt: time.toISOString(), email: 'not-persisted-on-read',
  }))
  assert.deepEqual(Object.keys(readLastLiveQuoteReceipt(storage)).sort(), ['modelCount', 'receivedAt', 'reference', 'version'])
  assert.equal(clearLastLiveQuoteReceipt(storage), true)
  assert.equal(readLastLiveQuoteReceipt(storage), null)
})

test('storage disabled does not create a false confirmation or crash', () => {
  const blocked = {
    getItem() { throw Error('blocked') },
    setItem() { throw Error('blocked') },
    removeItem() { throw Error('blocked') },
  }
  const receipt = receiptFromQuoteSubmission({ mode: 'live', reference }, 1, time)
  assert.equal(readLastLiveQuoteReceipt(blocked), null)
  assert.equal(saveLastLiveQuoteReceipt(receipt, blocked), false)
  assert.equal(clearLastLiveQuoteReceipt(blocked), false)
})


test('only an explicit received status with a canonical protocol confirms a live quote', () => {
  const data = { status: 'received', reference, deduplicated: false }
  assert.equal(isLiveQuoteReference(reference), true)
  assert.deepEqual(validateLiveQuoteConfirmation(data), {
    mode: 'live', reference, deduplicated: false,
  })
  assert.deepEqual(validateLiveQuoteConfirmation({ ...data, deduplicated: true }), {
    mode: 'live', reference, deduplicated: true,
  })
  const invalid = [
    null, '', [], {}, { ...data, status: undefined },
    { ...data, status: 'new' }, { ...data, status: 'error' },
    { ...data, reference: 'DEMO-AAAA' },
    { ...data, reference: 'TCS-INCOMPLETE' },
    { ...data, reference: 'TCS-1234-ABCD-7890-EF12-3456\n' },
    { ...data, reference: 'TCS-1234-ABCD-7890-EF12-3456 ' },
    { ...data, deduplicated: 'true' },
  ]
  for (const value of invalid) {
    assert.throws(() => validateLiveQuoteConfirmation(value), /quote_confirmation_invalid/)
  }
})

test('quote receipt SSOT cannot persist unconfirmed API response', () => {
  const memory = memoryStorage()
  const valid = validateLiveQuoteConfirmation({ reference, status: 'received' })
  const receipt = receiptFromQuoteSubmission(valid, 2, time)
  assert.equal(saveLastLiveQuoteReceipt(receipt, memory), true)
  const baseline = memory.getItem(LAST_LIVE_QUOTE_RECEIPT_KEY)
  assert.throws(() => validateLiveQuoteConfirmation({
    reference: 'DEMO-0000', status: 'received',
  }), /quote_confirmation_invalid/)
  assert.equal(memory.getItem(LAST_LIVE_QUOTE_RECEIPT_KEY), baseline)
})


test('quote client requires receipt validation and demo UI cannot claim production', async () => {
  const { readFileSync } = await import('node:fs')
  const quotesSource = readFileSync(new URL('../src/services/quotes.ts', import.meta.url), 'utf8')
  const dialogSource = readFileSync(new URL('../src/components/QuoteDialog.tsx', import.meta.url), 'utf8')
  assert.match(quotesSource, /return validateLiveQuoteConfirmation\(body\)/)
  assert.doesNotMatch(dialogSource, /O protocolo abaixo demonstra a confirmação em produção/)
  assert.match(dialogSource, /O código abaixo é apenas ilustrativo e não foi registrado em produção/)
})
