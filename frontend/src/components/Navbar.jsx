import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home, Package, ShoppingCart, Calendar, Plus, MoreHorizontal,
  Image, Folder, Activity, Bookmark, Shield, KeyRound, X, Inbox, ChefHat,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getInboxCount } from '../api'

const primaryLinks = [
  { to: '/', icon: Home, label: 'Hem' },
  { to: '/pantry', icon: Package, label: 'Pantry' },
  { to: '/add', icon: Plus, label: 'Nytt', primary: true },
  { to: '/shopping', icon: ShoppingCart, label: 'Inköp' },
  { to: '/mealplan', icon: Calendar, label: 'Plan' },
]

const moreLinks = [
  { to: '/inbox', icon: Inbox, label: 'Inkorg', badge: true },
  { to: '/prep-plan', icon: ChefHat, label: 'Prep-Master' },
  { to: '/images', icon: Image, label: 'Bildbank' },
  { to: '/collections', icon: Folder, label: 'Mappar' },
  { to: '/import/bookmarks', icon: Bookmark, label: 'Bokmärken' },
  { to: '/activity', icon: Activity, label: 'Aktivitet' },
  { to: '/security', icon: KeyRound, label: 'Säkerhet' },
]

const adminLinks = [
  { to: '/admin', icon: Shield, label: 'Admin' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) return
    getInboxCount().then((r) => setInboxCount(r.count || 0)).catch(() => {})
    const timer = setInterval(() => {
      getInboxCount().then((r) => setInboxCount(r.count || 0)).catch(() => {})
    }, 30000)
    return () => clearInterval(timer)
  }, [user])

  const extraLinks = user?.role === 'admin' ? [...moreLinks, ...adminLinks] : moreLinks

  const handleMoreNav = (to) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <>
      {/* Bottom navbar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40
                      glass border-t border-gray-200/60 dark:border-white/10
                      pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around px-2 pt-2 pb-2">
          {primaryLinks.map(({ to, icon: Icon, label, primary }) =>
            primary ? (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center justify-center -mt-6"
              >
                <div className="w-14 h-14 rounded-2xl bg-primary text-white shadow-lift
                                flex items-center justify-center
                                active:scale-95 transition-all duration-200 ease-silky">
                  <Icon size={26} strokeWidth={2.4} />
                </div>
              </NavLink>
            ) : (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex-1 max-w-[80px] flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl
                   transition-all duration-200 ease-silky
                   ${isActive
                     ? 'text-primary'
                     : 'text-gray-500 dark:text-gray-400 hover:text-primary'}`
                }
              >
                <Icon size={22} strokeWidth={2.2} />
                <span className="text-[10.5px] font-medium">{label}</span>
              </NavLink>
            )
          )}

          {/* Mer-knapp */}
          <button
            onClick={() => setOpen(true)}
            className="flex-1 max-w-[80px] flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl
                       text-gray-500 dark:text-gray-400 hover:text-primary
                       transition-all duration-200 ease-silky"
          >
            <MoreHorizontal size={22} strokeWidth={2.2} />
            <span className="text-[10.5px] font-medium">Mer</span>
          </button>
        </div>
      </nav>

      {/* Bottom sheet — overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative glass border-t border-gray-200/60 dark:border-white/10
                          rounded-t-3xl px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">Mer</span>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl
                           text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {extraLinks.map(({ to, icon: Icon, label, badge }) => (
                <button
                  key={to}
                  onClick={() => handleMoreNav(to)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-2xl
                             hover:bg-gray-100 dark:hover:bg-white/5
                             active:scale-95 transition-all"
                >
                  <div className="relative w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/10
                                  flex items-center justify-center">
                    <Icon size={22} className="text-gray-600 dark:text-gray-300" strokeWidth={2} />
                    {badge && inboxCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4.5 h-4.5 rounded-full
                                       bg-amber-500 text-white text-[9px] font-bold
                                       flex items-center justify-center leading-none min-w-[18px] px-1">
                        {inboxCount}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
