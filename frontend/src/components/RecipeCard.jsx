import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Users, Heart, Sparkles, Globe, Lock } from 'lucide-react'
import TagBadge from './TagBadge'
import { imageUrl, thumbFallback } from '../utils/imageUrl'
import { addFavorite, removeFavorite, updateRecipe } from '../api'
import { useAuth } from '../context/AuthContext'

const INITIALS_BG = [
  '#f6f0eb', '#ebf0f0', '#ece8f0', '#f0ebe8', '#e8f0eb',
]

/**
 * Toddler-tag helpers — these layer on top of normal user tags and
 * highlight family-friendly attributes.
 */
function ToddlerSignals({ recipe }) {
  const totalTime = (recipe.prep_time || 0) + (recipe.cook_time || 0)
  const signals = []

  if (totalTime > 0 && totalTime <= 20) {
    signals.push({ key: 'quick', label: 'Under 20 min', cls: 'chip-mint', Icon: Clock })
  }
  // Convention: tag with the literal name "Barnvänlig" or "4.5-åringen"
  // marks a kid-approved recipe.
  const kidTag = (recipe.tags || []).find((t) =>
    /barn|åringen|toddler|kid/i.test(t.name || '')
  )
  if (kidTag) {
    signals.push({ key: 'kid', label: 'Gillas av 4.5-åringen', cls: 'chip-peach', Icon: Heart })
  }
  // Source-type signal for AI-imported recipes
  if (recipe.source_type === 'url' || recipe.source_type === 'pdf') {
    signals.push({ key: 'src', label: recipe.source_type.toUpperCase(), cls: 'chip-sky', Icon: Sparkles })
  }

  if (!signals.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2.5">
      {signals.map(({ key, label, cls, Icon }) => (
        <span key={key} className={`chip ${cls}`}>
          <Icon size={11} strokeWidth={2.4} />
          {label}
        </span>
      ))}
    </div>
  )
}

