import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const home = readFileSync(new URL('../src/components/CatalogHome.tsx', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../src/hooks/useCatalogRuntime.ts', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/catalog-home.css', import.meta.url), 'utf8')

test('keyboard users can skip navigation to a focusable main landmark', () => {
  assert.match(home, /<a className="storefront-skip-link" href="#catalogo">Pular para o catálogo<\/a>/)
  assert.match(home, /<main id="catalogo" tabIndex=\{-1\}/)
  assert.match(css, /\.storefront-skip-link:focus-visible\s*\{[^}]*top:/)
  assert.match(css, /#catalogo\s*\{\s*scroll-margin-top:/)
})

test('collections navigation never points to an absent results-only anchor', () => {
  const sidebar = home.split('<nav className="storefront-sidebar__nav"')[1]?.split('</nav>')[0]
  const topbar = home.split('<nav aria-label="Navegação principal">')[1]?.split('</nav>')[0]
  assert.ok(sidebar && topbar)
  assert.match(sidebar, /\{resultsMode\s*\?\s*\(\s*<button type="button" onClick=\{\(\) => onOpenExplorer\(\)\}>/)
  assert.match(sidebar, /:\s*\(\s*<a href="#colecoes"/)
  assert.match(topbar, /\{resultsMode\s*\?\s*<button type="button" onClick=\{\(\) => onOpenExplorer\(\)\}>Coleções<\/button>\s*:\s*<a href="#colecoes"/)
  assert.match(home, /\{!resultsMode && <>[\s\S]*?<section id="colecoes"/)
})

test('icon-only pagination and franchise search have accessible names', () => {
  assert.match(home, /<input aria-label="Buscar franquias" value=\{franchiseFilter\}/)
  assert.match(home, /aria-label="Página anterior" disabled=\{catalog\.loading \|\| !catalog\.hasPreviousPage\}/)
  assert.match(home, /aria-label="Próxima página" disabled=\{catalog\.loading \|\| !catalog\.hasNextPage\}/)
  assert.match(home, /className="storefront-hero__dots" role="group" aria-label="Coleções em destaque"/)
  assert.match(css, /\.storefront-pager button:focus-visible/)
  assert.match(css, /\.storefront-franchise-search:focus-within/)
})

test('franchise discovery matches labels regardless of Portuguese accents', () => {
  assert.match(home, /function normalizeCatalogLabel\(value: string\)\s*\{\s*return value\.toLocaleLowerCase\('pt-BR'\)\.normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/)
  assert.match(home, /normalizeCatalogLabel\(item\.label\)\.includes\(franchiseNeedle\)/)
  assert.match(home, /normalizeCatalogLabel\(model\.franchise\)/)
})

test('R29 mobile header exposes the existing franchise and folder explorer at 44px', () => {
  assert.match(home, /className="storefront-topbar__collections storefront-topbar__explore"/)
  assert.match(home, /aria-label="Explorar franquias e pastas"/)
  assert.match(css, /@media \(max-width: 1080px\)\s*\{\s*\.storefront-topbar__explore \{ display: inline-flex; \}/)
})

test('attribute filters have a keyboard accessible disclosure and named numeric ranges', () => {
  assert.match(home, /aria-expanded=\{filterPanelOpen\} aria-controls="storefront-attribute-filters"/)
  assert.match(home, /<form id="storefront-attribute-filters" className="storefront-attribute-filters" aria-label="Filtros de atributos" hidden=\{!filterPanelOpen\}/)
  assert.match(home, /<legend>Altura \(cm\)<\/legend>/)
  assert.match(home, /<label>Mínima<input type="number" min="1" max="300"/)
  assert.match(home, /<label>Máxima<input type="number" min="1" max="300"/)
  assert.match(home, /role="alert">\{filterError\}/)
  assert.match(css, /\.storefront-attribute-filters input:focus-visible/)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.storefront-attribute-filters input,[\s\S]*?\.storefront-attribute-filters__actions button \{ min-height: 44px; \}/)
})


test('hero carousel controls keep 44px touch targets without enlarging decorative dots', () => {
  assert.match(home, /className="storefront-hero__dots" role="group" aria-label=/)
  const dotButtons = [...css.matchAll(/\.storefront-hero__dots button\s*\{([^}]*)\}/g)].map((match) => match[1])
  const declaredWidths = dotButtons.map((rule) => rule.match(/\bwidth:\s*(\d+)px/)?.[1]).filter(Boolean)
  assert.deepEqual(declaredWidths, ['44'])
  assert.ok(dotButtons.some((rule) => /height:\s*44px/.test(rule)))
  assert.match(css, /\.storefront-hero__dots button::before\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;/)
  assert.match(css, /\.storefront-hero__dots button\[aria-current="true"\]::before\s*\{[^}]*width:\s*17px;/)
  assert.match(css, /\.storefront-hero__nav\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/)
  assert.doesNotMatch(css, /\.storefront-hero__dots button\[aria-current="true"\]\s*\{[^}]*width:/)
})


test('unavailable catalog is not displayed as zero results or a fake demo', () => {
  assert.match(home, /catalogPageIsUnavailable\(catalog\)/)
  assert.match(home, /catalogUnavailable \? \([\s\S]*?Catálogo temporariamente indisponível/)
  assert.match(home, /Isso não significa que o acervo esteja vazio/)
  assert.match(home, /onClick=\{\(\) => window\.location\.reload\(\)\}>Tentar novamente/)
  assert.match(home, /catalogUnavailable \? 'Modelos temporariamente indisponíveis'/)
  assert.match(home, /catalogUnavailable \? '—' : formatter\.format\(catalogTotal\)/)
  assert.doesNotMatch(home, /catalogUnavailable[^\n]*demoModels/)
})


test('live catalog startup avoids a redundant D1 health preflight', () => {
  assert.doesNotMatch(runtime, /checkCatalogApi\(/)
  assert.match(runtime, /listCatalogCategories\(\)/)
  assert.match(runtime, /setApiHealthy\(true\)/)
  assert.match(worker, /const schema = await catalogSchemaStatus\(env\.DB\)[\s\S]*?if \(!schema\.ready\) \{[\s\S]*?url\.pathname === '\/api\/categories'/)
})


test('tablet has the canonical five-stop topbar when the sidebar is hidden', () => {
  assert.match(css, /@media \(min-width: 621px\) and \(max-width: 1080px\)\s*\{[\s\S]*?\.storefront-topbar nav\s*\{\s*grid-area: nav;\s*display: flex;/)
  assert.match(css, /\.storefront-topbar nav button\s*\{\s*flex: 1 0 auto;\s*min-height: 44px;/)
  assert.match(home, /href=\{resultsMode \? '#destaques' : '#catalogo'\}/)
  assert.match(css, /@media \(max-width: 1080px\)\s*\{\s*\.storefront-topbar__favorites \{ display: inline-flex !important; \}/)
  assert.doesNotMatch(home, /aria-current=\{activeNavSection !== 'colecoes' \? 'page'/)
})

test('front-end palette and readable type stay on storefront SSOT', () => {
  assert.match(css, /--store-type-caption: \.6875rem;/)
  assert.match(css, /--store-type-label: \.75rem;/)
  assert.match(css, /\.storefront-topbar nav button:hover \{ background: var\(--store-accent-soft\); \}/)
  assert.match(css, /\.storefront-model-card__copy small \{ font-size: var\(--store-type-caption\); \}/)
  assert.doesNotMatch(css, /\.storefront-sidebar__nav a\[href="#colecoes"\] \.storefront-icon \{ color: #8bd8c1;/)
})


test('responsive editorial display never silently hides a model', () => {
  assert.doesNotMatch(css, /\.storefront-model-card:nth-child\(n\+\d+\)\s*\{\s*display:\s*none;/)
  assert.match(css, /\.storefront-section:not\(\.storefront-section--results\) \.storefront-section__head p \{ display: none; \}/)
  assert.match(css, /\.storefront-section--results \.storefront-section__head p \{ display: block; line-height: 1\.45;/)
  assert.match(css, /\.storefront-results-view-toggle button \{ width: 44px; height: 44px; \}/)
})


test('advertised search shortcut focuses the canonical input instead of opening explorer', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /quickSearchShortcut && !anyModalOpen && !event\.isComposing/)
  assert.match(app, /searchInputRef\.current\?\.focus\(\)/)
  assert.match(app, /searchInputRef\.current\?\.select\(\)/)
  assert.doesNotMatch(app, /event\.key\.toLowerCase\(\) === 'k' && !anyModalOpen\) \{ event\.preventDefault\(\); openExplorer/)
  assert.match(home, /aria-label="Limpar busca"/)
  assert.match(home, /setGlobalSearchActiveIndex\(-1\); searchInputRef\.current\?\.focus\(\)/)
  assert.match(css, /\.storefront-search-suggestions \{\s*position: absolute;\s*top: calc\(100% \+ 8px\);/)
  assert.match(css, /\.storefront-search__clear \{ width: 44px; height: 44px; flex-basis: 44px; \}/)
})


test('active and saved filters inherit theme tokens and mobile touch dimensions', () => {
  assert.match(css, /\.storefront-active-filters \{[^}]*flex-wrap: wrap;[^}]*background: var\(--store-panel\);/)
  assert.match(css, /\.storefront-active-filters button \{[^}]*min-height: 36px;[^}]*font: 650 var\(--store-type-caption\)/)
  assert.match(css, /\.storefront-active-filters button:focus-visible \{ outline: 2px solid var\(--store-accent\);/)
  assert.match(css, /\.storefront-saved-filter button:focus-visible \{ outline: 2px solid var\(--store-accent\);/)
  assert.match(css, /\.storefront-active-filters button \{ min-height: 44px; font-size: var\(--store-type-label\); \}/)
  assert.match(css, /\.storefront-saved-filter button \{ min-height: 44px; font-size: var\(--store-type-label\); \}/)
  assert.doesNotMatch(css, /\.storefront-active-filters button \{ background: #302820 !important; \}/)
})
