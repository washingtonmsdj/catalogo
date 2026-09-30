import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { ConnectivityBanner } from './components/ConnectivityBanner'
import './styles.css'
import './hierarchy.css'
import './runtime.css'
import './premium.css'
import './lightbox.css'
import './resilience.css'
import './product-polish.css'
import './media-fallback.css'

function installMediaFallback() {
  document.addEventListener('error', (event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement)) return
    image.dataset.mediaFailed = 'true'
    image.closest('.model-art, .gallery-real-image, .image-lightbox__stage')?.classList.add('media-failed')
  }, true)
}

installMediaFallback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ConnectivityBanner />
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
