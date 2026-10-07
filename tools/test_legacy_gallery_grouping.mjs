import assert from 'node:assert/strict'
import test from 'node:test'

import { legacyCompositeGalleryVersion, planLegacyGalleryGroups, registeredLegacyGalleryForRow, registeredLegacyGalleryGroups } from '../src/lib/legacyGalleryGrouping.ts'

function row(id, slug, overrides = {}) {
  return {
    id,
    slug,
    name: 'Androide 18',
    category_slug: 'animes-desenhos',
    franchise_slug: 'dragon-ball',
    folder_path: 'androides/androide-18',
    image_count: 1,
    ...overrides,
  }
}

test('directional legacy views collapse automatically', () => {
  const plans = planLegacyGalleryGroups([
    row('front', 'dragon-ball-androide-18-traje-casual-frente'),
    row('side', 'dragon-ball-androide-18-traje-casual-lateral'),
    row('back', 'dragon-ball-androide-18-traje-casual-costas'),
  ])

  assert.equal(plans.length, 1)
  assert.equal(plans[0].source, 'high-confidence')
  assert.equal(plans[0].canonicalSlug, 'dragon-ball-androide-18-traje-casual-frente')
  assert.equal(plans[0].memberIds.length, 3)
})

test('ambiguous framing-only pair stays separate without review', () => {
  const plans = planLegacyGalleryGroups([
    row('full', 'dragon-ball-cell-primeira-forma-corpo-inteiro', {
      name: 'Cell',
      folder_path: 'androides/cell',
    }),
    row('stand', 'dragon-ball-cell-primeira-forma-em-pe', {
      name: 'Cell',
      folder_path: 'androides/cell',
    }),
  ])

  assert.deepEqual(plans, [])
})

test('reviewed Android 18 framing pair collapses only by explicit override', () => {
  const plans = planLegacyGalleryGroups([
    row('full', 'dragon-ball-androide-18-traje-azul-corpo-inteiro'),
    row('stand', 'dragon-ball-androide-18-traje-azul-em-pe'),
  ])

  assert.equal(plans.length, 1)
  assert.equal(plans[0].source, 'reviewed-override')
  assert.equal(plans[0].canonicalSlug, 'dragon-ball-androide-18-traje-azul-corpo-inteiro')
})

test('reviewed override is scoped to its exact folder and members', () => {
  const wrongFolder = planLegacyGalleryGroups([
    row('full', 'dragon-ball-androide-18-traje-azul-corpo-inteiro', { folder_path: 'outro' }),
    row('stand', 'dragon-ball-androide-18-traje-azul-em-pe', { folder_path: 'outro' }),
  ])
  assert.deepEqual(wrongFolder, [])

  const partial = planLegacyGalleryGroups([
    row('full', 'dragon-ball-androide-18-traje-azul-corpo-inteiro'),
  ])
  assert.deepEqual(partial, [])
})

test('registered repair is discoverable from a single page member', () => {
  const member = row('side', 'dragon-ball-androide-18-traje-casual-lateral')
  const repair = registeredLegacyGalleryForRow(member)

  assert.ok(repair)
  assert.equal(repair.canonicalSlug, 'dragon-ball-androide-18-traje-casual-frente')
  assert.equal(repair.memberSlugs.length, 4)
})

test('registered repair debt has no duplicate member slugs', () => {
  const groups = registeredLegacyGalleryGroups()
  const seen = new Set()

  assert.ok(groups.length >= 18)
  for (const group of groups) {
    assert.ok(group.memberSlugs.includes(group.canonicalSlug))
    assert.equal(new Set(group.memberSlugs).size, group.memberSlugs.length)
    for (const slug of group.memberSlugs) {
      assert.equal(seen.has(slug), false, `legacy slug appears in more than one group: ${slug}`)
      seen.add(slug)
    }
  }
})

test('registered legacy duplicate-card debt never grows above audited baseline', () => {
  const groups = registeredLegacyGalleryGroups()
  const extraCards = groups.reduce((sum, group) => sum + group.memberSlugs.length - 1, 0)

  assert.ok(extraCards > 0)
  assert.ok(
    extraCards <= 29,
    `legacy duplicate-card debt increased from audited baseline: ${extraCards} > 29`,
  )
})

test('legacy composite gallery version fingerprints composition instead of summing versions', () => {
  const first = legacyCompositeGalleryVersion([
    { slug: 'modelo-frente', gallery_version: 10 },
    { slug: 'modelo-costas', gallery_version: 20 },
  ])
  const sameSumDifferentState = legacyCompositeGalleryVersion([
    { slug: 'modelo-frente', gallery_version: 11 },
    { slug: 'modelo-costas', gallery_version: 19 },
  ])
  const reversedInput = legacyCompositeGalleryVersion([
    { slug: 'modelo-costas', gallery_version: 20 },
    { slug: 'modelo-frente', gallery_version: 10 },
  ])

  assert.notEqual(first, sameSumDifferentState)
  assert.equal(first, reversedInput)
  assert.ok(Number.isSafeInteger(first) && first > 0)
})

test('legacy composite gallery version rejects invalid physical versions', () => {
  assert.throws(
    () => legacyCompositeGalleryVersion([{ slug: 'modelo', gallery_version: 0 }]),
    /invalid legacy gallery version/,
  )
})

test('multi-image records are never treated as legacy split cards', () => {
  const plans = planLegacyGalleryGroups([
    row('front', 'dragon-ball-androide-18-traje-casual-frente', { image_count: 2 }),
    row('side', 'dragon-ball-androide-18-traje-casual-lateral'),
  ])
  assert.deepEqual(plans, [])
})
