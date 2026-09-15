import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { UserPlus, Mail, Lock, User as UserIcon, Crown } from 'lucide-react'
import SkaffioLogo from '../components/SkaffioLogo'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { user, status, loading, register } = useAuth()
  // ALLA hooks måste deklareras före tidiga returns — annars kraschar React #310
  // ("Rendered more hooks than during the previous render").
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (loading) return null
  if (user) return <Navigate to="/" replace />
  if (status.has_users && !status.allow_registration) {
    return <Navigate to="/login" replace />
  }

  const isFirstUser = !status.has_users

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await register(email.trim().toLowerCase(), name.trim(), password)
    } catch (err) {
      setError(err.message || 'Ett fel uppstod vid registrering')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas-light dark:bg-canvas-dark px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <SkaffioLogo size={56} />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              {isFirstUser ? 'Sätt upp Skaffio' : 'Skapa konto'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {isFirstUser ? 'Första kontot blir admin för familjen' : 'Gå med i familjens kök'}
            </p>
          </div>
        </div>

        {isFirstUser && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-2xl
                          bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200
                          text-[12.5px]">
            <Crown size={15} strokeWidth={2.4} className="shrink-0" />
            Detta är systemets allra första konto — du blir automatiskt admin.
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30
                          text-rose-700 dark:text-rose-300 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="surface-card p-6 space-y-4">
          <div>
            <label className="label">Namn</label>
            <div className="relative">
              <UserIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input pl-11"
                placeholder="Mamma / Pappa / Mormor..."
              />
            </div>
          </div>
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
            <label className="label">Lösenord <span className="text-gray-400 text-[11px]">(minst 8 tecken)</span></label>
            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pl-11"
                placeholder="••••••••"
              />
            </div>
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            <UserPlus size={18} strokeWidth={2.4} />
            {busy ? 'Skapar...' : isFirstUser ? 'Skapa admin-konto' : 'Skapa konto'}
          </button>
        </form>

        {status.has_users && (
          <p className="text-center text-sm text-gray-500">
            Har du redan ett konto?{' '}
            <Link to="/login" className="text-primary font-semibold hover:underline">
              Logga in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
