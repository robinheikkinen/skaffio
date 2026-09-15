import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChefHat, X, Timer, Pause } from 'lucide-react'
import { useCooking, formatDuration } from '../context/CookingSession'
import { imageUrl } from '../utils/imageUrl'

function TimerChip({ timer, onRemove }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, timer.durationSec - Math.floor((Date.now() - timer.startedAt) / 1000))
  )

  useEffect(() => {
    const iv = setInterval(() => {
      setRemaining(Math.max(0, timer.durationSec - Math.floor((Date.now() - timer.startedAt) / 1000)))
    }, 1000)
    return () => clearInterval(iv)
  }, [timer.startedAt, timer.durationSec])

  const pct = 100 - Math.min(100, (remaining / timer.durationSec) * 100)
  const isDone = remaining === 0
  const isUrgent = remaining > 0 && remaining < 30

  return (
    <div
      className={`relative shrink-0 flex items-center gap-2 px-3 py-2 rounded-2xl
                  shadow-sm border overflow-hidden
                  ${isDone
                    ? 'bg-sage-50 border-sage-300 text-sage-800 dark:bg-sage-900/40 dark:border-sage-700 dark:text-sage-200'
                    : isUrgent
                      ? 'bg-orange-50 border-orange-300 text-orange-800 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-200 animate-pulse'
                      : 'bg-white dark:bg-white/10 border-gray-200 dark:border-white/10'}`}
    >
      {/* progress fill */}
      <span
        className={`absolute inset-y-0 left-0 ${isDone ? 'bg-sage-200/60 dark:bg-sage-700/30' : 'bg-primary/15'} transition-all duration-1000`}
        style={{ width: `${pct}%` }}
      />
      <Timer size={14} className="relative shrink-0" strokeWidth={2.4} />
      <div className="relative leading-tight min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 truncate max-w-[110px]">
          {timer.label || 'Timer'}
        </p>
        <p className="text-sm font-bold tabular-nums">
          {isDone ? 'Klar!' : formatDuration(remaining)}
        </p>
      </div>
      <button
        onClick={() => onRemove(timer.id)}
        className="relative shrink-0 w-6 h-6 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"
        aria-label="Avbryt timer"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export default function CookingDock() {
  const { activeRecipe, timers, unpin, removeTimer } = useCooking()
  const location = useLocation()

  if (!activeRecipe && timers.length === 0) return null

  // On the public shared list view, don't show the dock
  if (location.pathname.startsWith('/shared/')) return null

  const onRecipePage = activeRecipe && location.pathname === `/recipes/${activeRecipe.id}`

  return (
    <div
      className="fixed left-0 right-0 z-30 px-3 md:px-6
                 bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] md:bottom-4
                 pointer-events-none"
    >
      <div className="max-w-3xl mx-auto pointer-events-auto">
        <div className="glass rounded-3xl shadow-lift border border-white/40 dark:border-white/10
                        flex items-stretch gap-3 p-2.5">
          {activeRecipe && (
            <>
              {activeRecipe.cover_image ? (
                <img
                  src={imageUrl(activeRecipe.cover_image, { thumb: true })}
                  alt=""
                  className="w-12 h-12 rounded-2xl object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-700
                                flex items-center justify-center shrink-0">
                  <ChefHat size={20} className="text-white" />
                </div>
              )}

              <Link
                to={`/recipes/${activeRecipe.id}`}
                className="flex-1 min-w-0 flex flex-col justify-center hover:opacity-80 transition"
              >
                <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">
                  Aktiv matlagning
                </span>
                <span className="font-semibold text-sm truncate">{activeRecipe.title}</span>
              </Link>

              <button
                onClick={unpin}
                className="shrink-0 w-10 h-10 rounded-2xl hover:bg-gray-100 dark:hover:bg-white/10
                           flex items-center justify-center transition-colors"
                aria-label="Avfäst recept"
                title="Avfäst"
              >
                <X size={18} />
              </button>
            </>
          )}

          {timers.length > 0 && (
            <div
              className={`flex items-center gap-2 overflow-x-auto scrollbar-hide
                          ${activeRecipe ? 'border-l border-gray-200 dark:border-white/10 pl-3' : 'flex-1'}`}
            >
              {timers.map((t) => (
                <TimerChip key={t.id} timer={t} onRemove={removeTimer} />
              ))}
            </div>
          )}
        </div>
        {onRecipePage && activeRecipe && (
          <p className="text-center text-[10px] text-gray-400 mt-1.5">
            🌗 Skärmen hålls vaken så länge du är här
          </p>
        )}
      </div>
    </div>
  )
}
