import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/motion'
import './components/sound'
import App from './App.tsx'
import SiteAnalytics from './components/SiteAnalytics'
import { startNet } from './net'

// Score stats and accounts: a no-op in a build without a backend.
startNet()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Vercel Web Analytics: one pageview per load, live site only, after the first screen. */}
    <SiteAnalytics />
  </StrictMode>,
)
