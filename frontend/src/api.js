const BASE_URL = import.meta.env.VITE_API_URL || '/api'

// ─── Auth-transport ───────────────────────────────────────────────
// JWT lagras i HttpOnly-cookie (sätts av backend vid login/register).
// Cookies skickas automatiskt av browser på same-origin-anrop via nginx-proxyn.
// Ingen Authorization-header behövs — ingen token exponeras för JS/XSS.

function handle401() {
  window.dispatchEvent(new CustomEvent('skaffio:auth-failed'))
}

async function request(path, options = {}, { auth = true } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    // credentials: 'same-origin' är default — cookie skickas automatiskt
  })
  if (res.status === 401 && auth) {
    handle401()
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const d = err.detail
    if (res.status === 409 && d?.exists) {
      const e = new Error(`Receptet finns redan: ${d.title}`)
      e.status = 409; e.existingId = d.id
      throw e
    }
    const msg = typeof d === 'string' ? d
      : Array.isArray(d) ? d.map(e => e.msg || String(e)).join(', ')
      : err.message || 'Request failed'
    throw new Error(msg)
  }
  return res.json()
}

const jsonOpts = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// FormData-request med 401-hantering (cookie skickas automatiskt, ingen header behövs)
async function formRequest(path, formData, { signal = null } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: formData,
    signal,
  })
  if (res.status === 401) handle401()
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const d = err.detail
    const msg = typeof d === 'string' ? d
      : Array.isArray(d) ? d.map(e => e.msg || String(e)).join(', ')
      : err.message || 'Request failed'
    throw new Error(msg)
  }
  return res.json()
}

// ─── Auth ───────────────────────────────────────────────────────
export const authStatus = () => request('/auth/status', {}, { auth: false })
export const register = (data) => request('/auth/register', jsonOpts('POST', data), { auth: false })
export const login = (data) => request('/auth/login', jsonOpts('POST', data), { auth: false })
export const cfLogin = () => request('/auth/cf-login', { method: 'POST' }, { auth: false })
export const logout = () => request('/auth/logout', { method: 'POST' }, { auth: false })
export const me = () => request('/auth/me')
export const changeOwnPassword = (current_password, new_password) =>
  request('/auth/me/password', jsonOpts('POST', { current_password, new_password }))
export const deleteMyAccount = () => request('/auth/me', { method: 'DELETE' })
export const exportMyData = async () => {
  const res = await fetch(`${BASE_URL}/auth/me/export`)
  if (!res.ok) throw new Error('Export misslyckades')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'skaffio-export.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
export const totpSetup = () => request('/auth/totp/setup', { method: 'POST' })
export const totpEnable = (code) => request('/auth/totp/enable', jsonOpts('POST', { code }))
export const totpDisable = (code) => request('/auth/totp/disable', jsonOpts('POST', { code }))
export const getAuditLog = (limit = 100) => request(`/auth/audit?limit=${limit}`)
export const listUsers = () => request('/auth/users')
export const createUser = (data) => request('/auth/users', jsonOpts('POST', data))
export const updateUser = (id, data) => request(`/auth/users/${id}`, jsonOpts('PUT', data))
export const deleteUser = (id) => request(`/auth/users/${id}`, { method: 'DELETE' })

// Favorites
export const getMyFavorites = () => request('/favorites')
export const addFavorite = (recipeId) => request(`/favorites/${recipeId}`, { method: 'POST' })
export const removeFavorite = (recipeId) => request(`/favorites/${recipeId}`, { method: 'DELETE' })

// Pantry
export const listPantry = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return request(`/pantry${q ? '?' + q : ''}`)
}
export const addPantryItem = (data) => request('/pantry', jsonOpts('POST', data))
export const updatePantryItem = (id, data) => request(`/pantry/${id}`, jsonOpts('PUT', data))
export const removePantryItem = (id) => request(`/pantry/${id}`, { method: 'DELETE' })
export const bulkAddPantry = (items) => request('/pantry/bulk', jsonOpts('POST', { items }))
export const importStaples = () => request('/pantry/import-staples', { method: 'POST' })
export const scanPantryPhoto = async (file, location = 'Kyl') => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('location', location)
  return formRequest('/pantry/scan-photo', fd)
}
export const scanReceipt = async (file, location = 'Skafferi') => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('location', location)
  return formRequest('/pantry/scan-receipt', fd)
}

// Collections
export const listCollections = () => request('/collections')
export const createCollection = (data) => request('/collections', jsonOpts('POST', data))
export const getCollection = (id) => request(`/collections/${id}`)
export const updateCollection = (id, data) => request(`/collections/${id}`, jsonOpts('PUT', data))
export const deleteCollection = (id) => request(`/collections/${id}`, { method: 'DELETE' })
export const getCollectionRecipes = (id) => request(`/collections/${id}/recipes`)
export const addRecipeToCollection = (collectionId, recipeId) =>
  request(`/collections/${collectionId}/recipes/${recipeId}`, { method: 'POST' })
