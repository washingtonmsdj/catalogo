import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Integration test: actual production frontend and API client, deterministic
// Worker-shaped responses intercepted in the browser. Never contacts D1.
const artifact = process.env.CATALOG_LIVE_ARTIFACT_DIR
const evidence = process.env.CATALOG_VISUAL_DIR
assert.ok(artifact && evidence, 'Live artifact and evidence paths required')
const origin = 'http://127.0.0.1:4174'
const apiBase = origin + '/__catalog_contract__'
const profiles = [
  { name: 'mobile-320', width: 320, height: 760 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-1024', width: 1024, height: 800 },
]
const report = { source: 'Isolated live-mode build with Worker-shaped fixtures; NOT real D1 or production', profiles: [], failures: [] }
const pause = ms => new Promise(done => setTimeout(done, ms))

// Fields and paths are the response contract from worker/index.ts. Data is
// intentionally synthetic and is used only in this test, never in the bundle.
const model = (id, name, folder_path, franchise_slug = 'saga-alfa') => ({
  id, slug: id, code: 'R29-' + id.toUpperCase(),
  name, variant_name: '', franchise: franchise_slug === 'saga-alfa' ? 'Saga Alfa' : 'Saga Vazia',
  franchise_slug, category: 'Jogos', category_slug: 'games',
  collection: 'Coleção de teste', folder_path,
  image_count: 1, gallery_version: 1, cover_storage_key: null,
  material: '', height_cm: 0, description: 'Modelo de contrato de navegação.',
})
const cards = [
  model('ayla', 'Ayla Colecionável', 'herois/personagens/ayla'),
  model('baruk', 'Baruk Colecionável', 'viloes/baruk'),
]
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
    { id: 'all', label: 'Todos', count: 2, cover_storage_key: null },
    { id: 'games', label: 'Jogos', count: 2, cover_storage_key: null },
  ] }
  if (path === '/api/franchises') {
    const category = params.get('category')
    const term = params.get('q')?.toLocaleLowerCase('pt-BR')
    return { items: franchises.filter(f =>
      (!category || f.category === category) && (!term || f.label.toLocaleLowerCase('pt-BR').includes(term))),
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
    const items = cards.filter(m =>
      (!category || category === m.category_slug) &&
      (!franchise || franchise === m.franchise_slug) &&
      (!folder || m.folder_path === folder || m.folder_path.startsWith(folder + '/')))
    return { items, nextCursor: null }
  }
  if (path.startsWith('/api/models/')) {
    const slug = decodeURIComponent(path.slice('/api/models/'.length))
    const item = cards.find(m => m.slug === slug)
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

async function exercise(browser, spec) {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height }, reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const state = { folderCalls: [], deepRequests: 0, unexpected: [] }
  const entry = { ...spec, checks: [] }
  report.profiles.push(entry)

  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.href.startsWith(apiBase + '/')) {
      const path = requestUrl.pathname.slice('/__catalog_contract__'.length)
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
    await page.locator('.storefront-model-grid .storefront-model-card').first().waitFor({ state: 'visible' })
    const openExplorer = async () => {
      await page.locator('button.storefront-filterbar__filters').click()
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
    await page.locator('.explorer-folder-structure .storefront-tree-select', { hasText: 'Ayla' }).click()
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
    assert.equal(state.deepRequests, 2, 'One failed nested folder read followed by exactly one successful retry')
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
    if (spec.width === 320) {
      await page.screenshot({ path: resolve(evidence, 'r29-mobile-hierarchy.png'), fullPage: true, animations: 'disabled' })
    }
    entry.folderCalls = state.folderCalls
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    entry.error = message
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
    '--host', '127.0.0.1', '--port', '4174', '--strictPort',
    '--outDir', artifact,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  server.stdout.on('data', chunk => { logs += chunk.toString() })
  server.stderr.on('data', chunk => { logs += chunk.toString() })
  let browser
  try {
    await preview(server)
    browser = await chromium.launch({ headless: true })
    for (const spec of profiles) await exercise(browser, spec)
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    report.previewLogs = logs.slice(-1500)
    await writeFile(resolve(evidence, 'r29-live-contract-report.json'), JSON.stringify(report, null, 2) + '\n')
  }
  if (report.failures.length) throw Error(report.failures.length + ' live-contract hierarchy profiles failed')
  console.log('R29 live-contract navigation verified across ' + profiles.length + ' viewports')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
