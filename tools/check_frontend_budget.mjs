import { gzipSync } from 'node:zlib'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const DIST = new URL('../dist/', import.meta.url)

const LIMITS = {
  singleJsGzip: 180 * 1024,
  totalJsGzip: 250 * 1024,
  totalCssGzip: 60 * 1024,
  totalJsRaw: 650 * 1024,
  totalCssRaw: 200 * 1024,
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else files.push(path)
  }
  return files
}

const pretty = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
const files = await walk(DIST)
const measured = []

for (const file of files) {
  const extension = extname(file)
  if (!['.js', '.css'].includes(extension)) continue
  const body = await readFile(file)
  measured.push({
    file: relative(DIST.pathname, file),
    type: extension.slice(1),
    raw: body.byteLength,
    gzip: gzipSync(body, { level: 9 }).byteLength,
  })
}

const js = measured.filter((item) => item.type === 'js')
const css = measured.filter((item) => item.type === 'css')
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0)
const totals = {
  jsRaw: sum(js, 'raw'),
  jsGzip: sum(js, 'gzip'),
  cssRaw: sum(css, 'raw'),
  cssGzip: sum(css, 'gzip'),
}

console.log('Frontend performance budget')
for (const item of measured.sort((a, b) => b.gzip - a.gzip)) {
  console.log(`- ${item.file}: ${pretty(item.raw)} raw / ${pretty(item.gzip)} gzip`)
}
console.log(`TOTAL JS:  ${pretty(totals.jsRaw)} raw / ${pretty(totals.jsGzip)} gzip`)
console.log(`TOTAL CSS: ${pretty(totals.cssRaw)} raw / ${pretty(totals.cssGzip)} gzip`)

const violations = []
for (const item of js) {
  if (item.gzip > LIMITS.singleJsGzip) {
    violations.push(`${item.file} gzip ${pretty(item.gzip)} > ${pretty(LIMITS.singleJsGzip)}`)
  }
}
if (totals.jsGzip > LIMITS.totalJsGzip) violations.push(`JS gzip total ${pretty(totals.jsGzip)} > ${pretty(LIMITS.totalJsGzip)}`)
if (totals.cssGzip > LIMITS.totalCssGzip) violations.push(`CSS gzip total ${pretty(totals.cssGzip)} > ${pretty(LIMITS.totalCssGzip)}`)
if (totals.jsRaw > LIMITS.totalJsRaw) violations.push(`JS raw total ${pretty(totals.jsRaw)} > ${pretty(LIMITS.totalJsRaw)}`)
if (totals.cssRaw > LIMITS.totalCssRaw) violations.push(`CSS raw total ${pretty(totals.cssRaw)} > ${pretty(LIMITS.totalCssRaw)}`)

if (violations.length) {
  console.error('\nPerformance budget exceeded:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('OK: frontend bundle is within the approved budget.')
