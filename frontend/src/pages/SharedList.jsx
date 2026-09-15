import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ShoppingBag, RefreshCw } from 'lucide-react'
import { getSharedList, toggleSharedItem } from '../api'
import GroupedShoppingList from '../components/GroupedShoppingList'

/**
 * Public, no-auth shopping list view — partner opens the link on their phone
 * and can tick items off as they shop. Token in the URL is the only auth.
 */
export default function SharedList() {
  const { token } = useParams()
  const [list, setList] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getSharedList(token)
      setList(data)
      try { setItems(JSON.parse(data.items || '[]')) } catch { setItems([]) }
    } catch (e) {
      setError(e.message || 'Listan kunde inte laddas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [token])

  // Light polling so two people shopping together stay in sync without WebSocket plumbing.
  useEffect(() => {
    const iv = setInterval(load, 8000)
    return () => clearInterval(iv)
  }, [token])

  const toggle = async (index) => {
    const next = items.map((it, i) => i === index ? { ...it, checked: !it.checked } : it)
    setItems(next)
    try {
      await toggleSharedItem(token, index, next[index].checked)
    } catch {
      toast.error('Kunde inte synka — försök igen')
      setItems(items)
    }
  }

  if (loading && !list) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas-light dark:bg-canvas-dark">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas-light dark:bg-canvas-dark p-6 text-center">
        <ShoppingBag size={48} className="text-gray-300" />
        <h1 className="text-xl font-semibold">Listan hittades inte</h1>
        <p className="text-sm text-gray-500">Länken kan ha återkallats eller skrivits fel.</p>
      </div>
    )
  }

  const remaining = items.filter((i) => !i.checked).length

  return (
    <div className="min-h-screen bg-canvas-light dark:bg-canvas-dark">
      <header className="glass sticky top-0 z-20 border-b border-gray-200/60 dark:border-white/10">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary-700
                          flex items-center justify-center shadow-sm">
            <ShoppingBag size={20} className="text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg leading-tight truncate">{list.name}</h1>
            <p className="text-[11px] text-gray-500">
              {remaining} av {items.length} kvar · Delad via Skaffio
            </p>
          </div>
          <button
            onClick={load}
            className="w-10 h-10 rounded-2xl flex items-center justify-center
                       hover:bg-white/40 dark:hover:bg-white/5 transition-colors"
            title="Uppdatera"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {items.length === 0 ? (
          <p className="text-center text-gray-400 mt-12">Listan är tom 🎉</p>
        ) : (
          <GroupedShoppingList items={items} onToggle={toggle} />
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 glass border-t border-gray-200/60 dark:border-white/10
                         pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-5 py-3 text-center text-[11px] text-gray-500">
          🛒 Bockar uppdateras automatiskt på avsändarens sida
        </div>
      </footer>
    </div>
  )
}
