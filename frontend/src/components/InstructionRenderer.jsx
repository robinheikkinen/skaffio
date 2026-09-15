import { Timer, Play } from 'lucide-react'
import { useCooking } from '../context/CookingSession'

/**
 * Smart rendering av receptinstruktioner med:
 *   1. {{ingredient}}-tokens → ersatta med skalad mängd (Tandoor-stil).
 *      Matchar case-insensitive på namn-substring av en ingrediens.
 *   2. tidsuttryck ("15 min", "1 timme", "30 sek") → klickbara badges
 *      som startar en countdown-timer i CookingDock (Paprika-stil).
 *   3. numrerade steg-detektering — en rad som börjar med "1." renderas
 *      som en steg-kort.
 */

const TIME_RX = /(\d+(?:[.,]\d+)?)\s*(timmar?|tim\b|t\b|minuter|minut|min|m\b|sekunder|sekund|sek|s\b)/gi
const ING_RX = /\{\{\s*([^}]+?)\s*\}\}/g
const STEP_RX = /^\s*(\d+)\.\s+(.*)$/

function unitToSeconds(unit) {
  const u = unit.toLowerCase()
  if (u.startsWith('t')) return 3600    // timme/tim/t
  if (u.startsWith('m')) return 60      // minut/min/m
  return 1                              // sekund/sek/s
}

function findIngredient(token, ingredients) {
  const needle = token.toLowerCase().trim()
  return ingredients.find((i) => {
    const name = (i.name || '').toLowerCase()
    return name === needle || name.startsWith(needle) || needle.startsWith(name) || name.includes(needle)
  })
}

function scaledAmount(ing, scale) {
  const n = parseFloat((ing.amount || '').replace(',', '.'))
  if (isNaN(n)) return (ing.amount || '').trim()
  const v = n * scale
  return (Math.round(v * 10) / 10).toString().replace(/\.0$/, '')
}

function IngredientChip({ ing, scale }) {
  if (!ing) return null
  const amt = scaledAmount(ing, scale)
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5
                 rounded-lg bg-primary/10 text-primary-700 dark:text-primary-300
                 text-[13px] font-semibold align-baseline"
      title={`${amt} ${ing.unit || ''} ${ing.name}`.trim()}
    >
      {amt && <span className="tabular-nums">{amt}</span>}
      {ing.unit && <span>{ing.unit}</span>}
      <span className="font-medium">{ing.name}</span>
    </span>
  )
}

function TimerBadge({ value, unit, label }) {
  const { addTimer } = useCooking()
  const seconds = Math.round(parseFloat(value.replace(',', '.')) * unitToSeconds(unit))

  return (
    <button
      type="button"
      onClick={() => addTimer(seconds, label)}
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mx-0.5
                 rounded-full bg-sage-100 text-sage-800 dark:bg-sage-900/40 dark:text-sage-200
                 text-[12.5px] font-semibold align-baseline
                 hover:bg-sage-200 dark:hover:bg-sage-800/40
                 active:scale-95 transition-all duration-150
                 cursor-pointer"
      title="Klicka för att starta timer"
    >
      <Play size={10} strokeWidth={3} className="fill-current" />
      {value} {unit}
    </button>
  )
}

/**
 * Tokenize a single line of text into a flat list of React nodes,
 * preserving order: text → ingredient-chip → text → timer-badge → text…
 */
function renderLine(text, { ingredients, scale, stepLabel }) {
  // First pass: replace {{ing}} tokens with placeholders we can re-walk.
  // We'll split on both regexes simultaneously by interleaving.
  const tokens = []
  let lastIdx = 0
  // Find all matches from both regexes, sorted by index
  const matches = []
  for (const m of text.matchAll(ING_RX)) {
    matches.push({ start: m.index, end: m.index + m[0].length, type: 'ing', payload: m[1] })
  }
  // Reset TIME_RX since /g has lastIndex state
  TIME_RX.lastIndex = 0
  for (const m of text.matchAll(TIME_RX)) {
    matches.push({ start: m.index, end: m.index + m[0].length, type: 'time', payload: { value: m[1], unit: m[2] } })
  }
  matches.sort((a, b) => a.start - b.start)
  // Drop overlapping matches (rare — ingredient name with numbers)
  const filtered = []
  let cursor = -1
  for (const m of matches) {
    if (m.start >= cursor) { filtered.push(m); cursor = m.end }
  }

  filtered.forEach((m, i) => {
    if (m.start > lastIdx) tokens.push(text.slice(lastIdx, m.start))
    if (m.type === 'ing') {
      const ing = findIngredient(m.payload, ingredients)
      if (ing) {
        tokens.push(<IngredientChip key={`ing-${i}`} ing={ing} scale={scale} />)
      } else {
        tokens.push(<span key={`ing-${i}`} className="text-gray-400 italic">{`{${m.payload}}`}</span>)
      }
    } else {
      tokens.push(
        <TimerBadge key={`tm-${i}`} value={m.payload.value} unit={m.payload.unit} label={stepLabel} />
      )
    }
    lastIdx = m.end
  })
  if (lastIdx < text.length) tokens.push(text.slice(lastIdx))

  return tokens.length ? tokens : [text]
}

export default function InstructionRenderer({ text, ingredients = [], originalServings = 1, currentServings = 1 }) {
  if (!text) return null
  const scale = (currentServings || 1) / (originalServings || 1)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  return (
    <ol className="space-y-3">
      {lines.map((line, idx) => {
        const stepMatch = line.match(STEP_RX)
        const stepNum = stepMatch ? stepMatch[1] : (idx + 1).toString()
        const body = stepMatch ? stepMatch[2] : line
        const stepLabel = `Steg ${stepNum}`

        return (
          <li
            key={idx}
            className="flex gap-3 surface rounded-2xl p-3.5 shadow-soft"
          >
            <span className="shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary
                             flex items-center justify-center font-bold text-sm tabular-nums">
              {stepNum}
            </span>
            <p className="leading-relaxed text-[15px] flex-1 [overflow-wrap:anywhere]">
              {renderLine(body, { ingredients, scale, stepLabel })}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