export const removeRecipeFromCollection = (collectionId, recipeId) =>
  request(`/collections/${collectionId}/recipes/${recipeId}`, { method: 'DELETE' })
export const adminCreateUser = (data) => request('/auth/users', jsonOpts('POST', data))
export const listInvites = () => request('/auth/invites')
export const createInvite = (data) => request('/auth/invites', jsonOpts('POST', data))
export const revokeInvite = (id) => request(`/auth/invites/${id}`, { method: 'DELETE' })
export const adminUpdateUser = (id, data) => request(`/auth/users/${id}`, jsonOpts('PUT', data))
export const adminDeleteUser = (id) => request(`/auth/users/${id}`, { method: 'DELETE' })

// ─── Recipes ────────────────────────────────────────────────────
export const getRecipes = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return request(`/recipes${q ? '?' + q : ''}`)
}
export const getRecipe = (id) => request(`/recipes/${id}`)
export const createRecipe = (data) => request('/recipes/create', jsonOpts('POST', data))
export const bulkCreateRecipes = (items) => request('/recipes/bulk', jsonOpts('POST', items))
export const bulkDeleteRecipes = (ids) => request('/recipes/bulk-delete', jsonOpts('POST', { ids }))
export const setRecipeRating = (id, rating) => request(`/recipes/${id}/rating`, jsonOpts('PUT', { rating }))
export const markRecipeCooked = (id, data = {}) => request(`/recipes/${id}/cooked`, jsonOpts('POST', data))
export const aiSearchRecipes = (query) => request('/recipes/ai-search', jsonOpts('POST', { query }))
export const updateRecipe = (id, data) => request(`/recipes/${id}`, jsonOpts('PUT', data))
export const deleteRecipe = (id) => request(`/recipes/${id}`, { method: 'DELETE' })
export const createRecipeShare = (id) => request(`/recipes/${id}/share`, { method: 'POST' })
export const revokeRecipeShare = (id) => request(`/recipes/${id}/share`, { method: 'DELETE' })
export const getSharedRecipe = (token) => request(`/recipes/share/${token}`, {}, { auth: false })
export const getRandomRecipe = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return request(`/recipes/random${q ? '?' + q : ''}`)
}
export const aiGenerateFromPantry = (extra_prompt = '', save = false) =>
  request('/recipes/ai-generate-from-pantry', jsonOpts('POST', { extra_prompt, save }))
export const calculateMacros = (id) => request(`/recipes/${id}/calculate-macros`, { method: 'POST' })
export const getMealPlanIcalUrl = () => request('/mealplan/ical-url')
export const getPreschoolMenu = (days = 7) => request(`/mealplan/preschool-menu?days=${days}`)
export const setPreschoolSchool = (url, display_name = '') =>
  request('/household/school-menu', jsonOpts('PUT', { url, display_name }))
export const inventRecipe = (mood = '') => request('/ai/invent-recipe', jsonOpts('POST', { mood }))

// Auth:ad nedladdning — cookie skickas automatiskt, ingen Authorization-header behövs
async function downloadAuthed(path, suggestedName) {
  const res = await fetch(`${BASE_URL}${path}`)
  if (res.status === 401) handle401()
  if (!res.ok) throw new Error('Nedladdning misslyckades')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const exportAllRecipesJson = () =>
  downloadAuthed('/recipes/export/json', `skaffio-export-${new Date().toISOString().slice(0, 10)}.json`)
export const exportRecipePdf = (id, title = 'recept') =>
  downloadAuthed(`/recipes/${id}/export/pdf`, `${title.replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 50)}.pdf`)

// ─── Images ─────────────────────────────────────────────────────
export const uploadImages = async (files, recipeId = null) => {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  if (recipeId) fd.append('recipe_id', recipeId)
  return formRequest('/images/upload', fd)
}
export const uploadPDF = async (file, { signal = null } = {}) => {
  const fd = new FormData()
  fd.append('file', file)
  return formRequest('/images/upload-pdf', fd, { signal })
}
export const importFromURL = (url, { signal = null } = {}) =>
  request('/import/url', { ...jsonOpts('POST', { url }), signal })
export const discoverRecipeUrls = (url) => request('/import/url-discover', jsonOpts('POST', { url }))
export const getImages = (recipeId = null) =>
  request(`/images${recipeId !== null ? '?recipe_id=' + recipeId : ''}`)
export const deleteImage = (id) => request(`/images/${id}`, { method: 'DELETE' })

// ─── Tags ───────────────────────────────────────────────────────
export const getTags = () => request('/tags')
export const createTag = (data) => request('/tags', jsonOpts('POST', data))
export const updateTag = (id, data) => request(`/tags/${id}`, jsonOpts('PUT', data))
export const deleteTag = (id) => request(`/tags/${id}`, { method: 'DELETE' })

// ─── Shopping ───────────────────────────────────────────────────
export const generateShoppingList = (recipe_ids, servings_override = {}) =>
  request('/shopping/from-recipes', jsonOpts('POST', { recipe_ids, servings_override }))
export const getMissingIngredients = (recipe_id, servings) =>
  request('/shopping/missing-from-recipe', jsonOpts('POST', { recipe_id, servings }))
export const getShoppingLists = () => request('/shopping')
export const createShoppingList = (data) => request('/shopping', jsonOpts('POST', data))
export const updateShoppingList = (id, data) => request(`/shopping/${id}`, jsonOpts('PUT', data))
export const deleteShoppingList = (id) => request(`/shopping/${id}`, { method: 'DELETE' })
export const createShareLink = (id) => request(`/shopping/${id}/share`, { method: 'POST' })
export const revokeShareLink = (id) => request(`/shopping/${id}/share`, { method: 'DELETE' })
export const getSharedList = (token) =>
  request(`/shopping/share/${token}`, {}, { auth: false })
export const toggleSharedItem = (token, index, checked) =>
  request(`/shopping/share/${token}/toggle`, jsonOpts('PATCH', { index, checked }), { auth: false })

// ─── AI Planner ─────────────────────────────────────────────────
export const aiPlan = (prompt, { startDate = null, commit = false } = {}) =>
  request('/ai/plan', jsonOpts('POST', { prompt, start_date: startDate, commit }))
export const aiStatus = () => request('/ai/status')
export const aiExtractFromImage = async (file, { onlyTitle = false, signal = null } = {}) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('only_title', onlyTitle ? 'true' : 'false')
  return formRequest('/ai/extract-from-image', fd, { signal })
}
export const aiExtractFromImages = async (files) => {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  return formRequest('/ai/extract-from-images', fd)
}

