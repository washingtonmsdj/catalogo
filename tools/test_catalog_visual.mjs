import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const artifact = process.env.DEMO_ARTIFACT_DIR
const evidence = process.env.CATALOG_VISUAL_DIR
assert.ok(artifact && evidence, 'Demo and evidence paths required')
async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a preview port')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

const configuredPort = Number.parseInt(process.env.CATALOG_PREVIEW_PORT ?? '', 10)
const previewPort = Number.isInteger(configuredPort) && configuredPort > 0
  ? configuredPort
  : await availablePort()
const url = `http://127.0.0.1:${previewPort}/`
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
    const collectionButton = document.querySelector('.collections-dock-trigger')
    const shareButton = document.querySelector('.collections-share-trigger')
    const bounds = [collectionButton, shareButton].map((node) => node?.getBoundingClientRect()).filter(Boolean)
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const cardObstruction = bounds.some((button) => cards.some((card) => overlap(button, card)))
    return {
      viewport: w,
      documentWidth: document.documentElement.scrollWidth,
      count: cards.length,
      demoCoverCount: document.querySelectorAll('.storefront-model-grid.is-results .storefront-model-card__sprite').length,
      outside: cards.filter((r) => r.left < -2 || r.right > w + 2).length,
      columns: getComputedStyle(document.querySelector('.storefront-model-grid.is-results'))
        .gridTemplateColumns.trim().split(/\s+/).length,
      railVisible: Boolean(rail && getComputedStyle(rail).display !== 'none' && rail.getBoundingClientRect().width > 0),
      collectionsDock: {
        position: collectionButton && getComputedStyle(collectionButton).position,
        sharingPosition: shareButton && getComputedStyle(shareButton).position,
        buttonsOutsideViewport: bounds.some((rect) => rect.left < -1 || rect.right > w + 1),
        obscuresCards: cardObstruction,
        touchTargets: bounds.map((rect) => Math.round(rect.height)),
      },
    }
  })
}

