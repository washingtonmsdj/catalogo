import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const artifact = process.env.DEMO_ARTIFACT_DIR
const evidence = process.env.CATALOG_VISUAL_DIR
assert.ok(artifact && evidence, 'Demo and evidence paths required')
const url = 'http://127.0.0.1:4173/'
const profiles = [
  { name: 'mobile-320', width: 320, height: 760 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-1024', width: 1024, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
]
const report = { source: 'Isolated demo build, not public production', profiles: [], failures: [] }
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

async function awaitPreview(server) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw Error('Preview exited unexpectedly')
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) })
      if (response.ok) return
    } catch { /* Waiting for the local preview process. */ }
    await pause(250)
  }
  throw Error('Preview startup timeout')
}

async function measure(page) {
  return page.evaluate(() => {
    const w = innerWidth
    const cards = [...document.querySelectorAll('.storefront-model-grid.is-results > .storefront-model-card')]
      .map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height)
    const rail = document.querySelector('.storefront-quote-rail')
    return {
      viewport: w,
      documentWidth: document.documentElement.scrollWidth,
      count: cards.length,
      outside: cards.filter((r) => r.left < -2 || r.right > w + 2).length,
      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none' && rail.getBoundingClientRect().width > 0),
    }
  })
}

async function exercise(browser, spec) {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const entry = { ...spec, screenshots: [], checks: [] }
  report.profiles.push(entry)
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    assert.equal(response?.status(), 200)
    await page.locator('.storefront-model-grid .storefront-model-card').first().waitFor({ state: 'visible', timeout: 18000 })
    assert.ok(await page.getByRole('textbox', { name: 'Buscar no catálogo' }).isVisible())
    assert.equal(await page.locator('.storefront-sidebar__nav a[href="#colecoes"]').count(), 1)
    await page.keyboard.press('Tab')
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('storefront-skip-link')),
      'Skip link must be the first keyboard stop')
    await page.keyboard.press('Enter')
    assert.equal(new URL(page.url()).hash, '#catalogo')
    entry.checks.push('demo, keyboard skip link, editorial collections anchor')
    await page.screenshot({ path: resolve(evidence, spec.name + '-editorial.png'), fullPage: true, animations: 'disabled' })
    entry.screenshots.push(spec.name + '-editorial.png')

    await page.getByRole('button', { name: /Ver catálogo completo/i }).click()
    await page.locator('.storefront-model-grid.is-results > .storefront-model-card').first().waitFor({ state: 'visible' })
    entry.layout = await measure(page)
    assert.ok(entry.layout.count >= 6, 'Demo results not rendered')
    assert.ok(entry.layout.documentWidth <= entry.layout.viewport + 2, 'Horizontal page overflow')
    assert.equal(entry.layout.outside, 0, 'Model cards outside viewport')
    assert.equal(entry.layout.railVisible, spec.width >= 1500, 'Quote rail responsive boundary')
    assert.equal(await page.locator('.storefront-topbar nav a[href="#colecoes"]').count(), 0)
    assert.equal(await page.locator('.storefront-sidebar__nav a[href="#colecoes"]').count(), 0)
    assert.equal(await page.locator('.storefront-topbar nav button').filter({ hasText: 'Coleções' }).count(), 1)
    entry.checks.push('responsive results, quote rail and valid collections navigation')
    await page.screenshot({ path: resolve(evidence, spec.name + '-results.png'), fullPage: true, animations: 'disabled' })
    entry.screenshots.push(spec.name + '-results.png')

    if ([390, 1920].includes(spec.width)) {
      const quote = page.locator('.storefront-model-grid.is-results .storefront-model-card__quote').first()
      await quote.click()
      assert.equal(await quote.getAttribute('aria-pressed'), 'true')
      if (spec.width === 1920) assert.ok(await page.locator('.storefront-quote-rail__item').count() > 0)
      const search = page.getByRole('textbox', { name: 'Buscar no catálogo' })
      await search.fill('Sentinela')
      await search.press('Enter')
      await page.waitForFunction(
        () => document.querySelectorAll('.storefront-model-grid.is-results > .storefront-model-card').length === 1,
        null, { timeout: 7000 },
      )
      entry.checks.push('selection and keyboard search')
    }
    console.log('PASS ' + spec.name + ' (' + entry.layout.documentWidth + 'px document)')
  } catch (error) {
    const message = spec.name + ': ' + (error instanceof Error ? error.stack || error.message : String(error))
    report.failures.push(message)
    console.error(message)
    try {
      await page.screenshot({ path: resolve(evidence, spec.name + '-failure.png'), fullPage: true, timeout: 7000 })
      entry.screenshots.push(spec.name + '-failure.png')
    } catch { console.error('Failure screenshot could not be captured') }
  } finally { await context.close() }
}

async function main() {
  await mkdir(evidence, { recursive: true })
  assert.ok((await readFile(resolve(artifact, 'index.html'), 'utf8')).includes('id="root"'))
  const server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview',
    '--host', '127.0.0.1', '--port', '4173', '--strictPort',
    '--outDir', artifact,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  server.stdout.on('data', (buffer) => { logs += buffer.toString() })
  server.stderr.on('data', (buffer) => { logs += buffer.toString() })
  let browser
  try {
    await awaitPreview(server)
    browser = await chromium.launch({ headless: true })
    for (const profile of profiles) await exercise(browser, profile)
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    report.previewLogs = logs.slice(-2000)
    await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  }
  if (report.failures.length) throw Error(report.failures.length + ' browser profiles failed')
  console.log('All ' + report.profiles.length + ' responsive browser profiles passed')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
