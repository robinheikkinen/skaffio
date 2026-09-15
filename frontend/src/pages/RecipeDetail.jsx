import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Edit2, Trash2, Clock, Users, ExternalLink, ShoppingCart, Calendar, Minus, Plus, Snowflake, Pin, PinOff, Flame, Share2, FileDown, StickyNote, Save, Activity, PackageSearch, X, Check, GitFork, Globe, Lock, ArrowLeftRight, Loader2, AlertTriangle, ShoppingBag, BookOpen, Sparkles } from 'lucide-react'
import { getRecipe, deleteRecipe, exportRecipePdf, updateRecipe, calculateMacros, getMissingIngredients, generateShoppingList, createShoppingList, forkRecipe, markRecipeCooked, substituteIngredient, logMeal, rewriteRecipe } from '../api'
import TagBadge from '../components/TagBadge'
import ImageGallery from '../components/ImageGallery'
import BatchFreezeModal from '../components/BatchFreezeModal'
import ShareRecipeModal from '../components/ShareRecipeModal'
import InstructionRenderer from '../components/InstructionRenderer'
import { useCooking } from '../context/CookingSession'
import { useWakeLock } from '../hooks/useWakeLock'
import { imageUrl } from '../utils/imageUrl'

export default function RecipeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [servings, setServings] = useState(4)
  const [checkedIngredients, setCheckedIngredients] = useState(new Set())
  const [freezerOpen, setFreezerOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [missingModal, setMissingModal] = useState(null)
  const [missingLoading, setMissingLoading] = useState(false)
  const [notesEditing, setNotesEditing] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [cookedResult, setCookedResult] = useState(null)
  const [subState, setSubState] = useState({}) // { [idx]: { loading, result } }
  const [logLoading, setLogLoading] = useState(false)
  const { activeRecipe, pin, unpin } = useCooking()

  const handleSubstitute = async (ing, idx) => {
    // toggle off if already shown
    if (subState[idx]?.result) {
      setSubState((prev) => { const n = { ...prev }; delete n[idx]; return n })
      return
    }
    setSubState((prev) => ({ ...prev, [idx]: { loading: true, result: null } }))
    try {
      const res = await substituteIngredient(Number(id), {
        ingredient: ing.name,
        amount: ing.scaledAmount || ing.amount || null,
        unit: ing.unit || null,
      })
      setSubState((prev) => ({ ...prev, [idx]: { loading: false, result: res } }))
    } catch (e) {
      setSubState((prev) => ({ ...prev, [idx]: { loading: false, result: { error: e.message } } }))
    }
  }
  const isPinned = activeRecipe?.id === Number(id)
  useWakeLock(isPinned)

  const handleMarkCooked = async () => {
    try {
      const res = await markRecipeCooked(recipe.id, { servings, deduct_pantry: true })
      setRecipe((r) => ({ ...r, times_cooked: res.times_cooked, last_cooked_at: res.last_cooked_at }))
      setCookedResult(res)
    } catch (e) { toast.error(e.message) }
  }

  useEffect(() => {
    getRecipe(id)
      .then((data) => {
        setRecipe(data)
        setServings(data.servings)
      })
      .catch(() => toast.error('Kunde inte hämta recept'))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!confirm('Radera receptet?')) return
    try {
      await deleteRecipe(id)
      toast.success('Recept raderat')
      navigate('/')
    } catch {
      toast.error('Kunde inte radera')
    }
  }

  const toggleIngredient = (i) =>
    setCheckedIngredients((prev) => {
      const s = new Set(prev)
      s.has(i) ? s.delete(i) : s.add(i)
      return s
    })

  const handleMissingIngredients = async () => {
    setMissingLoading(true)
    try {
      const result = await getMissingIngredients(Number(id), servings)
      setMissingModal(result)
    } catch (e) {
      toast.error(e.message || 'Kunde inte jämföra mot pantry')
    } finally {
      setMissingLoading(false)
    }
  }

  const handleAddMissingToList = async () => {
    if (!missingModal?.missing?.length) return
    const t = toast.loading('Skapar inköpslista...')
    try {
      const name = `${missingModal.recipe_title} — saknade`
      await createShoppingList({ name, items: JSON.stringify(missingModal.missing) })
      toast.success(`${missingModal.missing.length} varor tillagda i ny lista!`, { id: t })
      setMissingModal(null)
      navigate('/shopping')
    } catch (e) {
      toast.error(e.message || 'Kunde inte spara listan', { id: t })
    }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>
  if (!recipe) return <div className="text-center py-20 text-gray-500">Recept hittades inte</div>

  let ingredients = []
  try { ingredients = JSON.parse(recipe.ingredients || '[]') } catch {}

  const scaledIngredients = ingredients.map((ing) => {
    const factor = servings / (recipe.servings || 1)
    const amount = parseFloat(ing.amount)
    return {
      ...ing,
      scaledAmount: isNaN(amount) ? ing.amount : (Math.round(amount * factor * 10) / 10).toString(),
    }
  })

  const totalTime = (recipe.prep_time || 0) + (recipe.cook_time || 0)

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero image */}
      {recipe.cover_image && (
        <div className="relative h-64 md:h-80 rounded-3xl overflow-hidden mb-6">
          <img
            src={imageUrl(recipe.cover_image)}
            alt={recipe.title}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{recipe.title}</h1>
            {recipe.description && <p className="text-gray-500 dark:text-gray-400 mt-2">{recipe.description}</p>}
            <div className="flex items-center gap-1.5 mt-1.5">
              {recipe.visibility === 'public' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  <Globe size={11} /> Publik
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  <Lock size={11} /> Privat
                </span>
              )}
              {recipe.source_type === 'rewrite' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400">
                  <Sparkles size={11} /> Egen version
                </span>
              )}
              {recipe.source_type === 'fork' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400">
                  <GitFork size={11} /> Kopierad
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => isPinned ? unpin() : pin(recipe, servings)}
              className={`btn-secondary p-2 ${isPinned ? 'bg-primary/10 text-primary' : ''}`}
              title={isPinned ? 'Avfäst recept' : 'Fäst recept (visa längst ner när du går till andra sidor)'}
            >
              {isPinned ? <PinOff size={18} /> : <Pin size={18} />}
            </button>
            {recipe.can_edit && (
              <button
                onClick={() => setShareOpen(true)}
                className="btn-secondary p-2"
                title="Dela recept (publik länk + QR-kod)"
              >
                <Share2 size={18} />
              </button>
            )}
            {recipe.can_edit ? (
              <>
                <Link to={`/recipes/${id}/edit`} className="btn-secondary p-2">
                  <Edit2 size={18} />
                </Link>
                <button onClick={handleDelete} className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Trash2 size={18} />
                </button>
              </>
            ) : (
              <button
                onClick={async () => {
                  const t = toast.loading('Kopierar recept...')
                  try {
                    const res = await forkRecipe(recipe.id)
                    toast.success('Receptet kopierat till ditt hushåll!', { id: t })
                    navigate(`/recipes/${res.id}`)
                  } catch (e) { toast.error(e.message || 'Kunde inte kopiera', { id: t }) }
                }}
                className="btn-secondary p-2 flex items-center gap-1.5"
                title="Kopiera till ditt hushåll"
              >
                <GitFork size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(recipe.tags || []).map((tag) => <TagBadge key={tag.id} tag={tag} />)}
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
          {recipe.prep_time && <span className="flex items-center gap-1.5"><Clock size={15} /> Förb: {recipe.prep_time} min</span>}
          {recipe.cook_time && <span className="flex items-center gap-1.5"><Clock size={15} /> Tillagning: {recipe.cook_time} min</span>}
          {totalTime > 0 && <span className="font-medium text-gray-700 dark:text-gray-300">Totalt: {totalTime} min</span>}
        </div>

        {/* Näringsvärden per portion */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {(recipe.calories || recipe.protein || recipe.carbs || recipe.fat) ? (
            <>
              {recipe.calories != null && <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 font-medium text-xs">🔥 {recipe.calories} kcal</span>}
              {recipe.protein != null && <span className="px-2.5 py-1 rounded-lg bg-sage-50 dark:bg-sage-950/30 text-sage-800 dark:text-sage-300 font-medium text-xs">💪 {recipe.protein}g protein</span>}
              {recipe.carbs != null && <span className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 font-medium text-xs">🌾 {recipe.carbs}g kolh.</span>}
              {recipe.fat != null && <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 font-medium text-xs">🥑 {recipe.fat}g fett</span>}
              <span className="text-xs text-gray-400">per portion</span>
              <button
                onClick={async () => {
                  const t = toast.loading('AI räknar om...')
                  try {
                    const m = await calculateMacros(recipe.id)
                    setRecipe({ ...recipe, ...m })
                    toast.success('Näringsvärden uppdaterade', { id: t })
                  } catch (e) { toast.error(e.message, { id: t }) }
                }}
                className="text-xs text-gray-400 hover:text-primary underline"
              >
                räkna om
              </button>
            </>
          ) : (
            <button
              onClick={async () => {
                const t = toast.loading('AI beräknar näringsvärden...')
                try {
                  const m = await calculateMacros(recipe.id)
                  setRecipe({ ...recipe, ...m })
                  toast.success('Näringsvärden beräknade', { id: t })
                } catch (e) { toast.error(e.message, { id: t }) }
              }}
              className="text-xs text-gray-500 hover:text-primary flex items-center gap-1 underline"
            >
              <Activity size={12} /> Beräkna näringsvärden via AI
            </button>
          )}
        </div>

        {/* Portioner stepper */}
        <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 rounded-xl p-4 w-fit">
          <Users size={18} className="text-gray-500" />
          <button
            onClick={() => setServings((s) => Math.max(1, s - 1))}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <Minus size={16} />
          </button>
          <span className="w-10 text-center font-semibold">{servings}</span>
          <button
            onClick={() => setServings((s) => s + 1)}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <Plus size={16} />
          </button>
          <span className="text-sm text-gray-500">portioner</span>
        </div>

        {/* Ingredienser */}
        {scaledIngredients.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Ingredienser</h2>
            <ul className="space-y-1">
              {scaledIngredients.map((ing, i) => {
                const sub = subState[i]
                const isActive = sub?.result || sub?.loading
                return (
                  <li key={i} className="rounded-lg overflow-hidden">
                    {/* Ingredient row */}
                    <div
                      onClick={() => toggleIngredient(i)}
                      className={`flex items-center gap-3 p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group ${
                        checkedIngredients.has(i) ? 'opacity-50 line-through' : ''
                      } ${isActive ? 'bg-gray-50 dark:bg-gray-800' : ''}`}
                    >
                      <span className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                        checkedIngredients.has(i) ? 'bg-primary border-primary' : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {checkedIngredients.has(i) && <span className="text-white text-xs">✓</span>}
                      </span>
                      <span className="text-gray-500 w-16 text-right text-sm shrink-0">
                        {ing.scaledAmount} {ing.unit}
                      </span>
                      <span className="flex-1">{ing.name}</span>
                      {/* Substitute trigger */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSubstitute(ing, i) }}
                        className={`shrink-0 p-1.5 rounded-md transition-colors ${
                          isActive
                            ? 'text-primary bg-primary/10'
                            : 'text-gray-300 dark:text-gray-600 hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100'
                        }`}
                        title="Hitta ersättning från ditt skafferi"
                      >
                        {sub?.loading
                          ? <Loader2 size={13} className="animate-spin" />
                          : <ArrowLeftRight size={13} />}
                      </button>
                    </div>

                    {/* Inline substitution card */}
                    {sub?.result && !sub?.loading && (
                      <div className="mx-2 mb-2 rounded-lg border text-sm overflow-hidden
                                      border-sage-200 dark:border-sage-800 bg-sage-50 dark:bg-sage-950/40">
                        {sub.result.error ? (
                          <p className="px-3 py-2 text-red-500 text-xs">{sub.result.error}</p>
                        ) : (
                          <>
                            <div className="px-3 py-2.5 space-y-1.5">
                              {/* Pantry match headline */}
                              {sub.result.found_in_pantry && sub.result.pantry_item ? (
                                <p className="font-semibold text-sage-800 dark:text-sage-200 flex items-center gap-1.5">
                                  <span className="text-base">✅</span>
                                  Du har <span className="underline underline-offset-2">{sub.result.pantry_item}</span> hemma!
                                </p>
                              ) : (
                                <p className="font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                                  <ShoppingBag size={13} className="shrink-0 text-amber-500" />
                                  Köp <span className="underline underline-offset-2">{sub.result.substitute}</span> istället
                                </p>
                              )}
                              {/* Explanation */}
                              {sub.result.explanation && (
                                <p className="text-gray-600 dark:text-gray-400 text-xs leading-relaxed">
                                  {sub.result.explanation}
                                </p>
                              )}
                              {/* Amount note */}
                              {sub.result.amount_note && (
                                <p className="text-xs text-primary font-medium">
                                  📏 {sub.result.amount_note}
                                </p>
                              )}
                              {/* Allergen warning */}
                              {sub.result.allergen_warning && (
                                <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-md">
                                  <AlertTriangle size={11} className="shrink-0" />
                                  {sub.result.allergen_warning}
                                </p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Instruktioner — smart renderer med {{ingredient}}-substitution + klickbara timers */}
        {recipe.instructions && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-semibold">Instruktioner</h2>
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <Flame size={12} />
                Tryck på tids­markeringar för timer
              </span>
            </div>
            <InstructionRenderer
              text={recipe.instructions}
              ingredients={ingredients}
              originalServings={recipe.servings}
              currentServings={servings}
            />
          </section>
        )}

        {/* Familjens anteckningar */}
        <section className="surface rounded-2xl p-4 border-l-4 border-amber-400/60 bg-amber-50/30 dark:bg-amber-950/10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <StickyNote size={16} /> Familjens anteckningar
            </h2>
            {!notesEditing && (
              <button
                onClick={() => { setNotesDraft(recipe.notes || ''); setNotesEditing(true) }}
                className="text-xs text-amber-700 dark:text-amber-300 hover:underline"
              >
                {recipe.notes ? 'Ändra' : 'Lägg till'}
              </button>
            )}
          </div>
          {notesEditing ? (
            <div className="space-y-2">
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder='T.ex. "Nästa gång mindre salt", "barnen älskade detta", "kör 5 min extra"'
                rows={4}
                className="input text-sm"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setNotesSaving(true)
                    try {
                      const updated = await updateRecipe(recipe.id, { notes: notesDraft.trim() || null })
                      setRecipe({ ...recipe, notes: updated.notes })
                      setNotesEditing(false)
                      toast.success('Anteckning sparad')
                    } catch (e) {
                      toast.error(e.message || 'Kunde inte spara')
                    } finally { setNotesSaving(false) }
                  }}
                  disabled={notesSaving}
                  className="btn-primary text-sm"
                >
                  <Save size={14} /> Spara
                </button>
                <button
                  onClick={() => setNotesEditing(false)}
                  className="btn-secondary text-sm"
                >
                  Avbryt
                </button>
              </div>
            </div>
          ) : recipe.notes ? (
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{recipe.notes}</p>
          ) : (
            <p className="text-xs text-gray-400 italic">Inga anteckningar än — lägg till lärdomar från gångerna ni lagat detta.</p>
          )}
        </section>

        {/* Bildgalleri */}
        {(recipe.images || []).length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Bilder</h2>
            <ImageGallery images={recipe.images} />
          </section>
        )}

        {/* Knappar */}
        <div className="flex flex-wrap gap-3 pt-2">
          <Link to={`/shopping?recipe=${id}&servings=${servings}`} className="btn-secondary flex items-center gap-2">
            <ShoppingCart size={17} />
            Lägg till i inköpslista
          </Link>
          <button
            onClick={handleMissingIngredients}
            disabled={missingLoading}
            className="btn-secondary flex items-center gap-2"
            title="Jämför mot pantry och lägg bara till det som saknas"
          >
            <PackageSearch size={17} />
            {missingLoading ? 'Kollar pantry...' : 'Lägg till saknade'}
          </button>
          <Link to={`/mealplan?recipe=${id}`} className="btn-secondary flex items-center gap-2">
            <Calendar size={17} />
            Planera måltid
          </Link>
          <button onClick={() => setFreezerOpen(true)} className="btn-sage flex items-center gap-2">
            <Snowflake size={17} />
            Spara som barnportioner i frysen
          </button>
          {recipe.calories && (
            <button
              disabled={logLoading}
              onClick={async () => {
                setLogLoading(true)
                try {
                  await logMeal(recipe.id, servings)
                  const kcal = Math.round(recipe.calories * servings)
                  toast.success(`Loggat! ${kcal} kcal för ${servings} portioner`)
                } catch (e) { toast.error(e.message || 'Kunde inte logga') }
                finally { setLogLoading(false) }
              }}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
              title="Registrera vad du åt — sparar kalorier för idag"
            >
              <BookOpen size={17} />
              {logLoading ? 'Sparar...' : `🍽️ Jag åt detta${servings !== recipe.servings ? ` (${servings} port.)` : ''}`}
            </button>
          )}
          {recipe.can_edit && (
            <button onClick={handleMarkCooked} className="btn-secondary flex items-center gap-2">
              🍽️ Jag lagade detta
            </button>
          )}
          {/* Stjärn-rating */}
          <div className="flex items-center gap-1 px-3 py-2 surface rounded-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={async () => {
                  try {
                    const { setRecipeRating } = await import('../api')
                    await setRecipeRating(recipe.id, recipe.rating === n ? null : n)
                    toast.success(recipe.rating === n ? 'Rating borttagen' : `${n} stjärnor`)
                    window.location.reload()
                  } catch (e) { toast.error(e.message) }
                }}
                className={`text-xl ${(recipe.rating || 0) >= n ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
                aria-label={`${n} stjärnor`}
              >
                ★
              </button>
            ))}
          </div>
          {recipe.last_cooked_at && (
            <span className="text-xs text-gray-500 self-center">
              Senast lagad: {new Date(recipe.last_cooked_at).toLocaleDateString('sv-SE')}
              {recipe.times_cooked > 0 && ` · ${recipe.times_cooked}×`}
            </span>
          )}
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-2">
              <ExternalLink size={17} />
              Källrecept
            </a>
          )}
          {recipe.source_url && recipe.can_edit && (
            <button
              onClick={async () => {
                const t = toast.loading('AI skriver om receptet med egna ord + skapar ny bild...')
                try {
                  const res = await rewriteRecipe(recipe.id)
                  toast.success('Din egen version är klar! Den kan nu publiceras.', { id: t, duration: 5000 })
                  navigate(`/recipes/${res.id}`)
                } catch (e) { toast.error(e.message || 'Kunde inte skriva om', { id: t }) }
              }}
              className="btn-secondary flex items-center gap-2"
              title="AI skriver om instruktionerna med egna ord och genererar en ny bild — resultatet saknar källänk och kan publiceras i publika biblioteket"
            >
              <Sparkles size={17} />
              Skapa egen version
            </button>
          )}
          <button
            onClick={async () => {
              try { await exportRecipePdf(recipe.id, recipe.title); toast.success('PDF nedladdad') }
              catch (e) { toast.error(e.message) }
            }}
            className="btn-secondary flex items-center gap-2"
            title="Ladda ner som PDF för utskrift"
          >
            <FileDown size={17} />
            PDF
          </button>
        </div>
      </div>

      {/* Modal: saknade ingredienser vs pantry */}
      {missingModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="surface-card max-w-md w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Saknade ingredienser</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {missingModal.missing.length} av {missingModal.total} saknas hemma
                </p>
              </div>
              <button onClick={() => setMissingModal(null)} className="btn-ghost w-10 h-10 p-0">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-1 -mx-1">
              {missingModal.missing.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <Check size={40} className="mx-auto text-sage-500" />
                  <p className="font-semibold text-sage-700 dark:text-sage-300">Du har allt hemma!</p>
                  <p className="text-sm text-gray-500">Alla ingredienser finns i pantry.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-2 pb-1">Behöver handlas</p>
                  {missingModal.missing.map((ing, i) => (
                    <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-xl bg-red-50 dark:bg-red-950/20">
                      <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                      <span className="text-sm font-medium flex-1">{ing.name}</span>
                      <span className="text-xs text-gray-500">{ing.scaledAmount || ing.amount} {ing.unit}</span>
                      <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded-md">{ing.category}</span>
                    </div>
                  ))}
                  {missingModal.available.length > 0 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-2 pt-3 pb-1">Finns hemma</p>
                      {missingModal.available.map((ing, i) => (
                        <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded-xl opacity-50">
                          <Check size={14} className="text-sage-500 shrink-0" />
                          <span className="text-sm">{ing.name}</span>
                          <span className="text-xs text-gray-500 ml-auto">{ing.amount} {ing.unit}</span>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setMissingModal(null)} className="btn-secondary flex-1">
                Stäng
              </button>
              {missingModal.missing.length > 0 && (
                <button onClick={handleAddMissingToList} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <ShoppingCart size={16} />
                  Lägg till {missingModal.missing.length} varor
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <BatchFreezeModal
        open={freezerOpen}
        onClose={() => setFreezerOpen(false)}
        recipe={recipe}
      />

      <ShareRecipeModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        recipe={recipe}
      />

      {/* Pantry-avdrag modal */}
      {cookedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
             onClick={() => setCookedResult(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4"
               onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              🍽️ Lagad! ({cookedResult.times_cooked}×)
            </h2>
            {cookedResult.pantry_deducted?.filter(d => d.deducted !== null).length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Draget från pantry:</p>
                <ul className="space-y-1">
                  {cookedResult.pantry_deducted.filter(d => d.deducted !== null).map((d, i) => (
                    <li key={i} className="text-sm flex justify-between">
                      <span>{d.name}</span>
                      <span className="text-gray-500">−{d.deducted} {d.unit || ''} → {d.remaining} kvar</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cookedResult.pantry_shortages?.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl p-3 space-y-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Tog slut:</p>
                {cookedResult.pantry_shortages.map((s, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                    {s.name} — behövde {s.needed.toFixed(1)}, hade bara {s.had.toFixed(1)}
                  </p>
                ))}
              </div>
            )}
            {!cookedResult.pantry_deducted?.length && !cookedResult.pantry_shortages?.length && (
              <p className="text-sm text-gray-500">Inga ingredienser matchades mot pantry.</p>
            )}
            <button onClick={() => setCookedResult(null)} className="btn-primary w-full">
              Stäng
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
