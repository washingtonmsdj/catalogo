import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const browser = readFileSync(new URL('./test_catalog_visual.mjs', import.meta.url), 'utf8')
const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')

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
test('production Pages deployment continues to exclude demo data', () => {
  assert.match(pages, /node tools\/check_demo_catalog_artifact\.mjs dist absent/)
  assert.doesNotMatch(pages, /VITE_CATALOG_MODE: demo/)
})

test('R20 narrow-phone column count and clean capture position are guarded', () => {
  assert.match(browser, /spec\.width === 320\) assert\.equal\(entry\.layout\.columns, 1/)
  assert.match(browser, /spec\.width === 390\) assert\.equal\(entry\.layout\.columns, 2/)
  assert.match(browser, /async function resetCapturePosition\(page\)/)
  assert.ok(browser.split('await resetCapturePosition(page)').length === 3)
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

test('R29 live-contract browser gate runs independently of production D1 and without demo assets', () => {
  assert.match(ci, /VITE_CATALOG_MODE: live/)
  assert.match(ci, /VITE_API_BASE_URL: http:\/\/127\.0\.0\.1:4174\/__catalog_contract__/)
  assert.match(ci, /node tools\/test_catalog_live_navigation\.mjs/)
  assert.match(ci, /node tools\/check_demo_catalog_artifact\.mjs "\$CATALOG_LIVE_ARTIFACT_DIR" absent/)
  assert.match(browser, /Isolated demo build, not public production/)
})
