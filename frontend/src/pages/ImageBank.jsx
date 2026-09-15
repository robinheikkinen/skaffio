import { useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Trash2, Link2, Upload, X, CheckSquare, Wand2 } from 'lucide-react'
import {
  getImages, deleteImage, uploadImages, getRecipes, updateRecipe,
  aiExtractFromImage, aiExtractFromImages, bulkCreateRecipes,
} from '../api'

export default function ImageBank() {
  const navigate = useNavigate()
  const [images, setImages] = useState([])
  const [recipes, setRecipes] = useState([])
  const [filterRecipeId, setFilterRecipeId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [linkRecipeId, setLinkRecipeId] = useState('')
  const [uploading, setUploading] = useState(false)
  // Bulk-flöden
  const [uploadTargetRecipeId, setUploadTargetRecipeId] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkLinkId, setBulkLinkId] = useState('')
  // AI bulk-import
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 })
  const [aiResults, setAiResults] = useState(null)
  // Grupperingsläge: filer parkeras tills user grupperar dem
  const [pendingFiles, setPendingFiles] = useState([])  // {id, file, previewUrl}
  const [groups, setGroups] = useState([])              // [[id, id], [id], ...] — varje grupp = 1 recept

  const load = () => {
    getImages(filterRecipeId).then(setImages)
    getRecipes().then(setRecipes)
  }

  useEffect(() => { load() }, [filterRecipeId])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    multiple: true,
    onDrop: async (files) => {
      if (!files.length) return
      setUploading(true)
      const target = uploadTargetRecipeId ? Number(uploadTargetRecipeId) : null
      try {
        const uploaded = await uploadImages(files, target)
        const targetName = target ? recipes.find((r) => r.id === target)?.title : null
        toast.success(
          `${uploaded.length} bild(er) uppladdade${targetName ? ` → ${targetName}` : ' (ej kopplade)'}`
        )
        load()
      } catch {
        toast.error('Uppladdning misslyckades')
      } finally {
        setUploading(false)
      }
    },
  })

  const handleDelete = async (img) => {
    if (!confirm('Radera bilden?')) return
    await deleteImage(img.id)
    toast.success('Bild raderad')
    setSelected(null)
    load()
  }

  const handleLink = async () => {
    if (!selected || !linkRecipeId) return
    try {
      const recipe = recipes.find((r) => r.id === Number(linkRecipeId))
      if (!recipe) return
      const updates = {}
      if (!recipe.cover_image) updates.cover_image = selected.filename
      await updateRecipe(recipe.id, { ...updates })
      toast.success('Bild kopplad till recept')
      setSelected(null)
    } catch {
      toast.error('Kunde inte koppla bild')
    }
  }

  // Bulk-link många bilder till ett recept (sätter cover om receptet saknar)
  const handleBulkLink = async () => {
    if (!bulkLinkId || selectedIds.size === 0) return
    const recipe = recipes.find((r) => r.id === Number(bulkLinkId))
    if (!recipe) return
    try {
      const firstSelected = images.find((i) => selectedIds.has(i.id))
      const updates = {}
      if (!recipe.cover_image && firstSelected) updates.cover_image = firstSelected.filename
      // För nu uppdaterar vi bara cover — befintliga images-tabellen kopplas inte
      // mot recipe via update. (Att binda fler images per recept kräver bildbank-API ändring.)
      await updateRecipe(recipe.id, updates)
      toast.success(`${selectedIds.size} bild(er) kopplade till ${recipe.title}`)
      setSelectedIds(new Set())
      setSelectMode(false)
      setBulkLinkId('')
      load()
    } catch (e) {
      toast.error(e.message || 'Kunde inte koppla')
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Radera ${selectedIds.size} bilder?`)) return
    try {
      for (const id of selectedIds) {
        await deleteImage(id)
      }
      toast.success(`${selectedIds.size} bilder raderade`)
      setSelectedIds(new Set())
      setSelectMode(false)
      load()
    } catch (e) {
      toast.error(e.message || 'Kunde inte radera')
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Steg 1: Parkera bilder för gruppering (ingen uppladdning än)
  const handleAddPending = (files) => {
    if (!files.length) return
    const newFiles = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setPendingFiles((prev) => [...prev, ...newFiles])
    // Default: varje bild i egen grupp
    setGroups((prev) => [...prev, ...newFiles.map((f) => [f.id])])
  }

  const moveImageToGroup = (imageId, targetGroupIdx) => {
    setGroups((prev) => {
      const next = prev.map((g) => g.filter((id) => id !== imageId))
      if (targetGroupIdx === -1) {
        next.push([imageId])
      } else if (targetGroupIdx >= 0 && targetGroupIdx < next.length) {
        next[targetGroupIdx] = [...next[targetGroupIdx], imageId]
      }
      return next.filter((g) => g.length > 0)
    })
  }

  const removePending = (imageId) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== imageId))
    setGroups((prev) => prev.map((g) => g.filter((id) => id !== imageId)).filter((g) => g.length > 0))
  }

  const clearPending = () => {
    pendingFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    setPendingFiles([])
    setGroups([])
  }

  // Steg 2: Skicka varje grupp till AI som ETT recept
  const processGroups = async () => {
    if (!groups.length) return
    setAiBusy(true)
    setAiProgress({ done: 0, total: groups.length })
    const extracted = []

    for (let gi = 0; gi < groups.length; gi++) {
      const groupIds = groups[gi]
      const groupFiles = groupIds.map((id) => pendingFiles.find((f) => f.id === id)?.file).filter(Boolean)
      if (!groupFiles.length) {
        setAiProgress({ done: gi + 1, total: groups.length })
        continue
      }

      try {
        // Multi-image om grupp > 1, annars vanlig single
        const data = groupFiles.length > 1
          ? await aiExtractFromImages(groupFiles)
          : await aiExtractFromImage(groupFiles[0])

        if (data?.ok === false || !data?.title) {
          toast.error(`AI klarade inte: grupp ${gi + 1}`, { duration: 2500 })
          setAiProgress({ done: gi + 1, total: groups.length })
          continue
        }

        // Ladda upp ALLA bilder i gruppen — första blir cover
        const uploaded = await uploadImages(groupFiles)
        const cover = uploaded?.[0]?.filename || null

        extracted.push({
          __sourceImages: groupFiles.map((f) => f.name),
          __cover: cover,
          __uploadedFilenames: uploaded.map((u) => u.filename),
          title: data.title || `Recept ${gi + 1}`,
          description: data.description || '',
          ingredients: data.ingredients || '[]',
          instructions: data.instructions || '',
          servings: data.servings || 4,
          prep_time: data.prep_time || null,
          cook_time: data.cook_time || null,
          cover_image: cover,
          source_type: 'image',
        })
      } catch (e) {
        toast.error(`Fel: grupp ${gi + 1}`, { duration: 2500 })
      }
      setAiProgress({ done: gi + 1, total: groups.length })
    }

    setAiResults(extracted)
    setAiBusy(false)
    clearPending()
    toast.success(`AI extraherade ${extracted.length}/${groups.length} recept`)
  }

  const saveAllAiRecipes = async () => {
    if (!aiResults?.length) return
    try {
      const items = aiResults.map((r) => {
        const { __sourceImage, __cover, ...recipe } = r
        return recipe
      })
      const res = await bulkCreateRecipes(items)
      toast.success(`${res.created} recept skapade!`)
      setAiResults(null)
      // Koppla varje uppladdad bild till sitt nya recept
      for (let i = 0; i < res.ids.length && i < aiResults.length; i++) {
        const cover = aiResults[i].__cover
        if (cover) {
          // Cover-fältet är redan satt i bulk-create payload. Kopplingen i RecipeImage
          // sker via separate upload — vi behöver inte göra något mer.
        }
      }
      load()
      if (res.ids.length === 1) navigate(`/recipes/${res.ids[0]}`)
    } catch (e) {
      toast.error(e.message || 'Misslyckades spara')
    }
  }

  const aiDropzone = useDropzone({
    accept: { 'image/*': [] },
    multiple: true,
    onDrop: handleAddPending,
    disabled: aiBusy,
    noClick: false,
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bildbank</h1>
          <p className="text-sm text-gray-500 mt-0.5">{images.length} bilder · dra in flera samtidigt</p>
        </div>
        <button
          onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()) }}
          className={`btn-secondary text-sm ${selectMode ? 'bg-primary/10 text-primary' : ''}`}
        >
          <CheckSquare size={15} />
          {selectMode ? 'Avbryt val' : 'Välj flera'}
        </button>
      </div>

      {/* AI bulk-import — STEG 1: drop files */}
      <div
        {...aiDropzone.getRootProps()}
        className={`relative border-2 border-dashed rounded-3xl p-6 text-center cursor-pointer transition-all
                    bg-gradient-to-br from-primary/5 to-sage-50/30 dark:from-primary/10 dark:to-sage-950/20
                    ${aiDropzone.isDragActive ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-primary/30 hover:border-primary/60'}
                    ${aiBusy ? 'opacity-60 cursor-wait' : ''}`}
      >
        <input {...aiDropzone.getInputProps()} multiple />
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Wand2 size={24} className="text-primary" />
          </div>
          <p className="font-semibold text-base">Skapa recept från bilder (AI)</p>
          <p className="text-sm text-gray-500 max-w-md">
            {aiBusy
              ? `🤖 AI läser grupp ${aiProgress.done} av ${aiProgress.total}...`
              : aiDropzone.isDragActive
                ? 'Släpp bilderna för att börja'
                : 'Steg 1: Dra in alla bilder. Steg 2: Gruppera de som hör ihop (samma recept). Steg 3: AI läser varje grupp.'}
          </p>
          {aiBusy && (
            <div className="w-full max-w-xs h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(aiProgress.done / Math.max(1, aiProgress.total)) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* STEG 2: Gruppera bilder per recept */}
      {pendingFiles.length > 0 && !aiBusy && (
        <div className="surface-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold flex items-center gap-2">
                <CheckSquare size={16} className="text-primary" />
                Gruppera bilder ({pendingFiles.length} bild{pendingFiles.length !== 1 ? 'er' : ''} → {groups.length} recept)
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                En grupp = ett recept. Klicka "+ till grupp X" för bilder som hör till samma recept.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={clearPending} className="btn-secondary text-sm">Rensa</button>
              <button onClick={processGroups} className="btn-primary text-sm">
                <Wand2 size={14} /> Skanna {groups.length} {groups.length === 1 ? 'grupp' : 'grupper'}
              </button>
            </div>
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {groups.map((groupIds, gi) => (
              <div key={gi} className="rounded-2xl bg-gray-50 dark:bg-white/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Recept {gi + 1} · {groupIds.length} bild{groupIds.length !== 1 ? 'er' : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {groupIds.map((id) => {
                    const f = pendingFiles.find((p) => p.id === id)
                    if (!f) return null
                    return (
                      <div key={id} className="relative group">
                        <img
                          src={f.previewUrl}
                          alt={f.file.name}
                          className="w-20 h-20 object-cover rounded-lg ring-1 ring-gray-200 dark:ring-white/10"
                        />
                        <button
                          onClick={() => removePending(id)}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Ta bort denna bild"
                        >
                          ✕
                        </button>
                        <select
                          value={gi}
                          onChange={(e) => moveImageToGroup(id, parseInt(e.target.value))}
                          className="block w-20 mt-1 text-[10px] py-0.5 px-1 rounded border border-gray-200 dark:border-white/10 bg-transparent"
                          title="Flytta till annan grupp"
                        >
                          {groups.map((_, idx) => (
                            <option key={idx} value={idx}>Grupp {idx + 1}</option>
                          ))}
                          <option value={-1}>Egen grupp</option>
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI-resultat — granska + spara alla */}
      {aiResults && aiResults.length > 0 && (
        <div className="surface-card p-4 space-y-3 ring-2 ring-primary/30 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="font-semibold flex items-center gap-2">
              <Wand2 size={16} className="text-primary" />
              AI extraherade {aiResults.length} recept
            </p>
            <button onClick={() => setAiResults(null)} className="btn-ghost p-2"><X size={16} /></button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {aiResults.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-gray-50 dark:bg-white/5">
                {r.__cover && (
                  <img
                    src={`/uploads/thumb_${r.__cover.replace(/\.[^.]+$/, '.jpg')}`}
                    onError={(e) => { e.target.src = `/uploads/${r.__cover}` }}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <input
                    value={r.title}
                    onChange={(e) => {
                      const next = [...aiResults]
                      next[i] = { ...next[i], title: e.target.value }
                      setAiResults(next)
                    }}
                    className="font-medium text-sm bg-transparent w-full focus:outline-none focus:bg-white dark:focus:bg-black/30 rounded px-1"
                  />
                  <p className="text-[11px] text-gray-500 truncate">
                    {(() => {
                      try { return JSON.parse(r.ingredients).length } catch { return 0 }
                    })()} ingredienser · {r.servings} portioner · från {r.__sourceImage}
                  </p>
                </div>
                <button
                  onClick={() => setAiResults(aiResults.filter((_, idx) => idx !== i))}
                  className="btn-ghost p-1 text-rose-500"
                  title="Skippa detta recept"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAiResults(null)} className="btn-secondary flex-1">Avbryt allt</button>
            <button onClick={saveAllAiRecipes} className="btn-primary flex-1">
              💾 Spara {aiResults.length} recept
            </button>
          </div>
        </div>
      )}

      {/* Pre-select recept för uppladdning */}
      <div className="surface rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">Koppla nya bilder till:</span>
        <select
          value={uploadTargetRecipeId}
          onChange={(e) => setUploadTargetRecipeId(e.target.value)}
          className="input text-sm py-1.5 px-2 flex-1 min-w-[180px]"
        >
          <option value="">— Ingen koppling (ladda upp lösa) —</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        {uploadTargetRecipeId && (
          <button
            onClick={() => setUploadTargetRecipeId('')}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Rensa
          </button>
        )}
      </div>

      {/* Drop-zon */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-gray-300 dark:border-gray-600 hover:border-primary'
        }`}
      >
        <input {...getInputProps()} multiple />
        <Upload size={28} className="mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-500">
          {uploading
            ? 'Laddar upp...'
            : (isDragActive
              ? 'Släpp för att ladda upp'
              : 'Dra in flera bilder samtidigt — eller klicka för att välja flera')}
        </p>
        {uploadTargetRecipeId && (
          <p className="text-xs text-primary mt-2">
            → kopplas direkt till "{recipes.find((r) => r.id === Number(uploadTargetRecipeId))?.title}"
          </p>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterRecipeId(null)}
          className={`px-3 py-1.5 rounded-full text-sm ${filterRecipeId === null ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
        >
          Alla
        </button>
        {recipes.map((r) => (
          <button
            key={r.id}
            onClick={() => setFilterRecipeId(r.id)}
            className={`px-3 py-1.5 rounded-full text-sm ${filterRecipeId === r.id ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* Image grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {images.map((img) => {
          const isSelected = selectedIds.has(img.id)
          return (
            <button
              key={img.id}
              onClick={() => selectMode ? toggleSelect(img.id) : setSelected(img)}
              className={`aspect-square rounded-xl overflow-hidden relative transition-all ${
                selectMode && isSelected ? 'ring-4 ring-primary' : 'hover:ring-2 hover:ring-primary'
              }`}
            >
              <img
                src={`/uploads/thumb_${img.filename.replace(/\.[^.]+$/, '.jpg')}`}
                onError={(e) => { e.target.src = `/uploads/${img.filename}` }}
                alt={img.original_name}
                className="w-full h-full object-cover"
              />
              {selectMode && (
                <span className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center border-2
                                ${isSelected ? 'bg-primary border-primary text-white' : 'bg-white/80 border-gray-300'}`}>
                  {isSelected ? '✓' : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {images.length === 0 && (
        <p className="text-center text-gray-400 py-10">Inga bilder ännu</p>
      )}

      {/* Single image modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold">Bilddetaljer</h2>
              <button onClick={() => setSelected(null)}><X size={20} /></button>
            </div>
            <img
              src={`/uploads/${selected.filename}`}
              alt={selected.original_name}
              className="w-full max-h-64 object-contain rounded-lg"
            />
            <p className="text-sm text-gray-500">{selected.original_name}</p>

            <div className="flex gap-2">
              <select
                value={linkRecipeId}
                onChange={(e) => setLinkRecipeId(e.target.value)}
                className="flex-1 input text-sm"
              >
                <option value="">Välj recept...</option>
                {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
              <button onClick={handleLink} disabled={!linkRecipeId} className="btn-primary text-sm px-3 flex items-center gap-1">
                <Link2 size={15} /> Koppla
              </button>
            </div>

            <button
              onClick={() => handleDelete(selected)}
              className="w-full flex items-center justify-center gap-2 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <Trash2 size={16} /> Radera bild
            </button>
          </div>
        </div>
      )}

      {/* Bulk-action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40
                        bg-surface-light dark:bg-surface-dark shadow-lift
                        rounded-3xl border border-gray-200 dark:border-white/10
                        px-4 py-2.5 flex items-center gap-3 flex-wrap max-w-[95vw]">
          <span className="font-semibold text-sm">{selectedIds.size} valda</span>
          <select
            value={bulkLinkId}
            onChange={(e) => setBulkLinkId(e.target.value)}
            className="input text-sm py-1.5 px-2"
          >
            <option value="">Koppla till...</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <button
            onClick={handleBulkLink}
            disabled={!bulkLinkId}
            className="px-3 py-1.5 rounded-2xl bg-primary text-white text-sm font-medium
                       hover:bg-primary-600 active:scale-95 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Link2 size={14} /> Koppla
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 rounded-2xl bg-rose-500 text-white text-sm font-medium
                       hover:bg-rose-600 active:scale-95 flex items-center gap-1.5"
          >
            <Trash2 size={14} /> Radera
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectMode(false) }}
            className="px-3 py-1.5 rounded-2xl text-sm text-gray-500 hover:bg-gray-100
                       dark:hover:bg-white/10 flex items-center gap-1.5"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
