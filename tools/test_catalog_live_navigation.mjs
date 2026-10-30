import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Integration test: actual production frontend and API client, deterministic
// Worker-shaped responses intercepted in the browser. Never contacts D1.
const artifact = process.env.CATALOG_LIVE_ARTIFACT_DIR
const evidence = process.env.CATALOG_VISUAL_DIR
assert.ok(artifact && evidence, 'Live artifact and evidence paths required')
async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a live preview port')
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

const configuredPort = Number.parseInt(process.env.CATALOG_LIVE_PREVIEW_PORT ?? '', 10)
const previewPort = Number.isInteger(configuredPort) && configuredPort > 0
  ? configuredPort
  : await availablePort()
const origin = `http://127.0.0.1:${previewPort}`
const apiBase = 'http://127.0.0.1:4174/__catalog_contract__'
const profiles = [
  { name: 'mobile-320', width: 320, height: 760 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-1024', width: 1024, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
]
const requestedProfile = process.env.CATALOG_LIVE_PROFILE
const selectedProfiles = requestedProfile ? profiles.filter(profile => profile.name === requestedProfile) : profiles
if (requestedProfile && selectedProfiles.length !== 1) throw Error(`Unknown live-contract profile: ${requestedProfile}`)
const report = { source: 'Isolated live-mode build with Worker-shaped fixtures; NOT real D1 or production', profiles: [], failures: [] }
const pause = ms => new Promise(done => setTimeout(done, ms))
const largeCatalogTotal = 20320

// Fields and paths are the response contract from worker/index.ts. Data is
// intentionally synthetic and is used only in this test, never in the bundle.
const model = (id, name, folder_path, franchise_slug = 'saga-alfa') => ({
  id, slug: id, code: 'R29-' + id.toUpperCase(),
  name, variant_name: '', franchise: franchise_slug === 'saga-alfa' ? 'Saga Alfa' : 'Saga Vazia',
  franchise_slug, category: 'Jogos', category_slug: 'games',
  collection: 'Coleção escala', folder_path,
  image_count: 1, gallery_version: 1, cover_storage_key: 'test-media/catalog-card.webp',
  material: 'PVC', height_cm: 30, description: 'Modelo de contrato de navegação.',
})
const cards = [
  model('ayla', 'Ayla Colecionável', 'herois/personagens/ayla'),
  model('baruk', 'Baruk Colecionável', 'viloes/baruk'),
]
const largeCatalog = Array.from({ length: largeCatalogTotal }, (_, index) => {
  const serial = String(index + 1).padStart(5, '0')
  const matchesFacet = index % 2 === 0
  return {
    ...model(`bulk-${serial}`, `Modelo escalável ${serial}`, 'modelos/acervo'),
    collection: matchesFacet ? 'Coleção escala' : 'Coleção standard',
    material: matchesFacet ? 'PVC' : 'Resina',
    height_cm: matchesFacet ? 30 : 80,
  }
})
const franchises = [
  { id: 'saga-alfa', label: 'Saga Alfa', count: 2, category: 'games', cover_storage_key: null },
  { id: 'saga-vazia', label: 'Saga Vazia', count: 0, category: 'games', cover_storage_key: null },
]
const group = (id, label, count = 1) => ({ id, label, count, hasChildren: true })
const leaf = (id, label, count = 1) => ({ id, label, count, hasChildren: false })

function responseFor(path, search, state) {
  const params = new URLSearchParams(search)
  if (path === '/api/health') return { ok: true, service: 'tonecos-catalogo' }
  if (path === '/api/categories') return { items: [
    { id: 'all', label: 'Todos', count: state.largeCatalog ? largeCatalogTotal : 2, cover_storage_key: null },
    { id: 'games', label: 'Jogos', count: state.largeCatalog ? largeCatalogTotal : 2, cover_storage_key: null },
  ] }
  if (path === '/api/franchises') {
    const category = params.get('category')
    const term = params.get('q')?.toLocaleLowerCase('pt-BR')
    return { items: franchises.filter(f =>
      (!category || f.category === category) && (!term || f.label.toLocaleLowerCase('pt-BR').includes(term)))
      .map(item => state.largeCatalog ? { ...item, count: item.id === 'saga-alfa' ? largeCatalogTotal : 0 } : item),
      truncated: false }
  }
  if (path === '/api/folders') {
    const category = params.get('category')
    const franchise = params.get('franchise')
    const parent = params.get('parent') || ''
    if (category !== 'games' || !franchises.some(f => f.id === franchise)) return { status: 400, body: { error: 'folder_scope_required' } }
    state.folderCalls.push({ franchise, parent })
    if (franchise === 'saga-vazia') return { current: null, trail: [], items: [] }
    if (!parent) return { current: null, trail: [], items: [
      group('herois', 'Heróis'), group('viloes', 'Vilões'), group('extras', 'Extras'),
    ] }
    if (parent === 'herois') return { current: { id: 'herois', label: 'Heróis', count: 1 },
      trail: [{ id: 'herois', label: 'Heróis' }], items: [group('herois/personagens', 'Personagens')] }
    if (parent === 'herois/personagens') {
      state.deepRequests += 1
      if (state.deepRequests === 1) return { status: 503, body: { error: 'temporarily_unavailable' } }
      return { current: { id: parent, label: 'Personagens', count: 1 },
        trail: [{ id: 'herois', label: 'Heróis' }, { id: parent, label: 'Personagens' }],
        items: [leaf('herois/personagens/ayla', 'Ayla')] }
    }
    if (parent === 'herois/personagens/ayla') return {
      current: { id: parent, label: 'Ayla', count: 1 },
      trail: [
        { id: 'herois', label: 'Heróis' },
        { id: 'herois/personagens', label: 'Personagens' },
        { id: parent, label: 'Ayla' },
      ], items: [],
    }
    return { current: { id: parent, label: parent.split('/').at(-1), count: 0 }, trail: [], items: [] }
  }
  if (path === '/api/catalog') {
    const category = params.get('category')
    const franchise = params.get('franchise')
    const folder = params.get('folder')
    const term = params.get('q')?.toLocaleLowerCase('pt-BR')
    const material = params.get('material')?.toLocaleLowerCase('pt-BR') ?? ''
    const collection = params.get('collection')?.toLocaleLowerCase('pt-BR') ?? ''
    const minHeight = Number(params.get('minHeight')) || 0
    const maxHeight = Number(params.get('maxHeight')) || 0
    state.catalogCalls.push({
      category,
      franchise,
      folder,
      query: term ?? '',
      material,
      collection,
      minHeight: params.get('minHeight'),
      maxHeight: params.get('maxHeight'),
      cursor: params.get('cursor'),
      limit: Number(params.get('limit')),
    })
    const allItems = state.largeCatalog && !term && !folder && franchise !== 'saga-vazia' ? largeCatalog : cards
    const filteredItems = allItems.filter(m =>
      (!category || category === m.category_slug) &&
      (!franchise || franchise === m.franchise_slug) &&
      (!folder || m.folder_path === folder || m.folder_path.startsWith(folder + '/')) &&
      (!term || `${m.name} ${m.code}`.toLocaleLowerCase('pt-BR').includes(term)) &&
      (!material || m.material.toLocaleLowerCase('pt-BR').includes(material)) &&
      (!collection || m.collection.toLocaleLowerCase('pt-BR').includes(collection)) &&
      (!minHeight || m.height_cm >= minHeight) &&
      (!maxHeight || m.height_cm <= maxHeight))
    if (!state.largeCatalog || term) return { items: filteredItems, nextCursor: null }
    const rawCursor = params.get('cursor')
    let start = 0
    if (rawCursor) {
      const cursor = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'))
      start = filteredItems.findIndex(item => item.name.localeCompare(cursor.name, 'en', { sensitivity: 'base' }) > 0
        || (item.name.toLocaleLowerCase('en') === cursor.name.toLocaleLowerCase('en') && item.id > cursor.id))
      if (start < 0) start = filteredItems.length
    }
    const limit = Number(params.get('limit')) || 48
    const items = filteredItems.slice(start, start + limit)
    const last = items.at(-1)
    const nextCursor = start + limit < filteredItems.length && last
      ? Buffer.from(JSON.stringify({ name: last.name, id: last.id })).toString('base64url')
      : null
    return { items, nextCursor }
  }
  if (path.startsWith('/api/models/')) {
    const slug = decodeURIComponent(path.slice('/api/models/'.length))
    const item = [...cards, ...(state.largeCatalog ? largeCatalog : [])].find(m => m.slug === slug)
    return item || { status: 404, body: { error: 'model_not_found' } }
  }
  return { status: 404, body: { error: 'unexpected_fixture_endpoint' } }
}

async function preview(server) {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw Error('Live test preview exited')
    try {
      const resp = await fetch(origin, { signal: AbortSignal.timeout(1200) })
      if (resp.ok) return
    } catch { /* awaiting local preview */ }
    await pause(250)
  }
  throw Error('Live test preview startup timeout')
}

