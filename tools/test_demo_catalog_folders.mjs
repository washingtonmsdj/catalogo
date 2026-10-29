import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import test from 'node:test'

const bundled = await esbuild.build({
  entryPoints: ['src/data/demoCatalogPagination.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  define: { 'import.meta.env.VITE_CATALOG_MODE': '"demo"' },
})
const catalog = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

test('demo hierarchy has exact category and franchise counts across the 20k index', () => {
  assert.equal(catalog.demoCatalogSize(), 20347)
  let combinations = 0

  for (const category of ['all', 'games', 'anime', 'movies', 'comics', 'horror', 'tokusatsu', 'originals', 'other']) {
    for (const franchise of catalog.demoFranchises(category)) {
      const root = catalog.listDemoFolders(category, franchise.id)
      assert.ok(root.items.length, `${category}/${franchise.id} should expose root folders`)
      assert.equal(root.items.reduce((sum, item) => sum + item.count, 0), franchise.count,
        `${category}/${franchise.id} folder counts should equal its model count`)

      const group = root.items.find((item) => item.hasChildren)
      assert.ok(group, `${category}/${franchise.id} should expose a nested group`)
      const children = catalog.listDemoFolders(category, franchise.id, group.id)
      assert.ok(children.items.length)
      assert.equal(children.items.reduce((sum, item) => sum + item.count, 0), group.count)
      combinations += 1
    }
  }

  assert.equal(combinations, 84)
})

test('a nested demo folder filters a complete, correctly scoped model page', () => {
  const category = 'all'
  const franchise = catalog.demoFranchises(category)[0]
  const root = catalog.listDemoFolders(category, franchise.id)
  const group = root.items.find((item) => item.hasChildren)
  const leaf = catalog.listDemoFolders(category, franchise.id, group.id).items.find((item) => !item.hasChildren)
  const page = catalog.listDemoModels({ category, franchise: franchise.id, folder: leaf.id, search: '', pageIndex: 0, limit: 48 })

  assert.ok(page.totalApprox > 48)
  assert.equal(page.items.length, 48)
  assert.ok(page.items.every((item) => item.franchise === franchise.id))
  assert.ok(page.items.every((item) => item.folderPath === leaf.id || item.folderPath.startsWith(`${leaf.id}/`)))
})

test('material, collection and height facets filter the virtual 20k catalog before paging', () => {
  const page = catalog.listDemoModels({
    category: 'games', franchise: 'all', search: '', pageIndex: 0, limit: 24,
    material: 'pvc', collection: 'art', minHeight: 20, maxHeight: 60,
  })
  assert.ok(page.totalApprox > 48)
  assert.equal(page.items.length, 24)
  assert.ok(page.items.every((item) => item.material.toLocaleLowerCase('pt-BR').includes('pvc')))
  assert.ok(page.items.every((item) => item.collection.toLocaleLowerCase('pt-BR').includes('art')))
  assert.ok(page.items.every((item) => item.heightCm >= 20 && item.heightCm <= 60))
  const nextPage = catalog.listDemoModels({
    category: 'games', franchise: 'all', search: '', pageIndex: 1, limit: 24,
    material: 'pvc', collection: 'art', minHeight: 20, maxHeight: 60,
  })
  assert.equal(nextPage.totalApprox, page.totalApprox)
  assert.equal(nextPage.items.length, 24)
  assert.equal(page.items.some((item) => nextPage.items.some((next) => next.id === item.id)), false)

  const empty = catalog.listDemoModels({
    category: 'games', franchise: 'all', search: '', pageIndex: 0, limit: 24,
    material: 'material inexistente',
  })
  assert.equal(empty.totalApprox, 0)
  assert.deepEqual(empty.items, [])
})

test('demo search and text facets ignore accents like the live FTS index', () => {
  const search = (term) => catalog.listDemoModels({
    category: 'all', franchise: 'all', search: term, pageIndex: 0, limit: 24,
  })
  const accentedSearch = search('Guardião')
  const plainSearch = search('guardiao')
  assert.equal(plainSearch.totalApprox, accentedSearch.totalApprox)
  assert.deepEqual(plainSearch.items.map((item) => item.id), accentedSearch.items.map((item) => item.id))
  assert.ok(plainSearch.items.length > 0)

  const collection = (term) => catalog.listDemoModels({
    category: 'all', franchise: 'all', search: '', collection: term, pageIndex: 0, limit: 24,
  })
  const accentedFacet = collection('coleção')
  const plainFacet = collection('colecao')
  assert.equal(plainFacet.totalApprox, accentedFacet.totalApprox)
  assert.deepEqual(plainFacet.items.map((item) => item.id), accentedFacet.items.map((item) => item.id))
  assert.ok(plainFacet.items.length > 0)
})
