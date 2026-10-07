import viewDescriptorConfig from '../../config/catalog-view-descriptors.json' with { type: 'json' }
import legacyOverrideConfig from '../../config/catalog-legacy-gallery-overrides.json' with { type: 'json' }

export type LegacyGalleryRow = {
  id: string
  slug: string
  name: string
  category_slug: string
  franchise_slug: string
  folder_path: string | null
  image_count: number
}

export type LegacyGalleryPlan = {
  key: string
  family: string
  canonicalSlug: string
  memberIds: string[]
  memberSlugs: string[]
  source: 'high-confidence' | 'reviewed-override'
}

type Descriptor = {
  slugSuffix: string
  priority: number
  class: 'directional' | 'framing'
}

export type LegacyGalleryOverride = {
  categorySlug: string
  franchiseSlug: string
  folderPathKey: string
  family: string
  canonicalSlug: string
  memberSlugs: string[]
  reason: string
}

const descriptors = (viewDescriptorConfig.descriptors as Descriptor[])
  .map((entry) => ({
    suffix: entry.slugSuffix,
    priority: entry.priority,
    kind: entry.class,
  }))
  .sort((left, right) => right.suffix.length - left.suffix.length || left.priority - right.priority)

function validateReviewedOverrides(groups: LegacyGalleryOverride[]) {
  if (legacyOverrideConfig.version !== 2) {
    throw new Error(`legacy gallery override version unsupported: ${legacyOverrideConfig.version}`)
  }

  const groupKeys = new Set<string>()
  const memberSlugs = new Set<string>()
  for (const group of groups) {
    const groupKey = [group.categorySlug, group.franchiseSlug, group.folderPathKey, group.family].join('|')
    if (
      !group.categorySlug
      || !group.franchiseSlug
      || !group.folderPathKey
      || !group.family
      || !group.canonicalSlug
      || !group.reason?.trim()
      || !Array.isArray(group.memberSlugs)
      || group.memberSlugs.length < 2
    ) {
      throw new Error(`invalid legacy gallery group: ${groupKey}`)
    }
    if (groupKeys.has(groupKey)) throw new Error(`duplicate legacy gallery group: ${groupKey}`)
    groupKeys.add(groupKey)

    const local = new Set(group.memberSlugs)
    if (local.size !== group.memberSlugs.length || !local.has(group.canonicalSlug)) {
      throw new Error(`invalid legacy gallery members: ${groupKey}`)
    }
    for (const slug of group.memberSlugs) {
      if (memberSlugs.has(slug)) throw new Error(`legacy slug belongs to multiple groups: ${slug}`)
      memberSlugs.add(slug)
    }
  }
}

const reviewedOverrides = legacyOverrideConfig.groups as LegacyGalleryOverride[]
validateReviewedOverrides(reviewedOverrides)

function descriptorFor(slug: string) {
  for (const descriptor of descriptors) {
    if (!slug.endsWith(descriptor.suffix)) continue
    const family = slug.slice(0, -descriptor.suffix.length)
    if (family) return { family, ...descriptor }
  }
  return null
}

for (const group of reviewedOverrides) {
  for (const slug of group.memberSlugs) {
    const descriptor = descriptorFor(slug)
    if (!descriptor || descriptor.family !== group.family) {
      throw new Error(`legacy gallery member does not match declared family: ${slug}`)
    }
  }
}

function groupKey(row: LegacyGalleryRow, family: string) {
  return [
    row.category_slug,
    row.franchise_slug,
    row.folder_path ?? '',
    row.name.trim().toLocaleLowerCase('pt-BR'),
    family,
  ].join('|')
}

function sameOverrideScope(row: LegacyGalleryRow, candidate: LegacyGalleryOverride) {
  return candidate.categorySlug === row.category_slug
    && candidate.franchiseSlug === row.franchise_slug
    && candidate.folderPathKey === (row.folder_path ?? '')
}

export function registeredLegacyGalleryForRow(row: LegacyGalleryRow): LegacyGalleryOverride | null {
  if (row.image_count !== 1) return null
  return reviewedOverrides.find(
    (candidate) => sameOverrideScope(row, candidate) && candidate.memberSlugs.includes(row.slug),
  ) ?? null
}

export function registeredLegacyGalleryGroups(): readonly LegacyGalleryOverride[] {
  return reviewedOverrides
}

function reviewedOverride(
  first: LegacyGalleryRow,
  family: string,
  members: Array<{ row: LegacyGalleryRow }>,
) {
  const memberSlugs = new Set(members.map(({ row }) => row.slug))
  return reviewedOverrides.find((candidate) => {
    if (
      !sameOverrideScope(first, candidate)
      || candidate.family !== family
    ) return false
    const expected = new Set(candidate.memberSlugs)
    if (expected.size !== memberSlugs.size) return false
    return candidate.memberSlugs.every((slug) => memberSlugs.has(slug))
  })
}

export function legacyCompositeGalleryVersion(
  members: Array<{ slug: string; gallery_version: number }>,
) {
  if (!members.length) throw new Error('legacy gallery version requires members')
  const ordered = [...members].sort((left, right) => left.slug.localeCompare(right.slug, 'en'))
  let hash = 14695981039346656037n
  const prime = 1099511628211n
  for (const member of ordered) {
    if (!Number.isSafeInteger(member.gallery_version) || member.gallery_version < 1) {
      throw new Error(`invalid legacy gallery version: ${member.slug}`)
    }
    const identity = `${member.slug}:${member.gallery_version}|`
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= BigInt(identity.charCodeAt(index))
      hash = BigInt.asUintN(64, hash * prime)
    }
  }
  const version = Number(hash & BigInt(Number.MAX_SAFE_INTEGER))
  return version || 1
}

export function planLegacyGalleryGroups(rows: LegacyGalleryRow[]): LegacyGalleryPlan[] {
  const groups = new Map<string, Array<{
    row: LegacyGalleryRow
    family: string
    suffix: string
    priority: number
    kind: 'directional' | 'framing'
  }>>()

  for (const row of rows) {
    if (row.image_count !== 1) continue
    const descriptor = descriptorFor(row.slug)
    if (!descriptor) continue
    const key = groupKey(row, descriptor.family)
    const members = groups.get(key) ?? []
    members.push({ row, ...descriptor })
    groups.set(key, members)
  }

  const plans: LegacyGalleryPlan[] = []
  for (const [key, members] of groups) {
    if (members.length < 2) continue
    const directional = new Set(
      members.filter((member) => member.kind === 'directional').map((member) => member.suffix),
    )
    const override = reviewedOverride(members[0].row, members[0].family, members)
    if (directional.size < 2 && !override) continue

    const ordered = [...members].sort((left, right) =>
      left.priority - right.priority || left.row.slug.localeCompare(right.row.slug, 'pt-BR'),
    )
    const canonicalSlug = override?.canonicalSlug ?? ordered[0].row.slug
    const canonical = members.find((member) => member.row.slug === canonicalSlug)
    if (!canonical) continue

    const memberSlugs = ordered.map((member) => member.row.slug)
    const memberIds = ordered.map((member) => member.row.id)
    plans.push({
      key,
      family: members[0].family,
      canonicalSlug,
      memberIds,
      memberSlugs,
      source: override ? 'reviewed-override' : 'high-confidence',
    })
  }

  return plans.sort((left, right) => left.key.localeCompare(right.key, 'pt-BR'))
}
