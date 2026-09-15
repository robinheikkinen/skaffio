import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Inbox as InboxIcon, Check, X, Eye, Clock, AlertCircle, RefreshCw,
  ChevronDown, ChevronUp, ExternalLink, Plus, Loader2,
} from 'lucide-react'
import { getInbox, approveInboxItem, deleteInboxItem, updateInboxItem, queueInboxUrl } from '../api'
import { imageUrl } from '../utils/imageUrl'

const STATUS_LABEL = {
  pending:    { label: 'Väntar',       color: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300' },
  processing: { label: 'Bearbetar...',  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300', pulse: true },
  review:     { label: 'Granska',       color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  approved:   { label: 'Godkänd',       color: 'bg-sage-100 dark:bg-sage-900/30 text-sage-700 dark:text-sage-300' },
  rejected:   { label: 'Avvisad',       color: 'bg-red-100 dark:bg-red-900/30 text-red-500' },
  error:      { label: 'Fel',           color: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
}

function StatusBadge({ status }) {
  const s = STATUS_LABEL[status] || STATUS_LABEL.pending
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.color}`}>
      {s.pulse && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
      {s.label}
    </span>
  )
}

function InboxCard({ item, onApprove, onDelete, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [approving, setApproving] = useState(false)
  const [makePublic, setMakePublic] = useState(false)
  const navigate = useNavigate()

  let ingredients = []
  try { ingredients = JSON.parse(item.ingredients || '[]') } catch {}

  const handleApprove = async () => {
    setApproving(true)
    try {
      const res = await onApprove(item.id, makePublic ? 'public' : 'private')
      toast.success(`"${res.title}" tillagd i biblioteket!`)
      navigate(`/recipes/${res.recipe_id}`)
    } catch (e) {
      toast.error(e.message || 'Kunde inte godkänna')
      setApproving(false)
    }
  }

  const isReviewable = item.status === 'review' || item.status === 'error'
  const isActive = item.status === 'pending' || item.status === 'processing'

  return (
    <div className={`surface-card p-4 space-y-3 ${item.status === 'review' ? 'ring-2 ring-amber-400/40' : ''}`}>
      <div className="flex gap-3">
        {item.cover_image ? (
          <img
            src={imageUrl(item.cover_image)}
            alt={item.title}
            className="w-16 h-16 rounded-xl object-cover shrink-0 bg-gray-100 dark:bg-white/10"
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-white/10 shrink-0 flex items-center justify-center">
            <InboxIcon size={22} className="text-gray-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-[15px] leading-snug line-clamp-2">
                {item.title || <span className="text-gray-400 italic">Bearbetas...</span>}
              </p>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-gray-400 hover:text-primary flex items-center gap-0.5 mt-0.5 truncate max-w-[200px]"
              >
                <ExternalLink size={10} />
                {new URL(item.url).hostname}
              </a>
            </div>
            <StatusBadge status={item.status} />
          </div>
          {isActive && (
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" />
              AI bearbetar...
            </p>
          )}
          {item.status === 'error' && item.error_message && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
              <AlertCircle size={11} />
              {item.error_message}
            </p>
          )}
          {item.status === 'review' && (
            <p className="text-xs text-gray-500 mt-1">
              {ingredients.length} ingredienser
              {item.servings ? ` · ${item.servings} port.` : ''}
              {item.prep_time ? ` · ${item.prep_time} min` : ''}
            </p>
          )}
        </div>
      </div>

      {/* Förhandsgranska ingredienser + instruktioner */}
      {item.status === 'review' && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Dölj detaljer' : 'Förhandsgranska recept'}
          </button>
          {expanded && (
            <div className="space-y-3 text-sm border-t border-gray-100 dark:border-white/10 pt-3">
              {ingredients.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Ingredienser</p>
                  <ul className="space-y-0.5">
                    {ingredients.slice(0, 10).map((ing, i) => (
                      <li key={i} className="text-xs text-gray-700 dark:text-gray-300">
                        {ing.amount && <span className="text-gray-400 mr-1">{ing.amount} {ing.unit}</span>}
                        {ing.name}
                      </li>
                    ))}
                    {ingredients.length > 10 && (
                      <li className="text-xs text-gray-400">+{ingredients.length - 10} till...</li>
                    )}
                  </ul>
                </div>
              )}
              {item.instructions && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Instruktioner</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-4 whitespace-pre-line">
                    {item.instructions}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Knappar */}
      {(isReviewable || item.status === 'approved') && (
        <div className="flex gap-2 flex-wrap">
          {item.status === 'approved' && item.approved_recipe_id && (
            <Link to={`/recipes/${item.approved_recipe_id}`} className="btn-secondary text-sm flex items-center gap-1.5">
              <Eye size={14} />
              Visa recept
            </Link>
          )}
          {isReviewable && (
            <>
              <div className="w-full">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setMakePublic(v => !v)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${makePublic ? 'bg-primary' : 'bg-gray-300 dark:bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${makePublic ? 'translate-x-4' : ''}`} />
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    Gör receptet publikt
                  </span>
                </label>
                <p className="text-[11px] text-gray-400 mt-0.5 ml-11">
                  Publika recept kan ses av alla användare, men kan endast redigeras av ditt hushåll.
                </p>
              </div>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Godkänn
              </button>
              <button
                onClick={() => onDelete(item.id)}
                className="btn-ghost text-sm text-red-500 flex items-center gap-1.5"
              >
                <X size={14} />
                Avvisa
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function Inbox() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [urlInput, setUrlInput] = useState('')
  const [queueing, setQueueing] = useState(false)
  const [filter, setFilter] = useState('active') // active | all | approved

  const load = useCallback(async () => {
    try {
      const statusMap = {
        active: null,  // handled client-side
        all: null,
        approved: 'approved',
      }
      const data = await getInbox(statusMap[filter])
      setItems(data)
    } catch (e) {
      toast.error('Kunde inte hämta inkorg')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // Pollning när det finns aktiva jobb
  useEffect(() => {
    const hasActive = items.some((i) => i.status === 'pending' || i.status === 'processing')
    if (!hasActive) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [items, load])

  const filteredItems = filter === 'active'
    ? items.filter((i) => i.status !== 'approved' && i.status !== 'rejected')
    : items

  const reviewCount = items.filter((i) => i.status === 'review').length

  const handleQueueUrl = async () => {
    const url = urlInput.trim()
    if (!url) return
    setQueueing(true)
    try {
      await queueInboxUrl(url)
      setUrlInput('')
      toast.success('URL köad för import!')
      load()
    } catch (e) {
      toast.error(e.message || 'Kunde inte köa URL')
    } finally {
      setQueueing(false)
    }
  }

  const handleApprove = async (id) => {
    const res = await approveInboxItem(id)
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status: 'approved', approved_recipe_id: res.recipe_id } : i))
    return res
  }

  const handleDelete = async (id) => {
    try {
      await deleteInboxItem(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      toast.success('Borttagen från inkorg')
    } catch (e) {
      toast.error(e.message)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <InboxIcon size={28} className="text-primary" />
            Inkorg
            {reviewCount > 0 && (
              <span className="text-[13px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">
                {reviewCount}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Importerade recept som väntar på granskning
          </p>
        </div>
        <button onClick={load} className="btn-ghost p-2" title="Uppdatera">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Manuell URL-inmatning */}
      <div className="surface-card p-4 space-y-3">
        <p className="text-sm font-semibold">Importera från URL</p>
        <div className="flex gap-2">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQueueUrl()}
            placeholder="https://recept.nu/lasagne..."
            className="input flex-1 text-sm"
            type="url"
          />
          <button
            onClick={handleQueueUrl}
            disabled={queueing || !urlInput.trim()}
            className="btn-primary px-4"
          >
            {queueing ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          </button>
        </div>
      </div>

      {/* Filter-tabs */}
      <div className="flex gap-1 surface rounded-2xl p-1">
        {[
          { key: 'active', label: 'Aktiva' },
          { key: 'all', label: 'Alla' },
          { key: 'approved', label: 'Godkända' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === key
                ? 'bg-white dark:bg-white/10 shadow-sm text-primary'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-white/5 rounded-3xl animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <InboxIcon size={40} className="mx-auto text-gray-300 dark:text-white/20" />
          <p className="text-gray-400">Inkorgen är tom</p>
          <p className="text-xs text-gray-400">
            Dela ett recept från din mobils webbläsare — välj Skaffio i delningsmenyn
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <InboxCard
              key={item.id}
              item={item}
              onApprove={handleApprove}
              onDelete={handleDelete}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}
