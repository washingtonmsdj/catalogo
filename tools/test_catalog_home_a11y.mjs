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
