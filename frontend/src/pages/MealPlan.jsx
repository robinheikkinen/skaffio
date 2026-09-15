import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format, startOfWeek, addDays, addWeeks, subWeeks, getISOWeek } from 'date-fns'
import { sv } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, X, Search, ShoppingCart, Sparkles, Snowflake, CalendarDays, Baby, Pencil, Check } from 'lucide-react'
import { useMealPlan } from '../hooks/useMealPlan'
import { getRecipes, getMealPlanIcalUrl, getPreschoolMenu, setPreschoolSchool, generateShoppingList, createShoppingList } from '../api'
import AIChatDrawer from '../components/AIChatDrawer'
import BatchFreezeModal from '../components/BatchFreezeModal'

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Frukost', emoji: '🥣' },
  { key: 'lunch',     label: 'Lunch',   emoji: '🥗' },
  { key: 'dinner',    label: 'Middag',  emoji: '🍲' },
  { key: 'snack',     label: 'Mellan',  emoji: '🍎' },
]

// Aggregera dagens makron från planeringsposter. Returnerar null om INGEN
// post har näringsdata (då döljer vi widgeten istället för att visa ?).
function aggregateDayMacros(entries) {
  let kcal = 0, protein = 0, count = 0
  for (const e of entries) {
    const r = e.recipe
    if (!r || (r.calories == null && r.protein == null)) continue
    const ratio = (e.servings || r.servings || 1) / (r.servings || 1)
    if (r.calories != null) kcal += r.calories * ratio
    if (r.protein != null)  protein += r.protein * ratio
    count++
  }
  if (count === 0) return null
  return { kcal: Math.round(kcal), protein: Math.round(protein) }
}

