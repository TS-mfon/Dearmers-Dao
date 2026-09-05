import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import './App.css'
import App from './App.tsx'

class AppBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { if (this.state.error) return <main className="app-failure"><img src="/dreamers-dao-logo.svg" alt="Dreamers DAO"/><span className="eyebrow">THE DAO FOR DREAMERS</span><h1>The sanctuary is still waking.</h1><p>Authentication is unavailable, but the product should remain usable. Reload once or continue with the wallet workspace.</p><code>{this.state.error.message}</code><button onClick={() => window.location.reload()}>Reload sanctuary</button><a href="/explorer">Continue to Explorer</a></main>; return this.props.children; }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppBoundary>
      <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID || ''} config={{ appearance: { theme: 'dark', accentColor: '#b7ff3c' } }}>
        <App />
      </PrivyProvider>
    </AppBoundary>
  </StrictMode>,
)
document.getElementById('boot-screen')?.remove()
