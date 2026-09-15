import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  Package, Plus, Trash2, Camera, Sparkles, Snowflake, Refrigerator,
  AlertTriangle, Check, X, Receipt, Wand2, Minus, ArrowLeftRight, ChefHat,
  Search, Pencil, Save,
} from 'lucide-react'
import { MascotBo } from '../components/Mascots'
import { useNavigate } from 'react-router-dom'
import {
  listPantry, addPantryItem, updatePantryItem, removePantryItem, bulkAddPantry,
  scanPantryPhoto, scanReceipt, importStaples, aiGenerateFromPantry, inventRecipe,
  createRecipe, aiSearchRecipes,
} from '../api'

const LOCATIONS = [
  { key: 'Skafferi',        icon: Package },
  { key: 'Kyl - kök',       icon: Refrigerator },
  { key: 'Frys - kök',      icon: Snowflake },
  { key: 'Kyl - teknikrum', icon: Refrigerator },
  { key: 'Frys - teknikrum', icon: Snowflake },
  { key: 'Frys - trappan',  icon: Snowflake },
  { key: 'Kryddhylla',      icon: Package },
]

export default function Pantry() {
  const [items, setItems] = useState([])
  const [filterLoc, setFilterLoc] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newItem, setNewItem] = useState({
    name: '', amount: '', unit: '', location: 'Skafferi', expiry_date: '', notes: '', is_staple: false,
  })
  const [scanFile, setScanFile] = useState(null)
  const [scanLocation, setScanLocation] = useState('Kyl - kök')
  const [scanResults, setScanResults] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanMode, setScanMode] = useState('fridge')  // 'fridge' | 'receipt'
  const [importingStaples, setImportingStaples] = useState(false)
  // Quick actions
  const [useTarget, setUseTarget] = useState(null)
  const [useAmount, setUseAmount] = useState('')
  const [useBusy, setUseBusy] = useState(false)
  const [moveTarget, setMoveTarget] = useState(null)
  // Inline editing
  const [editingItem, setEditingItem] = useState(null) // { id, field, value }
  const [editBusy, setEditBusy] = useState(false)
  // Rescue recipe search
  const [rescuing, setRescuing] = useState(null) // item name being rescued
  const [generating, setGenerating] = useState(false)
  // Hitta på recept
  const [inventMood, setInventMood] = useState('')
  const [inventing, setInventing] = useState(false)
  const [inventedRecipe, setInventedRecipe] = useState(null)
  const [savingInvented, setSavingInvented] = useState(false)
  const [generated, setGenerated] = useState(null)
  const [extraPrompt, setExtraPrompt] = useState('')  // pre-generate chat input
  const [refineMsg, setRefineMsg] = useState('')       // post-generate refinement
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      setItems(await listPantry())
    } catch (e) {
      toast.error(e.message || 'Kunde inte hämta pantry')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!newItem.name.trim()) return toast.error('Namn krävs')
    try {
      const payload = {
        ...newItem,
        amount: newItem.amount ? Number(newItem.amount) : null,
        unit: newItem.unit || null,
        expiry_date: newItem.expiry_date || null,
        notes: newItem.notes || null,
      }
      await addPantryItem(payload)
      toast.success(`${newItem.name} tillagd`)
      setNewItem({ name: '', amount: '', unit: '', location: newItem.location, expiry_date: '', notes: '', is_staple: false })
      setShowAdd(false)
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const handleRemove = async (it) => {
    if (!confirm(`Ta bort ${it.name}?`)) return
    try {
      await removePantryItem(it.id)
      toast.success('Borttaget')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const handleUse = async (e) => {
    e.preventDefault()
    setUseBusy(true)
    try {
      const used = parseFloat(useAmount)
      const remaining = Math.round(((useTarget.amount || 0) - used) * 100) / 100
      if (remaining <= 0) {
        await removePantryItem(useTarget.id)
        toast.success(`${useTarget.name} tömd och borttagen`)
      } else {
        await updatePantryItem(useTarget.id, { amount: remaining })
        toast.success(`${remaining} ${useTarget.unit || ''} kvar av ${useTarget.name}`)
      }
      setUseTarget(null)
      setUseAmount('')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setUseBusy(false) }
  }

  const handleMarkEmpty = async () => {
    setUseBusy(true)
    try {
      await removePantryItem(useTarget.id)
      toast.success(`${useTarget.name} tömd och borttagen`)
      setUseTarget(null)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setUseBusy(false) }
  }

  const handleMove = async (item, newLocation) => {
    try {
      await updatePantryItem(item.id, { location: newLocation })
      toast.success(`${item.name} → ${newLocation}`)
      setMoveTarget(null)
      load()
    } catch (e) { toast.error(e.message) }
  }

  const commitInlineEdit = async () => {
    if (!editingItem) return
    setEditBusy(true)
    try {
      let val
      if (editingItem.field === 'amount') {
        val = editingItem.value === '' ? null : parseFloat(editingItem.value)
      } else if (editingItem.field === 'location') {
        val = editingItem.value || 'Skafferi'
      } else {
        val = editingItem.value || null
      }
      await updatePantryItem(editingItem.id, { [editingItem.field]: val })
      setEditingItem(null)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setEditBusy(false) }
  }

  const handleRescue = async (item) => {
    setRescuing(item.name)
    setGenerating(true)
    setGenerated(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const hint = item.is_expired
      ? `Hitta ett recept som MÅSTE använda: ${item.name} (redan utgånget!)`
      : `Hitta ett recept som prioriterar att använda: ${item.name} (snart utgånget)`
    setExtraPrompt(hint)
    try {
      const r = await aiGenerateFromPantry(hint)
      setGenerated(r)
      toast.success(`AI hittade ett recept för att rädda ${item.name}! 🍳`)
    } catch (e) {
      toast.error(e.message || 'Misslyckades')
    } finally {
      setGenerating(false)
      setRescuing(null)
    }
  }

  const handleInvent = async () => {
    setInventing(true)
    setInventedRecipe(null)
    const toastId = toast.loading('AI hittar på ett recept från vad ni har hemma...')
    try {
      const res = await inventRecipe(inventMood)
      if (res.ok && res.recipe) {
        setInventedRecipe(res.recipe)
        toast.success('Recept hittat på! 🍳', { id: toastId })
      } else {
        toast.error('AI kunde inte hitta på ett recept', { id: toastId })
      }
    } catch (e) {
      toast.error(e.message || 'Misslyckades', { id: toastId })
    } finally { setInventing(false) }
  }

  const handleSaveInvented = async () => {
    if (!inventedRecipe) return
    setSavingInvented(true)
    try {
      const payload = {
        title: inventedRecipe.title,
        description: inventedRecipe.description || '',
        ingredients: JSON.stringify(inventedRecipe.ingredients || []),
        instructions: inventedRecipe.instructions || '',
        servings: inventedRecipe.servings || 4,
        prep_time: inventedRecipe.prep_time || null,
        cook_time: inventedRecipe.cook_time || null,
        notes: inventedRecipe.notes || '',
        source_type: 'manual',
        tag_ids: [],
      }
      const created = await createRecipe(payload)
      toast.success(`"${inventedRecipe.title}" sparat!`)
      setInventedRecipe(null)
      navigate(`/recipes/${created.id}`)
    } catch (e) {
      toast.error(e.message || 'Kunde inte spara')
    } finally { setSavingInvented(false) }
  }

  const handleScan = async () => {
    if (!scanFile) return toast.error('Välj en bild först')
    setScanning(true)
    const isReceipt = scanMode === 'receipt'
    const toastId = toast.loading(isReceipt ? 'AI läser av kvittot...' : 'AI analyserar bilden...')
    try {
      const res = isReceipt
        ? await scanReceipt(scanFile, scanLocation)
        : await scanPantryPhoto(scanFile, scanLocation)
      if (!res.ok) {
        toast.error(res.message || 'AI inte tillgänglig', { id: toastId })
        return
      }
      setScanResults(res.suggestions || [])
      const storeMsg = isReceipt && res.store ? ` (${res.store})` : ''
      toast.success(`AI hittade ${res.count} varor${storeMsg} — granska och spara`, { id: toastId })
    } catch (e) {
      toast.error(`Scan misslyckades: ${e.message}`, { id: toastId })
    } finally {
      setScanning(false)
    }
  }

  const acceptAllScan = async () => {
    if (!scanResults?.length) return
    try {
      const payload = scanResults.map((s) => ({
        name: s.name, amount: s.amount, unit: s.unit, location: s.location,
        ...(s.expiry_date != null ? { expiry_date: s.expiry_date } : {}),
      }))
      const res = await bulkAddPantry(payload)
      toast.success(`${res.created} varor sparade i pantry`)
      setScanResults(null)
      setScanFile(null)
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  const filtered = filterLoc === 'all'
    ? items
    : items.filter((i) => i.location === filterLoc)

  const expiringSoon = items.filter((i) => i.days_until_expiry !== null && i.days_until_expiry <= 3 && !i.is_expired)
  const expired = items.filter((i) => i.is_expired)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pantry</h1>
          <p className="text-sm text-gray-500 mt-1">{items.length} varor totalt</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {items.length > 0 && (
            <div className="flex items-center gap-2">
              <input
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !generating && (async () => {
                  setGenerating(true)
                  try { const r = await aiGenerateFromPantry(extraPrompt); setGenerated(r); setRefineMsg('') }
                  catch (e) { toast.error(e.message || 'Misslyckades') }
                  finally { setGenerating(false) }
                })()}
                placeholder="Vad vill du laga? t.ex. lövbiff, kyckling, vegetariskt..."
                className="input text-sm flex-1 min-w-0"
              />
              <button
                onClick={async () => {
                  setGenerating(true)
                  try { const r = await aiGenerateFromPantry(extraPrompt); setGenerated(r); setRefineMsg('') }
                  catch (e) { toast.error(e.message || 'Misslyckades') }
                  finally { setGenerating(false) }
                }}
                disabled={generating}
                className="btn-primary shrink-0"
                title="AI hittar på en helt ny rätt baserat på det du har hemma"
              >
                <Wand2 size={16} />
                {generating ? 'AI tänker...' : 'Hitta på en rätt'}
              </button>
            </div>
          )}
          {items.length > 0 && (
            <button
              onClick={handleInvent}
              disabled={inventing}
              className="btn-secondary"
              title="AI hittar på ett NYTT recept från vad ni har hemma — sparas direkt i receptsamlingen"
            >
              <ChefHat size={16} />
              {inventing ? 'AI lagar ihop...' : 'Nytt recept från pantry'}
            </button>
          )}
          {items.length === 0 && (
            <button
              onClick={async () => {
                if (!confirm('Importera ~37 svenska basvaror (pasta, ris, oljor, kryddor...) som "finns alltid hemma"?')) return
                setImportingStaples(true)
                try {
                  const res = await importStaples()
                  toast.success(`${res.created} basvaror tillagda${res.skipped.length ? ` (${res.skipped.length} fanns redan)` : ''}`)
                  load()
                } catch (e) {
                  toast.error(e.message || 'Misslyckades')
                } finally { setImportingStaples(false) }
              }}
              disabled={importingStaples}
              className="btn-secondary"
              title="Lägg till typiska svenska basvaror på en gång"
            >
              📦 {importingStaples ? 'Importerar...' : 'Importera standardskafferi'}
            </button>
          )}
          <label className="btn-secondary cursor-pointer" title="Foto av kyl/frys/skafferi — AI listar vad som finns">
            <Camera size={17} />
            Skanna kyl/frys
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { setScanMode('fridge'); setScanFile(e.target.files[0]) }}
            />
          </label>
          <label className="btn-secondary cursor-pointer" title="Foto av butikskvitto — AI fyller på allt du handlat">
            <Receipt size={17} />
            Skanna kvitto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { setScanMode('receipt'); setScanFile(e.target.files[0]) }}
            />
          </label>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
            <Plus size={18} strokeWidth={2.4} />
            Lägg till
          </button>
        </div>
      </div>

      {/* Ät upp först-banner */}
      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="surface-card p-4 border-l-4 border-amber-400 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">
                Ät upp snart!
                {expired.length > 0 && (
                  <span className="ml-2 text-rose-600">{expired.length} har gått ut</span>
                )}
                {expiringSoon.length > 0 && (
                  <span className="ml-2 text-amber-700">{expiringSoon.length} går ut inom 3 dagar</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {[...expired, ...expiringSoon].slice(0, 8).map((i) => (
                  <span key={i.id} className={`text-xs px-2 py-1 rounded-full
                    ${i.is_expired ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
                    {i.name} {i.days_until_expiry !== null && (
                      i.is_expired ? '(utgånget)' : `(${i.days_until_expiry}d)`
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI-genererat recept */}
      {generated && (
        <div className="surface-card p-5 ring-2 ring-primary/30 animate-fade-in space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-primary font-semibold uppercase tracking-wider flex items-center gap-1">
                <Wand2 size={11} /> AI-förslag
              </p>
              <h2 className="text-xl font-bold mt-1">{generated.title}</h2>
              {generated.description && <p className="text-sm text-gray-500 mt-1">{generated.description}</p>}
            </div>
            <button onClick={() => setGenerated(null)} className="btn-ghost p-2"><X size={16} /></button>
          </div>
          {generated.why && (
            <div className="text-xs text-sage-700 dark:text-sage-300 bg-sage-50 dark:bg-sage-950/30 p-2 rounded-lg">
              💡 {generated.why}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span>🍽 {generated.servings} port.</span>
            {generated.prep_time && <span>⏱ Förb: {generated.prep_time}m</span>}
            {generated.cook_time && <span>🔥 Tillagn: {generated.cook_time}m</span>}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-primary font-medium">Visa ingredienser + instruktioner</summary>
            <div className="mt-2 space-y-2">
              <p className="font-semibold">Ingredienser:</p>
              <ul className="text-sm space-y-0.5 ml-3">
                {(() => { try { return JSON.parse(generated.ingredients || '[]') } catch { return [] }})()
                  .map((i, idx) => <li key={idx}>• {i.amount} {i.unit} {i.name}</li>)}
              </ul>
              <p className="font-semibold mt-3">Instruktioner:</p>
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{generated.instructions}</p>
            </div>
          </details>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setGenerating(true)
                try {
                  const saved = await aiGenerateFromPantry(extraPrompt, true)
                  toast.success('Recept sparat!')
                  navigate(`/recipes/${saved.saved_id}`)
                } catch (e) { toast.error(e.message) } finally { setGenerating(false) }
              }}
              disabled={generating}
              className="btn-primary flex-1"
            >
              <Check size={16} /> Spara receptet
            </button>
            <button
              onClick={async () => {
                setGenerating(true)
                try {
                  const r = await aiGenerateFromPantry(extraPrompt)
                  setGenerated(r); setRefineMsg('')
                } catch (e) { toast.error(e.message) } finally { setGenerating(false) }
              }}
              disabled={generating}
              className="btn-secondary shrink-0"
              title="Försök igen — annat förslag"
            >
              <Wand2 size={14} /> Ny idé
            </button>
          </div>
          {/* Förfina-rad — chatt-stil */}
          <div className="flex gap-2 items-center border-t border-gray-100 dark:border-white/10 pt-3">
            <input
              value={refineMsg}
              onChange={(e) => setRefineMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !generating && refineMsg.trim() && (async () => {
                const combined = [extraPrompt, refineMsg].filter(Boolean).join('. ')
                setExtraPrompt(combined)
                setGenerating(true)
                try { const r = await aiGenerateFromPantry(combined); setGenerated(r); setRefineMsg('') }
                catch (err) { toast.error(err.message) }
                finally { setGenerating(false) }
              })()}
              placeholder="Förfina: t.ex. 'lägg till pasta', 'kortare tid', 'inga lökar'..."
              className="input text-sm flex-1"
            />
            <button
              disabled={generating || !refineMsg.trim()}
              onClick={async () => {
                const combined = [extraPrompt, refineMsg].filter(Boolean).join('. ')
                setExtraPrompt(combined)
                setGenerating(true)
                try { const r = await aiGenerateFromPantry(combined); setGenerated(r); setRefineMsg('') }
                catch (err) { toast.error(err.message) }
                finally { setGenerating(false) }
              }}
              className="btn-secondary shrink-0 disabled:opacity-40"
            >
              Förfina
            </button>
          </div>
        </div>
      )}

      {/* Scan-fil + resultat */}
      {scanFile && !scanResults && (
        <div className="surface-card p-4 space-y-3 animate-fade-in">
          <p className="font-semibold flex items-center gap-2">
            <Sparkles size={17} className="text-primary" />
            {scanMode === 'receipt' ? 'Läs av kvitto' : 'Analysera kyl/frys-foto'} — {scanFile.name}?
          </p>
          <div className="flex gap-2">
            <select value={scanLocation} onChange={(e) => setScanLocation(e.target.value)} className="input flex-1">
              {LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.key}</option>)}
            </select>
            <button onClick={() => setScanFile(null)} className="btn-secondary">Avbryt</button>
            <button onClick={handleScan} disabled={scanning} className="btn-primary">
              {scanning ? 'Analyserar...' : 'Skanna'}
            </button>
          </div>
        </div>
      )}

      {scanResults && (
        <div className="surface-card p-4 space-y-3 ring-2 ring-primary/30 animate-fade-in">
          <p className="font-semibold">AI föreslog {scanResults.length} varor:</p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {scanResults.map((s, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{s.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {s.amount} {s.unit} · {s.location} · {Math.round(s.confidence * 100)}% säker
                    {s.expiry_date ? ` · bäst före ${s.expiry_guessed ? '~' : ''}${s.expiry_date}` : ''}
                  </p>
                </div>
                <button onClick={() => setScanResults(scanResults.filter((_, idx) => idx !== i))}
                        className="btn-ghost p-1 text-rose-500">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setScanResults(null); setScanFile(null) }} className="btn-secondary flex-1">
              Avbryt
            </button>
            <button onClick={acceptAllScan} className="btn-primary flex-1">
              <Check size={16} />
              Spara alla ({scanResults.length})
            </button>
          </div>
        </div>
      )}

      {/* Lägg-till-form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="surface-card p-5 space-y-3 animate-fade-in">
          <h2 className="font-semibold">Lägg till vara</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Namn</label>
              <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                     className="input" required autoFocus placeholder="t.ex. Mjölk, Kycklingfärs, Pasta" />
            </div>
            <div>
              <label className="label">Mängd</label>
              <input type="number" step="0.1" value={newItem.amount}
                     onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Enhet</label>
              <input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                     className="input" placeholder="dl, g, st, l" />
            </div>
            <div>
              <label className="label">Plats</label>
              <select value={newItem.location} onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
                      className="input">
                {LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.key}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Bäst före (valfritt)</label>
              <input type="date" value={newItem.expiry_date}
                     onChange={(e) => setNewItem({ ...newItem, expiry_date: e.target.value })} className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={newItem.is_staple}
                  onChange={(e) => setNewItem({ ...newItem, is_staple: e.target.checked })}
                  className="w-4 h-4 accent-primary"
                />
                <span>📌 Basvara — finns alltid hemma (utgångsdatum behövs sällan)</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary flex-1">Avbryt</button>
            <button type="submit" className="btn-primary flex-1">Spara</button>
          </div>
        </form>
      )}

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterLoc('all')}
                className={`chip ${filterLoc === 'all' ? 'chip-peach' : 'bg-gray-100 text-gray-600'}`}>
          Alla ({items.length})
        </button>
        {LOCATIONS.map((l) => {
          const count = items.filter((i) => i.location === l.key).length
          if (count === 0) return null
          return (
            <button key={l.key} onClick={() => setFilterLoc(l.key)}
                    className={`chip ${filterLoc === l.key ? 'chip-mint' : 'bg-gray-100 text-gray-600'}`}>
              <l.icon size={11} strokeWidth={2.4} /> {l.key} ({count})
            </button>
          )
        })}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-8 text-gray-400">Laddar...</div>
      ) : filtered.length === 0 ? (
        <div className="surface-card p-10 flex flex-col items-center text-center gap-4 text-gray-400">
          <MascotBo size={140} animation="bob" />
          <div>
            <p className="font-medium text-gray-500">Dags att fylla på!</p>
            <p className="text-sm mt-1">Lägg till varor manuellt eller skanna en bild av kylen</p>
          </div>
        </div>
      ) : (
        <div className="surface-card divide-y divide-gray-100 dark:divide-white/5">
          {filtered.map((i) => {
            const isExpired = i.is_expired
            const isUrgent = !isExpired && i.days_until_expiry !== null && i.days_until_expiry <= 3 && !i.is_staple
            const rowCls = isExpired
              ? 'bg-rose-50/60 dark:bg-rose-950/20'
              : isUrgent ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''
            const isEditingAmount = editingItem?.id === i.id && editingItem?.field === 'amount'
            const isEditingExpiry = editingItem?.id === i.id && editingItem?.field === 'expiry_date'
            const isEditingLocation = editingItem?.id === i.id && editingItem?.field === 'location'

            return (
              <div key={i.id} className={`px-4 py-3 flex items-center gap-3 ${rowCls}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {i.name}
                    {i.is_staple && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sage-100 dark:bg-sage-950/40 text-sage-700 dark:text-sage-300 font-medium">
                        📌 bas
                      </span>
                    )}
                    {isExpired && <span className="text-[10px] font-bold text-rose-600 px-1.5 py-0.5 rounded-full bg-rose-100">UTGÅNGET</span>}
                    {isUrgent && <span className="text-[10px] font-bold text-amber-700 px-1.5 py-0.5 rounded-full bg-amber-100">{i.days_until_expiry}d kvar</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {/* Inline amount edit */}
                    {isEditingAmount ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          type="number"
                          step="0.1"
                          value={editingItem.value}
                          onChange={(e) => setEditingItem((prev) => ({ ...prev, value: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitInlineEdit(); if (e.key === 'Escape') setEditingItem(null) }}
                          className="input py-0 px-1.5 text-xs w-20 h-6"
                        />
                        <span className="text-xs text-gray-400">{i.unit || ''}</span>
                        <button onClick={commitInlineEdit} disabled={editBusy} className="p-0.5 text-primary"><Save size={12} /></button>
                        <button onClick={() => setEditingItem(null)} className="p-0.5 text-gray-400"><X size={12} /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingItem({ id: i.id, field: 'amount', value: i.amount ?? '' })}
                        className="text-xs text-gray-500 hover:text-primary flex items-center gap-0.5"
                        title="Redigera mängd"
                      >
                        {i.amount ? `${i.amount} ${i.unit || ''}` : <span className="text-gray-400 italic">mängd?</span>}
                        <Pencil size={10} className="opacity-0 group-hover:opacity-100" />
                      </button>
                    )}
                    {isEditingLocation ? (
                      <div className="flex items-center gap-1">
                        <select
                          autoFocus
                          value={editingItem.value}
                          onChange={(e) => setEditingItem((prev) => ({ ...prev, value: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Escape') setEditingItem(null) }}
                          className="input py-0 px-1.5 text-xs h-6 w-36"
                        >
                          {LOCATIONS.map((l) => <option key={l.key} value={l.key}>{l.key}</option>)}
                        </select>
                        <button onClick={commitInlineEdit} disabled={editBusy} className="p-0.5 text-primary"><Save size={12} /></button>
                        <button onClick={() => setEditingItem(null)} className="p-0.5 text-gray-400"><X size={12} /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingItem({ id: i.id, field: 'location', value: i.location })}
                        className="text-xs text-gray-400 hover:text-blue-500"
                        title="Flytta till annan plats"
                      >
                        · {i.location}
                      </button>
                    )}
                    {/* Inline expiry edit */}
                    {!i.is_staple && (
                      isEditingExpiry ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="date"
                            value={editingItem.value}
                            onChange={(e) => setEditingItem((prev) => ({ ...prev, value: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitInlineEdit(); if (e.key === 'Escape') setEditingItem(null) }}
                            className="input py-0 px-1.5 text-xs h-6"
                          />
                          <button onClick={commitInlineEdit} disabled={editBusy} className="p-0.5 text-primary"><Save size={12} /></button>
                          <button onClick={() => setEditingItem(null)} className="p-0.5 text-gray-400"><X size={12} /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingItem({ id: i.id, field: 'expiry_date', value: i.expiry_date || '' })}
                          className={`text-xs flex items-center gap-0.5 hover:text-primary ${isExpired ? 'text-rose-600 font-semibold' : isUrgent ? 'text-amber-700' : 'text-gray-400'}`}
                          title="Redigera bäst-före-datum"
                        >
                          {i.expiry_date
                            ? (isExpired ? `Utgånget ${i.expiry_date}` : `Bäst före ${i.expiry_date}`)
                            : <span className="italic opacity-60">+ bäst före</span>}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Rädda-knapp vid utgångna/snart utgångna */}
                {(isExpired || isUrgent) && (
                  <button
                    onClick={() => handleRescue(i)}
                    className="btn-ghost p-2 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    title="Hitta recept som använder denna vara"
                  >
                    <Search size={14} />
                  </button>
                )}

                {/* Flytta */}
                {moveTarget === i.id ? (
                  <select
                    autoFocus
                    className="input text-xs py-1 px-2 w-36"
                    value={i.location}
                    onChange={(e) => handleMove(i, e.target.value)}
                    onBlur={() => setMoveTarget(null)}
                  >
                    {LOCATIONS.map((l) => (
                      <option key={l.key} value={l.key}>{l.key}</option>
                    ))}
                  </select>
                ) : (
                  <button
                    onClick={() => setMoveTarget(i.id)}
                    className="btn-ghost p-2 text-gray-400 hover:text-blue-500"
                    title="Flytta till annan plats"
                  >
                    <ArrowLeftRight size={14} />
                  </button>
                )}
                {/* Använd/minska */}
                <button
                  onClick={() => { setUseTarget(i); setUseAmount('') }}
                  className="btn-ghost p-2 text-gray-400 hover:text-amber-500"
                  title="Använde — minska mängd eller ta bort"
                >
                  <Minus size={14} />
                </button>
                <button
                  onClick={async () => {
                    try {
                      await updatePantryItem(i.id, { is_staple: !i.is_staple })
                      load()
                    } catch (e) { toast.error(e.message) }
                  }}
                  title={i.is_staple ? 'Sluta räkna som basvara' : 'Markera som basvara (finns alltid hemma)'}
                  className="btn-ghost p-2 text-gray-400 hover:text-sage-600"
                >
                  📌
                </button>
                <button onClick={() => handleRemove(i)} className="btn-ghost p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {/* Använd-modal */}
      {useTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setUseTarget(null)}>
          <form
            onSubmit={handleUse}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold flex items-center gap-2">
              <Minus size={18} className="text-amber-500" />
              Använde av {useTarget.name}
            </h2>
            {useTarget.amount ? (
              <>
                <p className="text-sm text-gray-500">
                  Finns: <strong>{useTarget.amount} {useTarget.unit || ''}</strong>
                </p>
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    type="number"
                    step="0.1"
                    min="0.1"
                    placeholder={`Använde hur mycket? (max ${useTarget.amount})`}
                    value={useAmount}
                    onChange={(e) => setUseAmount(e.target.value)}
                    className="input flex-1"
                  />
                  <span className="text-sm text-gray-500 shrink-0">{useTarget.unit || ''}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Ingen mängd registrerad — markera som tömd?</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setUseTarget(null)} className="btn-secondary flex-1">Avbryt</button>
              {useTarget.amount && (
                <button type="submit" disabled={useBusy || !useAmount} className="btn-primary flex-1">
                  {useBusy ? 'Sparar...' : 'Dra av'}
                </button>
              )}
              <button
                type="button"
                onClick={handleMarkEmpty}
                disabled={useBusy}
                className="flex-1 rounded-xl border border-rose-200 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 py-2 text-sm font-medium"
              >
                Tömd
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Påhittat recept-modal */}
      {inventedRecipe && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => setInventedRecipe(null)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg my-4 flex flex-col max-h-[calc(100dvh-2rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-sage-500 to-sage-700 p-5 text-white shrink-0 rounded-t-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider opacity-75 mb-1 flex items-center gap-1">
                    <ChefHat size={12} /> AI hittade på
                  </p>
                  <h2 className="text-xl font-bold">{inventedRecipe.title}</h2>
                  {inventedRecipe.description && (
                    <p className="text-sm opacity-85 mt-1">{inventedRecipe.description}</p>
                  )}
                </div>
                <button onClick={() => setInventedRecipe(null)} className="p-1 rounded-full hover:bg-white/20">
                  <X size={20} />
                </button>
              </div>
              <div className="flex gap-4 mt-3 text-sm opacity-80">
                {inventedRecipe.prep_time && <span>⏱ Förbered: {inventedRecipe.prep_time} min</span>}
                {inventedRecipe.cook_time && <span>🍳 Laga: {inventedRecipe.cook_time} min</span>}
                {inventedRecipe.servings && <span>👥 {inventedRecipe.servings} portioner</span>}
              </div>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Ingredienser */}
              {inventedRecipe.ingredients?.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Ingredienser</h3>
                  <ul className="space-y-1">
                    {inventedRecipe.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-gray-400">·</span>
                        <span>
                          {ing.amount && <strong>{ing.amount} {ing.unit} </strong>}
                          {ing.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Instruktioner */}
              {inventedRecipe.instructions && (
                <div>
                  <h3 className="font-semibold mb-2">Instruktioner</h3>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">
                    {inventedRecipe.instructions}
                  </p>
                </div>
              )}

              {/* Tips */}
              {inventedRecipe.notes && (
                <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl p-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200">💡 {inventedRecipe.notes}</p>
                </div>
              )}
            </div>

            {/* Knappar */}
            <div className="p-4 border-t border-gray-100 dark:border-white/5 flex gap-2 shrink-0">
              <button onClick={() => setInventedRecipe(null)} className="btn-secondary flex-1">
                Stäng
              </button>
              <button onClick={handleInvent} disabled={inventing} className="btn-secondary flex-1">
                <Wand2 size={14} /> {inventing ? 'Nytt...' : 'Annan idé'}
              </button>
              <button onClick={handleSaveInvented} disabled={savingInvented} className="btn-primary flex-1">
                <ChefHat size={14} /> {savingInvented ? 'Sparar...' : 'Spara recept'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