function assertExpectedHttpErrors(entry, expectsFolderRetry) {
  const observed = entry.httpErrors.map(({ status, url }) => {
    const request = new URL(url)
    return [status, request.pathname, request.searchParams.get('franchise'), request.searchParams.get('parent')]
  })
  const expected = expectsFolderRetry
    ? [[503, '/__catalog_contract__/api/folders', 'saga-alfa', 'herois/personagens']]
    : []
  assert.deepEqual(observed, expected, 'Only the deliberate nested-folder retry may return an HTTP error')
  entry.expectedHttpErrors = entry.httpErrors.splice(0)
  if (expectsFolderRetry) {
    assert.equal(entry.consoleErrors.length, 1, 'The deliberate folder retry should produce one browser console error')
    assert.match(entry.consoleErrors[0], /503 \(Service Unavailable\)/)
    entry.expectedConsoleErrors = entry.consoleErrors.splice(0)
  } else {
    assert.deepEqual(entry.consoleErrors, [], 'The desktop journey must not emit console errors')
  }
}

async function exercise(browser, spec) {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height }, reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  const state = { folderCalls: [], catalogCalls: [], deepRequests: 0, unexpected: [], largeCatalog: true }
  const entry = { ...spec, checks: [], pageErrors: [], consoleErrors: [], httpErrors: [] }
  page.on('pageerror', error => entry.pageErrors.push(error.stack || error.message))
  page.on('console', message => { if (message.type() === 'error') entry.consoleErrors.push(message.text().slice(0, 2500)) })
  page.on('response', response => {
    if (response.status() >= 400) entry.httpErrors.push({ status: response.status(), url: response.url() })
  })
  report.profiles.push(entry)

  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.href.startsWith(apiBase + '/')) {
      const path = requestUrl.pathname.slice('/__catalog_contract__'.length)
      if (path === '/test-media/catalog-card.webp') {
        await route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs><linearGradient id="g"><stop stop-color="#28231f"/><stop offset="1" stop-color="#58351f"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><circle cx="160" cy="72" r="34" fill="#e8833c"/><path d="M91 226c7-74 27-111 69-111s62 37 69 111" fill="#d4a37b"/><path d="m108 150-43 58 24 16 48-53m75-21 43 59-25 16-48-53" fill="#b96835"/></svg>',
        })
        return
      }
      if (path === '/api/catalog' && new URLSearchParams(requestUrl.search).get('q') === 'baruk') {
        await pause(800)
      }
      const data = responseFor(path, requestUrl.search, state)
      const status = data.status || 200
      const body = data.body || data
      if (status === 404 && body.error === 'unexpected_fixture_endpoint') state.unexpected.push(path)
      await route.fulfill({
        status, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      })
    } else if (requestUrl.origin === origin) {
      await route.continue()
    } else {
      state.unexpected.push('external:' + requestUrl.origin)
      await route.abort()
    }
  })

  try {
    const start = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 })
    assert.equal(start?.status(), 200)
    await page.waitForFunction(() => Boolean(document.querySelector('.storefront-model-grid .storefront-model-card, .fatal-state')), null, { timeout: 10000 })
    if (await page.locator('.fatal-state').count()) {
      throw Error('Live catalog failed during initial render. ' + JSON.stringify({ pageErrors: entry.pageErrors, consoleErrors: entry.consoleErrors, unexpected: state.unexpected }))
    }
    const expectedInitialCount = state.largeCatalog ? 48 : 2
    await page.waitForFunction(expected => document.querySelectorAll('.storefront-model-grid .storefront-model-card__main').length === expected,
      expectedInitialCount,
      { timeout: 10000 })
    const catalogSearch = page.getByRole('combobox', { name: 'Buscar no catálogo' })
    await catalogSearch.fill('ayla')
    await page.locator('.storefront-model-grid.is-results .storefront-model-card__meta b').filter({ hasText: 'R29-AYLA' }).waitFor({ state: 'visible', timeout: 10000 })
    await catalogSearch.fill('baruk')
    await page.waitForTimeout(450)
    assert.equal(await page.locator('.storefront-model-grid.is-results .storefront-model-card__main').count(), 0,
      'A result page from the previous search must be hidden while the new cursor request is pending')
    assert.ok(await page.locator('.storefront-model-grid--skeleton').isVisible(),
      'The pending search must show its loading state instead of stale models')
    await page.locator('.storefront-model-grid.is-results .storefront-model-card__meta b').filter({ hasText: 'R29-BARUK' }).waitFor({ state: 'visible', timeout: 10000 })
    await catalogSearch.fill('')
    await page.waitForFunction(expected => document.querySelectorAll('.storefront-model-grid .storefront-model-card__main').length === expected,
      expectedInitialCount,
      { timeout: 10000 })
    await catalogSearch.evaluate(element => element.blur())
    entry.checks.push('new live search immediately hides stale cursor results until its matching page resolves')
    if (state.largeCatalog) {
      assert.equal(await page.locator('.storefront-model-grid.is-results .storefront-model-card__main').count(), 48,
        'Live mode must render one complete page from an acervo larger than 20k models')
      assert.match(await page.locator('.storefront-results-hero__copy > strong').innerText(), /20,3\s+mil/)
      const readPageCodes = () => page.locator('.storefront-model-grid.is-results .storefront-model-card__meta b').allTextContents()
      const firstPageCodes = await readPageCodes()
      assert.equal(firstPageCodes[0], 'R29-BULK-00001')
      const cardCovers = page.locator('.storefront-model-grid.is-results .storefront-model-card__media img')
      assert.equal(await cardCovers.count(), 48)
      assert.equal(await cardCovers.nth(0).getAttribute('loading'), 'eager')
      assert.equal(await cardCovers.nth(0).getAttribute('fetchpriority'), 'high')
      assert.equal(await cardCovers.nth(5).getAttribute('loading'), 'eager')
      assert.equal(await cardCovers.nth(6).getAttribute('loading'), 'lazy')
      await page.waitForFunction(() => {
        const cover = document.querySelector('.storefront-model-grid.is-results .storefront-model-card__media img')
        return cover instanceof HTMLImageElement && cover.complete && cover.naturalWidth > 0
      }, null, { timeout: 7000 })
      entry.checks.push('live 20k+ cards render card-variant covers with bounded eager loading')
      const nextPage = page.locator('.storefront-results-footer').getByRole('button', { name: 'Próxima ›' })
      await nextPage.focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00049',
        null, { timeout: 10000 })
      await page.waitForFunction(() => {
        const heading = document.querySelector('#destaques .storefront-section__head h2')
        const bounds = heading?.getBoundingClientRect()
        return document.activeElement === heading && heading.matches(':focus-visible')
          && bounds && bounds.top >= 0 && bounds.bottom <= innerHeight
      }, null, { timeout: 7000 })
      assert.match(await page.locator('#destaques .storefront-section__head p').innerText(), /página 2/i,
        'Live cursor page count must announce the newly loaded page')
      const secondPageCodes = await readPageCodes()
      assert.equal(secondPageCodes.length, 48)
      assert.equal(firstPageCodes.some(code => secondPageCodes.includes(code)), false,
        'Adjacent live cursor pages must not duplicate models')
      const previousPage = page.locator('.storefront-results-footer').getByRole('button', { name: '‹ Anterior' })
      await previousPage.focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00001',
        null, { timeout: 10000 })
      await page.waitForFunction(() => document.activeElement === document.querySelector('#destaques .storefront-section__head h2'),
        null, { timeout: 7000 })
      assert.deepEqual(await readPageCodes(), firstPageCodes, 'Previous cursor navigation must restore the first page')
      await nextPage.focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00049',
        null, { timeout: 10000 })
      const changeScopeCallStart = state.catalogCalls.length
      await catalogSearch.fill('bulky')
      await page.waitForFunction(() => document.querySelector('.storefront-results-hero__copy h1')?.textContent?.includes('bulky'),
        null, { timeout: 10000 })
      await pause(350)
      const changedScopeCalls = state.catalogCalls.slice(changeScopeCallStart).filter((call) => call.query === 'bulky')
      assert.deepEqual(changedScopeCalls.map((call) => call.cursor), [null],
        'Changing search from page 2 must request only the new scope first page, never the previous scope cursor')
      entry.checks.push('scope changes from page 2 do not issue an obsolete-cursor catalog read')
      await catalogSearch.fill('')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00001',
        null, { timeout: 10000 })
      await nextPage.focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00049',
        null, { timeout: 10000 })
      const filterToggle = page.locator('.storefront-filterbar__filters')
      await filterToggle.click()
      const facetForm = page.getByRole('form', { name: 'Filtros de atributos' })
      const invalidFacetCallStart = state.catalogCalls.length
      await facetForm.getByLabel('Mínima').fill('35')
      await facetForm.getByLabel('Máxima').fill('25')
      await facetForm.getByRole('button', { name: 'Aplicar filtros' }).click()
      await page.getByRole('alert').filter({ hasText: 'A altura mínima não pode ser maior que a máxima.' }).waitFor({ state: 'visible' })
      assert.equal(state.catalogCalls.length, invalidFacetCallStart, 'An invalid height range must not issue a catalog request')
      assert.equal(new URL(page.url()).searchParams.has('altura-min'), false, 'An invalid height range must not leak into the shareable URL')
      assert.equal((await readPageCodes())[0], 'R29-BULK-00049', 'An invalid draft must preserve the currently rendered cursor page')
      entry.checks.push('invalid height range is announced without changing URL, results or cursor')
      await facetForm.getByLabel('Material').fill('pvc')
      await facetForm.getByLabel('Coleção').fill('escala')
      await facetForm.getByLabel('Mínima').fill('25')
      await facetForm.getByLabel('Máxima').fill('35')
      const facetCallStart = state.catalogCalls.length
      await facetForm.getByRole('button', { name: 'Aplicar filtros' }).click()
      await page.waitForFunction(() => location.search.includes('material=pvc') && location.search.includes('colecao-modelo=escala')
        && location.search.includes('altura-min=25') && location.search.includes('altura-max=35'), null, { timeout: 7000 })
      await page.waitForFunction(() => document.querySelectorAll('.storefront-model-grid.is-results .storefront-model-card__main').length === 48,
        null, { timeout: 10000 })
      assert.equal((await readPageCodes())[0], 'R29-BULK-00001', 'Applying live facets on page 2 must restart at the first filtered page')
      const firstFacetCalls = state.catalogCalls.slice(facetCallStart).filter((call) => call.material === 'pvc')
      assert.deepEqual(firstFacetCalls.map((call) => [call.cursor, call.collection, call.minHeight, call.maxHeight]), [
        [null, 'escala', '25', '35'],
      ], 'Live facets must reach one first-page request without a stale cursor')
      await page.getByRole('button', { name: 'Copiar link' }).click()
      await page.getByRole('status').filter({ hasText: 'Link do recorte copiado.' }).waitFor({ state: 'visible' })
      const sharedScope = new URL(await page.evaluate(() => navigator.clipboard.readText()))
      assert.equal(sharedScope.searchParams.get('material'), 'pvc')
      assert.equal(sharedScope.searchParams.get('colecao-modelo'), 'escala')
      assert.equal(sharedScope.searchParams.get('altura-min'), '25')
      assert.equal(sharedScope.searchParams.get('altura-max'), '35')
      assert.equal(sharedScope.searchParams.has('colecao-link'), false)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), spec.width,
        'The share action and copy status must not introduce horizontal page overflow')
      if (spec.width <= 620) {
        const activeFilters = page.locator('.storefront-active-filters')
        assert.equal(await activeFilters.evaluate((node) => node.scrollWidth),
          await activeFilters.evaluate((node) => node.clientWidth),
          'Mobile active filters must wrap instead of hiding actions in an undiscoverable horizontal strip')
        for (const label of ['Copiar link', 'Salvar filtros', 'Limpar tudo']) {
          const action = page.getByRole('button', { name: label, exact: true })
          assert.ok(await action.isVisible(), `Mobile users must see the ${label} action`)
          const bounds = await action.boundingBox()
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= spec.width,
            `The ${label} action must remain inside the mobile viewport`)
        }
      }
      if (spec.width === 390) await page.locator('.storefront-active-filters').screenshot({
        path: resolve(evidence, 'r29-mobile-390-shared-filters.png'), animations: 'disabled',
      })
      entry.checks.push('copyable discovery links preserve live search and attribute scope without opening shared-list links')
      if (spec.width <= 620) {
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => { throw new DOMException('Permission denied', 'NotAllowedError') } },
        }))
        await page.getByRole('button', { name: 'Copiar link', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'A cópia automática falhou.' }).waitFor({ state: 'visible' })
        const fallbackLink = page.getByRole('textbox', { name: 'Link compartilhável do recorte' })
        assert.ok(await fallbackLink.isVisible(), 'Clipboard failure must expose a selectable share URL')
        const fallbackScope = new URL(await fallbackLink.inputValue())
        assert.equal(fallbackScope.searchParams.get('material'), 'pvc')
        assert.equal(fallbackScope.searchParams.get('colecao-modelo'), 'escala')
        const fallbackBounds = await fallbackLink.boundingBox()
        assert.ok(fallbackBounds && fallbackBounds.x >= 0 && fallbackBounds.x + fallbackBounds.width <= spec.width,
          'The manual-copy fallback must fit inside the mobile viewport')
        await fallbackLink.focus()
        assert.equal(await fallbackLink.evaluate((node) => node.selectionStart === 0 && node.selectionEnd === node.value.length), true,
          'Focusing the manual-copy fallback must select the full discovery URL')
        const activeFilters = page.locator('.storefront-active-filters')
        const fallbackLayout = await activeFilters.evaluate((node) => ({
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          children: [...node.children].map((child) => {
            const rect = child.getBoundingClientRect()
            const style = getComputedStyle(child)
            return { className: child.className, x: rect.x, right: rect.right, width: rect.width,
              scrollWidth: child.scrollWidth, boxSizing: style.boxSizing, flex: style.flex, whiteSpace: style.whiteSpace }
          }),
        }))
        assert.equal(await activeFilters.evaluate((node) => node.scrollWidth),
          await activeFilters.evaluate((node) => node.clientWidth),
          `The manual-copy fallback must not reintroduce mobile horizontal scrolling: ${JSON.stringify(fallbackLayout)}`)
        if (spec.width === 320) await activeFilters.screenshot({
          path: resolve(evidence, 'r29-mobile-320-share-fallback.png'), animations: 'disabled',
        })
        entry.checks.push('clipboard denial exposes a selectable full URL inside the mobile active-filter layout')
      }
      const filteredFirstCodes = await readPageCodes()
      await page.getByRole('button', { name: 'Salvar filtros' }).click()
      const savedFilters = page.getByRole('group', { name: 'Filtros salvos' })
      await savedFilters.waitFor({ state: 'visible' })
      assert.match(await savedFilters.innerText(), /PVC.*escala.*25 cm.*35 cm/i)
      await page.waitForFunction(() => localStorage.getItem('tonecos:catalog-saved-filters-v1')?.toLocaleLowerCase('en-US').includes('pvc'))
      const reloadedFacetCallStart = state.catalogCalls.length
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00001',
        null, { timeout: 10000 })
      const reloadedSavedFilters = page.getByRole('group', { name: 'Filtros salvos' })
      await reloadedSavedFilters.waitFor({ state: 'visible' })
      assert.match(await reloadedSavedFilters.innerText(), /PVC.*escala.*25 cm.*35 cm/i,
        'Saved filter labels and values must survive a page reload')
      await page.locator('.storefront-results-footer').getByRole('button', { name: 'Próxima ›' }).click()
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00097',
        null, { timeout: 10000 })
      const filteredSecondCodes = await readPageCodes()
      assert.equal(filteredSecondCodes.length, 48)
      assert.equal(filteredSecondCodes[0], 'R29-BULK-00097',
        'The filtered cursor must advance through matching models, skipping non-matching records')
      assert.ok(filteredFirstCodes.every(code => Number(code.slice(-5)) % 2 === 1)
        && filteredSecondCodes.every(code => Number(code.slice(-5)) % 2 === 1),
      'Filtered live pages must exclude records that fail material, collection or height predicates')
      assert.equal(filteredFirstCodes.some((code) => filteredSecondCodes.includes(code)), false,
        'Live facet cursor pages must stay complete and non-overlapping')
      const secondFacetCall = state.catalogCalls.filter((call) => call.material === 'pvc').at(-1)
      assert.equal(secondFacetCall?.collection, 'escala')
      assert.equal(secondFacetCall?.minHeight, '25')
      assert.equal(secondFacetCall?.maxHeight, '35')
      assert.ok(secondFacetCall?.cursor, 'The next live facet page must advance with its worker cursor')
      const reloadedFacetCalls = state.catalogCalls.slice(reloadedFacetCallStart).filter((call) => call.material === 'pvc')
      assert.deepEqual(reloadedFacetCalls.map((call) => call.cursor), [null, secondFacetCall?.cursor],
        'Reload must restore the saved scope at page 1 before cursor pagination resumes')
      const savedApplyCallStart = state.catalogCalls.length
      await reloadedSavedFilters.locator('.storefront-saved-filter > button').first().click()
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00001',
        null, { timeout: 10000 })
      const savedApplyCalls = state.catalogCalls.slice(savedApplyCallStart).filter((call) => call.material === 'pvc')
      assert.deepEqual(savedApplyCalls.map((call) => [call.cursor, call.collection, call.minHeight, call.maxHeight]), [
        [null, 'escala', '25', '35'],
      ], 'Applying the active saved filter from page 2 must restart from a cursorless first page')
      entry.checks.push('saved filters retain folder identity, persist through reload and restart the same live scope at page 1')
      await filterToggle.click()
      await facetForm.getByRole('button', { name: 'Limpar' }).click()
      await page.waitForFunction(() => !location.search.includes('material=') && !location.search.includes('colecao-modelo=')
        && !location.search.includes('altura-min=') && !location.search.includes('altura-max='), null, { timeout: 7000 })
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'R29-BULK-00001',
        null, { timeout: 10000 })
      await filterToggle.click()
      entry.checks.push('live material, collection and height facets restart from page 1 and preserve filtered cursors')
      entry.checks.push('live 20k+ total, complete 48-model cursor pages, no duplicates and back navigation')
    }
    if (spec.width >= 1200) {
      assert.ok(await page.locator('.storefront-sidebar').isVisible(), 'Desktop catalog navigation must remain in the sidebar')
      const columns = await page.locator('.storefront-model-grid.is-results').evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').length)
      assert.equal(columns, 4, 'The desktop live catalog must preserve the concept’s four-column model density')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), spec.width,
        'Desktop live catalog must not introduce horizontal overflow')
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForFunction(() => window.scrollY === 0)
      await pause(120)
      await page.screenshot({ path: resolve(evidence, 'r29-desktop-live-catalog.png'), fullPage: true, animations: 'disabled' })
      entry.checks.push('desktop sidebar, four-column density and viewport fit')
      assert.deepEqual(state.unexpected, [], 'No unsupported or external calls during the desktop live catalog journey')
      assertExpectedHttpErrors(entry, false)
      return
    }
    const openExplorer = async () => {
      const trigger = page.getByRole('button', { name: 'Explorar franquias e pastas' })
      assert.ok(await trigger.isVisible(), 'Mobile/tablet requires persistent hierarchy entry in header')
      const target = await trigger.boundingBox()
      assert.ok(target && target.width >= 40 && target.height >= 44, 'Responsive navigation requires a 44px touch target')
      await trigger.click()
      await page.getByRole('dialog', { name: 'Encontrar modelos e franquias' }).waitFor({ state: 'visible' })
    }
    await openExplorer()
    await page.getByRole('button', { name: 'Navegar pastas de Saga Alfa' }).click()
    const dialog = page.getByRole('dialog', { name: 'Saga Alfa' })
    assert.ok(await dialog.isVisible())
    await page.getByRole('button', { name: 'Expandir Heróis' }).click()
    await page.getByRole('button', { name: 'Expandir Personagens' }).click()
    await page.getByRole('button', { name: 'Tentar novamente' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Tentar novamente' }).click()
    const ayla = page.locator('.explorer-folder-structure .storefront-tree-select', { hasText: 'Ayla' })
    await ayla.waitFor({ state: 'visible' })
    assert.equal(state.deepRequests, 2, 'Nested folder failure must recover with one explicit retry')
    if (spec.width === 320) await page.screenshot({
      path: resolve(evidence, 'r29-mobile-folder-hierarchy.png'), fullPage: true, animations: 'disabled',
    })
    await ayla.click()
    await page.waitForFunction(() => {
      const url = new URL(window.location.href)
      return url.searchParams.get('categoria') === 'games' &&
        url.searchParams.get('franquia') === 'saga-alfa' &&
        url.searchParams.get('pasta') === 'herois/personagens/ayla'
    }, null, { timeout: 8000 })
    await dialog.waitFor({ state: 'hidden' })
    const results = page.locator('.storefront-model-grid.is-results .storefront-model-card__main')
    await page.waitForFunction(() =>
      document.querySelectorAll('.storefront-model-grid.is-results .storefront-model-card__main').length === 1,
    null, { timeout: 10000 })
    assert.match(await results.first().innerText(), /Ayla Colecionável/)
    // The canonical active-folder trail can refresh the same ancestor after selection.
    assert.ok(state.deepRequests >= 2 && state.deepRequests <= 3, 'Unexpected repeated deep-folder reads')
    entry.checks.push('franchise / nested character folder / retry / URL scope / single filtered model')

    await results.first().click()
    const detail = page.getByRole('dialog', { name: 'Ayla Colecionável' })
    await detail.waitFor({ state: 'visible' })
    assert.match(await detail.innerText(), /R29-AYLA/)
    await page.getByRole('button', { name: 'Fechar detalhe do modelo' }).click()
    entry.checks.push('model detail opens by canonical route and closes')

    await openExplorer()
    await page.getByRole('button', { name: 'Navegar pastas de Saga Vazia' }).click()
    await page.getByText('Sem subdivisões').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Ver todos os modelos da franquia' }).click()
    await page.waitForFunction(() => {
      const url = new URL(window.location.href)
      return url.searchParams.get('franquia') === 'saga-vazia' &&
        !url.searchParams.has('pasta')
    })
    await page.waitForFunction(() =>
      document.querySelectorAll('.storefront-model-grid.is-results .storefront-model-card').length === 0,
    null, { timeout: 10000 })
    assert.deepEqual(state.unexpected, [], 'No unsupported or external calls during the contract journey')
    entry.checks.push('empty franchise / no fabricated folders or models / no external network calls')
    assertExpectedHttpErrors(entry, true)
    if (spec.width === 320) {
      await page.screenshot({ path: resolve(evidence, 'r29-mobile-hierarchy.png'), fullPage: true, animations: 'disabled' })
    }
    entry.folderCalls = state.folderCalls
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    entry.error = message
    entry.folderCalls = state.folderCalls
    entry.catalogCalls = state.catalogCalls
    entry.pagination = await page.locator('.storefront-results-footer').evaluate(element => ({
      text: element.innerText,
      buttons: [...element.querySelectorAll('button')].map(button => ({ text: button.innerText, disabled: button.disabled })),
    })).catch(() => null)
    entry.deepRequests = state.deepRequests
    report.failures.push({ profile: spec.name, error: message })
    try { await page.screenshot({ path: resolve(evidence, 'r29-' + spec.name + '-failure.png'), fullPage: true, timeout: 7000 }) }
    catch { /* preserve original failure */ }
  } finally {
    await context.close()
  }
}

async function main() {
  await mkdir(evidence, { recursive: true })
  const html = await readFile(resolve(artifact, 'index.html'), 'utf8')
  assert.match(html, /id="root"/)
  const server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview',
    '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort',
    '--outDir', artifact,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  server.stdout.on('data', chunk => { logs += chunk.toString() })
  server.stderr.on('data', chunk => { logs += chunk.toString() })
  let browser
  try {
    await preview(server)
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CATALOG_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CATALOG_CHROMIUM_EXECUTABLE }
        : {}),
    })
    for (const spec of selectedProfiles) await exercise(browser, spec)
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    report.previewLogs = logs.slice(-1500)
    await writeFile(resolve(evidence, 'r29-live-contract-report.json'), JSON.stringify(report, null, 2) + '\n')
  }
  if (report.failures.length) throw Error(report.failures.length + ' live-contract hierarchy profiles failed')
  console.log('R29 live-contract navigation verified across ' + selectedProfiles.length + ' viewport(s)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
