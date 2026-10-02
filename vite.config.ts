import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const DEFAULT_PUBLIC_SITE_URL = 'https://washingtonmsdj.github.io/catalogo/'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const publicSiteUrl = (env.VITE_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL).replace(/\/?$/, '/')

  return {
    base: './',
    plugins: [
      react(),
      {
        name: 'tonecos-public-site-url',
        transformIndexHtml(html) {
          return html.replaceAll('__PUBLIC_SITE_URL__', publicSiteUrl)
        },
      },
    ],
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  }
})
