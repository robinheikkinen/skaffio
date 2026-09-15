import { useState, useEffect, useMemo, useRef } from 'react'
import Fuse from 'fuse.js'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, CheckSquare, Trash2, X, Sparkles, Dices, Flame } from 'lucide-react'
import { MascotFrasse, MascotSkaffi } from '../components/Mascots'
import { useNavigate } from 'react-router-dom'
import { useRecipes } from '../hooks/useRecipes'
import { useCooking } from '../context/CookingSession'
import { getTags, bulkDeleteRecipes, aiSearchRecipes, getRandomRecipe, getNutritionLog, deleteLogEntry } from '../api'
import RecipeCard from '../components/RecipeCard'
import SearchBar from '../components/SearchBar'

export default function Home() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [allTags, setAllTags] = useState([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [sort, setSort] = useState(() => localStorage.getItem('skaffio.sort') || 'recent')
  const [aiQuery, setAiQuery] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResultIds, setAiResultIds] = useState(null)  // null = AI inte använd, [] = ingen träff
  const [aiSummary, setAiSummary] = useState('')
  const [nutrition, setNutrition] = useState(null)

  useEffect(() => { localStorage.setItem('skaffio.sort', sort) }, [sort])

  const refreshNutrition = () => getNutritionLog().then(setNutrition).catch(() => {})
  useEffect(() => { refreshNutrition() }, [])

  const runAiSearch = async () => {
    if (!aiQuery.trim() || aiBusy) return
    setAiBusy(true)
    try {
      const res = await aiSearchRecipes(aiQuery.trim())
      setAiResultIds(res.ids || [])
      setAiSummary(res.summary || '')
    } catch (e) {
      toast.error(e.message || 'AI-sök misslyckades')
      setAiResultIds(null)
    } finally {
      setAiBusy(false)
    }
  }

  const clearAiSearch = () => {
    setAiQuery('')
    setAiResultIds(null)
    setAiSummary('')
  }

  const rollRandom = async () => {
    try {
      const r = await getRandomRecipe({ pantry_priority: 'true' })
      toast.success(`🎲 ${r.title}`)
      navigate(`/recipes/${r.id}`)
    } catch (e) {
      toast.error(e.message || 'Kunde inte slumpa')
    }
  }

  // search-param skickas INTE till API — Fuse.js hanterar det client-side
  const params = useMemo(() => {
    const p = { sort }
    if (selectedTags.length) p.tags = selectedTags.join(',')
    if (favoritesOnly) p.favorites_only = 'true'
    return p
  }, [selectedTags, favoritesOnly, sort])

  const { recipes: allRecipes, loading } = useRecipes(params)

  // 250ms debounce på sökfältet
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef(null)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  // Bygg Fuse-index med parsade ingrediensnamn för bättre matchning
  const fuse = useMemo(() => {
    if (!allRecipes.length) return null
    const data = allRecipes.map((r) => {
      let ingText = ''
      try { ingText = JSON.parse(r.ingredients || '[]').map((i) => i.name).join(' ') }
      catch {}
      return { ...r, _ing: ingText }
    })
    return new Fuse(data, {
      keys: [
        { name: 'title',       weight: 4 },
        { name: '_ing',        weight: 2 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,       // 0 = exakt, 1 = allt matchar — 0.4 ger bra stavfelstolerans
      ignoreLocation: true, // matcha var som helst i strängen, inte bara från start
      minMatchCharLength: 2,
    })
  }, [allRecipes])

  // AI-sök har företräde; annars Fuse.js om det finns en söksträng
  const recipes = useMemo(() => {
    if (aiResultIds !== null) {
      return aiResultIds.map((id) => allRecipes.find((r) => r.id === id)).filter(Boolean)
    }
    if (debouncedSearch && fuse) {
      return fuse.search(debouncedSearch).map((r) => r.item)
    }
    return allRecipes
  }, [allRecipes, aiResultIds, debouncedSearch, fuse])

  useEffect(() => {
    getTags().then(setAllTags).catch(() => {})
  }, [])

  const toggleTag = (name) =>
    setSelectedTags((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]))

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const cancelSelect = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (!confirm(`Radera ${ids.length} recept permanent?`)) return
    try {
      const res = await bulkDeleteRecipes(ids)
      toast.success(`${res.deleted} recept raderade`)
      cancelSelect()
      window.location.reload()  // snabbaste sätt att refresha listan
    } catch (e) {
      toast.error(e.message || 'Kunde inte radera')
    }
  }

  const { activeRecipe } = useCooking()

return (
    <div className="space-y-5">
  {activeRecipe && (
    <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
      <div>
        <p className="text-sm text-primary font-medium">Fäst recept</p>
        <p className="text-sm font-semibold">{activeRecipe.title}</p>
      </div>
      <Link
        to={`/recipes/${activeRecipe.id}`}
        className="btn-primary"
      >
        Återuppta
      </Link>
    </div>
  )}
      {/* Dagens kalorier */}
      {nutrition && (nutrition.total_calories > 0 || nutrition.entries.length > 0) && (
        <div className="surface rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame size={18} className="text-amber-500" />
              <span className="font-semibold text-sm">Logg</span>
            </div>
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {nutrition.total_calories} <span className="text-sm font-normal text-gray-400">kcal</span>
            </span>
          </div>
          {(nutrition.total_protein > 0 || nutrition.total_carbs > 0 || nutrition.total_fat > 0) && (
            <div className="flex gap-3 text-xs text-gray-500">
              {nutrition.total_protein > 0 && <span>💪 {nutrition.total_protein}g protein</span>}
              {nutrition.total_carbs > 0 && <span>🌾 {nutrition.total_carbs}g kolh.</span>}
              {nutrition.total_fat > 0 && <span>🥑 {nutrition.total_fat}g fett</span>}
            </div>
          )}
          <ul className="space-y-1">
            {nutrition.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
                  {e.recipe_title}
                  {e.servings !== 1 && <span className="text-gray-400 text-xs ml-1">× {e.servings}</span>}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {e.calories && <span className="text-amber-600 dark:text-amber-400 font-medium">{e.calories} kcal</span>}
                  <button
                    onClick={async () => {
                      await deleteLogEntry(e.id).catch(() => {})
                      refreshNutrition()
                    }}
                    className="text-gray-300 hover:text-red-400 transition-colors"
                    title="Ta bort loggpost"
                  >
                    <X size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ fontFamily: "'DM Sans', sans-serif" }}>Mina recept</h1>
        <div className="flex gap-2">
          <button
            onClick={rollRandom}
            className="hidden md:flex items-center gap-2 btn-secondary"
            title="Slumpa recept — prioriterar det du har hemma"
          >
            <Dices size={18} />
            ✨ Vad lagar vi?
          </button>
          <Link to="/add" className="hidden md:flex items-center gap-2 btn-primary">
            <Plus size={18} />
            Nytt recept
          </Link>
        </div>
      </div>

      {/* AI-receptsök — fritext mot AI:n, returnerar rankad lista */}
      <div className="surface rounded-2xl p-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
            <input
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runAiSearch()}
              placeholder='Fråga AI: "Snabbt med kyckling", "Vegetariskt för barn"...'
              className="input pl-10"
            />
          </div>
          <button
            onClick={runAiSearch}
            disabled={aiBusy || !aiQuery.trim()}
            className="btn-primary shrink-0 disabled:opacity-50"
          >
            {aiBusy ? '...' : 'Fråga'}
          </button>
          {aiResultIds !== null && (
            <button onClick={clearAiSearch} className="btn-secondary shrink-0" title="Rensa AI-sök">
              <X size={16} />
            </button>
          )}
        </div>
        {aiSummary && <p className="text-xs text-gray-500 italic px-1">{aiSummary}</p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <SearchBar value={search} onChange={setSearch} />
        </div>
        <button
          type="button"
          onClick={() => setFavoritesOnly((v) => !v)}
          className={`shrink-0 h-11 px-4 rounded-2xl border-2 font-medium text-sm flex items-center gap-2
                      transition-all duration-200
                      ${favoritesOnly
                        ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300'
                        : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-gray-300'}`}
          title="Visa bara favoriter"
        >
          ❤ Favoriter
        </button>
        <button
          type="button"
          onClick={() => setSelectMode((v) => !v)}
          className={`shrink-0 h-11 px-4 rounded-2xl border-2 font-medium text-sm flex items-center gap-2
                      transition-all duration-200
                      ${selectMode
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-gray-300'}`}
          title="Markera flera för bulk-radering"
        >
          <CheckSquare size={16} />
          {selectMode ? `${selectedIds.size} valda` : 'Välj flera'}
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="shrink-0 h-11 px-3 rounded-2xl border-2 border-gray-200 dark:border-white/10
                     bg-transparent text-sm font-medium text-gray-600 dark:text-gray-300
                     hover:border-gray-300 focus:outline-none focus:border-primary"
          title="Sortera"
        >
          <option value="recent">Senast tillagda</option>
          <option value="popular">Mest lagade</option>
          <option value="rating">Högst betyg</option>
          <option value="stale">Längst sen vi lagade</option>
          <option value="title">A–Ö</option>
        </select>
      </div>

      {allTags.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {allTags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.name)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all duration-200 border-0 ${
                selectedTags.includes(tag.name)
                  ? 'text-white'
                  : 'bg-[#F5F0EB] dark:bg-white/5 text-[#6B6560] dark:text-gray-400 hover:bg-[#EDE7DF] dark:hover:bg-white/10'
              }`}
              style={selectedTags.includes(tag.name) ? { backgroundColor: tag.color } : {}}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-2xl bg-gray-200 dark:bg-gray-700 animate-pulse aspect-[4/3]" />
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
          {(search || debouncedSearch || selectedTags.length || favoritesOnly || aiResultIds !== null) ? (
            <>
              <MascotSkaffi size={140} animation="bob" />
              <div>
                <p className="text-lg font-medium text-gray-500 dark:text-gray-400">Hittade inget...</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Prova ett annat filter</p>
              </div>
            </>
          ) : (
            <>
              <MascotFrasse size={140} animation="wob" />
              <div>
                <p className="text-lg font-medium text-gray-500 dark:text-gray-400">Inga recept än</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Gå med i ett hushåll under Säkerhet, eller lägg till ditt första recept!
                </p>
              </div>
              <Link to="/add" className="btn-primary">
                <Plus size={18} className="mr-1.5" />
                Nytt recept
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {recipes.map((recipe, idx) => (
            <div key={recipe.id} className="relative h-full">
              {selectMode && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelected(recipe.id) }}
                  className={`absolute inset-0 z-10 rounded-3xl ring-4 transition-all
                              ${selectedIds.has(recipe.id)
                                ? 'ring-primary bg-primary/20'
                                : 'ring-transparent bg-black/0 hover:bg-black/10'}`}
                >
                  <span className={`absolute top-3 right-3 w-7 h-7 rounded-full border-2 flex items-center justify-center
                                    ${selectedIds.has(recipe.id)
                                      ? 'bg-primary border-primary text-white'
                                      : 'bg-white/80 border-gray-300'}`}>
                    {selectedIds.has(recipe.id) ? '✓' : ''}
                  </span>
                </button>
              )}
              <RecipeCard recipe={recipe} priority={idx < 4} />
            </div>
          ))}
        </div>
      )}

      {/* Mobile FAB */}
      <Link
        to="/add"
        className="md:hidden fixed right-5 bottom-20 z-30 w-14 h-14 bg-primary text-white rounded-full shadow-lg flex items-center justify-center hover:bg-primary-600 transition-colors"
      >
        <Plus size={26} />
      </Link>

      {/* Bulk-action bar */}
      {selectMode && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40
                        bg-surface-light dark:bg-surface-dark shadow-lift
                        rounded-3xl border border-gray-200 dark:border-white/10
                        px-4 py-2.5 flex items-center gap-3">
          <span className="font-semibold text-sm">{selectedIds.size} valda</span>
          <button
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0}
            className="px-3 py-1.5 rounded-2xl bg-rose-500 text-white text-sm font-medium
                       hover:bg-rose-600 active:scale-95 transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center gap-1.5"
          >
            <Trash2 size={14} /> Radera
          </button>
          <button
            onClick={cancelSelect}
            className="px-3 py-1.5 rounded-2xl text-sm text-gray-500 hover:bg-gray-100
                       dark:hover:bg-white/10 flex items-center gap-1.5"
          >
            <X size={14} /> Avbryt
          </button>
        </div>
      )}
    </div>
  )
}
