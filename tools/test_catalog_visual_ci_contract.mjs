import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const browser = readFileSync(new URL('./test_catalog_visual.mjs', import.meta.url), 'utf8')
const liveBrowser = readFileSync(new URL('./test_catalog_live_navigation.mjs', import.meta.url), 'utf8')
const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')
const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

test('visual job isolates the demo and stores failure evidence', () => {
  assert.match(ci, /\n  visual-audit:\n/)
  assert.match(ci, /VITE_CATALOG_MODE: demo/)
  assert.match(ci, /playwright@1\.56\.1/)
  assert.match(ci, /node tools\/test_catalog_visual\.mjs/)
  assert.match(ci, /if: always\(\)/)
  assert.match(ci, /catalog-visual-\$\{\{ github\.sha \}\}/)
})
test('browser checks mobile, tablet, desktop and real navigation', () => {
  for (const width of [320, 390, 768, 1024, 1440, 1920])
    assert.ok(browser.includes('width: ' + width + ','), 'Missing width ' + width)
  assert.match(browser, /documentWidth <= entry\.layout\.viewport \+ 2/)
  assert.match(browser, /skip-link/)
  assert.match(browser, /quote\.click\(\)/)
  assert.match(browser, /search\.press\('Enter'\)/)
  assert.match(browser, /fullPage: true/)
})
test('browser audit applies attributes, checks keyboard use and paginates filtered results', () => {
  assert.match(browser, /getByRole\('form', \{ name: 'Filtros de atributos' \}\)/)
  assert.match(browser, /getByLabel\('Material'\)/)
  assert.match(browser, /getByLabel\('Coleção'\)/)
  assert.match(browser, /Adjacent filtered cursor pages must not repeat models/)
  assert.match(browser, /Mobile filter disclosure must work from the keyboard/)
})
test('production Pages deployment continues to exclude demo data', () => {
  assert.match(pages, /node tools\/check_demo_catalog_artifact\.mjs dist absent/)
  assert.doesNotMatch(pages, /VITE_CATALOG_MODE: demo/)
})
test('production CSS pruning keeps dynamic catalog and media states', () => {
  assert.match(vite, /catalog-prune-unused-css/)
  assert.match(vite, /standard: \[\/\^is-\/, \/\^storefront-\//)
  assert.match(vite, /deep: \[\/data-media-failed\//)
  assert.match(vite, /sourceFilesUnder\(path\.join\(projectRoot, 'src'\)\)/)
})

test('R20 narrow-phone column count and clean capture position are guarded', () => {
  assert.match(browser, /spec\.width === 320\) assert\.equal\(entry\.layout\.columns, 1/)
  assert.match(browser, /spec\.width === 390\) assert\.equal\(entry\.layout\.columns, 2/)
  assert.match(browser, /async function resetCapturePosition\(page\)/)
  assert.ok(browser.split('await resetCapturePosition(page)').length === 5)
  assert.match(browser, /\[320, 390, 1440\]\.includes\(spec\.width\)/)
  assert.match(browser, /-initial-results\.png/)
  assert.match(browser, /spec\.name \+ '-search-open\.png'/)
  assert.match(browser, /mobile-390-filters-open\.png/)
  assert.match(browser, /Mobile search must show its full-results action without scrolling/)
})

test('R20 browser gate rejects a hero title clipped by its frame', () => {
  assert.match(browser, /Hero title must not be clipped by its container/)
  assert.match(browser, /hero\.titleTop >= hero\.frameTop - 1/)
})

test('R20 mobile carousel controls cannot cover hero text', () => {
  assert.match(browser, /Mobile hero arrows must not obscure the title/)
  assert.match(browser, /Mobile hero dots must not obscure description/)
})

test('R21 browser audit requires in-flow collection actions on mobile and tablet', () => {
  assert.match(browser, /spec\.width < 1500/)
  assert.match(browser, /Collection actions must not cover model cards/)
  assert.match(browser, /Collection actions must fit the viewport/)
  assert.match(browser, /Collection actions need 44px touch targets/)
  assert.match(browser, /Desktop collections shortcut remains fixed/)
  assert.match(browser, /both collection dialogs close and restore keyboard focus/)
})

test('R22 sticky header reaches the canonical collections dialog without overlay', () => {
  assert.match(browser, /Abrir minhas coleções pelo cabeçalho/)
  assert.match(browser, /Header collection shortcut must stay reachable after scrolling/)
  assert.match(browser, /Header shortcut must open canonical collections dialog/)
  assert.match(browser, /Wide desktop retains the reserved fixed dock/)
})

test('R23 modal focus management checks both openers and keyboard wrap', () => {
  assert.match(browser, /Opening collections from header must focus the close control/)
  assert.match(browser, /Reverse Tab must remain inside the collections dialog/)
  assert.match(browser, /Closing collections must restore focus to the header shortcut/)
  assert.match(browser, /Close button must restore focus to the footer collections trigger/)
  assert.match(browser, /Share dialog must restore focus to its opener/)
})

test('visual browser audit verifies 20k demo pagination and searchable result pages', () => {
  assert.match(browser, /The demo catalog must render one complete 48-model page/)
  assert.match(browser, /TS-D000049/)
  assert.match(browser, /Adjacent demo pages must not repeat model codes/)
  assert.match(browser, /48 nesta página/)
})

test('demo discovery artwork and hero subject remain visible', () => {
  assert.match(browser, /All visible demo category tiles must have artwork/)
  assert.match(browser, /All popular demo franchise tiles must have artwork/)
  assert.match(browser, /Desktop hero subject must remain inside its frame/)
})

test('catalog results are the initial concept view with editorial fallback', () => {
  assert.match(browser, /The scalable catalog is the initial view and shows one complete cursor page/)
  assert.match(browser, /The editorial home remains reachable from the catalog view/)
  assert.match(browser, /getByRole\('button', \{ name: 'Ver destaques' \}\)\.click\(\)/)
})

test('R29 live-contract browser gate runs independently of production D1 and without demo assets', () => {
  assert.match(ci, /VITE_CATALOG_MODE: live/)
  assert.match(ci, /VITE_API_BASE_URL: http:\/\/127\.0\.0\.1:4174\/__catalog_contract__/)
  assert.match(ci, /node tools\/test_catalog_live_navigation\.mjs/)
  assert.match(ci, /node tools\/check_demo_catalog_artifact\.mjs "\$CATALOG_LIVE_ARTIFACT_DIR" absent/)
  assert.match(browser, /Isolated demo build, not public production/)
  assert.match(liveBrowser, /CATALOG_CHROMIUM_EXECUTABLE/)
  assert.match(liveBrowser, /CATALOG_LIVE_PREVIEW_PORT/)
  assert.match(liveBrowser, /async function availablePort\(\)/)
  assert.match(liveBrowser, /name: 'desktop-1440', width: 1440/)
  assert.match(liveBrowser, /four-column model density/)
  assert.match(liveBrowser, /new live search immediately hides stale cursor results/)
  assert.match(liveBrowser, /const largeCatalogTotal = 20320/)
  assert.match(liveBrowser, /complete page from an acervo larger than 20k models/)
  assert.match(liveBrowser, /Adjacent live cursor pages must not duplicate models/)
})
