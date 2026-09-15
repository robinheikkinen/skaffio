import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Home, Image, ShoppingCart, Calendar, Menu, X, Plus,
  Activity as ActivityIcon, LogOut, Crown, Shield, Folder, Package, KeyRound, Bookmark, Download,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import ThemeToggle from './ThemeToggle'
import Navbar from './Navbar'
import CookingDock from './CookingDock'
import FeedbackButton from './FeedbackButton'
import { useAuth } from '../context/AuthContext'

const baseLinks = [
  { to: '/', icon: Home, label: 'Hem' },
  { to: '/collections', icon: Folder, label: 'Mappar' },
  { to: '/pantry', icon: Package, label: 'Pantry' },
  { to: '/images', icon: Image, label: 'Bildbank' },
  { to: '/shopping', icon: ShoppingCart, label: 'Inköpslista' },
  { to: '/mealplan', icon: Calendar, label: 'Måltidsplan' },
  { to: '/activity', icon: ActivityIcon, label: 'Aktivitet' },
  { to: '/import/bookmarks', icon: Bookmark, label: 'Bokmärken' },
  { to: '/security', icon: KeyRound, label: 'Säkerhet' },
]
const adminLinks = [
  { to: '/admin', icon: Shield, label: 'Admin' },
]

function BrandMark({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <img src="/icons/icon-favicon.svg" width="28" height="28" alt="Skaffio" className="shrink-0" />
      {!compact && (
        <div className="flex flex-col leading-none">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '19px', letterSpacing: '-0.02em' }}>
            <span className="text-[var(--text,#15171c)]">skaff</span>
            <span style={{ color: '#E07A4A' }}>io</span>
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: '8.5px', letterSpacing: '.2em', color: '#E07A4A', textTransform: 'uppercase', fontWeight: 600, marginTop: '3px', opacity: 0.8 }}>
            Ditt digitala skafferi
          </span>
        </div>
      )}
    </div>
  )
}

function UserPill({ compact = false }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || user.email[0].toUpperCase()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  if (compact) {
    return (
      <button
        onClick={handleLogout}
        className="w-11 h-11 flex items-center justify-center rounded-2xl
                   text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        title={`Logga ut ${user.name}`}
      >
        <LogOut size={18} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-2xl
                    bg-gray-50 dark:bg-white/5">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sage-500 to-sage-700
                      text-white text-[12px] font-bold flex items-center justify-center shadow-sm">
        {initials}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <p className="text-[12.5px] font-semibold truncate flex items-center gap-1">
          {user.name}
          {user.role === 'admin' && (
            <Crown size={11} strokeWidth={2.6} className="text-amber-500" />
          )}
        </p>
        <p className="text-[10px] text-gray-400 truncate">{user.email}</p>
      </div>
      <button
        onClick={handleLogout}
        className="w-8 h-8 rounded-xl text-gray-400 hover:text-rose-600
                   hover:bg-rose-50 dark:hover:bg-rose-950/30
                   flex items-center justify-center transition-colors shrink-0"
        title="Logga ut"
      >
        <LogOut size={14} />
      </button>
    </div>
  )
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [installPrompt, setInstallPrompt] = useState(null)
  const { user } = useAuth()

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }
  const links = user?.role === 'admin' ? [...baseLinks, ...adminLinks] : baseLinks

  return (
    <div className="min-h-screen flex bg-canvas-light dark:bg-canvas-dark">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col bg-[var(--bg-2,#fbfbfa)] dark:bg-[var(--bg,#15171c)]
                    border-r border-[var(--line,#ececea)] dark:border-[var(--line,#2a2f3a)]
                    transition-all duration-300 ease-silky
                    ${sidebarOpen ? 'w-64' : 'w-[76px]'}`}
      >
        <div className="px-4 pt-5 pb-4 flex items-center border-b border-[var(--line-soft)] mb-1.5">
          <BrandMark compact={!sidebarOpen} />
        </div>

        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {links.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-[11px] rounded-[10px] text-[14.5px] font-medium
                 transition-all duration-150
                 ${isActive
                   ? 'bg-[var(--accent-soft)] text-primary'
                   : 'text-[#6B6560] dark:text-[var(--text-2,#b6bac4)] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'}`
              }
            >
              <Icon size={18} strokeWidth={1.8} className="shrink-0" />
              {sidebarOpen && <span>{label}</span>}
            </NavLink>
          ))}

          <NavLink
            to="/add"
            className={({ isActive }) =>
              `flex items-center gap-3 mt-3 px-3 py-[13px] rounded-xl text-[14.5px] font-semibold
               bg-primary text-white active:scale-[0.98]
               transition-all duration-150
               ${isActive ? 'brightness-110' : 'hover:brightness-110'}`
            }
            style={{ boxShadow: '0 8px 20px -10px rgba(224,122,74,.65)' }}
          >
            <Plus size={18} strokeWidth={2.2} className="shrink-0" />
            {sidebarOpen && <span>Nytt recept</span>}
          </NavLink>
        </nav>

        <div className="px-3 py-3 border-t border-gray-100 dark:border-white/5 space-y-2">
          {installPrompt && (
            <button
              onClick={handleInstall}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl
                         bg-primary/10 text-primary font-semibold text-sm
                         hover:bg-primary/20 transition-colors"
            >
              <Download size={18} strokeWidth={2.2} />
              {sidebarOpen && 'Installera app'}
            </button>
          )}
          <UserPill compact={!sidebarOpen} />
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="w-11 h-11 flex items-center justify-center rounded-2xl
                         text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10
                         transition-all duration-200"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header — glassmorphic */}
        <header className="md:hidden sticky top-0 z-30 glass">
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <BrandMark />
            <div className="flex items-center gap-1">
              {user && (
                <NavLink
                  to="/activity"
                  className={({ isActive }) =>
                    `w-10 h-10 rounded-2xl flex items-center justify-center
                     transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:bg-white/40 dark:hover:bg-white/5'}`
                  }
                  title="Aktivitet"
                >
                  <ActivityIcon size={18} />
                </NavLink>
              )}
              <ThemeToggle />
              {user && <UserPill compact />}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 md:px-8 md:py-8 pb-28 md:pb-10 overflow-auto">
          <div className="max-w-6xl mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>

      <Navbar />
      <CookingDock />
      <FeedbackButton />
    </div>
  )
}
