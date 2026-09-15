import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getRecipe } from '../api'
import RecipeForm from '../components/RecipeForm'

export default function EditRecipe() {
  const { id } = useParams()
  const [recipe, setRecipe] = useState(null)

  useEffect(() => {
    getRecipe(id).then(setRecipe)
  }, [id])

  if (!recipe) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Redigera recept</h1>
      <RecipeForm initialData={recipe} />
    </div>
  )
}
