import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tonecos catalog runtime error', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="fatal-state" role="alert">
        <div className="fatal-state__mark" aria-hidden="true">T</div>
        <span className="fatal-state__eyebrow">TONECOS STUDIOS</span>
        <h1>Não foi possível abrir o catálogo</h1>
        <p>Seus favoritos e sua lista continuam salvos neste navegador.</p>
        <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button>
      </main>
    )
  }
}
