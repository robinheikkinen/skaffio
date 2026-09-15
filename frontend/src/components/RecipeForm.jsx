import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { Plus, Minus, Upload, Link, FileText, Sparkles, Image as ImageIcon, Camera } from 'lucide-react'
import { createRecipe, bulkCreateRecipes, updateRecipe, getTags, createTag, uploadImages, importFromURL, uploadPDF, aiExtractFromImage } from '../api'
import { useAuth } from '../context/AuthContext'

const EMPTY_INGREDIENT = { name: '', amount: '', unit: '' }

function IngredientsEditor({ ingredients, setIngredients }) {
  const add = () => setIngredients((prev) => [...prev, { ...EMPTY_INGREDIENT }])
  const remove = (i) => setIngredients((prev) => prev.filter((_, idx) => idx !== i))
  const update = (i, field, val) =>
    setIngredients((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)))

  return (
    <div className="space-y-2">
      {ingredients.map((ing, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={ing.amount}
            onChange={(e) => update(i, 'amount', e.target.value)}
            placeholder="Mängd"
            className="w-20 input"
          />
          <input
            value={ing.unit}
            onChange={(e) => update(i, 'unit', e.target.value)}
            placeholder="Enhet"
            className="w-24 input"
          />
          <input
            value={ing.name}
            onChange={(e) => update(i, 'name', e.target.value)}
            placeholder="Ingrediens"
            className="flex-1 input"
          />
          <button type="button" onClick={() => remove(i)} className="p-2 text-red-400 hover:text-red-600">
            <Minus size={16} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1 text-sm text-primary hover:underline">
        <Plus size={16} /> Lägg till ingrediens
      </button>
    </div>
  )
}

function TagSelector({ selectedIds, onChange, allTags, onTagsChange }) {
  const [newTagName, setNewTagName] = useState('')

  const toggle = (id) =>
    onChange((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

  const addTag = async () => {
    if (!newTagName.trim()) return
    try {
      const tag = await createTag({ name: newTagName.trim(), color: '#6B7280' })
      onTagsChange((prev) => [...prev, tag])
      onChange((prev) => [...prev, tag.id])
      setNewTagName('')
    } catch {
      toast.error('Kunde inte skapa tagg')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {allTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id)}
            className={`px-3 py-1 rounded-full text-sm border-2 transition-colors ${
              selectedIds.includes(tag.id)
                ? 'text-white border-transparent'
                : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
            }`}
            style={selectedIds.includes(tag.id) ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
          >
            {tag.name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
          placeholder="Ny tagg..."
          className="flex-1 input text-sm"
        />
        <button type="button" onClick={addTag} className="btn-primary text-sm px-3">
          Skapa
        </button>
      </div>
    </div>
  )
}

export default function RecipeForm({ initialData = null }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('url') ? 'url' : 'manual')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)   // pågående avbrytbar operation (URL/PDF/bild)
  const abortRef = useRef(null)

  // Avbryter vilken pågående import/analys som helst.
  const cancelOp = () => abortRef.current?.abort()
  const [allTags, setAllTags] = useState([])
  const [urlInput, setUrlInput] = useState(searchParams.get('url') || '')
  const [form, setForm] = useState({
    title: '',
    description: '',
    ingredients: [{ ...EMPTY_INGREDIENT }],
    instructions: '',
    servings: 4,
    prep_time: '',
    cook_time: '',
    source_url: '',
    source_type: 'manual',
    cover_image: '',
    tag_ids: [],
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    visibility: 'private',
  })
  const [showNutrition, setShowNutrition] = useState(false)
  const [pdfRecipes, setPdfRecipes] = useState([])      // alla extraherade från senaste PDF
  const [pdfPickedIdx, setPdfPickedIdx] = useState(0)
  const [pdfSelected, setPdfSelected] = useState(new Set())  // index för bulk-save
  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)

  useEffect(() => {
    getTags().then(setAllTags).catch(() => {})
    if (initialData) {
      let ingredients
      try { ingredients = JSON.parse(initialData.ingredients || '[]') } catch { ingredients = [] }
      setForm({
        ...initialData,
        ingredients: ingredients.length ? ingredients : [{ ...EMPTY_INGREDIENT }],
        tag_ids: (initialData.tags || []).map((t) => t.id),
        prep_time: initialData.prep_time || '',
        cook_time: initialData.cook_time || '',
        calories: initialData.calories ?? '',
        protein: initialData.protein ?? '',
        carbs: initialData.carbs ?? '',
        fat: initialData.fat ?? '',
        visibility: initialData.visibility || 'private',
      })
      if (initialData.calories || initialData.protein) setShowNutrition(true)
      if (initialData.cover_image) setCoverPreview(`/uploads/thumb_${initialData.cover_image.replace(/\.[^.]+$/, '.jpg')}`)
    }
  }, [])

  // Auto-import om ?url= finns (från bookmarklet)
  useEffect(() => {
    const u = searchParams.get('url')
    if (u && !initialData) {
      // Trigger en gång — ge React tid att rendera urlInput
      setTimeout(() => importURL(), 100)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { getRootProps, getInputProps } = useDropzone({
    accept: { 'image/*': [] },
    multiple: false,
    onDrop: ([file]) => {
      setCoverFile(file)
      setCoverPreview(URL.createObjectURL(file))
    },
  })

  const set = (field, val) => setForm((prev) => ({ ...prev, [field]: val }))

  const importURL = async () => {
    if (!urlInput) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setLoading(true)
    try {
      const data = await importFromURL(urlInput, { signal: controller.signal })
      let ingredients
      try { ingredients = JSON.parse(data.ingredients || '[]') } catch { ingredients = [] }

      // Auto-applicera AI:s tag-förslag (matchar mot befintliga tags + skapar nya)
      let newTagIds = []
      if (Array.isArray(data.suggested_tags) && data.suggested_tags.length) {
        const existingTags = await getTags()
        const existingByName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))
        for (const tagName of data.suggested_tags) {
          const normalized = String(tagName).trim().toLowerCase()
          if (!normalized) continue
          const existing = existingByName.get(normalized)
          if (existing) {
            newTagIds.push(existing.id)
          } else {
            // Skapa ny tag
            try {
              const created = await createTag({ name: normalized, color: '#6B7280' })
              newTagIds.push(created.id)
            } catch { /* skip duplicates */ }
          }
        }
      }

      setForm((prev) => ({
        ...prev,
        title: data.title || prev.title,
        description: data.description || prev.description,
        ingredients: ingredients.length ? ingredients : prev.ingredients,
        instructions: data.instructions || prev.instructions,
        source_url: data.source_url || urlInput,
        source_type: 'url',
        servings: data.servings || prev.servings,
        prep_time: data.prep_time ?? prev.prep_time,
        cook_time: data.cook_time ?? prev.cook_time,
        tag_ids: newTagIds.length ? [...new Set([...prev.tag_ids, ...newTagIds])] : prev.tag_ids,
      }))
      // Preview cover from URL if present (saved as remote URL string for now)
      if (data.cover_image && !coverFile) {
        setCoverPreview(data.cover_image)
        setForm((prev) => ({ ...prev, cover_image: data.cover_image }))
      }
      const tagsMsg = newTagIds.length ? ` (+${newTagIds.length} taggar)` : ''
      toast.success(data.title ? `"${data.title}" importerat${tagsMsg}` : 'Recept importerat')
    } catch (e) {
      if (e.name === 'AbortError') toast('Import avbruten', { icon: '✋' })
      else toast.error('Kunde inte importera från URL')
    } finally {
      setBusy(false)
      setLoading(false)
      abortRef.current = null
    }
  }

  const analyzeImage = async (file, { onlyTitle = false } = {}) => {
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setLoading(true)
    const toastId = toast.loading(onlyTitle ? 'AI letar efter receptnamn...' : 'AI analyserar bilden...')
    try {
      const data = await aiExtractFromImage(file, { onlyTitle, signal: controller.signal })
      if (!data.ok) {
        toast.error(data.message || 'AI-analysen misslyckades', { id: toastId })
        return
      }
      let ingredients = []
      try { ingredients = JSON.parse(data.ingredients || '[]') } catch {}
      setForm((prev) => ({
        ...prev,
        title: data.title || prev.title,
        description: data.description || prev.description,
        ingredients: ingredients.length ? ingredients : prev.ingredients,
        instructions: data.instructions || prev.instructions,
        servings: data.servings || prev.servings,
        source_type: 'image',
      }))
      const conf = data.confidence ? ` (${Math.round(data.confidence * 100)}% säkerhet)` : ''
      toast.success(data.title ? `"${data.title}" hittat${conf}` : 'Bild analyserad', { id: toastId })
    } catch (e) {
      if (e.name === 'AbortError') {
        toast('Analys avbruten', { id: toastId, icon: '✋' })
      } else {
        toast.error('AI-analysen misslyckades', { id: toastId })
      }
    } finally {
      setBusy(false)
      setLoading(false)
      abortRef.current = null
    }
  }

  const toggleSelected = (idx) => {
    setPdfSelected((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  const selectAllPdf = () => setPdfSelected(new Set(pdfRecipes.map((_, i) => i)))
  const selectNonePdf = () => setPdfSelected(new Set())

  const saveSelectedPdfRecipes = async () => {
    const items = [...pdfSelected]
      .sort((a, b) => a - b)
      .map((i) => pdfRecipes[i])
      .filter(Boolean)
    if (items.length === 0) return toast.error('Inga recept valda')

    const toastId = toast.loading(`Sparar ${items.length} recept...`)
    setLoading(true)
    try {
      const payloads = items.map((r) => {
        const ings = Array.isArray(r.ingredients) ? r.ingredients : []
        return {
          title: r.title || '(utan titel)',
          description: r.description || '',
          ingredients: JSON.stringify(ings),
          instructions: r.instructions || '',
          servings: r.servings || 1,
          prep_time: r.prep_time ?? null,
          cook_time: r.cook_time ?? null,
          source_type: 'pdf',
          cover_image: r.cover_image || null,
          calories: r.calories ?? null,
          protein: r.protein ?? null,
          carbs: r.carbs ?? null,
          fat: r.fat ?? null,
          tag_ids: [],
        }
      })
      const res = await bulkCreateRecipes(payloads)
      toast.success(`${res.created} recept skapade!`, { id: toastId, duration: 5000 })
      setPdfRecipes([])
      setPdfSelected(new Set())
      navigate('/')
    } catch (e) {
      toast.error(`Kunde inte spara: ${e.message || 'okänt fel'}`, { id: toastId, duration: 8000 })
    } finally {
      setLoading(false)
    }
  }

  const pickRecipeFromPdf = (recipe, idx) => {
    let ingredients = []
    if (Array.isArray(recipe.ingredients)) ingredients = recipe.ingredients
    setForm((prev) => ({
      ...prev,
      title: recipe.title || '',
      description: recipe.description || '',
      ingredients: ingredients.length ? ingredients : [{ ...EMPTY_INGREDIENT }],
      instructions: recipe.instructions || '',
      servings: recipe.servings || prev.servings,
      prep_time: recipe.prep_time ?? prev.prep_time,
      cook_time: recipe.cook_time ?? prev.cook_time,
      calories: recipe.calories ?? '',
      protein: recipe.protein ?? '',
      carbs: recipe.carbs ?? '',
      fat: recipe.fat ?? '',
      cover_image: recipe.cover_image || prev.cover_image || '',
      source_type: 'pdf',
    }))
    if (recipe.cover_image) {
      setCoverFile(null)
      setCoverPreview(`/uploads/${recipe.cover_image}`)
    }
    if (recipe.calories || recipe.protein) setShowNutrition(true)
    setPdfPickedIdx(idx)
  }

  const importPDF = async (file) => {
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setLoading(true)
    // Visa progress under hela uppladdningen (kan ta 30-90s när AI-vägen körs)
    const toastId = toast.loading(
      'Tolkar PDF... (kan ta upp till 90s om AI-extraktion används)',
      { duration: Infinity }
    )
    try {
      const data = await uploadPDF(file, { signal: controller.signal })
      const recipes = Array.isArray(data.extracted_recipes) ? data.extracted_recipes : []
      const method = data.extraction_stats?.method || (data.ai_status === 'ok' ? 'AI' : 'heuristik')

      if (recipes.length === 0) {
        toast.error(
          'Inga recept hittades. Kontrollera att PDF:en innehåller läsbar text (inte bara scannade bilder).',
          { id: toastId, duration: 8000 }
        )
        setPdfRecipes([])
        return
      }

      setPdfRecipes(recipes)
      setPdfSelected(new Set(recipes.map((_, i) => i)))   // alla förvalda
      pickRecipeFromPdf(recipes[0], 0)

      toast.success(
        `Hittade ${recipes.length} recept (${method}) — alla förvalda för "Spara alla"`,
        { id: toastId, duration: 6000 }
      )
    } catch (e) {
      if (e.name === 'AbortError') toast('PDF-tolkning avbruten', { id: toastId, icon: '✋' })
      else toast.error(`Kunde inte tolka PDF: ${e.message || 'okänt fel'}`, { id: toastId, duration: 8000 })
    } finally {
      setBusy(false)
      setLoading(false)
      abortRef.current = null
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('Titel krävs')
    setLoading(true)
    try {
      let cover_image = form.cover_image
      if (coverFile) {
        const uploaded = await uploadImages([coverFile])
        cover_image = uploaded[0]?.filename || ''
      }
      const payload = {
        ...form,
        ingredients: JSON.stringify(form.ingredients.filter((ing) => ing.name.trim())),
        prep_time: form.prep_time ? Number(form.prep_time) : null,
        cook_time: form.cook_time ? Number(form.cook_time) : null,
        calories: form.calories === '' ? null : Number(form.calories),
        protein: form.protein === '' ? null : Number(form.protein),
        carbs: form.carbs === '' ? null : Number(form.carbs),
        fat: form.fat === '' ? null : Number(form.fat),
        cover_image,
      }
      if (initialData?.id) {
        await updateRecipe(initialData.id, payload)
        toast.success('Recept uppdaterat')
        navigate(`/recipes/${initialData.id}`)
      } else {
        const created = await createRecipe(payload)
        toast.success('Recept skapat!')
        navigate(`/recipes/${created.id}`)
      }
    } catch (err) {
      toast.error(err.message || 'Något gick fel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl mx-auto space-y-6">
      {busy && (
        <div className="sticky top-2 z-30 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl
                        bg-amber-50 border border-amber-200 shadow-sm">
          <span className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Bearbetar… (URL / PDF / bild)
          </span>
          <button
            type="button"
            onClick={cancelOp}
            className="px-3 py-1.5 rounded-xl text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
          >
            Avbryt
          </button>
        </div>
      )}
      {!initialData && (
        <div className="flex gap-2 flex-wrap pb-2 border-b border-gray-200 dark:border-white/10">
          {[
            { key: 'manual', label: 'Manuell', icon: null },
            { key: 'url',    label: 'Från URL', icon: Link },
            { key: 'pdf',    label: 'Från PDF', icon: FileText },
            { key: 'image',  label: 'Från bild', icon: Camera, ai: true },
          ].map(({ key, label, icon: Icon, ai }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium transition-all duration-200 ${
                tab === key
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
              }`}
            >
              {Icon && <Icon size={15} />}
              {label}
              {ai && (
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full
                                  ${tab === key ? 'bg-white/25' : 'bg-primary/15 text-primary'}`}>
                  AI
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === 'url' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://..."
              className="flex-1 input"
            />
            <button type="button" onClick={importURL} disabled={loading} className="btn-primary">
              Importera
            </button>
          </div>
          {/* Bookmarklet — drag-and-drop till bokmärkesraden */}
          <details className="text-xs text-gray-500 surface rounded-xl p-3">
            <summary className="cursor-pointer font-medium text-primary hover:underline">
              💡 Tips: Bookmarklet för snabbare import
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Dra länken nedan till din webbläsares bokmärkesrad. Sen kan du klicka på den
                från VILKEN receptsida som helst → öppnar Skaffio och importerar automatiskt.
              </p>
              <a
                href={`javascript:(function(){window.open('${window.location.origin}/add?url='+encodeURIComponent(location.href),'_blank');})();`}
                onClick={(e) => { e.preventDefault(); toast('Dra länken till bokmärkesraden istället!') }}
                className="inline-block px-3 py-2 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-primary-600"
                draggable
              >
                📌 Importera till Skaffio
              </a>
              <p className="text-[11px] text-gray-400 italic">
                (Klick gör inget — dra länken med musen till bokmärkesraden.)
              </p>
            </div>
          </details>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="space-y-3">
          <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-gray-300 dark:border-white/10 rounded-2xl cursor-pointer hover:border-primary transition-colors">
            <FileText size={32} className="text-gray-400" />
            <span className="text-sm text-gray-500">Klicka för att välja PDF</span>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => e.target.files[0] && importPDF(e.target.files[0])}
            />
          </label>

          {pdfRecipes.length > 0 && (
            <div className="surface rounded-2xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-sm font-semibold">
                  {pdfRecipes.length} recept hittade · {pdfSelected.size} valda
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={selectAllPdf}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200"
                  >
                    Välj alla
                  </button>
                  <button
                    type="button"
                    onClick={selectNonePdf}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200"
                  >
                    Avmarkera
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPdfRecipes([]); setPdfSelected(new Set()); setPdfPickedIdx(0) }}
                    className="text-xs px-2 py-1 rounded-lg text-gray-400 hover:text-red-500"
                  >
                    Rensa
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1">
                {pdfRecipes.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2 py-2 rounded-xl border transition-colors ${
                      i === pdfPickedIdx
                        ? 'border-primary bg-primary/5'
                        : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={pdfSelected.has(i)}
                      onChange={() => toggleSelected(i)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 accent-primary shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => pickRecipeFromPdf(r, i)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="font-medium text-sm line-clamp-1">{r.title || '(utan titel)'}</p>
                      <p className="text-[11px] text-gray-400">
                        {(r.ingredients?.length || 0)} ing.
                        {r.servings ? ` · ${r.servings} port.` : ''}
                        {r.calories ? ` · ${r.calories} kcal` : ''}
                        {r.cover_image ? ` · 📸` : ''}
                      </p>
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveSelectedPdfRecipes}
                  disabled={loading || pdfSelected.size === 0}
                  className="btn-primary flex-1 disabled:opacity-40"
                >
                  💾 Spara {pdfSelected.size} {pdfSelected.size === 1 ? 'recept' : 'recept'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 px-1">
                Klicka ett kort för att se/redigera detaljer i formuläret nedan, eller spara alla valda i ett svep.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'image' && (
        <label className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-primary/40 rounded-3xl
                          cursor-pointer hover:border-primary hover:bg-primary/5
                          transition-all duration-200 bg-gradient-to-br from-primary/5 to-pastel-peach/20">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center">
            <Sparkles size={28} className="text-primary" strokeWidth={2.2} />
          </div>
          <div className="text-center">
            <p className="font-semibold">Ta eller välj en bild</p>
            <p className="text-sm text-gray-500 mt-1">
              AI-kocken känner igen rätten och fyller i namn, beskrivning och ingredienser.
            </p>
            <p className="text-[11px] text-gray-400 mt-2">Funkar bäst med tydliga bilder eller foton av kokboksidor</p>
          </div>
          {busy && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); cancelOp() }}
              className="mt-1 px-4 py-2 rounded-xl text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
            >
              Avbryt analys
            </button>
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files[0]
              if (!f) return
              setCoverFile(f)
              setCoverPreview(URL.createObjectURL(f))
              analyzeImage(f)
            }}
          />
        </label>
      )}

      <div className="space-y-4">
        <div>
          <label className="label">Titel *</label>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} className="input" required />
        </div>

        <div>
          <label className="label">Beskrivning</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            className="input"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Portioner</label>
            <input
              type="number"
              min={1}
              value={form.servings}
              onChange={(e) => set('servings', Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label className="label">Förberedelse (min)</label>
            <input
              type="number"
              min={0}
              value={form.prep_time}
              onChange={(e) => set('prep_time', e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Tillagningstid (min)</label>
            <input
              type="number"
              min={0}
              value={form.cook_time}
              onChange={(e) => set('cook_time', e.target.value)}
              className="input"
            />
          </div>
        </div>

        {/* Näringsvärden — valfritt, kollapsbart */}
        <div className="surface rounded-2xl p-4 -mt-2">
          <button
            type="button"
            onClick={() => setShowNutrition((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            <span>Näringsvärden per portion (valfritt)</span>
            <span className="text-gray-400 text-xs">
              {showNutrition ? 'Dölj –' : 'Visa +'}
            </span>
          </button>
          {showNutrition && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div>
                <label className="label text-[11px]">Kalorier (kcal)</label>
                <input type="number" min={0} value={form.calories} onChange={(e) => set('calories', e.target.value)} className="input" />
              </div>
              <div>
                <label className="label text-[11px]">Protein (g)</label>
                <input type="number" min={0} step="0.1" value={form.protein} onChange={(e) => set('protein', e.target.value)} className="input" />
              </div>
              <div>
                <label className="label text-[11px]">Kolhydrater (g)</label>
                <input type="number" min={0} step="0.1" value={form.carbs} onChange={(e) => set('carbs', e.target.value)} className="input" />
              </div>
              <div>
                <label className="label text-[11px]">Fett (g)</label>
                <input type="number" min={0} step="0.1" value={form.fat} onChange={(e) => set('fat', e.target.value)} className="input" />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="label">Ingredienser</label>
          <IngredientsEditor
            ingredients={form.ingredients}
            setIngredients={(val) => set('ingredients', typeof val === 'function' ? val(form.ingredients) : val)}
          />
        </div>

        <div>
          <label className="label">Instruktioner (Markdown)</label>
          <textarea
            value={form.instructions}
            onChange={(e) => set('instructions', e.target.value)}
            rows={8}
            className="input font-mono text-sm"
            placeholder="1. Börja med att..."
          />
        </div>

        <div>
          <label className="label">Taggar</label>
          <TagSelector
            selectedIds={form.tag_ids}
            onChange={(val) => set('tag_ids', typeof val === 'function' ? val(form.tag_ids) : val)}
            allTags={allTags}
            onTagsChange={setAllTags}
          />
        </div>

        <div>
          <label className="label">Omslagsbild</label>
          <div
            {...getRootProps()}
            className="border-2 border-dashed border-gray-300 dark:border-white/10 rounded-2xl p-6 text-center cursor-pointer hover:border-primary transition-colors"
          >
            <input {...getInputProps()} />
            {coverPreview ? (
              <img src={coverPreview} alt="Preview" className="max-h-44 mx-auto rounded-xl object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <Upload size={28} />
                <span className="text-sm">Dra och släpp eller klicka för att välja bild</span>
              </div>
            )}
          </div>
          {coverFile && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); analyzeImage(coverFile, { onlyTitle: !form.title }) }}
              disabled={loading}
              className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline disabled:opacity-50"
            >
              <Sparkles size={14} strokeWidth={2.4} />
              {form.title ? 'Analysera bild med AI' : 'AI: Hitta receptnamn från bilden'}
            </button>
          )}
        </div>

        {form.source_url && (
          <div>
            <label className="label">Källänk</label>
            <input value={form.source_url} onChange={(e) => set('source_url', e.target.value)} className="input" />
          </div>
        )}
      </div>

      {/* Synlighet — bara admin får ändra (backend spärrar övriga med 403) */}
      <div className="flex items-center justify-between surface-card px-4 py-3">
        <div>
          <p className="text-sm font-medium">Synlighet</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {!isAdmin
              ? 'Bara admin kan ändra synlighet'
              : form.visibility === 'private' ? 'Privat — bara ditt hushåll ser receptet' : 'Publik — alla inloggade ser det (men kan inte redigera)'}
          </p>
        </div>
        <button
          type="button"
          disabled={!isAdmin}
          onClick={() => set('visibility', form.visibility === 'private' ? 'public' : 'private')}
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                      ${form.visibility === 'public' ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.visibility === 'public' ? 'translate-x-6' : ''}`} />
        </button>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => navigate(-1)} className="btn-secondary flex-1">
          Avbryt
        </button>
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? 'Sparar...' : initialData ? 'Uppdatera recept' : 'Skapa recept'}
        </button>
      </div>
    </form>
  )
}