export default function MealPlan() {
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [modal, setModal] = useState(null)
  const [generatingList, setGeneratingList] = useState(false)
  const [recipes, setRecipes] = useState([])
  const [search, setSearch] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [freezeTarget, setFreezeTarget] = useState(null)
  const [icalModalOpen, setIcalModalOpen] = useState(false)
  const [icalInfo, setIcalInfo] = useState(null)
  const [preschool, setPreschool] = useState(null)
  const [preschoolName, setPreschoolName] = useState('Förskolan')
  const [preschoolModal, setPreschoolModal] = useState(false)
  const [preschoolConfigured, setPreschoolConfigured] = useState(null)
  const [currentSchoolUrl, setCurrentSchoolUrl] = useState('')
  const [schoolEditOpen, setSchoolEditOpen] = useState(false)
  const [schoolUrlDraft, setSchoolUrlDraft] = useState('')
  const [schoolSaving, setSchoolSaving] = useState(false)

  // Hjälpfunktion: hittar förskole-event för ett givet datum (YYYY-MM-DD)
  const preschoolForDay = (isoDate) =>
    (preschool || []).find((p) => {
      const pDate = p.start ? p.start.slice(0, 10) : ''
      return pDate === isoDate
    })

  // Enkel keyword-overlap för att flagga "liknande mat på förskolan"
  const STOPWORDS = new Set(['med', 'och', 'samt', 'eller', 'av', 'i', 'på', 'till', 'en', 'ett', 'serveras', 'för'])
  const tokenize = (s) =>
    (s || '').toLowerCase()
      .replace(/[^a-zåäö\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))

  const isDuplicateWithPreschool = (recipeTitle, isoDate) => {
    const ev = preschoolForDay(isoDate)
    if (!ev) return false
    const recipeWords = new Set(tokenize(recipeTitle))
    const psWords = tokenize(ev.summary)
    return psWords.some((w) => recipeWords.has(w))
  }
  const { entries, fetch, add, remove } = useMealPlan()

  const weekEnd = addDays(weekStart, 6)

  const reload = () => fetch(format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd'))

  useEffect(() => { reload() }, [weekStart])
  useEffect(() => { getRecipes().then(setRecipes) }, [])
  const fetchPreschool = () =>
    getPreschoolMenu(14).then((r) => {
      setPreschoolConfigured(r.configured)
      setCurrentSchoolUrl(r.school_url || '')
      if (r.configured) {
        setPreschool(r.events || [])
        if (r.name) setPreschoolName(r.name)
      } else {
        setPreschool(null)
      }
    }).catch(() => setPreschoolConfigured(false))

  useEffect(() => { fetchPreschool() }, [])

  const handleSaveSchool = async () => {
    const url = schoolUrlDraft.trim()
    if (!url.startsWith('https://skolmaten.se/')) {
      toast.error('URL måste börja med https://skolmaten.se/')
      return
    }
    setSchoolSaving(true)
    try {
      await setPreschoolSchool(url)
      setSchoolEditOpen(false)
      await fetchPreschool()
      toast.success('Förskola sparad!')
    } catch (e) {
      toast.error(e.message || 'Kunde inte spara')
    } finally {
      setSchoolSaving(false)
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const getEntry = (date, mealType) =>
    entries.find(
      (e) => e.date === format(date, 'yyyy-MM-dd') && e.meal_type === mealType
    )

  const handleAdd = async (recipe) => {
    if (!modal) return
    try {
      await add({
        recipe_id: recipe.id,
        date: format(modal.date, 'yyyy-MM-dd'),
        meal_type: modal.meal_type,
        servings: recipe.servings || 4,
      })
      setModal(null)
    } catch {
      toast.error('Kunde inte lägga till')
    }
  }

  const filteredRecipes = recipes.filter((r) =>
    r.title.toLowerCase().includes(search.toLowerCase())
  )

  const recipeIds = [...new Set(entries.map((e) => e.recipe_id))]
  const todayKey = format(new Date(), 'yyyy-MM-dd')

  const handleGenerateWeeklyShopping = async () => {
    if (recipeIds.length === 0) return toast.error('Inga recept planerade den här veckan')
    setGeneratingList(true)
    const t = toast.loading('Genererar veckohandling...')
    try {
      // Sum servings per recipe across all meal plan entries
      const servingsMap = {}
      entries.forEach((e) => {
        const key = String(e.recipe_id)
        servingsMap[key] = (servingsMap[key] || 0) + (e.servings || 4)
      })
      const items = await generateShoppingList(recipeIds, servingsMap)
      const weekLabel = `Veckohandling ${format(weekStart, 'd MMM', { locale: sv })}–${format(weekEnd, 'd MMM', { locale: sv })}`
      await createShoppingList({ name: weekLabel, items: JSON.stringify(items) })
      toast.success(`${items.length} varor — lista skapad!`, { id: t, duration: 5000 })
      navigate('/shopping')
    } catch (e) {
      toast.error(e.message || 'Kunde inte generera lista', { id: t })
    } finally {
      setGeneratingList(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Måltidsplan</h1>
          <p className="text-sm text-gray-500 mt-1">Planera veckan – manuellt eller med AI-kocken</p>
        </div>
        <div className="flex gap-2">
          {recipeIds.length > 0 && (
            <button
              onClick={handleGenerateWeeklyShopping}
              disabled={generatingList}
              className="btn-secondary"
              title="Generera inköpslista för hela veckan med rätt portioner"
            >
              <ShoppingCart size={17} />
              <span className="hidden sm:inline">{generatingList ? 'Genererar...' : 'Veckohandling'}</span>
            </button>
          )}
          <button
            onClick={async () => {
              try {
                const info = await getMealPlanIcalUrl()
                setIcalInfo(info)
                setIcalModalOpen(true)
              } catch (e) { toast.error(e.message) }
            }}
            className="btn-secondary"
            title="Få planen i Google Calendar / Apple Kalender"
          >
            <CalendarDays size={17} />
            <span className="hidden sm:inline">Synka kalender</span>
          </button>
          <button
            onClick={() => setAiOpen(true)}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5
                       rounded-2xl font-medium text-white
                       bg-gradient-to-br from-primary via-primary-600 to-primary-700
                       shadow-card hover:shadow-lift active:scale-[0.98]
                       transition-all duration-200 ease-silky"
          >
            <Sparkles size={17} strokeWidth={2.4} />
            Fråga AI-kocken
          </button>
        </div>
      </div>

      {/* Förskolans matsedel — setup-kort om ej konfigurerat */}
      {preschoolConfigured === false && (
        <div className="surface-card p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <Baby size={13} className="text-pink-500" />
            Koppla in förskolan
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Klistra in er förskolas URL från skolmaten.se — menyn visas sedan automatiskt här och AI-kocken undviker dubbletter.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={schoolUrlDraft}
              onChange={(e) => setSchoolUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveSchool()}
              placeholder="https://skolmaten.se/din-forskola"
              className="input flex-1 text-sm"
            />
            <button
              onClick={handleSaveSchool}
              disabled={schoolSaving || !schoolUrlDraft.trim()}
              className="btn-primary px-4 text-sm"
            >
              {schoolSaving ? '...' : 'Spara'}
            </button>
          </div>
        </div>
      )}

      {/* Förskolans matsedel — kommande dagar */}
      {preschool && preschool.length > 0 && (
        <div className="surface-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {schoolEditOpen ? (
              <div className="flex gap-2 flex-1">
                <input
                  type="url"
                  value={schoolUrlDraft}
                  onChange={(e) => setSchoolUrlDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSchool(); if (e.key === 'Escape') setSchoolEditOpen(false) }}
                  placeholder="https://skolmaten.se/din-forskola"
                  className="input flex-1 text-sm h-8 py-1"
                  autoFocus
                />
                <button
                  onClick={handleSaveSchool}
                  disabled={schoolSaving}
                  className="w-8 h-8 rounded-lg bg-pink-500 hover:bg-pink-600 text-white flex items-center justify-center transition-colors"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setSchoolEditOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                  <Baby size={13} className="text-pink-500" />
                  {preschoolName} — vecka {getISOWeek(weekStart)}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSchoolUrlDraft(currentSchoolUrl); setSchoolEditOpen(true) }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    title="Byt förskola"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => setPreschoolModal(true)}
                    className="text-[11px] text-pink-600 dark:text-pink-300 hover:underline"
                  >
                    Visa hela →
                  </button>
                </div>
              </>
            )}
          </div>
          {!schoolEditOpen && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {preschool.slice(0, 14).map((ev, i) => {
                const d = ev.start ? new Date(ev.start) : null
                const day = d ? d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric' }) : ''
                return (
                  <button
                    key={i}
                    onClick={() => setPreschoolModal(true)}
                    className="shrink-0 px-3 py-2 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200/40 dark:border-pink-800/30 text-left hover:bg-pink-100 dark:hover:bg-pink-900/30 transition-colors"
                  >
                    <p className="text-[10px] font-semibold text-pink-600 dark:text-pink-300 uppercase">{day}</p>
                    <p className="text-xs text-gray-700 dark:text-gray-200 max-w-[180px] line-clamp-2">{ev.summary}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="surface rounded-3xl px-3 py-2.5 flex items-center justify-between">
        <button
          onClick={() => setWeekStart((w) => subWeeks(w, 1))}
          className="w-11 h-11 rounded-2xl flex items-center justify-center
                     hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold text-[15px] tracking-tight">
          {format(weekStart, 'd MMM', { locale: sv })} – {format(weekEnd, 'd MMM yyyy', { locale: sv })}
        </span>
        <button
          onClick={() => setWeekStart((w) => addWeeks(w, 1))}
          className="w-11 h-11 rounded-2xl flex items-center justify-center
                     hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <div className="grid grid-cols-7 gap-2.5 min-w-[760px]">
          {days.map((day) => {
            const isToday = format(day, 'yyyy-MM-dd') === todayKey
            const dayKey = format(day, 'yyyy-MM-dd')
            const dayEntries = entries.filter((e) => e.date === dayKey)
            const macros = aggregateDayMacros(dayEntries)
            return (
              <div key={day.toString()} className="space-y-2">
                <div className={`text-center py-2 rounded-2xl ${
                  isToday ? 'bg-primary/10 text-primary' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold">{format(day, 'EEE', { locale: sv })}</p>
                  <p className={`text-lg ${isToday ? 'font-bold' : 'font-semibold'}`}>{format(day, 'd')}</p>
                </div>

                {/* Daglig makro-mini-widget */}
                {macros && (
                  <div className="surface rounded-2xl px-2 py-1.5 space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{macros.kcal}</span>
                      <span className="text-gray-400">kcal</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-sage-700 dark:text-sage-300 tabular-nums">{macros.protein}g</span>
                      <span className="text-gray-400">protein</span>
                    </div>
                  </div>
                )}

                {MEAL_TYPES.map(({ key, label, emoji }) => {
                  const entry = getEntry(day, key)
                  const isDup = entry && key === 'dinner' && isDuplicateWithPreschool(entry.recipe?.title, dayKey)
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1.5 px-1">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                          <span className="mr-1">{emoji}</span>{label}
                        </p>
                      </div>
                      {entry ? (
                        <div className={`surface-card p-2.5 text-xs relative group ${isDup ? 'ring-2 ring-pink-400/60' : ''}`}>
                          <Link
                            to={`/recipes/${entry.recipe_id}`}
                            className="font-semibold line-clamp-2 hover:text-primary leading-snug block"
                          >
                            {entry.recipe?.title}
                          </Link>
                          {isDup && (
                            <p
                              className="text-[10px] text-pink-700 dark:text-pink-300 mt-1 flex items-center gap-1 cursor-help"
                              title={`Förskolan: ${preschoolForDay(dayKey)?.summary}`}
                            >
                              <Baby size={10} /> liknande på förskolan
                            </p>
                          )}
                          {entry.notes && (
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                              {entry.notes}
                            </p>
                          )}
                          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={() => setFreezeTarget(entry.recipe)}
                              title="Spara som barnportioner i frysen"
                              className="w-6 h-6 rounded-lg bg-white/95 dark:bg-black/50
                                         flex items-center justify-center
                                         text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                            >
                              <Snowflake size={12} strokeWidth={2.4} />
                            </button>
                            <button
                              onClick={() => remove(entry.id)}
                              className="w-6 h-6 rounded-lg bg-white/95 dark:bg-black/50
                                         flex items-center justify-center
                                         text-gray-500 hover:text-red-500"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setModal({ date: day, meal_type: key })}
                          className="w-full h-14 border-2 border-dashed rounded-2xl
                                     border-gray-200 dark:border-white/10 text-gray-300 dark:text-white/20
                                     hover:border-primary hover:text-primary
                                     transition-all duration-200 ease-silky text-xl font-light"
                        >
                          +
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Recipe picker modal */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="surface-card max-w-md w-full p-5 space-y-4 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-lg">Välj recept</h2>
              <button onClick={() => setModal(null)} className="btn-ghost w-10 h-10 p-0">
                <X size={20} />
              </button>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sök..."
                className="input pl-11"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 space-y-1 -mx-2">
              {filteredRecipes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleAdd(r)}
                  className="w-full text-left list-row"
                >
                  <div className="flex-1">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{r.servings} portioner</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <AIChatDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        weekStart={weekStart}
        onPlanApplied={() => { setAiOpen(false); reload() }}
      />

      <BatchFreezeModal
        open={!!freezeTarget}
        recipe={freezeTarget}
        onClose={() => setFreezeTarget(null)}
      />

      {/* Förskole-matsedel — full översikt */}
      {preschoolModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="surface-card max-w-lg w-full p-5 space-y-3 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Baby size={20} className="text-pink-500" />
                {preschoolName} matsedel
              </h2>
              <button onClick={() => setPreschoolModal(false)} className="btn-ghost w-10 h-10 p-0"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto space-y-2 flex-1">
              {(preschool || []).map((ev, i) => {
                const d = ev.start ? new Date(ev.start) : null
                const day = d ? d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
                return (
                  <div key={i} className="p-3 rounded-xl bg-pink-50 dark:bg-pink-950/20 border border-pink-200/40 dark:border-pink-800/30">
                    <p className="text-xs font-semibold text-pink-700 dark:text-pink-300 uppercase mb-1">{day}</p>
                    <p className="text-sm">{ev.summary}</p>
                  </div>
                )
              })}
              {(preschool || []).length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">Ingen matsedel hittad de kommande dagarna.</p>
              )}
            </div>
            <p className="text-[11px] text-gray-400 text-center">Från skolmaten.se · uppdateras automatiskt</p>
          </div>
        </div>
      )}

      {/* iCal-prenumeration */}
      {icalModalOpen && icalInfo && (() => {
        const fullUrl = `${window.location.origin}/api${icalInfo.path}`
        return (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="surface-card max-w-md w-full p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <CalendarDays size={20} className="text-primary" />
                  Synka med kalender
                </h2>
                <button onClick={() => setIcalModalOpen(false)} className="btn-ghost w-10 h-10 p-0"><X size={20} /></button>
              </div>
              <p className="text-sm text-gray-500">
                Lägg till Skaffios måltidsplan i er gemensamma Google Kalender — uppdateras automatiskt när ni ändrar.
              </p>
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-2">
                <code className="flex-1 text-xs truncate text-gray-600 dark:text-gray-300">{fullUrl}</code>
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(fullUrl); toast.success('Kopierad! 📋') }
                    catch { toast.error('Kunde inte kopiera') }
                  }}
                  className="btn-primary p-2 text-xs"
                >
                  Kopiera
                </button>
              </div>
              <div className="text-xs text-gray-500 space-y-2">
                <p className="font-semibold text-gray-700 dark:text-gray-300">Lägg till i er delade Google Kalender:</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>Öppna <a href="https://calendar.google.com/" target="_blank" rel="noopener noreferrer" className="text-primary underline">calendar.google.com</a> på datorn</li>
                  <li>Vänster meny → <strong>Andra kalendrar</strong> → <strong>+</strong> → <strong>Från URL</strong></li>
                  <li>Klistra in URL:en → <strong>Lägg till kalender</strong></li>
                  <li>Klicka på de tre punkterna bredvid den nya "Skaffio"-kalendern → <strong>Inställningar</strong></li>
                  <li>Scrolla till <strong>Dela med specifika personer</strong> → lägg till partners e-post</li>
                </ol>
                <p className="text-gray-400 pt-1">Nu ser ni båda måltidsplanen i samma kalendervy utan att göra det två gånger.</p>
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                ⚠️ Länken är personlig — vem som helst med den kan se din måltidsplan. Dela bara med familjen.
              </p>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
