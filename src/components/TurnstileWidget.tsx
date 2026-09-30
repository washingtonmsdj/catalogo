import { useEffect, useRef, useState } from 'react'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim()
let scriptPromise: Promise<void> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-tonecos-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('turnstile_script_failed')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.tonecosTurnstile = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('turnstile_script_failed'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

export function isTurnstileConfigured() {
  return Boolean(siteKey)
}

export function TurnstileWidget({ resetKey = 0 }: { resetKey?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [token, setToken] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!siteKey || !containerRef.current) return
    let disposed = false
    let widgetId: string | null = null
    setToken('')
    setFailed(false)

    loadTurnstile()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) return
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'flexible',
          appearance: 'interaction-only',
          action: 'quote',
          callback: (value: string) => setToken(value),
          'expired-callback': () => setToken(''),
          'timeout-callback': () => setToken(''),
          'error-callback': () => {
            setToken('')
            setFailed(true)
          },
        })
      })
      .catch(() => setFailed(true))

    return () => {
      disposed = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [resetKey])

  if (!siteKey) return null

  return (
    <div className="turnstile-field">
      <div ref={containerRef} />
      <input type="hidden" name="turnstileToken" value={token} readOnly />
      {failed && <p role="alert">A verificação anti-bot não carregou. Atualize a página e tente novamente.</p>}
    </div>
  )
}
