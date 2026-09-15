import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, X } from 'lucide-react'
import {
  getCollection, getCollectionRecipes, getRecipes,
  addRecipeToCollection, removeRecipeFromCollection,
} from '../api'
import { imageUrl } from '../utils/imageUrl'

export default function CollectionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [collection, setCollection] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [allRecipes, setAllRecipes] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [c, r, a] = await Promise.all([
        getCollection(id),
        getCollectionRecipes(id),
        getRecipes(),
      ])
      setCollection(c)
      setRecipes(r)
      setAllRecipes(a)
    } catch (e) {
      toast.error(e.message || 'Kunde inte hämta mappen')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  const handleAdd = async (recipeId) => {
    try {
      await addRecipeToCollection(id, recipeId)
      toast.success('Tillagt i mappen')
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const handleRemove = async (recipeId) => {
    try {
      await removeRecipeFromCollection(id, recipeId)
      toast.success('Borttaget från mappen')
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>
  }
  if (!collection) return <div className="text-center text-gray-400 py-20">Mappen finns inte</div>

  const inMapIds = new Set(recipes.map((r) => r.id))
  const candidates = allRecipes.filter((r) => !inMapIds.has(r.id))

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate('/collections')} className="btn-ghost text-sm">
        <ArrowLeft size={16} /> Alla mappar
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="text-5xl shrink-0">{collection.icon}</div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">{collection.name}</h1>
            {collection.description && (
              <p className="text-sm text-gray-500 mt-1">{collection.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">{recipes.length} recept</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary shrink-0">
          <Plus size={18} />
          Lägg till
        </button>
      </div>

      {showAdd && (
        <div className="surface-card p-4 space-y-2 max-h-80 overflow-y-auto animate-fade-in">
          <h2 className="font-semibold mb-2">Välj recept att lägga till</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-400">Alla dina recept finns redan i denna mapp.</p>
          ) : candidates.map((r) => (
            <button
              key={r.id}
              onClick={() => handleAdd(r.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-2xl
                         hover:bg-gray-50 dark:hover:bg-white/5 text-left"
            >
              {r.cover_image ? (
                <img src={imageUrl(r.cover_image, { thumb: true })} alt="" className="w-10 h-10 rounded-xl object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-700 flex items-center justify-center text-white font-bold">
                  {r.title.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="flex-1 font-medium truncate">{r.title}</span>
              <Plus size={16} className="text-primary" />
            </button>
          ))}
        </div>
      )}

      {recipes.length === 0 ? (
        <div className="surface-card p-10 text-center text-gray-400">
          <p>Inga recept i mappen ännu</p>
          <p className="text-sm mt-1">Klicka "Lägg till" ovan för att börja</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {recipes.map((r) => (
            <div key={r.id} className="surface-card overflow-hidden group">
              <Link to={`/recipes/${r.id}`}>
                {r.cover_image ? (
                  <img src={imageUrl(r.cover_image, { thumb: true })} alt={r.title}
                       className="w-full aspect-[4/3] object-cover" />
                ) : (
                  <div className="w-full aspect-[4/3] bg-gradient-to-br from-primary to-primary-700 flex items-center justify-center">
                    <span className="text-5xl text-white/80">{r.title.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                <div className="p-3">
                  <p className="font-semibold text-sm line-clamp-1">{r.title}</p>
                </div>
              </Link>
              <button
                onClick={() => handleRemove(r.id)}
                className="absolute top-2 right-2 glass w-7 h-7 rounded-full
                           flex items-center justify-center text-rose-500
                           opacity-0 group-hover:opacity-100 transition-opacity"
                title="Ta bort från mappen"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