async function resetCapturePosition(page) {
  // Preserve the actual keyboard-navigation test, but remove its scroll/focus
  // side effects so screenshots depict the page from its natural beginning.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    document.documentElement.style.scrollBehavior = 'auto'
    window.scrollTo(0, 0)
  })
  await page.waitForFunction(() => window.scrollY <= 1, null, { timeout: 5000 })
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
    assert.ok(await page.getByRole('combobox', { name: 'Buscar no catálogo' }).isVisible())
    assert.equal(await page.locator('.storefront-model-grid.is-results > .storefront-model-card').count(), 48,
      'The scalable catalog is the initial view and shows one complete cursor page')
    assert.ok(await page.locator('.storefront-results-hero--global').isVisible(),
      'The global catalog should use the concept results banner above the model grid on desktop and mobile')
    assert.equal(await page.getByRole('region', { name: 'Destaque editorial do catálogo' }).isVisible(), false,
      'The large campaign hero belongs to the editorial discovery view, not the results grid')
    assert.ok(await page.getByRole('button', { name: 'Ver destaques' }).isVisible(),
      'The editorial home remains reachable from the catalog view')
    if ([320, 390, 1440].includes(spec.width)) {
      await resetCapturePosition(page)
      await page.screenshot({ path: resolve(evidence, spec.name + '-initial-results.png'), fullPage: true, animations: 'disabled' })
      entry.screenshots.push(spec.name + '-initial-results.png')
    }
    await page.keyboard.press('Tab')
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('storefront-skip-link')),
      'Skip link must be the first keyboard stop')
    await page.keyboard.press('Enter')
    await page.waitForURL((target) => target.hash === '#catalogo', { timeout: 5000 })
    entry.checks.push('initial results page and keyboard skip link')

    await page.getByRole('button', { name: 'Ver destaques' }).click()
    await page.locator('.storefront-category-grid .storefront-category-tile').first().waitFor({ state: 'visible' })
    const discoveryArtwork = await page.evaluate(() => ({
      categories: document.querySelectorAll('.storefront-category-tile.has-demo-artwork .storefront-category-tile__sprite').length,
      franchises: document.querySelectorAll('.storefront-franchise-cards > button.has-demo-artwork .storefront-franchise-cards__sprite').length,
    }))
    assert.equal(discoveryArtwork.categories, 6, 'All visible demo category tiles must have artwork')
    assert.equal(discoveryArtwork.franchises, 4, 'All popular demo franchise tiles must have artwork')
    const hero = await page.evaluate(() => {
      const frame = document.querySelector('.storefront-hero')?.getBoundingClientRect()
      const title = document.querySelector('.storefront-hero h1')?.getBoundingClientRect()
      if (!frame || !title) return null
      const subject = document.querySelector('.storefront-hero__backdrop-subject')?.getBoundingClientRect()
      const paragraph = document.querySelector('.storefront-hero__copy > p')?.getBoundingClientRect()
      const dots = document.querySelector('.storefront-hero__dots')?.getBoundingClientRect()
      const navs = [...document.querySelectorAll('.storefront-hero__nav')].map((node) => node.getBoundingClientRect())
      const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      return {
        frameTop: frame.top, titleTop: title.top, titleBottom: title.bottom, frameBottom: frame.bottom,
        subjectTop: subject?.top, subjectBottom: subject?.bottom,
        navOverlapsTitle: navs.some((nav) => intersects(nav, title)),
        dotsOverlapParagraph: Boolean(dots && paragraph && intersects(dots, paragraph)),
      }
    })
    assert.ok(hero, 'Hero and heading must exist')
    assert.ok(hero.titleTop >= hero.frameTop - 1 && hero.titleBottom <= hero.frameBottom + 1,
      'Hero title must not be clipped by its container')
    if (spec.width > 620) {
      assert.ok(hero.subjectTop >= hero.frameTop - 1 && hero.subjectBottom <= hero.frameBottom + 1,
        'Desktop hero subject must remain inside its frame')
    }
    if (spec.width <= 620) {
      assert.equal(hero.navOverlapsTitle, false, 'Mobile hero arrows must not obscure the title')
      assert.equal(hero.dotsOverlapParagraph, false, 'Mobile hero dots must not obscure description')
    }
    assert.equal(await page.locator('.storefront-sidebar__nav a[href="#colecoes"]').count(), 1)
    entry.checks.push('editorial home, category artwork, and valid collections anchor')
    await resetCapturePosition(page)
    await page.screenshot({ path: resolve(evidence, spec.name + '-editorial.png'), fullPage: true, animations: 'disabled' })
    entry.screenshots.push(spec.name + '-editorial.png')

    await page.getByRole('button', { name: /Ver catálogo completo/i }).click()
    await page.locator('.storefront-model-grid.is-results > .storefront-model-card').first().waitFor({ state: 'visible' })
    entry.layout = await measure(page)
    assert.equal(entry.layout.count, 48, 'The demo catalog must render one complete 48-model page')
    assert.equal(entry.layout.demoCoverCount, entry.layout.count, 'Every demo result must use a product cover')
    assert.ok(entry.layout.documentWidth <= entry.layout.viewport + 2, 'Horizontal page overflow')
    assert.equal(entry.layout.outside, 0, 'Model cards outside viewport')
    if (spec.width === 320) assert.equal(entry.layout.columns, 1, '320px results require readable full-width cards')
    if (spec.width === 390) assert.equal(entry.layout.columns, 2, '390px results should retain two-column density')
    assert.equal(entry.layout.railVisible, spec.width >= 1500, 'Quote rail responsive boundary')
    if (spec.width < 1500) {
      assert.equal(entry.layout.collectionsDock.position, 'static', 'Collections trigger must not float above tablet/mobile cards')
      assert.equal(entry.layout.collectionsDock.sharingPosition, 'static', 'Share trigger must not float above tablet/mobile cards')
      assert.equal(entry.layout.collectionsDock.obscuresCards, false, 'Collection actions must not cover model cards')
      assert.equal(entry.layout.collectionsDock.buttonsOutsideViewport, false, 'Collection actions must fit the viewport')
      assert.ok(entry.layout.collectionsDock.touchTargets.every((height) => height >= 44), 'Collection actions need 44px touch targets')
    } else {
      assert.equal(entry.layout.collectionsDock.position, 'fixed', 'Desktop collections shortcut remains fixed')
      assert.equal(entry.layout.collectionsDock.sharingPosition, 'fixed', 'Desktop sharing shortcut remains fixed')
    }
    if ([320, 390, 1440].includes(spec.width)) {
      const grid = page.locator('.storefront-model-grid.is-results')
      const pageOneCodes = await grid.locator('.storefront-model-card__meta b').allTextContents()
      const listToggle = page.getByRole('button', { name: 'Visualizar em lista' })
      await listToggle.click()
      assert.equal(await listToggle.getAttribute('aria-pressed'), 'true',
        'List view toggle must announce its selected state')
      assert.ok(await grid.evaluate((node) => node.classList.contains('is-list')),
        'List view must apply its layout without replacing the result page')
      const listLayout = await measure(page)
      assert.equal(listLayout.columns, 1, 'List view must render one readable card per row')
      assert.equal(listLayout.count, 48, 'List view must retain the complete cursor page')
      assert.equal(listLayout.outside, 0, 'List view cards must fit the viewport')
      assert.deepEqual(await grid.locator('.storefront-model-card__meta b').allTextContents(), pageOneCodes,
        'Changing presentation must not alter the ordered result set')
      if (spec.width === 1440) {
        await page.locator('.storefront-results-footer').getByRole('button', { name: 'Próxima ›' }).click()
        await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-D000049',
          null, { timeout: 7000 })
        assert.ok(await grid.evaluate((node) => node.classList.contains('is-list')),
          'List presentation must persist across a cursor page change')
        await page.locator('.storefront-results-footer').getByRole('button', { name: '‹ Anterior' }).click()
        await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
          null, { timeout: 7000 })
      }
      const gridToggle = page.getByRole('button', { name: 'Visualizar em grade' })
      await gridToggle.click()
      assert.equal(await gridToggle.getAttribute('aria-pressed'), 'true',
        'Switching back to grid must restore its selected state')
      assert.ok(await grid.evaluate((node) => !node.classList.contains('is-list')),
        'Grid view must restore the concept card layout')
      entry.checks.push('grid and list presentation preserve ordered cursor results on narrow mobile, mobile and desktop')
    }
    assert.equal(await page.locator('.storefront-topbar nav a[href="#colecoes"]').count(), 0)
    assert.equal(await page.locator('.storefront-sidebar__nav a[href="#colecoes"]').count(), 0)
    assert.equal(await page.locator('.storefront-topbar nav button').filter({ hasText: 'Coleções' }).count(), 1)
    if (spec.width === 1440) {
      await page.locator('.storefront-franchise-expand').first().click()
      const tree = page.locator('.storefront-franchise-entry.is-expanded .storefront-folder-tree').first()
      await tree.locator('.storefront-tree-select').first().waitFor({ state: 'visible', timeout: 5000 })
      const treePalette = await page.evaluate(() => {
        const entry = document.querySelector('.storefront-franchise-entry.is-expanded')
        const group = entry?.querySelector('.storefront-tree-row.is-group')
        const channels = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
        return {
          entry: channels(getComputedStyle(entry).backgroundColor),
          group: channels(group ? getComputedStyle(group).backgroundColor : ''),
        }
      })
      assert.ok(treePalette.entry.length === 3 && treePalette.entry.every((channel) => channel < 65),
        'Expanded franchise panels must stay dark like the catalog sidebar')
      assert.ok(treePalette.group.length === 3 && treePalette.group.every((channel) => channel < 65),
        'Folder groups must not retain the legacy white theme')
      await tree.locator('.storefront-tree-select').first().click()
      await page.waitForFunction(() => document.querySelectorAll('.storefront-model-grid.is-results > .storefront-model-card').length > 0,
        null, { timeout: 7000 })
      assert.equal(await tree.locator('.storefront-tree-row.is-active').count(), 1,
        'Selecting a virtual hierarchy node must apply a visible folder filter')
      await tree.getByRole('button', { name: 'Todos da franquia' }).click()
      await page.locator('.storefront-sidebar-categories').getByRole('button', { name: /Todos os modelos/ }).click()
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
        null, { timeout: 7000 })
      entry.checks.push('expandable virtual folders filter models and reset cleanly')

      const search = page.getByRole('combobox', { name: 'Buscar no catálogo' })
      await search.fill('Sentinela')
      const suggestions = page.getByRole('listbox', { name: 'Sugestões de modelos e franquias' })
      const modelSuggestions = suggestions.getByRole('group', { name: 'Modelos' })
      await modelSuggestions.waitFor({ state: 'visible', timeout: 7000 })
      assert.ok(await modelSuggestions.getByRole('option').count() > 0,
        'Search should suggest matching models from the current result page')
      const relatedFranchises = suggestions.getByRole('group', { name: 'Franquias relacionadas' })
      assert.ok(await relatedFranchises.isVisible(),
        'Search should offer related franchises alongside models')
      assert.ok(await relatedFranchises.getByRole('option').count() > 0,
        'A matching model should expose its franchise as a related suggestion')
      assert.ok(await suggestions.getByRole('option', { name: /Ver todos os resultados para/ }).isVisible(),
        'Search suggestions must keep a clear full-results action')
      await search.press('ArrowDown')
      const activeSuggestionId = await search.getAttribute('aria-activedescendant')
      assert.ok(activeSuggestionId?.startsWith('storefront-search-option-model-'),
        'ArrowDown must activate the first matching model suggestion')
      assert.equal(await page.locator(`#${activeSuggestionId}`).getAttribute('aria-selected'), 'true',
        'The active suggestion must be announced to assistive technology')
      await search.press('Enter')
      const modelDialog = page.getByRole('dialog', { name: /.+/ })
      await modelDialog.waitFor({ state: 'visible', timeout: 5000 })
      await modelDialog.getByRole('button', { name: 'Fechar detalhe do modelo' }).click()
      await search.click()
      await modelSuggestions.waitFor({ state: 'visible', timeout: 5000 })
      await relatedFranchises.waitFor({ state: 'visible', timeout: 5000 })
      const matchingModelCount = await modelSuggestions.getByRole('option').count()
      await search.press('ArrowDown')
      for (let index = 0; index < matchingModelCount; index += 1) await search.press('ArrowDown')
      const activeFranchiseId = await search.getAttribute('aria-activedescendant')
      assert.ok(activeFranchiseId?.startsWith('storefront-search-option-franchise-'),
        'ArrowDown must move from matching models into related franchise suggestions')
      const activeFranchiseName = await page.locator('[role="option"][aria-selected="true"] strong').innerText()
      await search.press('Enter')
      await page.waitForFunction((label) => document.querySelector('.storefront-results-hero__copy h1')?.textContent?.trim() === label,
        activeFranchiseName, { timeout: 7000 })
      await page.locator('.storefront-sidebar-categories').getByRole('button', { name: /Todos os modelos/ }).click()
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
        null, { timeout: 7000 })
      const focusedSearchBackground = await search.evaluate((input) => getComputedStyle(input.parentElement).backgroundColor)
      const focusedSearchChannels = focusedSearchBackground.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
      assert.ok(focusedSearchChannels.length === 3 && focusedSearchChannels.every((channel) => channel < 65),
        'Focused search must retain the dark concept palette')
      await search.fill('')
      await search.fill('zzzzzz')
      await suggestions.getByText(/Nenhuma sugestão direta/).waitFor({ state: 'visible', timeout: 7000 })
      assert.ok(await suggestions.getByRole('option', { name: /Ver todos os resultados para/ }).isVisible(),
        'Queries without shortcuts must still expose the full-results option')
      await search.press('Enter')
      await page.getByText('Nenhum modelo neste recorte').waitFor({ state: 'visible', timeout: 7000 })
      await search.fill('')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
        null, { timeout: 7000 })
      entry.checks.push('global search supports keyboard selection and zero-suggestion fallback')

      const filterToggle = page.locator('.storefront-filterbar__filters')
      await filterToggle.click()
      const facetForm = page.getByRole('form', { name: 'Filtros de atributos' })
      assert.ok(await facetForm.isVisible(), 'Facet form must open from its disclosure control')
      await facetForm.getByLabel('Material').fill('pvc')
      await facetForm.getByLabel('Coleção').fill('art')
      await facetForm.getByLabel('Mínima').fill('20')
      await facetForm.getByLabel('Máxima').fill('60')
      await facetForm.getByRole('button', { name: 'Aplicar filtros' }).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => location.search.includes('material=pvc')
        && location.search.includes('colecao-modelo=art') && location.search.includes('altura-min=20')
        && location.search.includes('altura-max=60'), null, { timeout: 7000 })
      assert.ok(await filterToggle.evaluate((node) => node === document.activeElement),
        'Applying facets must restore keyboard focus to their disclosure button')
      const filteredCodes = await page.locator('.storefront-model-grid.is-results .storefront-model-card__meta b').allTextContents()
      const filteredCardText = await page.locator('.storefront-model-grid.is-results > .storefront-model-card').allInnerTexts()
      assert.equal(filteredCodes.length, 48, 'Facet results must remain a complete 48-model page')
      assert.ok(filteredCardText.every((value) => /PVC/i.test(value)),
        'Every visible model must satisfy the material facet')
      assert.ok(filteredCardText.every((value) => {
        const height = Number(value.match(/(\d+)\s*cm/i)?.[1])
        return height >= 20 && height <= 60
      }), 'Every visible model must satisfy the inclusive height range')

      await page.locator('.storefront-results-footer').getByRole('button', { name: 'Próxima ›' }).click()
      await page.waitForFunction((firstCode) => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent !== firstCode,
        filteredCodes[0], { timeout: 7000 })
      const nextFilteredCodes = await page.locator('.storefront-model-grid.is-results .storefront-model-card__meta b').allTextContents()
      assert.equal(nextFilteredCodes.length, 48)
      assert.equal(filteredCodes.some((code) => nextFilteredCodes.includes(code)), false,
        'Adjacent filtered cursor pages must not repeat models')
      await page.locator('.storefront-results-footer').getByRole('button', { name: '‹ Anterior' }).click()
      await page.waitForFunction((firstCode) => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === firstCode,
        filteredCodes[0], { timeout: 7000 })
      await page.getByRole('button', { name: /Filtros · ativos/ }).click()
      const materialFacet = facetForm.getByLabel('Material')
      await page.getByRole('button', { name: 'Remover filtro de material' }).click()
      assert.equal(await materialFacet.inputValue(), '',
        'Removing an active material chip must clear the open filter draft')
      await facetForm.getByRole('button', { name: 'Aplicar filtros' }).click()
      await page.waitForFunction(() => !location.search.includes('material=')
        && location.search.includes('colecao-modelo=art') && location.search.includes('altura-min=20'), null, { timeout: 7000 })
      assert.equal(await page.locator('.storefront-model-grid.is-results > .storefront-model-card').count(), 48,
        'Removing one facet must preserve a complete cursor page for the remaining filters')
      await page.getByRole('button', { name: 'Limpar tudo' }).click()
      await page.waitForFunction(() => !location.search.includes('material=') && !location.search.includes('altura-min='),
        null, { timeout: 7000 })
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
        null, { timeout: 7000 })
      entry.checks.push('material, collection and height facets preserve complete non-overlapping cursor pages')
    }
    if ([320, 390].includes(spec.width)) {
      const search = page.getByRole('combobox', { name: 'Buscar no catálogo' })
      await search.fill('sentinela')
      const suggestions = page.locator('#storefront-search-suggestions')
      await suggestions.waitFor({ state: 'visible', timeout: 7000 })
      const suggestionsBox = await suggestions.boundingBox()
      assert.ok(suggestionsBox && suggestionsBox.x >= 0 && suggestionsBox.x + suggestionsBox.width <= spec.width,
        'Mobile search suggestions must stay inside the viewport')
      const allResultsBox = await suggestions.getByRole('option', { name: /Ver todos os resultados para/ }).boundingBox()
      assert.ok(suggestionsBox && allResultsBox && allResultsBox.y >= suggestionsBox.y
        && allResultsBox.y + allResultsBox.height <= suggestionsBox.y + suggestionsBox.height
        && suggestionsBox.y + suggestionsBox.height <= spec.height,
      'Mobile search must show its full-results action without scrolling the suggestion panel')
      const searchScreenshot = spec.name + '-search-open.png'
      await page.screenshot({ path: resolve(evidence, searchScreenshot), animations: 'disabled' })
      entry.screenshots.push(searchScreenshot)
      await search.fill('')
      await page.waitForFunction(() => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
        null, { timeout: 7000 })
    }
    if (spec.width === 320 || spec.width === 390) {
      const filterToggle = page.getByRole('button', { name: 'Filtros', exact: true })
      const filterToggleBox = await filterToggle.boundingBox()
      assert.ok(filterToggleBox && filterToggleBox.height >= 44,
        'Mobile attribute filter trigger needs a 44px touch target')
      await filterToggle.focus()
      await page.keyboard.press('Enter')
      const facetForm = page.getByRole('form', { name: 'Filtros de atributos' })
      assert.ok(await facetForm.isVisible(), 'Mobile filter disclosure must work from the keyboard')
      const facetLayout = await facetForm.evaluate((form) => ({
        columns: getComputedStyle(form).gridTemplateColumns.trim().split(/\s+/).length,
        touchTargets: [...form.querySelectorAll('input, button')].map((control) => control.getBoundingClientRect().height),
      }))
      assert.equal(facetLayout.columns, spec.width === 320 ? 1 : 2,
        'Mobile facet form must switch to one column below 360px')
      assert.ok(facetLayout.touchTargets.every((height) => height >= 44),
        'Mobile facet fields and actions need 44px touch targets')
      if (spec.width === 390) {
        await resetCapturePosition(page)
        await page.screenshot({ path: resolve(evidence, 'mobile-390-filters-open.png'), fullPage: true, animations: 'disabled' })
        entry.screenshots.push('mobile-390-filters-open.png')
      }
      const formBox = await facetForm.boundingBox()
      assert.ok(formBox && formBox.x >= 0 && formBox.x + formBox.width <= spec.width,
        'Mobile facet controls must stay inside the viewport')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), spec.width,
        'Mobile facets must not introduce horizontal overflow')
      await filterToggle.click()
      await facetForm.waitFor({ state: 'hidden' })
      entry.checks.push('mobile facet disclosure is keyboard operable and fits without horizontal overflow')
    }
    const pageCodes = () => page.locator('.storefront-model-grid.is-results .storefront-model-card__meta b').allTextContents()
    const firstPageCodes = await pageCodes()
    assert.equal(firstPageCodes[0], 'TS-000001')
    assert.equal(firstPageCodes.at(-1), 'TS-D000048')
    const nextResultsPage = page.locator('.storefront-results-footer').getByRole('button', { name: 'Próxima ›' })
    await nextResultsPage.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-D000049',
      null, { timeout: 7000 },
    )
    await page.waitForFunction(() => {
      const heading = document.querySelector('#destaques .storefront-section__head h2')
      const bounds = heading?.getBoundingClientRect()
      return document.activeElement === heading && heading.matches(':focus-visible')
        && bounds && bounds.top >= 0 && bounds.bottom <= innerHeight
    }, null, { timeout: 7000 })
    const headingFocus = await page.locator('#destaques .storefront-section__head h2').evaluate((node) => ({
      style: getComputedStyle(node).outlineStyle,
      width: getComputedStyle(node).outlineWidth,
      color: getComputedStyle(node).outlineColor,
    }))
    assert.equal(headingFocus.style, 'solid', 'Keyboard page changes must show a focus ring on the results heading')
    assert.equal(headingFocus.width, '2px')
    assert.equal(headingFocus.color, 'rgb(240, 107, 36)', 'The focus ring must use the catalog accent color')
    assert.equal(await page.locator('#destaques .storefront-section__head p').getAttribute('aria-live'), 'polite',
      'Cursor page changes must announce the updated page count')
    const secondPageCodes = await pageCodes()
    assert.equal(secondPageCodes.length, 48)
    assert.equal(secondPageCodes.at(-1), 'TS-D000096')
    assert.equal(firstPageCodes.some((code) => secondPageCodes.includes(code)), false, 'Adjacent demo pages must not repeat model codes')
    const previousResultsPage = page.locator('.storefront-results-footer').getByRole('button', { name: '‹ Anterior' })
    await previousResultsPage.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => document.querySelector('.storefront-model-grid.is-results .storefront-model-card__meta b')?.textContent === 'TS-000001',
      null, { timeout: 7000 },
    )
    await page.waitForFunction(() => document.activeElement === document.querySelector('#destaques .storefront-section__head h2'),
      null, { timeout: 7000 })
    entry.checks.push('20k demo total, complete 48-model pages, no adjacent-page duplicates, and return navigation')
    entry.checks.push('responsive results, quote rail and valid collections navigation')
    if (spec.width < 1500) {
      const shortcut = page.getByRole('button', { name: 'Abrir minhas coleções pelo cabeçalho' })
      assert.ok(await shortcut.isVisible(), 'Collections header shortcut must be visible')
      const buttonBox = await shortcut.boundingBox()
      assert.ok(buttonBox && buttonBox.width >= 40 && buttonBox.height >= 40,
        'Header collection shortcut needs a reachable touch target')
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2))
      const stickyBox = await shortcut.boundingBox()
      assert.ok(stickyBox && stickyBox.y >= -1 && stickyBox.y + stickyBox.height <= spec.height + 1,
        'Header collection shortcut must stay reachable after scrolling')
      await shortcut.click()
      const headerDialog = page.getByRole('dialog', { name: 'Minhas coleções' })
      assert.ok(await headerDialog.isVisible(), 'Header shortcut must open canonical collections dialog')
      assert.ok(await page.getByRole('button', { name: 'Fechar coleções' }).evaluate((node) => node === document.activeElement),
        'Opening collections from header must focus the close control')
      await page.keyboard.press('Shift+Tab')
      assert.ok(await headerDialog.evaluate((node) => node.contains(document.activeElement)),
        'Reverse Tab must remain inside the collections dialog')
      await page.keyboard.press('Tab')
      assert.ok(await page.getByRole('button', { name: 'Fechar coleções' }).evaluate((node) => node === document.activeElement),
        'Tab must wrap back to the first collections control')
      await page.keyboard.press('Escape')
      await headerDialog.waitFor({ state: 'hidden' })
      assert.ok(await shortcut.evaluate((node) => node === document.activeElement),
        'Closing collections must restore focus to the header shortcut')
      entry.checks.push('collections focus trapped and restored after header Escape')
    } else {
      assert.equal(await page.getByRole('button', { name: 'Abrir minhas coleções pelo cabeçalho' }).isVisible(), false,
        'Wide desktop retains the reserved fixed dock instead of duplicate header access')
    }
    await resetCapturePosition(page)
    await page.screenshot({ path: resolve(evidence, spec.name + '-results.png'), fullPage: true, animations: 'disabled' })
    entry.screenshots.push(spec.name + '-results.png')

    if ([390, 1024].includes(spec.width)) {
      const collectionTrigger = page.getByRole('button', { name: 'Abrir minhas coleções', exact: true })
      await collectionTrigger.click()
      const collectionsDialog = page.getByRole('dialog', { name: 'Minhas coleções' })
      assert.ok(await collectionsDialog.isVisible())
      assert.ok(await page.getByRole('button', { name: 'Fechar coleções' }).evaluate((node) => node === document.activeElement),
        'Collections must put initial focus inside the modal')
      await page.getByRole('button', { name: 'Fechar coleções' }).click()
      await collectionsDialog.waitFor({ state: 'hidden' })
      assert.ok(await collectionTrigger.evaluate((node) => node === document.activeElement),
        'Close button must restore focus to the footer collections trigger')

      const shareTrigger = page.getByRole('button', { name: 'Compartilhar uma coleção' })
      await shareTrigger.click()
      const shareDialog = page.getByRole('dialog', { name: 'Compartilhar coleção' })
      assert.ok(await shareDialog.isVisible())
      assert.ok(await page.getByRole('button', { name: 'Fechar compartilhamento' }).evaluate((node) => node === document.activeElement),
        'Share dialog must focus the close control')
      await page.keyboard.press('Shift+Tab')
      assert.ok(await shareDialog.evaluate((node) => node.contains(document.activeElement)),
        'Reverse Tab must stay inside the share dialog')
      await page.keyboard.press('Tab')
      assert.ok(await page.getByRole('button', { name: 'Fechar compartilhamento' }).evaluate((node) => node === document.activeElement),
        'Tab must wrap inside the share dialog')
      await page.keyboard.press('Escape')
      await shareDialog.waitFor({ state: 'hidden' })
      assert.ok(await shareTrigger.evaluate((node) => node === document.activeElement),
        'Share dialog must restore focus to its opener')
      entry.checks.push('both collection dialogs close and restore keyboard focus')
    }
    if ([390, 1920].includes(spec.width)) {
      const quote = page.locator('.storefront-model-grid.is-results .storefront-model-card__quote')
        .nth(spec.width === 390 ? 1 : 0)
      await quote.click()
      assert.equal(await quote.getAttribute('aria-pressed'), 'true')
      if (spec.width === 1920) assert.ok(await page.locator('.storefront-quote-rail__item').count() > 0)
      const search = page.getByRole('combobox', { name: 'Buscar no catálogo' })
      if (spec.width === 390) {
        await search.fill('cacadora')
        const accentedModel = page.getByRole('listbox', { name: 'Sugestões de modelos e franquias' })
          .getByRole('group', { name: 'Modelos' }).getByRole('option', { name: /Caçadora Celeste/i }).first()
        await accentedModel.waitFor({ state: 'visible', timeout: 10000 })
        entry.checks.push('unaccented search matches accented model suggestion')
      }
      await search.fill('Sentinela')
      await search.press('Enter')
      await page.waitForFunction(
        () => document.querySelectorAll('.storefront-model-grid.is-results > .storefront-model-card').length === 48,
        null, { timeout: 7000 },
      )
      assert.match(await page.locator('.storefront-section__head p').innerText(), /48 nesta página/)
      if (spec.width === 390) {
        const addToList = page.locator('.storefront-model-grid.is-results .storefront-model-card__quote').first()
        await addToList.click()
        await page.waitForFunction(() =>
          document.querySelector('.storefront-model-grid.is-results .storefront-model-card__quote')
            ?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 },
        )
        await page.locator('.storefront-footer').getByRole('button', { name: /Minha lista/ }).click()
        const quoteDialog = page.getByRole('dialog', { name: 'Solicitar orçamento' })
        await quoteDialog.waitFor({ state: 'visible' })
        await quoteDialog.locator('input[name="name"]').fill('Cliente Demo')
        await quoteDialog.locator('input[name="email"]').fill('teste@example.com')
        await quoteDialog.getByRole('button', { name: /Enviar solicitação/ }).click()
        await page.getByRole('dialog', { name: 'Solicitação registrada' }).waitFor({ state: 'visible' })
        assert.ok((await page.locator('.quote-receipt code').innerText()).startsWith('DEMO-'),
          'Only a demo receipt should be shown by the test catalog')
        assert.equal(await page.evaluate(() => localStorage.getItem('tonecos:last-live-quote-receipt')), null,
          'Demo submissions must never be stored as a live quote')
        await page.getByRole('button', { name: 'Voltar ao catálogo' }).click()
        entry.checks.push('demo quote request creates no persistent live receipt')
      }
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
    '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort',
    '--outDir', artifact,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  server.stdout.on('data', (buffer) => { logs += buffer.toString() })
  server.stderr.on('data', (buffer) => { logs += buffer.toString() })
  let browser
  try {
    await awaitPreview(server)
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CATALOG_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CATALOG_CHROMIUM_EXECUTABLE }
        : {}),
    })
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
