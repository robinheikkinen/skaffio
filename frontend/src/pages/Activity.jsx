import { useEffect, useState, useMemo } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { sv } from 'date-fns/locale'
import {
  Activity as ActivityIcon, RefreshCw, ChefHat, ShoppingCart, Calendar,
  Tag as TagIcon, Snowflake, Sparkles, User as UserIcon, Image as ImageIcon,
  Share2, LogIn, UserPlus, Edit3, Trash2,
} from 'lucide-react'
import { getAuditLog } from '../api'
import { useAuth } from '../context/AuthContext'

const ACTION_META = {
  'recipe.create':       { Icon: ChefHat,     label: 'skapade recept',      tint: 'text-primary' },
  'recipe.update':       { Icon: Edit3,       label: 'uppdaterade recept',  tint: 'text-primary' },
  'recipe.delete':       { Icon: Trash2,      label: 'raderade recept',     tint: 'text-rose-600' },
  'shopping.generate':   { Icon: ShoppingCart,label: 'genererade inköpslista', tint: 'text-sage-700' },
  'shopping.create':     { Icon: ShoppingCart,label: 'sparade inköpslista', tint: 'text-sage-700' },
  'shopping.update':     { Icon: ShoppingCart,label: 'uppdaterade lista',   tint: 'text-sage-700' },
  'shopping.delete':     { Icon: Trash2,      label: 'raderade lista',      tint: 'text-rose-600' },
  'shopping.share':      { Icon: Share2,      label: 'delade lista',        tint: 'text-sky-700' },
  'shopping.unshare':    { Icon: Share2,      label: 'återkallade delning', tint: 'text-gray-500' },
  'shopping.share_toggle': { Icon: ShoppingCart, label: 'bockade i delad lista', tint: 'text-sky-700' },
  'mealplan.add':        { Icon: Calendar,    label: 'planerade måltid',    tint: 'text-primary' },
  'mealplan.update':     { Icon: Calendar,    label: 'flyttade måltid',     tint: 'text-primary' },
  'mealplan.delete':     { Icon: Calendar,    label: 'tog bort måltid',     tint: 'text-rose-600' },
  'tag.create':          { Icon: TagIcon,     label: 'skapade tagg',        tint: 'text-amber-700' },
  'tag.update':          { Icon: TagIcon,     label: 'uppdaterade tagg',    tint: 'text-amber-700' },
  'tag.delete':          { Icon: TagIcon,     label: 'raderade tagg',       tint: 'text-rose-600' },
  'freezer.add':         { Icon: Snowflake,   label: 'frös portioner',      tint: 'text-sky-600' },
  'freezer.update':      { Icon: Snowflake,   label: 'uppdaterade frys',    tint: 'text-sky-600' },
  'freezer.consume':     { Icon: Snowflake,   label: 'åt upp portion',      tint: 'text-sky-600' },
  'image.upload':        { Icon: ImageIcon,   label: 'laddade upp bild',    tint: 'text-violet-600' },
  'image.delete':        { Icon: Trash2,      label: 'raderade bild',       tint: 'text-rose-600' },
  'ai.plan_preview':     { Icon: Sparkles,    label: 'frågade AI-kocken',   tint: 'text-primary' },
  'ai.plan_commit':      { Icon: Sparkles,    label: 'sparade AI-plan',     tint: 'text-primary' },
  'user.login':          { Icon: LogIn,       label: 'loggade in',          tint: 'text-gray-500' },
  'user.register':       { Icon: UserPlus,    label: 'registrerade konto',  tint: 'text-sage-700' },
  'user.create':         { Icon: UserPlus,    label: 'skapade användare',   tint: 'text-sage-700' },
  'user.update':         { Icon: UserIcon,    label: 'uppdaterade användare', tint: 'text-gray-500' },
  'user.delete':         { Icon: Trash2,      label: 'raderade användare',  tint: 'text-rose-600' },
}

function detailText(entry) {
  if (!entry.details) return ''
  try {
    const d = JSON.parse(entry.details)
    if (d.title) return d.title
    if (d.name)  return d.name
    if (d.label) return d.label
    if (d.entries) return `${d.entries} måltider`
    if (d.items) return `${d.items} varor`
    if (d.count) return `${d.count} st`
    if (d.recipe_id) return `Recept #${d.recipe_id}`
    if (d.fields?.length) return `Fält: ${d.fields.join(', ')}`
    return ''
  } catch {
    return ''
  }
}

export default function Activity() {
  const { user } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const data = await getAuditLog(200)
      setEntries(data)
    } catch {
      // Audit-fel — visa bara tom lista
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  // Gruppera per dag
  const grouped = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      const day = format(new Date(e.created_at), 'yyyy-MM-dd')
      if (!m.has(day)) m.set(day, [])
      m.get(day).push(e)
    }
    return [...m.entries()]
  }, [entries])

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ActivityIcon size={24} strokeWidth={2.4} />
            Aktivitet
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {user?.role === 'admin'
              ? 'Vem i familjen gjorde vad — admin-vy'
              : 'Din aktivitet i Skaffio'}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="btn-ghost p-2.5"
          title="Uppdatera"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="surface-card p-10 text-center text-gray-400">
          <ActivityIcon size={36} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">Inget loggat ännu.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, dayEntries]) => (
            <section key={day}>
              <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 px-1 mb-2">
                {format(new Date(day), 'EEEE d MMMM', { locale: sv })}
              </h2>
              <ul className="space-y-1.5">
                {dayEntries.map((e) => {
                  const meta = ACTION_META[e.action] || {
                    Icon: ActivityIcon, label: e.action, tint: 'text-gray-500',
                  }
                  const detail = detailText(e)
                  return (
                    <li key={e.id} className="surface-card px-4 py-3 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center shrink-0 ${meta.tint}`}>
                        <meta.Icon size={16} strokeWidth={2.4} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] leading-tight">
                          <span className="font-semibold">
                            {e.user_name || (e.action === 'shopping.share_toggle' ? 'Gäst' : 'Okänd')}
                          </span>{' '}
                          <span className="text-gray-500">{meta.label}</span>
                          {detail && (
                            <>
                              {' '}
                              <span className="text-gray-700 dark:text-gray-200 font-medium">— {detail}</span>
                            </>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {format(new Date(e.created_at), 'HH:mm')} ·{' '}
                          {formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: sv })}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
