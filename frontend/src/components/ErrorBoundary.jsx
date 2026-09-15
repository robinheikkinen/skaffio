import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, autoReloadAttempted: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    if (this.props.onError) {
      this.props.onError(error, info)
    }
    console.error('ErrorBoundary caught an error:', error, info)

    // Auto-reload EN gång om vi är inom 3s från senaste login.
    // Detta löser race-condition där komponenter hämtar data
    // mikrosekunden innan AuthContext hunnit sätta upp token.
    try {
      const lastLogin = parseInt(sessionStorage.getItem('skaffio.lastLogin') || '0', 10)
      const reloadedAfterLogin = sessionStorage.getItem('skaffio.errorReloaded') === '1'
      if (lastLogin && Date.now() - lastLogin < 3000 && !reloadedAfterLogin) {
        sessionStorage.setItem('skaffio.errorReloaded', '1')
        setTimeout(() => window.location.reload(), 200)
      }
    } catch {}
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas-light dark:bg-canvas-dark px-4">
        <div className="max-w-md w-full surface-card p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/30 flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-rose-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Något gick fel</h1>
            <p className="text-sm text-gray-500 mt-1">
              Sidan kunde inte laddas. Uppdatera och försök igen.
            </p>
          </div>
          <button onClick={this.handleReload} className="btn-primary w-full justify-center">
            <RefreshCw size={18} />
            Ladda om
          </button>
        </div>
      </div>
    )
  }
}