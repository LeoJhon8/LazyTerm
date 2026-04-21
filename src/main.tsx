import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import 'geist/font/sans';
import 'geist/font/mono';
import './index.css'
import App from './App.tsx'

// Disable the native WebView context menu in production builds only.
// Custom Radix UI context menus are unaffected because they call
// event.preventDefault() themselves before the event reaches document.
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

const app = <App />

createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? app : <StrictMode>{app}</StrictMode>,
)
