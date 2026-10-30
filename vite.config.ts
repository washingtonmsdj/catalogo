import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PurgeCSS } from 'purgecss'
import brand from './config/brand.json'
import publicRuntime from './config/public-runtime.json'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const catalogName = `${brand.catalogLabel} ${brand.name}`
const catalogPageTitle = `${brand.catalogLabel} — ${brand.name}`
const publicSiteUrl = publicRuntime.publicSiteUrl.replace(/\/?$/, '/')
const brandInitial = Array.from(brand.shortName.trim())[0]?.toLocaleUpperCase('pt-BR') ?? '?'
const faviconSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#071817"/>
  <rect x="7" y="7" width="50" height="50" rx="10" fill="none" stroke="#24f0b0" stroke-opacity=".45" stroke-width="2"/>
  <text x="32" y="40" text-anchor="middle" fill="#74ffd1" font-family="Arial,sans-serif" font-size="30" font-weight="800">${brandInitial}</text>
  <path d="M22 48h20" stroke="#a8ffe1" stroke-width="2.5" stroke-linecap="round"/>
</svg>
`
const manifestSource = `${JSON.stringify({
  name: catalogName,
  short_name: brand.shortName,
  description: `Catálogo digital da ${brand.name}`,
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#080a0c',
  theme_color: '#080a0c',
  icons: [
    {
      src: './favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    },
  ],
}, null, 2)}\n`

function applyBrandTokens(html: string) {
  return html
    .replaceAll('__BRAND_NAME__', brand.name)
    .replaceAll('__BRAND_SHORT_NAME__', brand.shortName)
    .replaceAll('__CATALOG_LABEL__', brand.catalogLabel)
    .replaceAll('__CATALOG_NAME__', catalogName)
    .replaceAll('__CATALOG_PAGE_TITLE__', catalogPageTitle)
}

function sourceFilesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(target)
    return /\.(?:ts|tsx|js|jsx|html)$/.test(entry.name) ? [target] : []
  })
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'catalog-branding',
      transformIndexHtml(html) {
        return applyBrandTokens(html).replaceAll('__PUBLIC_SITE_URL__', publicSiteUrl)
      },
      configureServer(server) {
        server.middlewares.use('/site.webmanifest', (_request, response) => {
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
          response.end(manifestSource)
        })
        server.middlewares.use('/favicon.svg', (_request, response) => {
          response.statusCode = 200
          response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
          response.end(faviconSource)
        })
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'site.webmanifest',
          source: manifestSource,
        })
        this.emitFile({
          type: 'asset',
          fileName: 'favicon.svg',
          source: faviconSource,
        })
      },
    },
    {
      name: 'catalog-demo-artifact-isolation',
      apply: 'build',
      writeBundle(outputOptions) {
        if (process.env.VITE_CATALOG_MODE === 'demo') return

        const outputDirectory = outputOptions.dir ?? 'dist'
        for (const demoAsset of ['collectible-covers.png', 'hero-campaign.png']) {
          fs.rmSync(path.resolve(outputDirectory, 'demo', demoAsset), { force: true })
        }
      },
    },
    {
      name: 'catalog-prune-unused-css',
      apply: 'build',
      async generateBundle(_options, bundle) {
        const content = [
          path.join(projectRoot, 'index.html'),
          ...sourceFilesUnder(path.join(projectRoot, 'src')),
        ].map((filePath) => ({
          raw: fs.readFileSync(filePath, 'utf8'),
          extension: path.extname(filePath).slice(1),
        }))
        const purger = new PurgeCSS()
        for (const asset of Object.values(bundle)) {
          if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue
          const results = await purger.purge({
            content,
            css: [{ raw: asset.source.toString() }],
            safelist: {
              standard: [/^is-/, /^storefront-/],
              deep: [/data-media-failed/],
            },
          })
          if (!results[0]) throw new Error(`CSS purge produced no output for ${asset.fileName}`)
          asset.source = results[0].css
        }
      },
    },
  ],
  server: {
    watch: {
      ignored: ['**/work/**'],
    },
  },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    sourcemap: false,
  },
})
