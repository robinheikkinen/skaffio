import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FolderPlus, Folder, Trash2, X, Pencil } from 'lucide-react'
import {
  listCollections, createCollection, deleteCollection, updateCollection,
} from '../api'

const EMOJI_OPTIONS = ['📁', '🍝', '🍰', '🥗', '🌮', '🍕', '🥘', '🍣', '🥩', '🐟', '🌱', '☕', '👶', '🎉', '⭐']

export default function Collections() {
  const [collections, setCollections] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newColl, setNewColl] = useState({ name: '', description: '', icon: '📁' })

  const load = async () => {
    setLoading(true)
    try {
      setCollections(await listCollections())
    } catch (e) {
      toast.error(e.message || 'Kunde inte hämta mappar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newColl.name.trim()) return toast.error('Namn krävs')
    try {
      await createCollection(newColl)
      toast.success(`Mappen "${newColl.name}" skapad`)
      setNewColl({ name: '', description: '', icon: '📁' })
      setShowCreate(false)
      load()
    } catch (e) {
      toast.error(e.message || 'Kunde inte skapa')
    }
  }

  const handleDelete = async (c) => {
    if (!confirm(`Radera mappen "${c.name}"? Recepten i mappen påverkas inte.`)) return
    try {
      await deleteCollection(c.id)
      toast.success(`"${c.name}" raderad`)
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mappar</h1>
          <p className="text-sm text-gray-500 mt-1">Organisera dina recept i samlingar</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          <FolderPlus size={18} strokeWidth={2.4} />
          Ny mapp
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="surface-card p-5 space-y-4 animate-fade-in">
          <h2 className="font-semibold">Skapa ny mapp</h2>
          <div>
            <label className="label">Namn</label>
            <input
              value={newColl.name}
              onChange={(e) => setNewColl({ ...newColl, name: e.target.value })}
              placeholder="t.ex. Italienskt, Snabba vardagar..."
              className="input"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Beskrivning (valfritt)</label>
            <input
              value={newColl.description}
              onChange={(e) => setNewColl({ ...newColl, description: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="label">Ikon</label>
            <div className="flex flex-wrap gap-2">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setNewColl({ ...newColl, icon: emoji })}
                  className={`w-11 h-11 rounded-2xl text-xl border-2 transition-all
                              ${newColl.icon === emoji
                                ? 'border-primary bg-primary/10 scale-105'
                                : 'border-gray-200 dark:border-white/10 hover:border-gray-300'}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary flex-1">
              Avbryt
            </button>
            <button type="submit" className="btn-primary flex-1">Skapa mapp</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-gray-100 dark:bg-white/5 rounded-3xl animate-pulse" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <Folder size={48} className="mx-auto text-gray-300 mb-3" />
          <h3 className="font-semibold text-gray-500">Inga mappar än</h3>
          <p className="text-sm text-gray-400 mt-1">Skapa en mapp för att gruppera dina recept</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {collections.map((c) => (
            <div key={c.id} className="surface-card p-5 hover:shadow-lift transition-all group">
              <Link to={`/collections/${c.id}`} className="block">
                <div className="flex items-start gap-3">
                  <div className="text-4xl">{c.icon}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold tracking-tight truncate">{c.name}</h3>
                    {c.description && (
                      <p className="text-sm text-gray-500 line-clamp-2 mt-1">{c.description}</p>
                    )}
                  </div>
                </div>
              </Link>
              <div className="mt-3 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => handleDelete(c)}
                  className="btn-ghost p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