export default function RecipeCard({ recipe, onFavoriteChange, priority = false }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const placeholderBg = INITIALS_BG[recipe.id % INITIALS_BG.length]
  const totalTime = (recipe.prep_time || 0) + (recipe.cook_time || 0)
  const visibleTags = (recipe.tags || [])
    .filter((t) => !/barn|åringen|toddler|kid/i.test(t.name || ''))
    .slice(0, 3)

  const [isFav, setIsFav] = useState(!!recipe.is_favorite)
  const [favBusy, setFavBusy] = useState(false)
  const [visibility, setVisibility] = useState(recipe.visibility || 'private')
  const [visBusy, setVisBusy] = useState(false)
  useEffect(() => { setVisibility(recipe.visibility || 'private') }, [recipe.visibility])

  const toggleFavorite = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (favBusy) return
    setFavBusy(true)
    const next = !isFav
    setIsFav(next)
    try {
      if (next) await addFavorite(recipe.id)
      else await removeFavorite(recipe.id)
      onFavoriteChange?.(recipe.id, next)
    } catch {
      setIsFav(!next) // rollback
    } finally {
      setFavBusy(false)
    }
  }

  const toggleVisibility = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (visBusy) return
    setVisBusy(true)
    const next = visibility === 'public' ? 'private' : 'public'
    setVisibility(next)
    try {
      await updateRecipe(recipe.id, { visibility: next })
    } catch {
      setVisibility(visibility) // rollback
    } finally {
      setVisBusy(false)
    }
  }

  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="group bg-[var(--panel,#fff)] rounded-2xl overflow-hidden w-full h-full
                 border border-[var(--line,#ececea)] dark:border-[var(--line,#2a2f3a)]
                 hover:-translate-y-[3px] active:scale-[0.99]
                 transition-all duration-200 ease-silky
                 flex flex-col"
      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 18px 40px -22px rgba(0,0,0,0.35)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'}
    >
      <div className="aspect-[4/3] relative overflow-hidden">
        {recipe.cover_image ? (
          <img
            src={imageUrl(recipe.cover_image, { thumb: true })}
            onError={thumbFallback(recipe.cover_image)}
            alt={recipe.title}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            className="w-full h-full object-cover group-hover:scale-[1.04]
                       transition-transform duration-500 ease-silky"
          />
        ) : null}
        {!recipe.cover_image && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 select-none"
            style={{ background: placeholderBg }}
          >
            <span style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '54px', fontWeight: 700, color: 'rgba(100,85,75,0.25)', lineHeight: 1 }}>
              {recipe.title.charAt(0).toUpperCase()}
            </span>
            <span className="text-[9.5px] font-semibold tracking-[.18em] uppercase text-[rgba(100,85,75,0.35)] px-4 text-center line-clamp-1">
              {recipe.title}
            </span>
          </div>
        )}
        {/* Top-right: visibility toggle (admin only, ej importerade — upphovsrätt) + time chip */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {isAdmin && !recipe.source_url && (
            <button
              onClick={toggleVisibility}
              disabled={visBusy}
              title={visibility === 'public' ? 'Delat — klicka för att dölja' : 'Privat — klicka för att dela'}
              className={`glass w-7 h-7 rounded-full flex items-center justify-center shadow-sm
                          transition-all duration-200 active:scale-90
                          ${visibility === 'public' ? 'text-emerald-500' : 'text-white/70 hover:text-white'}`}
            >
              {visibility === 'public'
                ? <Globe size={13} strokeWidth={2.4} />
                : <Lock size={13} strokeWidth={2.4} />}
            </button>
          )}
          {totalTime > 0 && (
            <div className="glass px-2.5 py-1 rounded-full
                            text-[11px] font-semibold flex items-center gap-1
                            text-gray-800 dark:text-gray-100 shadow-sm">
              <Clock size={11} strokeWidth={2.6} />
              {totalTime}m
            </div>
          )}
        </div>
        {/* Top-left favorite toggle */}
        <button
          onClick={toggleFavorite}
          disabled={favBusy}
          className={`absolute top-3 left-3 glass w-8 h-8 rounded-full
                      flex items-center justify-center shadow-sm
                      transition-all duration-200 active:scale-90
                      ${isFav
                        ? 'text-rose-500'
                        : 'text-white/80 hover:text-rose-400'}`}
          aria-label={isFav ? 'Ta bort favorit' : 'Lägg till favorit'}
        >
          <Heart size={16} strokeWidth={2.4} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <h3 className="font-semibold text-[15px] tracking-[-0.01em] text-gray-900 dark:text-gray-100 line-clamp-1 mb-2">
          {recipe.title}
        </h3>
        {recipe.description && (
          <p className="text-[13px] text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
            {recipe.description}
          </p>
        )}

        <ToddlerSignals recipe={recipe} />

        {/* Trafikljus: hur mycket av ingredienserna har du hemma? */}
        {recipe.pantry_match && recipe.pantry_match.total > 0 && (() => {
          const pct = recipe.pantry_match.available / recipe.pantry_match.total
          const cls = pct >= 0.8
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : pct >= 0.4
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold mb-1.5 ${cls}`}>
              🥕 {recipe.pantry_match.available}/{recipe.pantry_match.total} hemma
            </span>
          )
        })()}

        {/* Rating-stjärnor om satta */}
        {recipe.rating && (
          <div className="flex gap-0.5 mb-1.5 text-amber-400 text-[12px]">
            {'★'.repeat(recipe.rating)}{'☆'.repeat(5 - recipe.rating)}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">
            <Users size={13} strokeWidth={2.4} />
            <span className="font-medium">{recipe.servings}</span>
            <span>portioner</span>
          </div>
          {visibleTags.length > 0 && (
            <div className="flex gap-1">
              {visibleTags.slice(0, 2).map((tag) => <TagBadge key={tag.id} tag={tag} />)}
              {visibleTags.length > 2 && (
                <span className="text-[11px] text-gray-400 self-center">+{visibleTags.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
