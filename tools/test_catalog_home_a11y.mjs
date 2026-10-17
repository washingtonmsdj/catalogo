import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const home = readFileSync(new URL('../src/components/CatalogHome.tsx', import.meta.url), 'utf8')
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
