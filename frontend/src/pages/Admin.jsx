import { useState, useEffect, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Crown, UserPlus, Trash2, Shield, ShieldOff, KeyRound, Power, Download, Mail, X, Check } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  listUsers, createUser, updateUser, deleteUser as apiDeleteUser, exportAllRecipesJson,
  listInvites, createInvite, revokeInvite,
} from '../api'

export default function Admin() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', password: '', role: 'member' })
  const [creating, setCreating] = useState(false)
  // Invites
  const [invites, setInvites] = useState([])
  const [newInvite, setNewInvite] = useState({ email: '', role: 'member', note: '' })
  const [showInvite, setShowInvite] = useState(false)
  const [invBusy, setInvBusy] = useState(false)
  // Reset password modal
  const [resetTarget, setResetTarget] = useState(null)
  const [resetPw, setResetPw] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const resetInputRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const [u, inv] = await Promise.all([
        listUsers(),
        listInvites().catch(() => []),
      ])
      setUsers(u)
      setInvites(inv)
    } catch (e) {
      toast.error(e.message || 'Kunde inte hämta användare')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (!user) return null
  if (user.role !== 'admin') return <Navigate to="/" replace />

  const handleInvite = async (e) => {
    e.preventDefault()
    if (!newInvite.email.includes('@')) return toast.error('Ogiltig email')
    setInvBusy(true)
    try {
      await createInvite(newInvite)
      toast.success(`Invite skapad för ${newInvite.email}. Glöm inte CF Access allow-list!`)
      setNewInvite({ email: '', role: 'member', note: '' })
      setShowInvite(false)
      load()
    } catch (e) {
      toast.error(e.message || 'Misslyckades')
    } finally { setInvBusy(false) }
  }

  const handleRevokeInvite = async (inv) => {
    if (!confirm(`Återkalla invite för ${inv.email}?`)) return
    try {
      await revokeInvite(inv.id)
      toast.success('Återkallad')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (newUser.password.length < 12) return toast.error('Lösenord måste vara minst 12 tecken')
    setCreating(true)
    try {
      await createUser(newUser)
      toast.success(`${newUser.name} skapad`)
      setNewUser({ email: '', name: '', password: '', role: 'member' })
      setShowCreate(false)
      load()
    } catch (e) {
      toast.error(e.message || 'Kunde inte skapa användare')
    } finally {
      setCreating(false)
    }
  }

  const toggleRole = async (u) => {
    const newRole = u.role === 'admin' ? 'member' : 'admin'
    try {
      await updateUser(u.id, { role: newRole })
      toast.success(`${u.name} → ${newRole}`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  const toggleActive = async (u) => {
    try {
      await updateUser(u.id, { is_active: !u.is_active })
      toast.success(u.is_active ? `${u.name} inaktiverad` : `${u.name} aktiverad`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  const openResetModal = (u) => {
    setResetTarget(u)
    setResetPw('')
    const t = setTimeout(() => resetInputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }

  const closeResetModal = () => {
    setResetTarget(null)
    setResetPw('')
  }

  const submitResetPassword = async (e) => {
    e.preventDefault()
    if (resetPw.length < 12) return toast.error('Minst 12 tecken')
    setResetBusy(true)
    try {
      await updateUser(resetTarget.id, { password: resetPw })
      toast.success(`Lösenord ändrat för ${resetTarget.name}`)
      closeResetModal()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setResetBusy(false)
    }
  }

  const handleDelete = async (u) => {
    if (u.id === user.id) return toast.error('Du kan inte radera dig själv')
    if (!confirm(`Radera ${u.name} (${u.email}) permanent?`)) return
    try {
      await apiDeleteUser(u.id)
      toast.success(`${u.name} raderad`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Crown size={24} className="text-amber-500" />
            Admin
          </h1>
          <p className="text-sm text-gray-500 mt-1">Användarhantering · {users.length} konton</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={async () => {
              try { await exportAllRecipesJson(); toast.success('Export nedladdad') }
              catch (e) { toast.error(e.message) }
            }}
            className="btn-secondary"
            title="Exportera alla recept som JSON (migrationsförsäkring)"
          >
            <Download size={18} />
            Exportera JSON
          </button>
          <button onClick={() => setShowInvite(!showInvite)} className="btn-secondary">
            <Mail size={18} />
            Bjud in
          </button>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
            <UserPlus size={18} />
            Ny användare
          </button>
        </div>
      </div>

      {/* Invite-formulär */}
      {showInvite && (
        <form onSubmit={handleInvite} className="surface-card p-5 space-y-3 animate-fade-in">
          <h2 className="font-semibold flex items-center gap-2">
            <Mail size={16} className="text-primary" /> Bjud in via Google SSO
          </h2>
          <p className="text-xs text-gray-500">
            Skapa en invite — när personen loggar in på skaffio.app
            auto-skapas kontot. Glöm inte att lägga till email i Cloudflare Access allow-list också!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="email"
              placeholder="email@gmail.com"
              value={newInvite.email}
              onChange={(e) => setNewInvite({ ...newInvite, email: e.target.value })}
              className="input sm:col-span-2"
              required
            />
            <select
              value={newInvite.role}
              onChange={(e) => setNewInvite({ ...newInvite, role: e.target.value })}
              className="input"
            >
              <option value="member">Medlem</option>
              <option value="admin">Admin</option>
            </select>
            <input
              type="text"
              placeholder='Note (ex. "Sambo", "Mormor")'
              value={newInvite.note}
              onChange={(e) => setNewInvite({ ...newInvite, note: e.target.value })}
              className="input sm:col-span-3"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowInvite(false)} className="btn-secondary flex-1">Avbryt</button>
            <button type="submit" disabled={invBusy} className="btn-primary flex-1">
              <Mail size={14} /> {invBusy ? 'Skapar...' : 'Skapa invite'}
            </button>
          </div>
        </form>
      )}

      {/* Aktiva invites */}
      {invites.length > 0 && (
        <div className="surface-card p-4 space-y-2">
          <p className="font-semibold text-sm flex items-center gap-2">
            <Mail size={14} /> Inbjudningar ({invites.filter((i) => !i.used).length} väntar)
          </p>
          <div className="space-y-1">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-white/5 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{inv.email}</p>
                  <p className="text-[11px] text-gray-500">
                    {inv.role} · {inv.note || '—'} · {inv.used ? '✓ använd' : 'väntar'}
                  </p>
                </div>
                {!inv.used && (
                  <button
                    onClick={() => handleRevokeInvite(inv)}
                    className="btn-ghost p-2 text-rose-500"
                    title="Återkalla"
                  >
                    <X size={14} />
                  </button>
                )}
                {inv.used && <Check size={14} className="text-sage-600 mr-2" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="surface-card p-5 space-y-4 animate-fade-in">
          <h2 className="font-semibold">Skapa nytt konto</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Namn</label>
              <input
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">E-post</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="input"
                required
              />
            </div>
            <div>
              <label className="label">Lösenord</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="input"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="label">Roll</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="input"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary flex-1">
              Avbryt
            </button>
            <button type="submit" disabled={creating} className="btn-primary flex-1">
              {creating ? 'Skapar...' : 'Skapa konto'}
            </button>
          </div>
        </form>
      )}

      <div className="surface-card divide-y divide-gray-100 dark:divide-white/5">
        {loading ? (
          <div className="p-6 text-center text-gray-400">Laddar...</div>
        ) : users.length === 0 ? (
          <div className="p-6 text-center text-gray-400">Inga användare</div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm
                              ${u.role === 'admin'
                                ? 'bg-gradient-to-br from-amber-400 to-amber-600'
                                : 'bg-gradient-to-br from-sage-500 to-sage-700'}`}>
                {u.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{u.name}</span>
                  {u.role === 'admin' && (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full">
                      Admin
                    </span>
                  )}
                  {!u.is_active && (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500 bg-gray-100 dark:bg-white/10 px-2 py-0.5 rounded-full">
                      Inaktiv
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{u.email}</p>
                {u.last_login_at && (
                  <p className="text-[10px] text-gray-400">
                    Senast inloggad: {new Date(u.last_login_at).toLocaleString('sv-SE')}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => toggleRole(u)}
                  className="btn-ghost p-2"
                  title={u.role === 'admin' ? 'Gör till member' : 'Gör till admin'}
                >
                  {u.role === 'admin' ? <ShieldOff size={16} /> : <Shield size={16} />}
                </button>
                <button
                  onClick={() => toggleActive(u)}
                  className="btn-ghost p-2"
                  title={u.is_active ? 'Inaktivera' : 'Aktivera'}
                >
                  <Power size={16} className={u.is_active ? 'text-sage-600' : 'text-gray-400'} />
                </button>
                <button onClick={() => openResetModal(u)} className="btn-ghost p-2" title="Återställ lösenord">
                  <KeyRound size={16} />
                </button>
                {u.id !== user.id && (
                  <button
                    onClick={() => handleDelete(u)}
                    className="btn-ghost p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Radera"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {/* Reset password modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeResetModal}>
          <form
            onSubmit={submitResetPassword}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <KeyRound size={18} className="text-primary" />
                Återställ lösenord
              </h2>
              <button type="button" onClick={closeResetModal} className="btn-ghost p-1">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-500">Nytt lösenord för <strong>{resetTarget.name}</strong></p>
            <input
              ref={resetInputRef}
              type="password"
              placeholder="Minst 12 tecken"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              className="input w-full"
              minLength={12}
              required
            />
            <div className="flex gap-2">
              <button type="button" onClick={closeResetModal} className="btn-secondary flex-1">Avbryt</button>
              <button type="submit" disabled={resetBusy || resetPw.length < 12} className="btn-primary flex-1">
                {resetBusy ? 'Sparar...' : 'Spara'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
