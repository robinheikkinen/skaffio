import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <button
      onClick={() => setDark((d) => !d)}
      className="relative w-11 h-11 rounded-2xl flex items-center justify-center
                 text-gray-600 dark:text-gray-300
                 hover:bg-gray-100 dark:hover:bg-white/10
                 active:scale-95 transition-all duration-200 ease-silky"
      aria-label={dark ? 'Byt till ljust läge' : 'Byt till mörkt läge'}
    >
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
          dark ? 'opacity-0 -rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
        }`}
      >
        <Moon size={19} strokeWidth={2.2} />
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
          dark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50'
        }`}
      >
        <Sun size={19} strokeWidth={2.2} />
      </span>
    </button>
  )
}