// ─── Freezer / batch portions ──────────────────────────────────
export const getFreezerPortions = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return request(`/freezer${q ? '?' + q : ''}`)
}
export const createFreezerPortion = (data) => request('/freezer', jsonOpts('POST', data))
export const deleteFreezerPortion = (id) => request(`/freezer/${id}`, { method: 'DELETE' })

// ─── Meal Plan ─────────────────────────────────────────────────
export const getMealPlan = (start, end) => request(`/mealplan?start=${start}&end=${end}`)
export const createMealPlanEntry = (data) => request('/mealplan', jsonOpts('POST', data))
export const updateMealPlanEntry = (id, data) => request(`/mealplan/${id}`, jsonOpts('PUT', data))
export const deleteMealPlanEntry = (id) => request(`/mealplan/${id}`, { method: 'DELETE' })

// ─── Inbox ─────────────────────────────────────────────────────
export const queueInboxUrl = (url, title = '') => request('/inbox', jsonOpts('POST', { url, title }))
export const getInbox = (status = null) =>
  request(`/inbox${status ? '?status=' + status : ''}`)
export const getInboxItem = (id) => request(`/inbox/${id}`)
export const updateInboxItem = (id, data) => request(`/inbox/${id}`, jsonOpts('PUT', data))
export const approveInboxItem = (id, visibility = 'private') => request(`/inbox/${id}/approve`, jsonOpts('POST', { visibility }))
export const deleteInboxItem = (id) => request(`/inbox/${id}`, { method: 'DELETE' })
export const getInboxCount = () => request('/inbox/count')

// ─── Household ───────────────────────────────────────────────────
export const getHousehold = () => request('/household')
export const joinHousehold = (invite_code) => request('/household/join', jsonOpts('POST', { invite_code }))
export const regenerateInvite = () => request('/household/regenerate-invite', { method: 'POST' })
export const renameHousehold = (name) => request('/household/rename', jsonOpts('PUT', { name }))

// ─── Recipe fork ─────────────────────────────────────────────────
export const forkRecipe = (id) => request(`/recipes/${id}/fork`, { method: 'POST' })

// ─── AI-omskrivning: egen version utan källänk (publicerbar) ─────
export const rewriteRecipe = (id) => request(`/recipes/${id}/rewrite`, { method: 'POST' })

// ─── Smart Substitution ───────────────────────────────────────────
export const substituteIngredient = (recipeId, data) =>
  request(`/recipes/${recipeId}/substitute`, jsonOpts('POST', data))

// ─── Prep-Master ──────────────────────────────────────────────────
export const generatePrepPlan = (recipe_ids) =>
  request('/recipes/prep-plan', jsonOpts('POST', { recipe_ids }))

// ─── Calorie log ─────────────────────────────────────────────────
export const logMeal = (recipe_id, servings, log_date) =>
  request('/nutrition/log', jsonOpts('POST', { recipe_id, servings, log_date }))
export const getNutritionLog = (log_date) =>
  request(`/nutrition/log${log_date ? '?log_date=' + log_date : ''}`)
export const deleteLogEntry = (id) => request(`/nutrition/log/${id}`, { method: 'DELETE' })
