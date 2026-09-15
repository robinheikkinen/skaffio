import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'

/**
 * Pinned cooking session — survives navigation and reloads via localStorage.
 *
 * activeRecipe: { id, title, servings, cover_image } | null
 * timers:       [{ id, label, durationSec, startedAt, recipeId }]
 */
const CookingContext = createContext(null)

const STORAGE_KEY = 'skaffio.cooking'

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { activeRecipe: null, timers: [] }
    const parsed = JSON.parse(raw)
    return {
      activeRecipe: parsed.activeRecipe || null,
      timers: Array.isArray(parsed.timers) ? parsed.timers : [],
    }
  } catch {
    return { activeRecipe: null, timers: [] }
  }
}

export function CookingProvider({ children }) {
  const [state, setState] = useState(loadInitial)
  const audioRef = useRef(null)

  // Persist on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
  }, [state])

  const pin = useCallback((recipe, servings) => {
    setState((s) => ({
      ...s,
      activeRecipe: {
        id: recipe.id,
        title: recipe.title,
        servings: servings ?? recipe.servings,
        cover_image: recipe.cover_image || null,
      },
    }))
    toast.success(`📌 "${recipe.title}" fäst — den finns kvar längst ner`)
  }, [])

  const unpin = useCallback(() => {
    setState((s) => ({ ...s, activeRecipe: null }))
  }, [])

  const addTimer = useCallback((durationSec, label = '', recipeId = null) => {
    const id = Math.random().toString(36).slice(2, 10)
    setState((s) => ({
      ...s,
      timers: [...s.timers, {
        id, label, durationSec, recipeId,
        startedAt: Date.now(),
      }],
    }))
    toast.success(`⏱ Timer startad: ${label || formatDuration(durationSec)}`)
    return id
  }, [])

  const removeTimer = useCallback((id) => {
    setState((s) => ({ ...s, timers: s.timers.filter((t) => t.id !== id) }))
  }, [])

  // Tick: check for expired timers, fire alert, auto-remove
  useEffect(() => {
    if (state.timers.length === 0) return
    const tick = setInterval(() => {
      const now = Date.now()
      const expired = state.timers.filter((t) => now - t.startedAt >= t.durationSec * 1000)
      if (expired.length) {
        expired.forEach((t) => {
          toast.success(`⏰ Timer klar: ${t.label || formatDuration(t.durationSec)}`, { duration: 8000 })
        })
        try {
          // Short beep using WebAudio — no asset required
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          const o = ctx.createOscillator()
          const g = ctx.createGain()
          o.connect(g); g.connect(ctx.destination)
          o.frequency.value = 880; g.gain.value = 0.15
          o.start(); o.stop(ctx.currentTime + 0.6)
        } catch {}
        setState((s) => ({ ...s, timers: s.timers.filter((t) => !expired.includes(t)) }))
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [state.timers])

  return (
    <CookingContext.Provider value={{
      activeRecipe: state.activeRecipe,
      timers: state.timers,
      pin, unpin, addTimer, removeTimer,
    }}>
      {children}
    </CookingContext.Provider>
  )
}

export function useCooking() {
  const ctx = useContext(CookingContext)
  if (!ctx) throw new Error('useCooking must be inside <CookingProvider>')
  return ctx
}

export function formatDuration(sec) {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m} min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
