import definition from '../../config/brand.json'

export const BRAND_NAME = definition.name
export const BRAND_SHORT_NAME = definition.shortName
export const CATALOG_LABEL = definition.catalogLabel

export const BRAND_NAME_UPPER = BRAND_NAME.toLocaleUpperCase('pt-BR')
export const CATALOG_NAME = `${CATALOG_LABEL} ${BRAND_NAME}`
export const CATALOG_PAGE_TITLE = `${CATALOG_LABEL} — ${BRAND_NAME}`
export const BRAND_FILE_SLUG = BRAND_SHORT_NAME
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'catalogo'

export function catalogDocumentTitle(prefix?: string) {
  return prefix ? `${prefix} — ${CATALOG_NAME}` : CATALOG_PAGE_TITLE
}
