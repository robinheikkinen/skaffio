import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import { AuthProvider } from './context/AuthContext'
import { CookingProvider } from './context/CookingSession'

// Apply saved theme before first render
const theme = localStorage.getItem('theme')
if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark')
}

// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('/service-worker.js')
// }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
  <ErrorBoundary>
    <AuthProvider>
      <CookingProvider>
        <App />
      </CookingProvider>
    </AuthProvider>
    </ErrorBoundary>
</React.StrictMode>
)
