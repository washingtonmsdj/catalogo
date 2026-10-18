import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const browser = readFileSync(new URL('../src/components/FranchiseBrowser.tsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('../src/components/CatalogHome.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/explorer.css', import.meta.url), 'utf8')

test('responsive explorer reuses the exact canonical tree and its folder API', () => {
  assert.match(browser, /import \{ CatalogSidebarTree \} from '\.\/CatalogSidebarTree'/)
  assert.match(browser, /<CatalogSidebarTree[\s\S]*?category=\{browsingFranchise\.category\}[\s\S]*?franchise=\{browsingFranchise\.id\}/)
  assert.doesNotMatch(browser, /fetch\s*\(|listCatalogFolders/)
  assert.match(home, /<CatalogSidebarTree/)
})

test('live franchises retain model selection and have a separate accessible folder action', () => {
  assert.ok(browser.includes('Ver modelos de'))
  assert.ok(browser.includes('Navegar pastas de'))
  assert.match(browser, /mode === 'live' && \(/)
  assert.match(browser, /ref=\{backRef\}/)
  assert.match(browser, /Voltar às franquias/)
  assert.match(browser, /Ver todos os modelos da franquia/)
  assert.match(css, /\.explorer-grid__browse\s*\{[^}]*min-height:\s*44px/)
  assert.match(css, /\.explorer-folder-structure \.storefront-tree-toggle\s*\{[^}]*height:\s*44px/)
  assert.match(css, /\.explorer-folder-structure \.storefront-tree-select\s*\{[^}]*min-height:\s*44px/)
})

test('selected folder uses canonical category, franchise and folder setters, in order', () => {
  assert.ok(browser.includes('onSelectFolder(browsingFranchise.category, browsingFranchise.id, folder)'))
  assert.match(app, /function chooseExplorerFolder\(category: string, franchise: string, folder: string\) \{\s*catalog\.setSearch\(''\)\s*catalog\.setCategory\(category\)\s*catalog\.setFranchise\(franchise\)\s*catalog\.setFolder\(folder\)/)
  assert.match(app, /<FranchiseBrowser[^>]*onSelectFolder=\{chooseExplorerFolder\}/)
})
