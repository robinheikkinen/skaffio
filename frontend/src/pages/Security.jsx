import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Shield, ShieldCheck, ShieldOff, Smartphone, Copy, Home, RefreshCw, Users, KeyRound, MessageSquare, BookOpen, Download, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { totpSetup, totpEnable, totpDisable, me as fetchMe, getHousehold, joinHousehold, regenerateInvite, renameHousehold, exportMyData, deleteMyAccount, changeOwnPassword } from '../api'
import OnboardingModal from '../components/OnboardingModal'

function HouseholdPanel({ user }) {
  const [household, setHousehold] = useState(null)
  const [inviteInput, setInviteInput] = useState('')
  const [renameInput, setRenameInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getHousehold().then(setHousehold).catch(() => {})
  }, [])

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(household?.invite_code || '')
      toast.success('Inbjudningskod kopierad!')
    } catch { toast.error('Kunde inte kopiera') }
  }

  const copyTesterInvite = async () => {
    const msg = `Tjena! Jag har byggt en AI-driven recept-app som jag gärna vill att du testar. Den heter Skaffio.\n\nSå här kommer du igång:\n\n1. Gå till https://skaffio.app och logga in — skriv in din e-postadress och få en engångskod via mail\n2. Utforska det publika receptbiblioteket och testa AI-kocken\n\nDu får ett eget privat konto — inga konstigheter. Om du vill testa hushållsfunktionerna och dela med mig så hör av dig så fixar jag en familjekod! 🚀`
    try {
      await navigator.clipboard.writeText(msg)
      toast.success('Testinbjudan kopierad!')
    } catch { toast.error('Kunde inte kopiera') }
  }

  const copyFamilyInvite = async () => {
    const msg = `Hej! Jag har byggt en egen recept-app till oss som heter Skaffio. Nu är den redo! 🚀\n\nSå här gör du:\n\n1. Gå till https://skaffio.app och logga in — skriv in din e-postadress och få en engångskod via mail\n2. Gå till Säkerhet → Gå med i hushåll och ange koden: ${household?.invite_code}\n\nNu är vi ett team! Vi delar digitalt skafferi, planerar veckans mat ihop och ser varandras privata familjerecept. Välkommen till köket! 🍽️❤️`
    try {
      await navigator.clipboard.writeText(msg)
      toast.success('Familjeinbjudan kopierad!')
    } catch { toast.error('Kunde inte kopiera') }
  }

  const handleRegenerate = async () => {
    if (!confirm('Generera ny inbjudningskod? Den gamla slutar fungera.')) return
    setBusy(true)
    try {
      const res = await regenerateInvite()
      setHousehold((h) => ({ ...h, invite_code: res.invite_code }))
      toast.success('Ny kod genererad')
    } catch (e) { toast.error(e.message || 'Misslyckades') }
    finally { setBusy(false) }
  }

  const handleJoin = async () => {
    if (!inviteInput.trim()) return
    setBusy(true)
    try {
      const res = await joinHousehold(inviteInput.trim())
      toast.success(`Gick med i "${res.household_name}"!`)
      setInviteInput('')
      const h = await getHousehold()
      setHousehold(h)
    } catch (e) { toast.error(e.message || 'Ogiltig kod') }
    finally { setBusy(false) }
  }

  const handleRename = async () => {
    if (!renameInput.trim()) return
    setBusy(true)
    try {
      await renameHousehold(renameInput.trim())
      setHousehold((h) => ({ ...h, name: renameInput.trim() }))
      setRenameInput('')
      toast.success('Hushållet omdöpt')
    } catch (e) { toast.error(e.message || 'Misslyckades') }
    finally { setBusy(false) }
  }

  return (
    <div className="surface-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Home size={18} className="text-primary" />
        <p className="font-semibold">
          Hushåll: <span className="text-primary">{household?.name || '…'}</span>
        </p>
      </div>

      {household && (
        <>
          <div>
            <p className="text-xs text-gray-500 mb-1">Inbjudningskod — dela med familjemedlemmar</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 bg-gray-100 dark:bg-white/5 rounded-lg px-3 py-2 text-sm font-mono tracking-widest text-center">
                {household.invite_code}
              </code>
              <button onClick={copyCode} className="btn-secondary p-2" title="Kopiera koden"><Copy size={16} /></button>
              {user?.role === 'admin' && (
                <button onClick={handleRegenerate} disabled={busy} className="btn-secondary p-2" title="Generera ny kod">
                  <RefreshCw size={16} />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <button
                onClick={copyFamilyInvite}
                className="flex items-center gap-2 text-xs text-primary hover:underline"
              >
                <MessageSquare size={13} /> Kopiera familjeinbjudan (med hushållskod)
              </button>
              <button
                onClick={copyTesterInvite}
                className="flex items-center gap-2 text-xs text-gray-500 hover:underline"
              >
                <MessageSquare size={13} /> Kopiera testinbjudan (utan kod)
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Users size={12} /> Medlemmar ({household.members?.length || 0})</p>
            <div className="flex flex-wrap gap-2">
              {(household.members || []).map((m) => (
                <span key={m.id} className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300">
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          {user?.role === 'admin' && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Byt namn på hushållet</p>
              <div className="flex gap-2">
                <input
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  placeholder={household.name}
                  className="input flex-1 text-sm"
                />
                <button onClick={handleRename} disabled={busy || !renameInput.trim()} className="btn-primary px-4 text-sm">
                  Spara
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><KeyRound size={12} /> Gå med i ett annat hushåll</p>
        <div className="flex gap-2">
          <input
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="Inbjudningskod"
            className="input flex-1 text-sm font-mono"
          />
          <button onClick={handleJoin} disabled={busy || !inviteInput.trim()} className="btn-secondary px-4 text-sm">
            Gå med
          </button>
        </div>
      </div>
    </div>
  )
}

function ChangePasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const canSubmit = currentPassword && newPassword.length >= 12 && newPassword === confirmPassword

  const handleSubmit = async () => {
    if (newPassword.length < 12) return toast.error('Nytt lösenord måste vara minst 12 tecken')
    if (newPassword !== confirmPassword) return toast.error('Lösenorden matchar inte')
    setBusy(true)
    try {
      await changeOwnPassword(currentPassword, newPassword)
      toast.success('Lösenord bytt!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      toast.error(e.message || 'Kunde inte byta lösenord')
    } finally { setBusy(false) }
  }

  return (
    <div className="surface-card p-5 space-y-3">
      <p className="font-semibold flex items-center gap-2">
        <KeyRound size={16} className="text-gray-400" />
        Byt lösenord
      </p>
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Nuvarande lösenord"
        autoComplete="current-password"
        className="input w-full text-sm"
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="Nytt lösenord (minst 12 tecken)"
        autoComplete="new-password"
        className="input w-full text-sm"
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
        placeholder="Bekräfta nytt lösenord"
        autoComplete="new-password"
        className="input w-full text-sm"
      />
      <button onClick={handleSubmit} disabled={busy || !canSubmit} className="btn-primary w-full text-sm">
        {busy ? 'Byter...' : 'Byt lösenord'}
      </button>
    </div>
  )
}

export default function Security() {
  const { user } = useAuth()
  const [setupData, setSetupData] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(user?.totp_enabled || false)

  // Refresh user-state from server to get latest totp_enabled
  const refreshStatus = async () => {
    try {
      const u = await fetchMe()
      setEnabled(!!u.totp_enabled)
    } catch {}
  }

  const startSetup = async () => {
    setBusy(true)
    try {
      const data = await totpSetup()
      setSetupData(data)
    } catch (e) {
      toast.error(e.message || 'Kunde inte starta 2FA-setup')
    } finally { setBusy(false) }
  }

  const confirmEnable = async () => {
    if (code.length !== 6) return toast.error('Ange 6-siffrig kod')
    setBusy(true)
    try {
      await totpEnable(code)
      toast.success('2FA aktiverat! 🔐')
      setSetupData(null)
      setCode('')
      setEnabled(true)
      refreshStatus()
    } catch (e) {
      toast.error(e.message || 'Aktivering misslyckades')
    } finally { setBusy(false) }
  }

  const disable = async () => {
    if (code.length !== 6) return toast.error('Bekräfta med din nuvarande 2FA-kod')
    if (!confirm('Stäng av 2FA? Du kommer logga in med bara lösenord igen.')) return
    setBusy(true)
    try {
      await totpDisable(code)
      toast.success('2FA avstängt')
      setCode('')
      setEnabled(false)
      refreshStatus()
    } catch (e) {
      toast.error(e.message || 'Misslyckades')
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {showOnboarding && <OnboardingModal onDone={() => setShowOnboarding(false)} />}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shield size={28} className="text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Säkerhet</h1>
            <p className="text-sm text-gray-500">Hantera din kontosäkerhet</p>
          </div>
        </div>
        <button
          onClick={() => setShowOnboarding(true)}
          className="btn-ghost flex items-center gap-2 text-sm text-gray-500"
          title="Visa app-guiden igen"
        >
          <BookOpen size={16} />
          App-guide
        </button>
      </div>

      <HouseholdPanel user={user} />

      <ChangePasswordPanel />

      <div className="surface-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {enabled
              ? <ShieldCheck size={24} className="text-sage-600" />
              : <ShieldOff size={24} className="text-gray-400" />}
            <div>
              <p className="font-semibold">Tvåfaktorsautentisering (2FA)</p>
              <p className="text-sm text-gray-500">
                {enabled
                  ? 'Aktivt — du måste ange en kod vid varje inloggning'
                  : 'Inte aktivt — bara lösenord skyddar ditt konto'}
              </p>
            </div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
            enabled ? 'bg-sage-100 text-sage-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {enabled ? 'PÅ' : 'AV'}
          </span>
        </div>

        {/* Setup-flöde — visa QR och verifiering */}
        {setupData && (
          <div className="border-t pt-4 space-y-3 animate-fade-in">
            <p className="text-sm font-medium flex items-center gap-2">
              <Smartphone size={16} /> Steg 1: Scanna QR-koden
            </p>
            <p className="text-xs text-gray-500">
              Använd Google Authenticator, Authy, 1Password, Bitwarden eller liknande app.
            </p>
            <div className="flex justify-center bg-white p-4 rounded-xl">
              <img
                src={`data:image/png;base64,${setupData.qr_png_base64}`}
                alt="2FA QR"
                className="w-48 h-48"
              />
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500">Eller mata in koden manuellt</summary>
              <div className="mt-2 flex items-center gap-2 bg-gray-50 dark:bg-white/5 p-2 rounded-lg">
                <code className="flex-1 text-xs font-mono">{setupData.secret}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(setupData.secret)
                    toast.success('Kopierad')
                  }}
                  className="btn-ghost p-1"
                >
                  <Copy size={12} />
                </button>
              </div>
            </details>
            <p className="text-sm font-medium pt-2">Steg 2: Bekräfta med en kod från appen</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="input text-center text-2xl tracking-[0.4em] font-mono"
              placeholder="000000"
            />
            <div className="flex gap-2">
              <button onClick={() => { setSetupData(null); setCode('') }} className="btn-secondary flex-1">Avbryt</button>
              <button onClick={confirmEnable} disabled={busy || code.length !== 6} className="btn-primary flex-1">
                {busy ? 'Aktiverar...' : 'Aktivera 2FA'}
              </button>
            </div>
          </div>
        )}

        {/* Disable-flöde */}
        {enabled && !setupData && (
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm text-gray-500">För att stänga av 2FA — bekräfta med en aktuell kod:</p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="input flex-1 text-center font-mono"
                placeholder="000000"
              />
              <button onClick={disable} disabled={busy || code.length !== 6} className="btn-secondary text-rose-600 border-rose-200">
                <ShieldOff size={14} /> Stäng av
              </button>
            </div>
          </div>
        )}

        {/* Enable-knapp */}
        {!enabled && !setupData && (
          <button onClick={startSetup} disabled={busy} className="btn-primary w-full">
            <Shield size={16} /> Aktivera 2FA
          </button>
        )}
      </div>

      <div className="surface-card p-5 space-y-2">
        <p className="font-semibold flex items-center gap-2">
          <Shield size={16} className="text-gray-400" />
          Övriga säkerhetsfunktioner
        </p>
        <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5 ml-1">
          <li>✓ Lösenord hashas med bcrypt (cost 12)</li>
          <li>✓ JWT-token signerad med servers hemliga nyckel</li>
          <li>✓ Konto-lockout efter 5 felaktiga inloggningsförsök (15 min)</li>
          <li>✓ Rate-limiting på AI-endpoints (skyddar mot abuse)</li>
          <li>✓ Audit-log över alla viktiga händelser</li>
          <li>✓ Discord-notifiering vid säkerhetshändelser (om konfigurerat)</li>
        </ul>
      </div>

      <AccountPanel user={user} />

      <p className="text-center text-xs text-gray-400 pb-2">
        <Link to="/privacy" className="hover:text-primary hover:underline transition-colors">
          Integritetspolicy
        </Link>
      </p>
    </div>
  )
}

function AccountPanel({ user }) {
  const { logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const handleExport = async () => {
    setBusy(true)
    try {
      await exportMyData()
      toast.success('Data exporterad!')
    } catch (e) {
      toast.error(e.message || 'Export misslyckades')
    } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (confirmText !== user?.email) return
    setBusy(true)
    try {
      await deleteMyAccount()
      toast.success('Konto raderat')
      await logout()
    } catch (e) {
      toast.error(e.message || 'Radering misslyckades')
      setBusy(false)
    }
  }

  return (
    <div className="surface-card p-5 space-y-4">
      <p className="font-semibold flex items-center gap-2 text-gray-700 dark:text-gray-200">
        <KeyRound size={16} className="text-gray-400" />
        Mitt konto
      </p>

      <button
        onClick={handleExport}
        disabled={busy}
        className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
      >
        <Download size={15} />
        Ladda ner mina uppgifter (GDPR-export)
      </button>

      {!showDelete ? (
        <button
          onClick={() => setShowDelete(true)}
          className="btn-ghost w-full flex items-center justify-center gap-2 text-sm text-rose-500 hover:text-rose-600"
        >
          <Trash2 size={15} />
          Radera konto permanent
        </button>
      ) : (
        <div className="border border-rose-200 dark:border-rose-800 rounded-xl p-4 space-y-3 animate-fade-in">
          <p className="text-sm font-semibold text-rose-600">Radera konto permanent</p>
          <p className="text-xs text-gray-500">
            Detta raderar ditt konto och all din data. Är du sista personen i hushållet raderas även alla recept, pantry och listor.
            Åtgärden kan <strong>inte ångras</strong>.
          </p>
          <p className="text-xs text-gray-500">Bekräfta med din e-postadress:</p>
          <input
            type="email"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={user?.email}
            className="input text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setShowDelete(false); setConfirmText('') }}
              className="btn-secondary flex-1 text-sm"
            >
              Avbryt
            </button>
            <button
              onClick={handleDelete}
              disabled={busy || confirmText !== user?.email}
              className="flex-1 text-sm px-4 py-2 rounded-xl font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? 'Raderar...' : 'Radera permanent'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
