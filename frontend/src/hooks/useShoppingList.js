import { useState, useEffect } from 'react'
import { getShoppingLists, createShoppingList, updateShoppingList, deleteShoppingList, generateShoppingList } from '../api'
import toast from 'react-hot-toast'

export function useShoppingList() {
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)

  const fetch = async () => {
    setLoading(true)
    try {
      setLists(await getShoppingLists())
    } catch {
      toast.error('Kunde inte hämta inköpslistor')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() }, [])

  const generate = async (recipeIds, servingsOverride = {}) => {
    return generateShoppingList(recipeIds, servingsOverride)
  }

  const save = async (name, items) => {
    const list = await createShoppingList({ name, items: JSON.stringify(items) })
    setLists((prev) => [list, ...prev])
    toast.success('Lista sparad')
    return list
  }

  const update = async (id, data) => {
    if (!id) return
    // Optimistic update — apply immediately, don't wait for server
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, ...data } : l)))
    try {
      await updateShoppingList(id, data)
      // Don't apply server response to state — stale responses from parallel
      // requests can overwrite fresher optimistic state. Optimistic is authoritative.
    } catch {
      toast.error('Kunde inte spara ändringar')
      // On failure: refetch from server to restore correct state
      getShoppingLists().then(setLists).catch(() => {})
    }
  }

  const remove = async (id) => {
    await deleteShoppingList(id)
    setLists((prev) => prev.filter((l) => l.id !== id))
    toast.success('Lista raderad')
  }

  return { lists, loading, generate, save, update, remove, refetch: fetch }
}
