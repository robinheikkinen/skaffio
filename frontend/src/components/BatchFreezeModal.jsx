import { useState } from 'react'
import toast from 'react-hot-toast'
import { X, Snowflake, Refrigerator, Minus, Plus, Baby, User } from 'lucide-react'
import { createFreezerPortion } from '../api'

const LOCATIONS = [
  { key: 'Frys 1', icon: Snowflake },
  { key: 'Frys 2', icon: Snowflake },
  { key: 'Kyl 1',  icon: Refrigerator },
  { key: 'Kyl 2',  icon: Refrigerator },
]

export default function BatchFreezeModal({ open, onClose, recipe, defaultPortions = 3, onSaved }) {
  const [portions, setPortions] = useState(defaultPortions)
  const [portionType, setPortionType] = useState('child')
  const [location, setLocation] = useState('Frys 1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  if (!open || !recipe) return null

  const submit = async () => {
    setSaving(true)
    try {
      const result = await createFreezerPortion({
        recipe_id: recipe.id,
        portions,
        portion_type: portionType,
        location,
        notes: notes.trim() || null,
      })
      const haTag = result.ha_delivered ? ' · 📡 HA notifierad' : ''
      toast.success(`${portions} ${portionType === 'child' ? 'barnportioner' : 'portioner'} sparade i ${location}${haTag}`)
      onSaved?.(result)
      onClose()
    } catch {
      toast.error('Kunde inte spara i frysen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-card w-full sm:max-w-md p-5 space-y-5 rounded-t-3xl sm:rounded-3xl sm:rounded-b-3xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-300 to-sky-500 flex items-center justify-center shadow-sm">
              <Snowflake size={22} className="text-white" strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="font-bold text-lg leading-tight">Spara i frysen</h2>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{recipe.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost w-10 h-10 p-0"><X size={20} /></button>
        </div>

        {/* Portion type */}
        <div>
          <p className="label">Typ av portion</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'child', label: 'Barnportion', icon: Baby, hint: 'Liten, mild' },
              { key: 'adult', label: 'Vuxenportion', icon: User, hint: 'Full storlek' },
            ].map(({ key, label, icon: Icon, hint }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPortionType(key)}
                className={`flex flex-col items-start gap-1 p-3 rounded-2xl border-2 transition-all duration-200 ease-silky text-left ${
                  portionType === key
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 dark:border-white/10 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon size={16} strokeWidth={2.4} className={portionType === key ? 'text-primary' : 'text-gray-400'} />
                  <span className="font-semibold text-sm">{label}</span>
                </div>
                <span className="text-[11px] text-gray-500">{hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Portions stepper */}
        <div>
          <p className="label">Antal portioner</p>
          <div className="flex items-center justify-center gap-4 py-2">
            <button type="button" onClick={() => setPortions((p) => Math.max(1, p - 1))} className="stepper-btn">
              <Minus size={18} />
            </button>
            <div className="text-center min-w-[88px]">
              <p className="text-4xl font-bold tabular-nums">{portions}</p>
              <p className="text-[11px] uppercase tracking-wider text-gray-400 mt-0.5">
                {portionType === 'child' ? 'barnportioner' : 'portioner'}
              </p>
            </div>
            <button type="button" onClick={() => setPortions((p) => p + 1)} className="stepper-btn">
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* Location */}
        <div>
          <p className="label">Var sparas det?</p>
          <div className="grid grid-cols-4 gap-2">
            {LOCATIONS.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setLocation(key)}
                className={`flex flex-col items-center gap-1.5 py-2.5 rounded-2xl border-2 transition-all duration-200 ${
                  location === key
                    ? 'border-sage-600 bg-sage-50 dark:bg-sage-900/30 text-sage-800 dark:text-sage-200'
                    : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-gray-300'
                }`}
              >
                <Icon size={18} strokeWidth={2.2} />
                <span className="text-[11px] font-semibold">{key}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Anteckning (valfritt)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="t.ex. extra mild, utan lök..."
            className="input"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Avbryt</button>
          <button onClick={submit} disabled={saving} className="btn-sage flex-1">
            {saving ? 'Sparar...' : 'Spara i frysen'}
          </button>
        </div>
      </div>
    </div>
  )
}
