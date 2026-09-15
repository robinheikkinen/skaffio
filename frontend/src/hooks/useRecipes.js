import { useState, useEffect, useCallback } from 'react'
import { getRecipes, deleteRecipe } from '../api'
import toast from 'react-hot-toast'

export function useRecipes(params = {}) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRecipes(params)
      setRecipes(data)
    } catch (e) {
      toast.error('Kunde inte hämta recept')
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(params)])

  useEffect(() => { fetch() }, [fetch])

  const remove = async (id) => {
    await deleteRecipe(id)
    setRecipes((prev) => prev.filter((r) => r.id !== id))
    toast.success('Recept raderat')
  }

  return { recipes, loading, refetch: fetch, remove }
}
