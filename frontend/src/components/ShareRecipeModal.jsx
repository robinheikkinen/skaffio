import { useState, useEffect } from 'react'
import { X, Copy, Trash2, QrCode } from 'lucide-react'
import toast from 'react-hot-toast'
import QRCode from 'qrcode'
import { createRecipeShare, revokeRecipeShare } from '../api'

export default function ShareRecipeModal({ open, onClose, recipe }) {
  const [token, setToken] = useState(recipe?.share_token || null)
  const [busy, setBusy] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    setToken(recipe?.share_token || null)
  }, [recipe])

  const fullUrl = token ? `${window.location.origin}/shared/recipe/${token}` : ''

  useEffect(() => {
    if (!fullUrl) { setQrDataUrl(''); return }
    QRCode.toDataURL(fullUrl, { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [fullUrl])

  if (!open || !recipe) return null

  const handleCreate = async () => {
    setBusy(true)
    try {
      const res = await createRecipeShare(recipe.id)
      setToken(res.token)
      toast.success('Delningslänk skapad')
    } catch (e) {
      toast.error(e.message || 'Misslyckades')
    } finally { setBusy(false) }
  }

  const handleRevoke = async () => {
    if (!confirm('Återkalla delningslänken? Befintliga länkar slutar fungera.')) return
    setBusy(true)
    try {
      await revokeRecipeShare(recipe.id)
      setToken(null)
      toast.success('Länk återkallad')
    } catch (e) {
      toast.error(e.message || 'Misslyckades')
    } finally { setBusy(false) }
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      toast.success('Länk kopierad! 📋')
    } catch {
      toast.error('Kunde inte kopiera')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="surface-card max-w-md w-full p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">Dela recept</h2>
          <button onClick={onClose} className="btn-ghost w-10 h-10 p-0"><X size={20} /></button>
        </div>

        <p className="text-sm text-gray-500">
          Skapa en publik länk för <span className="font-semibold text-gray-700 dark:text-gray-200">{recipe.title}</span>.
          Vem som helst med länken kan se receptet — ingen inloggning krävs.
        </p>

        {!token ? (
          <button onClick={handleCreate} disabled={busy} className="btn-primary w-full">
            {busy ? 'Skapar...' : 'Skapa delningslänk'}
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-2">
              <code className="flex-1 text-xs truncate text-gray-600 dark:text-gray-300">{fullUrl}</code>
              <button onClick={copyUrl} className="btn-primary p-2" title="Kopiera">
                <Copy size={16} />
              </button>
            </div>

            {qrDataUrl && (
              <div className="flex flex-col items-center gap-2 py-2">
                <img src={qrDataUrl} alt="QR-kod" className="rounded-lg border border-gray-200 dark:border-white/10" />
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <QrCode size={11} /> Skanna med mobilen
                </p>
              </div>
            )}

            <button
              onClick={handleRevoke}
              disabled={busy}
              className="w-full text-sm text-red-500 hover:text-red-600 flex items-center justify-center gap-2 py-2"
            >
              <Trash2 size={14} /> Återkalla länken
            </button>
          </>
        )}
      </div>
    </div>
  )
}
