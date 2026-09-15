import { useState } from 'react'
import { Navigate, Link, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { LogIn, Mail, Lock } from 'lucide-react'
import SkaffioLogo from '../components/SkaffioLogo'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { user, login, status, loading } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (loading) return null
  if (user) return <Navigate to={location.state?.from || '/'} replace />
  // First-run: no users yet → punta över till register.
  if (!status.has_users) return <Navigate to="/register" replace />

const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim().toLowerCase(), password, totpCode || undefined)
      toast.success('Välkommen tillbaka 👋')
    } catch (err) {
      const msg = err.message || 'Kunde inte logga in'
      // Backend signalerar "2FA-kod krävs" — visa TOTP-fält
      if (msg.includes('2FA') || msg.includes('totp')) {
        setNeedsTotp(true)
        if (msg.includes('Ogiltig')) setError('Ogiltig 2FA-kod, försök igen')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const sessionExpired = location.state?.sessionExpired

return (
    <div className="min-h-screen flex items-center justify-center bg-canvas-light dark:bg-canvas-dark px-4">
      <div className="w-full max-w-sm space-y-6">
  {sessionExpired && (
    <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-700 dark:text-rose-300">
      Sessionen har gått ut. Logga in igen för att fortsätta.
    </div>
  )}
        <div className="flex flex-col items-center gap-3">
          <SkaffioLogo size={56} />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Skaffio</h1>
            <p className="text-sm text-gray-500 mt-1">Logga in på familjekontot</p>
          </div>
        </div>

        {error && (
  <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-700 dark:text-rose-300">
    {error}
  </div>
)}

<form onSubmit={submit} className="surface-card p-6 space-y-4">
          <div>
            <label className="label">E-post</label>
            <div className="relative">
              <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input pl-11"
                placeholder="du@familj.se"
              />
            </div>
          </div>
          <div>
            <label className="label">Lösenord</label>
            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pl-11"
                placeholder="••••••••"
              />
            </div>
          </div>
          {needsTotp && (
            <div className="animate-fade-in">
              <label className="label">2FA-kod</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                className="input text-center text-2xl tracking-[0.4em] font-mono"
                placeholder="000000"
              />
              <p className="text-xs text-gray-500 mt-1">6-siffrig kod från din Authenticator-app</p>
            </div>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            <LogIn size={18} strokeWidth={2.4} />
            {busy ? 'Loggar in...' : 'Logga in'}
          </button>
        </form>

        <div className="text-center text-xs text-gray-400 px-4 leading-relaxed">
          💡 Loggar du in via <span className="font-semibold">skaffio.app</span> med Google eller engångskod?
          Då är du redan inne — formuläret behövs bara för direkt-LAN-access eller om
          inloggningen av någon anledning inte triggas.
        </div>
        {status.allow_registration && (
          <p className="text-center text-sm text-gray-500">
            Ny här?{' '}
            <Link to="/register" className="text-primary font-semibold hover:underline">
              Skapa konto
            </Link>
          </p>
        )}
        <p className="text-center text-xs text-gray-400">
          <Link to="/privacy" className="hover:text-primary hover:underline transition-colors">
            Integritetspolicy
          </Link>
        </p>
      </div>
    </div>
  )
}
