import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('publication banner uses canonical catalog runtime and never polls D1', () => {
  const banner = read('src/components/CatalogPublicationBanner.tsx')
  const app = read('src/App.tsx')
  const main = read('src/main.tsx')

  for (const forbidden of ['fetch(', 'setInterval(', 'visibilitychange', 'checkCatalogApi', 'listCatalogCategories', 'useEffect(']) {
    assert.equal(banner.includes(forbidden), false, 'No redundant D1 read: ' + forbidden)
  }
  assert.match(app, /<CatalogPublicationBanner[\s\S]*mode=\{catalog\.mode\}[\s\S]*apiHealthy=\{catalog\.apiHealthy\}[\s\S]*loading=\{catalog\.loading\}[\s\S]*categories=\{catalog\.categories\}/)
  assert.doesNotMatch(main, /CatalogPublicationBanner/)
  assert.match(banner, /loading \|\| !apiHealthy/)
  assert.match(banner, /catalogTotal\(categories\) > 0/)
  assert.match(banner, /Publicação do acervo em andamento/)
})
