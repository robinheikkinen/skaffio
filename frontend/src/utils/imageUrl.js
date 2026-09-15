/**
 * Resolve any cover_image / RecipeImage filename to a displayable URL.
 *
 * cover_image kan ha tre former i databasen:
 *   1. lokalt filnamn  ("kebabgratang-abc12.jpg")     → /uploads/...
 *   2. komplett URL    ("https://example.com/x.jpg")  → as-is (fallback för äldre rader)
 *   3. tomt/null                                       → null
 */
export function imageUrl(filename, { thumb = false } = {}) {
  if (!filename) return null
  if (/^https?:\/\//i.test(filename)) return filename
  if (thumb) {
    const base = filename.replace(/\.[^.]+$/, '')
    return `/uploads/thumb_${base}.jpg`
  }
  return `/uploads/${filename}`
}

/** Returns a fallback handler that swaps thumb → full-size on 404.
 *  Använder data-attribute som idempotent flag — fungerar även om React
 *  re-renderar och skapar ny onError-callback (annars: oändlig loop).
 */
export function thumbFallback(filename) {
  return (e) => {
    if (!filename) return
    if (e.target.dataset.fallbackDone === '1') return  // redan testat full-size
    e.target.dataset.fallbackDone = '1'
    e.target.src = imageUrl(filename, { thumb: false })
  }
}
