import { useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Bookmark, CheckSquare, Square, X, ArrowRight, RefreshCw, Search, Lock } from 'lucide-react'
import { importFromURL, createRecipe, discoverRecipeUrls } from '../api'

function parseBookmarksHtml(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const anchors = Array.from(doc.querySelectorAll('a[href]'))
  return anchors
    .map((a) => ({ url: a.getAttribute('href') || '', title: a.textContent.trim() }))
    .filter(({ url }) => url.startsWith('http://') || url.startsWith('https://'))
    .map((item, i) => ({ ...item, selected: true, id: i }))
}

export default function BookmarkImport() {
  const [links, setLinks] = useState([])
  const [filter, setFilter] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const cancelRef = useRef(false)
  const fileInputRef = useRef(null)
  const [discoverUrl, setDiscoverUrl] = useState('')
  const [discovering, setDiscovering] = useState(false)

  const handleDiscover = async () => {
    if (!discoverUrl.trim()) return
    setDiscovering(true)
    try {
      const res = await discoverRecipeUrls(discoverUrl.trim())
      if (!res.urls?.length) {
        toast.error('Inga recept hittades på sidan')
        return
      }
      const discovered = res.urls.map((url, i) => ({ url, title: url, selected: true, id: i }))
      setLinks(discovered)
      setProgress(null)
      setFilter('')
      toast.success(`${res.count} recept hittade!`)
    } catch (e) {
      toast.error(e.message || 'Misslyckades')
    } finally {
      setDiscovering(false)
    }
  }

  const handleFile = useCallback((file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const extracted = parseBookmarksHtml(e.target.result)
      if (!extracted.length) {
        toast.error('Inga URLs hittades i filen')
        return
      }
      setLinks(extracted)
      setProgress(null)
      toast.success(`${extracted.length} URLs hittade`)
    }
    reader.readAsText(file)
  }, [])

  const onDrop = (e) => {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  const onInputChange = (e) => handleFile(e.target.files[0])

  const toggleAll = (val) => setLinks((l) => l.map((x) => ({ ...x, selected: val })))
  const toggleOne = (id) => setLinks((l) => l.map((x) => (x.id === id ? { ...x, selected: !x.selected } : x)))

  const filtered = filter
    ? links.filter(
        (l) =>
          l.title.toLowerCase().includes(filter.toLowerCase()) ||
          l.url.toLowerCase().includes(filter.toLowerCase())
      )
    : links

  const selectedCount = links.filter((l) => l.selected).length

  const runImport = async () => {
    const toImport = links.filter((l) => l.selected)
    if (!toImport.length) return
    cancelRef.current = false
    setImporting(true)
    const results = []
    setProgress({ current: 0, total: toImport.length, results, done: false, currentTitle: '' })

    for (let i = 0; i < toImport.length; i++) {
      if (cancelRef.current) break
      const item = toImport[i]
      setProgress((p) => ({ ...p, current: i, currentTitle: item.title || item.url }))

      try {
        const recipe = await importFromURL(item.url)
        if (recipe?.title) {
          try {
            const saved = await createRecipe({
              title: recipe.title,
              description: recipe.description || '',
              ingredients: recipe.ingredients || '[]',
              instructions: recipe.instructions || '',
              servings: recipe.servings || 4,
              prep_time: recipe.prep_time || null,
              cook_time: recipe.cook_time || null,
              source_url: item.url,
              source_type: 'url',
              cover_image: recipe.cover_image || null,
              tag_ids: [],
              visibility: 'private',  // importerat innehåll — alltid privat (upphovsrätt)
            })
            results.push({ url: item.url, title: saved.title || recipe.title, status: 'ok', id: saved.id })
          } catch (saveErr) {
            if (saveErr.message?.includes('exists') || saveErr.message === '409') {
              results.push({ url: item.url, title: item.title, status: 'exists', reason: 'Redan importerat' })
            } else {
              results.push({ url: item.url, title: item.title, status: 'fail', reason: saveErr.message })
            }
          }
        } else {
          results.push({ url: item.url, title: item.title, status: 'fail', reason: 'Inget recept hittades' })
        }
      } catch (err) {
        results.push({ url: item.url, title: item.title, status: 'fail', reason: err.message })
      }

      setProgress((p) => ({ ...p, current: i + 1, results: [...results] }))
    }

    setImporting(false)
    setProgress((p) => ({ ...p, done: true, currentTitle: '' }))
  }

  const reset = () => {
    setLinks([])
    setProgress(null)
    setFilter('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const okCount = progress?.results.filter((r) => r.status === 'ok').length ?? 0
  const failCount = progress?.results.filter((r) => r.status === 'fail').length ?? 0

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Importera recept</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Klistra in en samlingssida för att hitta alla recept automatiskt, eller ladda upp bokmärken som HTML-fil.
        </p>
      </div>

      {/* URL-discovery */}
      {!links.length && (
        <div className="surface-card p-4 space-y-3">
          <p className="text-sm font-medium">Hitta recept från en samlingssida</p>
          <div className="flex gap-2">
            <input
              className="flex-1 input text-sm"
              placeholder="https://arla.se/artiklar/sommarmat..."
              value={discoverUrl}
              onChange={(e) => setDiscoverUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
            />
            <button
              onClick={handleDiscover}
              disabled={discovering || !discoverUrl.trim()}
              className="btn-primary flex items-center gap-2 px-4 text-sm"
            >
              {discovering
                ? <RefreshCw size={14} className="animate-spin" />
                : <Search size={14} />}
              {discovering ? 'Söker...' : 'Hitta recept'}
            </button>
          </div>
          <p className="text-xs text-gray-400">AI analyserar sidan och hittar alla receptlänkar automatiskt</p>
        </div>
      )}

      {/* Drag-drop zon */}
      {!links.length && (
        <div
          className="border-2 border-dashed border-gray-200 dark:border-white/10 rounded-2xl
                     p-14 text-center cursor-pointer
                     hover:border-primary hover:bg-primary/5 transition-colors"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <Bookmark size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="font-semibold text-gray-700 dark:text-gray-200">Dra och släpp HTML-fil här</p>
          <p className="text-sm text-gray-400 mt-1">eller klicka för att välja fil</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={onInputChange}
          />
        </div>
      )}

      {/* URL-lista */}
      {links.length > 0 && !progress?.done && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10
                         bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Filtrera på titel eller URL..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              onClick={() => toggleAll(true)}
              className="flex items-center gap-1 px-3 py-2 text-sm rounded-xl
                         hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <CheckSquare size={14} /> Alla
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="flex items-center gap-1 px-3 py-2 text-sm rounded-xl
                         hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <Square size={14} /> Ingen
            </button>
          </div>

          <p className="text-xs text-gray-400">
            {filtered.length} av {links.length} URLs visas · {selectedCount} valda
            <span className="inline-flex items-center gap-1 ml-1.5"><Lock size={11} className="inline" /> importeras privat (upphovsrätt)</span>
          </p>

          <div className="border border-gray-100 dark:border-white/5 rounded-2xl
                          divide-y divide-gray-100 dark:divide-white/5 max-h-96 overflow-y-auto">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50
                           dark:hover:bg-white/5 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => toggleOne(item.id)}
                  className="mt-0.5 accent-primary shrink-0 cursor-pointer"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title || '(ingen titel)'}</p>
                  <p className="text-xs text-gray-400 truncate">{item.url}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Progress under import */}
          {importing && progress && (
            <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  Importerar {progress.current} / {progress.total}
                </span>
                <button
                  onClick={() => { cancelRef.current = true }}
                  className="text-red-500 hover:underline text-xs flex items-center gap-1"
                >
                  <X size={12} /> Avbryt
                </button>
              </div>
              <div className="w-full bg-gray-200 dark:bg-white/10 rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              {progress.currentTitle && (
                <p className="text-xs text-gray-400 truncate">⏳ {progress.currentTitle}</p>
              )}
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {[...progress.results].reverse().slice(0, 6).map((r, i) => (
                  <p key={i} className={`text-xs truncate ${r.status === 'ok' ? 'text-green-600' : 'text-red-400'}`}>
                    {r.status === 'ok' ? '✓' : '✗'} {r.title || r.url}
                  </p>
                ))}
              </div>
            </div>
          )}

          {!importing && (
            <div className="flex gap-3">
              <button
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl
                           bg-primary text-white font-semibold shadow-sm
                           hover:shadow-md active:scale-[0.98] transition-all
                           disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={selectedCount === 0}
                onClick={runImport}
              >
                <ArrowRight size={16} />
                Importera {selectedCount} recept
                {publicCount > 0 && ` (${publicCount} publika)`}
              </button>
              <button
                onClick={reset}
                className="px-4 py-3 rounded-2xl border border-gray-200 dark:border-white/10
                           hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-sm"
              >
                Ny fil
              </button>
            </div>
          )}
        </>
      )}

      {/* Resultat */}
      {progress?.done && (
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-5">
            <p className="font-semibold text-lg mb-1">Klart!</p>
            <p className="text-sm text-gray-500">
              {okCount > 0 && <span className="text-green-600 font-medium">✓ {okCount} importerade</span>}
              {progress.results.filter(r => r.status === 'exists').length > 0 && (
                <span className="text-gray-400"> · ⏭ {progress.results.filter(r => r.status === 'exists').length} fanns redan</span>
              )}
              {failCount > 0 && <span className="text-red-400"> · ✗ {failCount} misslyckades</span>}
            </p>
          </div>

          {failCount > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Misslyckades</p>
              <div className="border border-gray-100 dark:border-white/5 rounded-2xl
                              divide-y divide-gray-100 dark:divide-white/5 max-h-52 overflow-y-auto">
                {progress.results.filter((r) => r.status === 'fail').map((r, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <p className="text-sm font-medium text-red-500 truncate">{r.title || r.url}</p>
                    <p className="text-xs text-gray-400">{r.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Link
              to="/"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl
                         bg-primary text-white font-semibold text-sm
                         hover:shadow-md active:scale-[0.98] transition-all"
            >
              Gå till recepten <ArrowRight size={15} />
            </Link>
            <button
              onClick={reset}
              className="px-4 py-3 rounded-2xl border border-gray-200 dark:border-white/10
                         hover:bg-gray-50 dark:hover:bg-white/5 transition-colors
                         flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} /> Importera fler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
