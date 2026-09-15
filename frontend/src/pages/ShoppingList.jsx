import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Trash2, Copy, ShoppingBag, Filter, Share2, Link as LinkIcon, PenLine, X } from 'lucide-react'
import { useShoppingList } from '../hooks/useShoppingList'
import { getRecipes, createShareLink, revokeShareLink } from '../api'
import GroupedShoppingList from '../components/GroupedShoppingList'

export default function ShoppingList() {
  const [searchParams] = useSearchParams()
  const { lists, loading, generate, save, update, remove } = useShoppingList()
  const [recipes, setRecipes] = useState([])
  const [selectedRecipes, setSelectedRecipes] = useState([])
  const [activeList, setActiveList] = useState(null)
  const [showGenerator, setShowGenerator] = useState(false)
  const [hideInStock, setHideInStock] = useState(false)
  const [sharedTokens, setSharedTokens] = useState({})
  const [manualInput, setManualInput] = useState('')
  const [savedInputs, setSavedInputs] = useState({})  // per-lista inputvärden
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [confirmClearId, setConfirmClearId] = useState(null)
  const manualRef = useRef(null)

  useEffect(() => {
    getRecipes().then(setRecipes)
    const recipeIds = searchParams.getAll('recipe').map(Number).filter(Boolean)
    if (recipeIds.length) {
      setSelectedRecipes(recipeIds)
      setShowGenerator(true)
    }
  }, [])

  const handleGenerate = async () => {
    if (selectedRecipes.length === 0) return toast.error('Välj minst ett recept')
    try {
      const items = await generate(selectedRecipes)
      setActiveList({ name: 'Ny inköpslista', items })
      setShowGenerator(false)
      const inStockCount = items.filter((i) => i.available_at_home).length
      if (inStockCount > 0) {
        toast.success(`${inStockCount} ${inStockCount === 1 ? 'vara finns' : 'varor finns'} redan hemma`, { duration: 4000 })
      }
    } catch {
      toast.error('Kunde inte generera lista')
    }
  }

  const handleSave = async () => {
    if (!activeList) return
    await save(activeList.name, activeList.items)
    setActiveList(null)
  }

  const toggleActive = (index) => {
    if (!activeList) return
    const newItems = activeList.items.map((item, i) =>
      i === index ? { ...item, checked: !item.checked } : item
    )
    setActiveList({ ...activeList, items: newItems })
  }

  const toggleSavedItem = async (list, index) => {
    const items = JSON.parse(list.items)
    items[index].checked = !items[index].checked
    await update(list.id, { items: JSON.stringify(items) })
  }

  // Parsar "2 dl mjölk" → {amount:"2", unit:"dl", name:"mjölk"}
  const parseManualItem = (text) => {
    const t = text.trim()
    if (!t) return null
    const m = t.match(/^([\d.,/]+)\s*([a-zA-ZåäöÅÄÖ.]+)?\s+(.+)$/)
    if (m) {
      const unit = m[2] && m[2].length <= 5 ? m[2] : ''
      const name = unit ? m[3] : (m[2] ? m[2] + ' ' + m[3] : m[3])
      return { amount: m[1], unit, name: name.trim(), checked: false, recipe_id: null, category: 'Övrigt' }
    }
    return { amount: '', unit: '', name: t, checked: false, recipe_id: null, category: 'Övrigt' }
  }

  const addManualItemToActive = () => {
    const item = parseManualItem(manualInput)
    if (!item) return
    setActiveList(prev => ({ ...prev, items: [...prev.items, item] }))
    setManualInput('')
    manualRef.current?.focus()
  }

  const addItemToSaved = async (list, items, text) => {
    const item = parseManualItem(text)
    if (!item) return
    await update(list.id, { items: JSON.stringify([...items, item]) })
    setSavedInputs(prev => ({ ...prev, [list.id]: '' }))
  }

  const removeFromActive = (index) => {
    setActiveList((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))
  }

  const editActiveItem = (index, text) => {
    const parsed = parseManualItem(text)
    if (!parsed) return
    setActiveList((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], ...parsed }
      return { ...prev, items }
    })
  }

  const editSavedItem = (list, items, index, text) => {
    const parsed = parseManualItem(text)
    if (!parsed) return
    const newItems = [...items]
    newItems[index] = { ...newItems[index], ...parsed }
    update(list.id, { items: JSON.stringify(newItems) })
  }

  const handleDeleteList = (id) => {
    if (confirmDeleteId === id) {
      remove(id)
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(id)
    }
  }

  const removeItemFromSaved = (list, items, index) => {
    const remaining = items.filter((_, i) => i !== index)
    update(list.id, { items: JSON.stringify(remaining) })
  }

  const clearChecked = async (list, items) => {
    const remaining = items.filter((i) => !i.checked)
    await update(list.id, { items: JSON.stringify(remaining) })
    toast.success('Avbockade varor borttagna')
  }

  const copyToClipboard = (items) => {
    const text = items
      .filter((i) => !i.checked && !i.available_at_home)
      .map((i) => `${i.amount ? i.amount + ' ' : ''}${i.unit ? i.unit + ' ' : ''}${i.name}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    toast.success('Kopierad till urklipp')
  }

  const shareList = async (list) => {
    try {
      const { token } = await createShareLink(list.id)
      const url = `${window.location.origin}/shared/list/${token}`
      await navigator.clipboard.writeText(url)
      setSharedTokens((prev) => ({ ...prev, [list.id]: token }))
      toast.success('Delningslänk kopierad! Skicka till partnern 📲', { duration: 4500 })
    } catch {
      toast.error('Kunde inte skapa delningslänk')
    }
  }

  const unshareList = async (list) => {
    try {
      await revokeShareLink(list.id)
      setSharedTokens((prev) => {
        const next = { ...prev }
        delete next[list.id]
        return next
      })
      toast.success('Delning återkallad')
    } catch {
      toast.error('Kunde inte återkalla')
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inköpslistor</h1>
          <p className="text-sm text-gray-500 mt-1">Smart kategoriserat per butikssektion</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveList({ name: 'Min lista', items: [] })}
            className="btn-ghost"
            title="Tom lista"
          >
            <PenLine size={18} />
          </button>
          <button onClick={() => setShowGenerator(!showGenerator)} className="btn-primary">
            <Plus size={18} strokeWidth={2.4} />
            Ny lista
          </button>
        </div>
      </div>

      {showGenerator && (
        <div className="surface-card p-5 space-y-4 animate-fade-in">
          <h2 className="font-semibold">Välj recept att handla för</h2>
          <div className="space-y-1 max-h-64 overflow-y-auto -mx-1">
            {recipes.map((r) => (
              <label key={r.id} className="list-row">
                <input
                  type="checkbox"
                  checked={selectedRecipes.includes(r.id)}
                  onChange={() =>
                    setSelectedRecipes((prev) =>
                      prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                    )
                  }
                  className="w-5 h-5 accent-primary"
                />
                <span className="font-medium">{r.title}</span>
                <span className="ml-auto text-xs text-gray-400">{r.servings} port.</span>
              </label>
            ))}
          </div>
          <button onClick={handleGenerate} className="btn-primary w-full">
            <ShoppingBag size={18} />
            Generera lista
          </button>
        </div>
      )}

      {activeList && (
        <div className="surface-card p-5 space-y-4 ring-2 ring-primary/20 animate-fade-in">
          <div className="flex items-center justify-between gap-3">
            <input
              value={activeList.name}
              onChange={(e) => setActiveList({ ...activeList, name: e.target.value })}
              className="font-semibold text-lg bg-transparent border-b-2 border-transparent
                         focus:border-primary focus:outline-none flex-1 min-w-0"
            />
            <div className="flex gap-2 shrink-0">
              <button onClick={() => copyToClipboard(activeList.items)} className="btn-ghost" title="Kopiera som text">
                <Copy size={16} />
              </button>
              <button onClick={handleSave} className="btn-primary">Spara</button>
            </div>
          </div>

          {activeList.items.some((i) => i.available_at_home) && (
            <button
              onClick={() => setHideInStock((v) => !v)}
              className="text-sm flex items-center gap-2 text-sage-700 dark:text-sage-300 font-medium"
            >
              <Filter size={14} />
              {hideInStock ? 'Visa allt' : 'Dölj varor som finns hemma'}
            </button>
          )}

          <GroupedShoppingList
            items={activeList.items}
            onToggle={toggleActive}
            onDelete={removeFromActive}
            onEdit={editActiveItem}
            onReorder={(newItems) => setActiveList((prev) => ({ ...prev, items: newItems }))}
            hideInStock={hideInStock}
          />

          <div className="flex gap-2 pt-1">
            <input
              ref={manualRef}
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addManualItemToActive()}
              placeholder="Lägg till vara, t.ex. 2 dl grädde..."
              className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10
                         bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button onClick={addManualItemToActive} className="btn-primary px-3">
              <Plus size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wider text-gray-400 px-1">Sparade listor</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 bg-gray-100 dark:bg-white/5 rounded-3xl animate-pulse" />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <p className="text-gray-400 text-sm px-1">Inga sparade listor ännu</p>
        ) : (
          lists.map((list) => {
            const items = (() => { try { return JSON.parse(list.items) } catch { return [] } })()
            const unchecked = items.filter((i) => !i.checked).length
            const checkedCount = items.filter((i) => i.checked).length
            const token = list.share_token || sharedTokens[list.id]
            const savedInput = savedInputs[list.id] || ''
            return (
              <div key={list.id} className="surface-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{list.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{unchecked} av {items.length} kvar</p>
                  </div>
                  <div className="flex gap-1">
                    {checkedCount > 0 && (
                      confirmClearId === list.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { clearChecked(list, items); setConfirmClearId(null) }}
                            className="btn-ghost px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            Rensa {checkedCount}
                          </button>
                          <button
                            onClick={() => setConfirmClearId(null)}
                            className="btn-ghost p-2 text-gray-400"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmClearId(list.id)}
                          className="btn-ghost p-2 text-gray-400 hover:text-red-500"
                          title={`Rensa ${checkedCount} avbockade`}
                        >
                          <X size={16} />
                        </button>
                      )
                    )}
                    {token ? (
                      <button
                        onClick={() => unshareList(list)}
                        className="btn-ghost p-2 text-sage-700 dark:text-sage-300"
                        title="Återkalla delning"
                      >
                        <LinkIcon size={16} />
                      </button>
                    ) : (
                      <button
                        onClick={() => shareList(list)}
                        className="btn-ghost p-2"
                        title="Dela lista"
                      >
                        <Share2 size={16} />
                      </button>
                    )}
                    <button onClick={() => copyToClipboard(items)} className="btn-ghost p-2" title="Kopiera som text">
                      <Copy size={16} />
                    </button>
                    {confirmDeleteId === list.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDeleteList(list.id)}
                          className="btn-ghost px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          Ja, radera
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="btn-ghost p-2 text-gray-400"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDeleteList(list.id)}
                        className="btn-ghost p-2 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Radera lista"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {token && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-2xl
                                  bg-sage-50 dark:bg-sage-900/20 text-[12px] text-sage-800 dark:text-sage-200">
                    <Share2 size={13} className="shrink-0" />
                    <span className="font-medium">Delas live · </span>
                    <span className="font-mono truncate flex-1">/shared/list/{token.slice(0, 8)}…</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/shared/list/${token}`)
                        toast.success('Länk kopierad')
                      }}
                      className="text-sage-700 dark:text-sage-300 hover:underline shrink-0"
                    >
                      Kopiera
                    </button>
                  </div>
                )}

                <GroupedShoppingList
                  items={items}
                  onToggle={(i) => toggleSavedItem(list, i)}
                  onDelete={(i) => removeItemFromSaved(list, items, i)}
                  onEdit={(i, text) => editSavedItem(list, items, i, text)}
                  onReorder={(newItems) => update(list.id, { items: JSON.stringify(newItems) })}
                  compact
                />

                {/* Lägg till vara i sparad lista */}
                <div className="flex gap-2 pt-1">
                  <input
                    value={savedInput}
                    onChange={e => setSavedInputs(prev => ({ ...prev, [list.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addItemToSaved(list, items, savedInput)}
                    placeholder="Lägg till vara..."
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10
                               bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => addItemToSaved(list, items, savedInput)}
                    disabled={!savedInput.trim()}
                    className="btn-primary px-3 disabled:opacity-40"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
