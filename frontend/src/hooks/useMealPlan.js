import { useState, useCallback } from 'react'
import { getMealPlan, createMealPlanEntry, updateMealPlanEntry, deleteMealPlanEntry } from '../api'
import toast from 'react-hot-toast'

export function useMealPlan() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async (start, end) => {
    setLoading(true)
    try {
      setEntries(await getMealPlan(start, end))
    } catch {
      toast.error('Kunde inte hämta måltidsplan')
    } finally {
      setLoading(false)
    }
  }, [])

  const add = async (data) => {
    const entry = await createMealPlanEntry(data)
    setEntries((prev) => [...prev, entry])
    toast.success('Recept tillagt i planen')
    return entry
  }

  const update = async (id, data) => {
    const updated = await updateMealPlanEntry(id, data)
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)))
  }

  const remove = async (id) => {
    await deleteMealPlanEntry(id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
    toast.success('Borttagen från planen')
  }

  return { entries, loading, fetch, add, update, remove }
}
