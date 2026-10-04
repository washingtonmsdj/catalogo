import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import brand from './config/brand.json'

const DEFAULT_PUBLIC_SITE_URL = 'https://washingtonmsdj.github.io/catalogo/'

const catalogName = `${brand.catalogLabel} ${brand.name}`
const catalogPageTitle = `${brand.catalogLabel} — ${brand.name}`
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const publicSiteUrl = (env.VITE_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL).replace(/\/?$/, '/')

  return {
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
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'site.webmanifest',
            source: manifestSource,
          })
        },
      },
    ],
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  }
})
