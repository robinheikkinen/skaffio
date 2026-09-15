import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { sv } from 'date-fns/locale'
import toast from 'react-hot-toast'
import {
  Sparkles, X, Send, Bot, User, Heart, Clock, ChefHat, Wand2, Check, AlertCircle,
  UtensilsCrossed, Calendar, ShoppingCart,
} from 'lucide-react'
import { aiPlan, aiStatus, generateShoppingList, createShoppingList } from '../api'

const SUGGESTIONS = [
  { icon: Heart,  text: 'Gör en barnvänlig matsedel för veckan' },
  { icon: Clock,  text: 'Snabba vardagsmiddagar under 25 minuter' },
  { icon: ChefHat, text: 'Vegetarisk vecka med variation' },
  { icon: Wand2,  text: 'Använd det vi redan har hemma' },
]

function MessageBubble({ msg, onApplyPlan, onBuyShopping }) {
  const navigate = useNavigate()
  const isUser = msg.role === 'user'
  const firstRecipeId = msg.plan?.find((e) => e.recipe_id)?.recipe_id

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 shadow-sm
                       ${isUser
                         ? 'bg-primary text-white'
                         : 'bg-gradient-to-br from-sage-500 to-sage-700 text-white'}`}>
        {isUser ? <User size={16} strokeWidth={2.4} /> : <Bot size={16} strokeWidth={2.4} />}
      </div>
      <div className={`max-w-[82%] rounded-3xl px-4 py-3 text-[14px] leading-relaxed
                       ${isUser
                         ? 'bg-primary text-white rounded-tr-md'
                         : 'bg-gray-100 dark:bg-white/5 text-gray-800 dark:text-gray-100 rounded-tl-md'}`}>
        {msg.content}
        {msg.plan && msg.plan.length > 0 && (
          <>
            <div className="mt-3 space-y-1.5">
              {msg.plan.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 bg-white/70 dark:bg-black/30 rounded-2xl px-3 py-2 text-[12.5px]">
                  <span className="font-semibold text-primary capitalize">
                    {format(new Date(entry.date), 'EEE d MMM', { locale: sv })}
                  </span>
                  <span className="text-gray-500">·</span>
                  <span className="font-medium truncate">{entry.recipe?.title || `#${entry.recipe_id}`}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-gray-400">{entry.meal_type}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {firstRecipeId && (
                <button
                  onClick={() => navigate(`/recipes/${firstRecipeId}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium
                             bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200
                             hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                >
                  <UtensilsCrossed size={13} />
                  Laga nu
                </button>
              )}
              <button
                onClick={onApplyPlan}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium
                           bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Calendar size={13} />
                Lägg i plan
              </button>
              <button
                onClick={onBuyShopping}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium
                           bg-sage-100 dark:bg-sage-900/30 text-sage-800 dark:text-sage-200
                           hover:bg-sage-200 dark:hover:bg-sage-900/50 transition-colors"
              >
                <ShoppingCart size={13} />
                Köp saknade varor
              </button>
            </div>
          </>
        )}
        {msg.error && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-amber-200">
            <AlertCircle size={13} />
            {msg.error}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AIChatDrawer({ open, onClose, weekStart, onPlanApplied }) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hej! 👋 Jag är Skaffio – din lokala AI-kock. Berätta hur du vill planera veckan så föreslår jag måltider från dina egna recept!',
    },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [aiOnline, setAiOnline] = useState(null)
  const [aiDetail, setAiDetail] = useState('')
  const [pendingPlan, setPendingPlan] = useState(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    aiStatus()
      .then((s) => {
        setAiOnline(s.ollama === 'online')
        setAiDetail(s.detail || '')
      })
      .catch(() => {
        setAiOnline(false)
        setAiDetail('')
      })
    setTimeout(() => inputRef.current?.focus(), 250)
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, sending])

  const send = async (text) => {
    const prompt = (text ?? input).trim()
    if (!prompt || sending) return
    setMessages((m) => [...m, { role: 'user', content: prompt }])
    setInput('')
    setSending(true)
    try {
      const res = await aiPlan(prompt, { startDate: format(weekStart, 'yyyy-MM-dd') })
      if (!res.ok) {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: res.message || 'Något gick fel.',
          error: res.detail || (res.reason === 'ollama_offline' ? 'AI är offline – kontrollera AI_API_URL/AI_API_KEY.' : null),
        }])
      } else {
        setMessages((m) => [...m, {
          role: 'assistant',
          content: res.summary || 'Här är ett förslag på veckans plan!',
          plan: res.plan,
        }])
        setPendingPlan(res.plan)
      }
    } catch (e) {
      setMessages((m) => [...m, {
        role: 'assistant',
        content: 'Hoppsan, något gick fel. Försök igen om en stund.',
        error: e.message,
      }])
    } finally {
      setSending(false)
    }
  }

  const applyPlan = async (planOverride) => {
    const plan = planOverride ?? pendingPlan
    if (!plan?.length) return
    setSending(true)
    if (planOverride) setPendingPlan(planOverride)
    try {
      const res = await aiPlan(
        'Spara samma plan som diskuterades.',
        { startDate: format(weekStart, 'yyyy-MM-dd'), commit: true }
      )
      if (res.ok) {
        toast.success(`${res.plan.length} måltider tillagda i planen!`)
        setPendingPlan(null)
        onPlanApplied?.()
      } else {
        toast.error(res.message || 'Kunde inte spara planen')
      }
    } finally {
      setSending(false)
    }
  }

  const handleBuyShopping = async (plan) => {
    if (!plan?.length) return
    const recipeIds = [...new Set(plan.map((e) => e.recipe_id).filter(Boolean))]
    if (!recipeIds.length) return
    const t = toast.loading('Förbereder inköpslista...')
    try {
      const items = await generateShoppingList(recipeIds)
      const label = `AI-veckohandling ${format(weekStart, 'd MMM', { locale: sv })}`
      await createShoppingList({ name: label, items: JSON.stringify(items) })
      toast.success(`${items.length} varor sparade!`, { id: t })
      onClose()
      navigate('/shopping')
    } catch (e) {
      toast.error(e.message || 'Kunde inte skapa lista', { id: t })
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm
                    transition-opacity duration-300
                    ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Drawer */}
      <aside
        className={`fixed z-50 inset-y-0 right-0 w-full sm:w-[440px]
                    bg-surface-light dark:bg-surface-dark
                    border-l border-gray-100 dark:border-white/10
                    shadow-lift flex flex-col
                    transition-transform duration-300 ease-silky
                    ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-label="AI-måltidsplanerare"
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-gray-100 dark:border-white/10
                           bg-gradient-to-br from-primary/10 via-pastel-peach/30 to-pastel-butter/30
                           dark:from-primary/10 dark:via-primary/5 dark:to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-primary-700
                              flex items-center justify-center shadow-md">
                <Sparkles size={22} className="text-white" strokeWidth={2.2} />
              </div>
              <div>
                <h2 className="font-bold text-[17px] tracking-tight">AI-kocken</h2>
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    aiOnline === null ? 'bg-gray-400' : aiOnline ? 'bg-sage-500 animate-pulse' : 'bg-amber-500'
                  }`} />
                  {aiOnline === null ? 'Kollar status...' : aiOnline ? 'AI online' : 'Offline – manuellt läge'}
                  {!aiOnline && aiDetail && (
                    <span className="text-[10px] text-amber-600 ml-2" title={aiDetail}>
                      {aiDetail}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-2xl flex items-center justify-center
                         hover:bg-white/40 dark:hover:bg-white/5 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              msg={m}
              onApplyPlan={() => m.plan && applyPlan(m.plan)}
              onBuyShopping={() => handleBuyShopping(m.plan)}
            />
          ))}

          {sending && (
            <div className="flex gap-2.5">
              <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-sage-500 to-sage-700
                              flex items-center justify-center shrink-0">
                <Bot size={16} className="text-white" />
              </div>
              <div className="bg-gray-100 dark:bg-white/5 rounded-3xl rounded-tl-md px-4 py-3
                              flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {/* Initial suggestions */}
          {messages.length === 1 && !sending && (
            <div className="space-y-2 pt-2">
              <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold px-1">Förslag</p>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s.text)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-2xl
                             bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10
                             text-left transition-all duration-200 ease-silky
                             active:scale-[0.98]"
                >
                  <div className="w-9 h-9 rounded-xl bg-pastel-peach/70 text-orange-800
                                  flex items-center justify-center shrink-0">
                    <s.icon size={17} strokeWidth={2.2} />
                  </div>
                  <span className="text-[14px] font-medium">{s.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pending plan action bar */}
        {pendingPlan && pendingPlan.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-white/10
                          bg-sage-50 dark:bg-sage-900/20 flex items-center gap-3">
            <span className="text-[13px] flex-1">
              <span className="font-semibold text-sage-800 dark:text-sage-200">{pendingPlan.length} måltider</span> redo att läggas till.
            </span>
            <button onClick={() => setPendingPlan(null)} className="btn-ghost text-sm py-2">Avbryt</button>
            <button onClick={applyPlan} disabled={sending} className="btn-sage text-sm">
              <Check size={16} />
              Lägg till
            </button>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send() }}
          className="px-4 py-4 border-t border-gray-100 dark:border-white/10 flex gap-2 items-end"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="Berätta vad du vill äta i veckan..."
            className="input resize-none max-h-32 py-3"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="w-12 h-12 rounded-2xl bg-primary text-white shadow-sm
                       hover:shadow-md hover:bg-primary-600 active:scale-95
                       disabled:opacity-40 disabled:active:scale-100
                       transition-all duration-200 ease-silky
                       flex items-center justify-center shrink-0"
          >
            <Send size={18} strokeWidth={2.2} />
          </button>
        </form>
      </aside>
    </>
  )
}
