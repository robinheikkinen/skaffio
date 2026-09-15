import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import { useAuth } from './context/AuthContext'
import PWAUpdateBanner from './components/PWAUpdateBanner'
import OnboardingModal, { useOnboarding } from './components/OnboardingModal'

// Lazy-loaded pages — varje sida blir ett eget chunk
const Home           = lazy(() => import('./pages/Home'))
const RecipeDetail   = lazy(() => import('./pages/RecipeDetail'))
const AddRecipe      = lazy(() => import('./pages/AddRecipe'))
const EditRecipe     = lazy(() => import('./pages/EditRecipe'))
const ImageBank      = lazy(() => import('./pages/ImageBank'))
const ShoppingList   = lazy(() => import('./pages/ShoppingList'))
const MealPlan       = lazy(() => import('./pages/MealPlan'))
const SharedList     = lazy(() => import('./pages/SharedList'))
const SharedRecipe   = lazy(() => import('./pages/SharedRecipe'))
const Security       = lazy(() => import('./pages/Security'))
const Login          = lazy(() => import('./pages/Login'))
const Register       = lazy(() => import('./pages/Register'))
const Activity       = lazy(() => import('./pages/Activity'))
const Admin          = lazy(() => import('./pages/Admin'))
const Collections    = lazy(() => import('./pages/Collections'))
const CollectionDetail = lazy(() => import('./pages/CollectionDetail'))
const Pantry         = lazy(() => import('./pages/Pantry'))
const BookmarkImport = lazy(() => import('./pages/BookmarkImport'))
const Inbox          = lazy(() => import('./pages/Inbox'))
const ShareReceiver  = lazy(() => import('./pages/ShareReceiver'))
const PrepPlan       = lazy(() => import('./pages/PrepPlan'))
const Privacy        = lazy(() => import('./pages/Privacy'))

function BootSplash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-canvas-light dark:bg-canvas-dark">
      <img src="/icons/icon-rounded.svg" width="56" height="56" alt="Skaffio" />
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading, status } = useAuth()
  const location = useLocation()
  if (loading) return <BootSplash />
  if (!user) {
    return (
      <Navigate
        to={status.has_users ? '/login' : '/register'}
        replace
        state={{ from: location.pathname + location.search }}
      />
    )
  }
  return children
}

function AppShell() {
  const { user } = useAuth()
  const { show, dismiss } = useOnboarding()

  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <PWAUpdateBanner />
      {user && show && <OnboardingModal onDone={dismiss} />}
      <Suspense fallback={<BootSplash />}>
        <Routes>
          {/* Publika rutter — INGEN auth krävs */}
          <Route path="/shared/list/:token" element={<SharedList />} />
          <Route path="/shared/recipe/:token" element={<SharedRecipe />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* Share target — kräver auth men utan Layout */}
          <Route
            path="/share"
            element={
              <RequireAuth>
                <ShareReceiver />
              </RequireAuth>
            }
          />

          {/* Allt annat kräver inloggning */}
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="recipes/:id" element={<RecipeDetail />} />
            <Route path="recipes/:id/edit" element={<EditRecipe />} />
            <Route path="add" element={<AddRecipe />} />
            <Route path="images" element={<ImageBank />} />
            <Route path="shopping" element={<ShoppingList />} />
            <Route path="mealplan" element={<MealPlan />} />
            <Route path="activity" element={<Activity />} />
            <Route path="admin" element={<Admin />} />
            <Route path="collections" element={<Collections />} />
            <Route path="collections/:id" element={<CollectionDetail />} />
            <Route path="pantry" element={<Pantry />} />
            <Route path="security" element={<Security />} />
            <Route path="import/bookmarks" element={<BookmarkImport />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="prep-plan" element={<PrepPlan />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
