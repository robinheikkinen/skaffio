import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Clock, Users, ChefHat } from 'lucide-react'
import SkaffioLogo from '../components/SkaffioLogo'
import { getSharedRecipe } from '../api'
import { imageUrl } from '../utils/imageUrl'

export default function SharedRecipe() {
  const { token } = useParams()
  const [recipe, setRecipe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getSharedRecipe(token)
      .then(setRecipe)
      .catch((e) => setError(e.message || 'Receptet kunde inte hämtas'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return <div className="flex justify-center py-20">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  }

  if (error || !recipe) {
    return <div className="max-w-md mx-auto text-center py-20 px-4">
      <ChefHat size={48} className="text-gray-300 mx-auto mb-4" />
      <h1 className="text-xl font-bold mb-2">Receptet finns inte</h1>
      <p className="text-gray-500 text-sm">{error || 'Delningslänken kan ha återkallats.'}</p>
    </div>
  }

  let ingredients = []
  try { ingredients = JSON.parse(recipe.ingredients || '[]') } catch {}
  const totalTime = (recipe.prep_time || 0) + (recipe.cook_time || 0)

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header med Skaffio-branding */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-white/10">
        <div className="flex items-center gap-2">
          <SkaffioLogo size={24} />
          <span className="font-semibold">Skaffio</span>
        </div>
        <span className="text-xs text-gray-400">Delat recept</span>
      </div>

      {recipe.cover_image && (
        <div className="rounded-3xl overflow-hidden h-64 md:h-80">
          <img src={imageUrl(recipe.cover_image)} alt={recipe.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold">{recipe.title}</h1>
        {recipe.description && <p className="text-gray-500 dark:text-gray-400 mt-2">{recipe.description}</p>}
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
        {totalTime > 0 && <span className="flex items-center gap-1.5"><Clock size={15} /> {totalTime} min</span>}
        <span className="flex items-center gap-1.5"><Users size={15} /> {recipe.servings} portioner</span>
      </div>

      {ingredients.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Ingredienser</h2>
          <ul className="space-y-2">
            {ingredients.map((ing, i) => (
              <li key={i} className="flex items-center gap-3 p-2">
                <span className="text-gray-500 w-16 text-right text-sm">
                  {ing.amount} {ing.unit}
                </span>
                <span>{ing.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recipe.instructions && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Instruktioner</h2>
          <div className="whitespace-pre-wrap leading-relaxed">{recipe.instructions}</div>
        </section>
      )}

      <div className="pt-6 border-t border-gray-200 dark:border-white/10 text-center text-xs text-gray-400">
        Delat via <a href="/" className="text-primary hover:underline">Skaffio</a>
      </div>
    </div>
  )
}
