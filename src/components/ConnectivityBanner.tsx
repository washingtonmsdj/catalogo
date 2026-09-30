import { useEffect, useState } from 'react'

export function ConnectivityBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="connectivity-banner" role="status" aria-live="polite">
      <span aria-hidden="true" />
      <strong>Você está offline</strong>
      <p>O que já foi carregado continua disponível. Favoritos e sua lista permanecem salvos.</p>
    </div>
  )
}
