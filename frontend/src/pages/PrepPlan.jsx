import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ChefHat, Check, Clock, Snowflake, Package, AlertTriangle,
  ChevronDown, ChevronUp, Loader2, ArrowLeft, Wand2, RotateCcw,
} from 'lucide-react'
import { useRecipes } from '../hooks/useRecipes'
import { generatePrepPlan } from '../api'
import { imageUrl } from '../utils/imageUrl'

const PHASE_COLORS = {
  prep:    'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20',
  active:  'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20',
  storage: 'border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/20',
}
const PHASE_BADGE = {
  prep:    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  active:  'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  storage: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
}

// ─── Steg-checklista ────────────────────────────────────────────────
function PhaseSection({ phase, checked, onToggle }) {
  const [collapsed, setCollapsed] = useState(false)
  const done = phase.steps.filter((_, i) => checked.has(`${phase.id}-${i}`)).length
  const total = phase.steps.length

  return (
    <div className={`rounded-2xl border ${PHASE_COLORS[phase.id] || 'border-gray-200 dark:border-gray-700'}`}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-bold text-lg flex items-center gap-2">
          <span>{phase.emoji}</span>
          {phase.title}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PHASE_BADGE[phase.id] || 'bg-gray-100 text-gray-600'}`}>
            {done}/{total}
          </span>
        </span>
        {collapsed ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronUp size={18} className="text-gray-400" />}
      </button>

      {!collapsed && (
        <ul className="px-4 pb-4 space-y-2">
          {phase.steps.map((step, i) => {
            const key = `${phase.id}-${i}`
            const isDone = checked.has(key)
            return (
              <li
                key={i}
                onClick={() => onToggle(key)}
                className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all
                  hover:bg-white/60 dark:hover:bg-white/5 select-none
                  ${isDone ? 'opacity-50' : ''}`}
              >
                <span className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                  isDone ? 'bg-primary border-primary' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isDone && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${isDone ? 'line-through text-gray-400' : ''}`}>
                    {step.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {step.time_min && (
                      <span className="text-[11px] text-gray-400 flex items-center gap-0.5">
                        <Clock size={10} /> {step.time_min} min
                      </span>
                    )}
                    {step.shared && (
                      <span className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                        Delas
                      </span>
                    )}
                    {step.recipes?.map((r) => (
                      <span key={r} className="text-[11px] text-gray-400 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Recept-väljare ─────────────────────────────────────────────────
function RecipeSelector({ selected, onToggle, onGenerate, generating }) {
  const { recipes, loading } = useRecipes({ sort: 'recent' })
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    if (!filter.trim()) return recipes
    const q = filter.toLowerCase()
    return recipes.filter((r) => r.title.toLowerCase().includes(q))
  }, [recipes, filter])

  return (
    <div className="space-y-4">
      <div className="surface-card p-4 space-y-3">
        <p className="text-sm text-gray-500">
          Välj <span className="font-semibold text-primary">2–6 recept</span> du vill batch-laga.
          AI:n skapar en optimerad Game Plan med konsoliderade ingredienser, parallellt arbete och ugnsoptimering.
        </p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrera recept..."
          className="input text-sm"
        />
        {selected.size > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-primary">{selected.size} valda</p>
            <button
              onClick={onGenerate}
              disabled={selected.size < 2 || generating}
              className="btn-primary flex items-center gap-2"
            >
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {generating ? 'AI tänker...' : 'Skapa Game Plan'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {visible.map((r) => {
            const isSel = selected.has(r.id)
            const disabled = !isSel && selected.size >= 6
            return (
              <button
                key={r.id}
                onClick={() => !disabled && onToggle(r.id)}
                disabled={disabled}
                className={`relative rounded-2xl overflow-hidden text-left transition-all
                  ${isSel ? 'ring-2 ring-primary shadow-lg scale-[1.02]' : 'hover:shadow-md hover:scale-[1.01]'}
                  ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
                  surface`}
              >
                {/* Thumbnail */}
                <div className="h-20 bg-gradient-to-br from-orange-200 to-rose-300 relative overflow-hidden">
                  {r.cover_image && (
                    <img
                      src={imageUrl(r.cover_image, { thumb: true })}
                      alt={r.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                  {isSel && (
                    <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
                      <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg">
                        <Check size={15} className="text-white" strokeWidth={3} />
                      </div>
                    </div>
                  )}
                </div>
                {/* Title */}
                <div className="p-2">
                  <p className="text-xs font-semibold line-clamp-2 leading-snug">{r.title}</p>
                  {(r.prep_time || r.cook_time) && (
                    <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-0.5">
                      <Clock size={9} />
                      {(r.prep_time || 0) + (r.cook_time || 0)} min
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected.size >= 2 && (
        <div className="flex justify-center">
          <button
            onClick={onGenerate}
            disabled={generating}
            className="btn-primary text-base px-8 py-3 flex items-center gap-2"
          >
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
            {generating ? 'AI skapar din Game Plan...' : `Skapa Game Plan för ${selected.size} recept`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Game Plan-visning ──────────────────────────────────────────────
function GamePlan({ plan, onReset }) {
  const [checked, setChecked] = useState(new Set())

  const totalSteps = plan.phases.reduce((acc, ph) => acc + ph.steps.length, 0)
  const doneSteps = checked.size
  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0

  const toggle = (key) =>
    setChecked((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="surface-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <ChefHat size={22} className="text-primary" />
              Game Plan
            </h2>
            <p className="text-sm text-gray-500 mt-1">{plan.summary}</p>
          </div>
          <button
            onClick={onReset}
            className="btn-ghost p-2 text-gray-400 hover:text-primary shrink-0"
            title="Välj om recept"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap gap-3 text-sm">
          {plan.total_time_estimate && (
            <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
              <Clock size={14} className="text-primary" />
              {plan.total_time_estimate} (parallellt optimerat)
            </span>
          )}
          <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <Package size={14} className="text-primary" />
            {plan.recipes.join(', ')}
          </span>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{doneSteps}/{totalSteps} steg klara</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {pct === 100 && (
          <div className="text-center py-2 text-lg font-bold text-primary animate-bounce">
            🎉 Klart! Bra jobbat!
          </div>
        )}
      </div>

      {/* Tiningslista */}
      {plan.thaw_list?.length > 0 && (
        <div className="surface-card p-4 border-l-4 border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 space-y-2">
          <p className="font-semibold text-sm flex items-center gap-2 text-blue-800 dark:text-blue-200">
            <Snowflake size={16} className="text-blue-500" />
            Ta ut ur frysen i förväg
          </p>
          <ul className="space-y-1">
            {plan.thaw_list.map((t, i) => (
              <li key={i} className="text-sm flex items-start gap-2 text-blue-700 dark:text-blue-300">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-blue-400" />
                <span>
                  <span className="font-medium">{t.item}</span>
                  {t.note && <span className="text-blue-500 dark:text-blue-400"> — {t.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Faser */}
      {plan.phases.map((phase) => (
        <PhaseSection key={phase.id} phase={phase} checked={checked} onToggle={toggle} />
      ))}
    </div>
  )
}

// ─── Huvud-sida ─────────────────────────────────────────────────────
export default function PrepPlan() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(new Set())
  const [plan, setPlan] = useState(null)
  const [generating, setGenerating] = useState(false)

  const toggleRecipe = (id) =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const handleGenerate = async () => {
    if (selected.size < 2) return toast.error('Välj minst 2 recept')
    setGenerating(true)
    const toastId = toast.loading('AI skapar din Game Plan...')
    try {
      const res = await generatePrepPlan([...selected])
      setPlan(res)
      toast.success('Game Plan klar! 🍳', { id: toastId })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast.error(e.message || 'Misslyckades', { id: toastId })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ChefHat size={24} className="text-primary" />
            Prep-Master
          </h1>
          <p className="text-sm text-gray-500">Batch-laga flera recept med en optimerad Game Plan</p>
        </div>
      </div>

      {plan ? (
        <GamePlan plan={plan} onReset={() => { setPlan(null); setSelected(new Set()) }} />
      ) : (
        <RecipeSelector
          selected={selected}
          onToggle={toggleRecipe}
          onGenerate={handleGenerate}
          generating={generating}
        />
      )}
    </div>
  )
}
