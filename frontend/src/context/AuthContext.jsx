import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  authStatus, login as apiLogin, register as apiRegister, me as apiMe,
  cfLogin as apiCfLogin, logout as apiLogout,
} from '../api'

/**
 * Familjekontot — JWT i HttpOnly-cookie (hanteras av backend).
 * Frontend lagrar INTE token — ingen XSS-stöld möjlig.
 *
 * Flow:
 *   1. Vid mount: anropa /me direkt (cookie skickas automatiskt av browser).
 *      Om OK → rehydrera user-state. Om 401 → försök CF Access auto-login.
 *   2. login()/register() → cookie sätts av backend i Set-Cookie-header.
 *   3. logout() → backend rensar cookie, React-state töms.
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState({ has_users: true, allow_registration: false })
  const [loading, setLoading] = useState(true)

  // Initial bootstrap — kolla om giltig cookie finns
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await authStatus()
        if (!cancelled) setStatus(s)
      } catch {}

      // Försök rehydrera från cookie (skickas automatiskt)
      try {
        const u = await apiMe()
        if (!cancelled) setUser(u)
      } catch {
        // Ingen giltig cookie — försök CF Access auto-login
        try {
          const data = await apiCfLogin()
          if (!cancelled && data?.user) {
            setUser(data.user)
          }
        } catch { /* ingen CF-identitet — visa login-form */ }
      }

      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // React på 401 från valfritt API-anrop
  useEffect(() => {
    const handler = () => {
      if (user) toast.error('Sessionen har gått ut — logga in igen')
      setUser(null)
    }
    window.addEventListener('skaffio:auth-failed', handler)
    return () => window.removeEventListener('skaffio:auth-failed', handler)
  }, [user])

  const login = useCallback(async (email, password, totp_code) => {
    try {
      const data = await apiLogin({ email, password, totp_code })
      // Backend sätter HttpOnly-cookie i Set-Cookie — vi lagrar bara user-info i React-state
      try { sessionStorage.setItem('skaffio.lastLogin', String(Date.now())) } catch {}
      try { sessionStorage.removeItem('skaffio.errorReloaded') } catch {}
      setUser({
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        role: data.user.role,
        is_active: data.user.is_active,
        created_at: data.user.created_at,
        last_login_at: data.user.last_login_at,
      })
      authStatus().then(setStatus).catch(() => {})
      return data.user
    } catch (error) {
      console.error('Login failed:', error)
      throw new Error(error.message || 'Login failed')
    }
  }, [])

  const register = useCallback(async (email, name, password) => {
    try {
      const data = await apiRegister({ email, name, password })
      setUser({
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        role: data.user.role,
        is_active: data.user.is_active,
        created_at: data.user.created_at,
        last_login_at: data.user.last_login_at,
      })
      const fresh = await authStatus().catch(() => null)
      if (fresh) setStatus(fresh)
      return data.user
    } catch (error) {
      console.error('Registration failed:', error)
      throw new Error(error.message || 'Registration failed')
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiLogout()  // Backend rensar HttpOnly-cookie
    } catch { /* ignorera fel — logga ut lokalt ändå */ }
    // Rensa offline-cachen — hushållsdata ska inte ligga kvar i browsern efter utloggning
    try {
      await caches.delete('api-cache')
      await caches.delete('uploads-cache')
    } catch { /* caches-API saknas (osäker kontext) — inget att rensa */ }
    setUser(null)
    toast.success('Du är utloggad')
  }, [])

  return (
    <AuthContext.Provider value={{ user, status, loading, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}
