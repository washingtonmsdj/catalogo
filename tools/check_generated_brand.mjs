import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')
const BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'brand.json'), 'utf8'))

const forbiddenMarks = [
  Buffer.from([115, 116, 108, 102, 111, 114, 103, 101]).toString('utf8'),
  Buffer.from([115, 116, 108, 32, 102, 111, 114, 103, 101]).toString('utf8'),
]
const unresolvedBrandTokens = [
  '__BRAND_NAME__',
  '__BRAND_SHORT_NAME__',
  '__CATALOG_LABEL__',
  '__CATALOG_NAME__',
  '__CATALOG_PAGE_TITLE__',
]

function fail(message) {
  console.error(`[brand:dist] ${message}`)
  process.exitCode = 1
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

if (!fs.existsSync(DIST)) {
  fail('dist/ não existe; execute o build antes da validação de marca.')
  process.exit()
}

const files = walk(DIST)
const offenders = []
const unresolved = []

for (const file of files) {
  const body = fs.readFileSync(file).toString('utf8')
  const normalized = body.toLocaleLowerCase('en-US')
  if (forbiddenMarks.some((mark) => normalized.includes(mark))) {
    offenders.push(path.relative(ROOT, file))
  }
  if (unresolvedBrandTokens.some((token) => body.includes(token))) {
    unresolved.push(path.relative(ROOT, file))
  }
}

if (offenders.length) {
  fail(`identidade concorrente encontrada no build: ${offenders.join(', ')}`)
}
if (unresolved.length) {
  fail(`tokens de marca não resolvidos no build: ${unresolved.join(', ')}`)
}

const indexPath = path.join(DIST, 'index.html')
const manifestPath = path.join(DIST, 'site.webmanifest')
const faviconPath = path.join(DIST, 'favicon.svg')

for (const required of [indexPath, manifestPath, faviconPath]) {
  if (!fs.existsSync(required)) {
    fail(`asset obrigatório ausente: ${path.relative(ROOT, required)}`)
  }
}

if (process.exitCode) process.exit(process.exitCode)

const indexHtml = fs.readFileSync(indexPath, 'utf8')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const favicon = fs.readFileSync(faviconPath, 'utf8')
const expectedCatalogName = `${BRAND.catalogLabel} ${BRAND.name}`
const expectedPageTitle = `${BRAND.catalogLabel} — ${BRAND.name}`
const expectedInitial = Array.from(BRAND.shortName.trim())[0]?.toLocaleUpperCase('pt-BR') ?? '?'

if (!indexHtml.includes(BRAND.name)) fail('index.html não contém a marca definida no SSOT.')
if (!indexHtml.includes(expectedPageTitle)) fail('index.html não contém o título derivado do SSOT.')
if (manifest.name !== expectedCatalogName) fail(`manifest.name divergente: ${manifest.name}`)
if (manifest.short_name !== BRAND.shortName) fail(`manifest.short_name divergente: ${manifest.short_name}`)
if (!favicon.includes(`>${expectedInitial}</text>`)) fail('favicon.svg não contém a inicial derivada do SSOT.')

if (!process.exitCode) {
  console.log(`[brand:dist] OK — ${BRAND.name}; ${files.length} arquivos verificados.`)
}
