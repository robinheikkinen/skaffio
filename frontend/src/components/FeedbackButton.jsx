import { useState } from 'react'
import { MessageSquare, X, Send } from 'lucide-react'

const FEEDBACK_EMAIL = 'contact@example.com'

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const send = () => {
    const subject = encodeURIComponent('Skaffio-feedback')
    const body = encodeURIComponent(text.trim())
    window.open(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`)
    setText('')
    setOpen(false)
  }

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-4 md:left-auto md:bottom-6 md:right-6 z-40
                   w-11 h-11 rounded-2xl shadow-lift
                   bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10
                   text-gray-500 hover:text-primary hover:border-primary/30
                   flex items-center justify-center
                   transition-all duration-200 active:scale-95"
        title="Skicka feedback"
        aria-label="Skicka feedback"
      >
        <MessageSquare size={18} strokeWidth={1.8} />
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-sm surface-card p-5 space-y-4 animate-fade-in
                          rounded-2xl shadow-2xl mb-20 md:mb-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-primary" />
                <p className="font-semibold text-sm">Skicka feedback</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-xl flex items-center justify-center
                           text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Vad fungerar bra? Vad är krångligt? Vad saknas?"
              className="input w-full h-28 resize-none text-sm"
              autoFocus
            />

            <p className="text-xs text-gray-400">
              Öppnar din e-postklient med meddelandet ifyllt.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="btn-secondary flex-1 text-sm"
              >
                Avbryt
              </button>
              <button
                onClick={send}
                disabled={!text.trim()}
                className="btn-primary flex-1 text-sm flex items-center justify-center gap-2
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                Skicka via e-post
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
