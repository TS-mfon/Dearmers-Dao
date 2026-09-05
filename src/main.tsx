import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID || ''} config={{ loginMethods: ['email', 'wallet'], appearance: { theme: 'dark', accentColor: '#b7ff3c' } }}>
      <App />
    </PrivyProvider>
  </StrictMode>,
)
