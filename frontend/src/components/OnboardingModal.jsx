import { useState, useEffect } from 'react'
import {
  Home, Package, ShoppingCart, Calendar, Sparkles, Inbox,
  ChefHat, Folder, X, ArrowRight, ArrowLeft, Check, Download,
} from 'lucide-react'
import SkaffioLogo from './SkaffioLogo'
import { MascotFrasse } from './Mascots'

const STEPS = [
  {
    icon: null,
    title: 'Välkommen till Skaffio!',
    subtitle: 'Din smarta kökskompis',
    body: 'Skaffio hjälper dig hålla koll på vad du har hemma, planera middagar och hitta recept — med lite hjälp av AI. Låt oss gå igenom vad du kan göra.',
    color: 'from-orange-400 to-rose-400',
  },
  {
    icon: Home,
    title: 'Recept',
    subtitle: 'Din receptsamling',
    body: 'Startsidan visar alla recept i ditt hushåll. Ser du inga recept än? Då behöver du gå med i ett hushåll — gå till Säkerhet → Hushåll och ange inbjudningskoden du fått. Väl inne ser du alla recept direkt. Du kan också importera recept från en URL, ladda upp ett foto av ett receptkort, eller lägga till manuellt. AI-söket förstår naturligt språk — prova "snabb kyckling" eller "vegetariskt för barn".',
    color: 'from-amber-400 to-orange-400',
    features: ['Gå med i hushåll via inbjudningskod under Säkerhet', 'Import från URL, foto eller PDF', 'AI-sökning på naturligt språk', 'Filtrera på taggar och favoriter'],
  },
  {
    icon: Package,
    title: 'Pantry',
    subtitle: 'Vad du har hemma',
    body: 'Håll koll på vad som finns i kyl, frys och skafferi. Skaffio vet vad du har hemma och kan föreslå recept baserat på det. Du kan scanna ett kassakvitto så fyller AI:n på pantry automatiskt.',
    color: 'from-emerald-400 to-teal-500',
    features: ['Kyl, frys, skafferi & mer', 'Kvittoskanning med AI', 'Utgångsdatum och varningar', 'AI-matförslag från det du har hemma'],
  },
  {
    icon: ShoppingCart,
    title: 'Inköpslista',
    subtitle: 'Handla smartare',
    body: 'Skapa inköpslistor manuellt eller generera automatiskt från recept du planerar laga. Appen slår ihop dubbletter och visar vad du saknar jämfört med din pantry. Du kan dela listan med någon via en länk — de kan bocka av direkt i sin webbläsare utan att logga in.',
    color: 'from-sky-400 to-blue-500',
    features: ['Generera från recept', 'Dela via länk utan inloggning', 'Bocka av i realtid'],
  },
  {
    icon: Calendar,
    title: 'Måltidsplan',
    subtitle: 'Planera veckan',
    body: 'Planera vilka recept du ska laga vilka dagar. AI:n kan föreslå en hel veckas matsedel baserat på dina recept och vad du har hemma. Du kan exportera planen som iCal och lägga till den i din vanliga kalender.',
    color: 'from-violet-400 to-purple-500',
    features: ['AI-planering för hela veckor', 'iCal-export till Google/Apple Kalender'],
  },
  {
    icon: Sparkles,
    title: 'AI-funktioner',
    subtitle: 'Din smarta assistent',
    body: 'Flera ställen i appen har AI-hjälp inbyggt. På startsidan kan du fråga "Vad kan jag laga med det jag har?" — AI:n tittar i din pantry och föreslår recept. På ett recept kan du trycka på en ingrediens för att få ett substitut om du saknar den hemma.',
    color: 'from-fuchsia-400 to-pink-500',
    features: ['Matförslag från pantry med stämningsläge', 'Ingrediens-substitut med förklaring', 'AI-genererade Game Plans för batch-cooking'],
  },
  {
    icon: ChefHat,
    title: 'Prep-Master',
    subtitle: 'Batch-laga flera recept',
    body: 'Välj 2–6 recept du vill laga samtidigt. AI:n skapar en optimerad "Game Plan" med konsoliderade ingredienser, parallellt arbete och ugnsoptimering — så du lagar allt på kortast möjliga tid. Perfekt för söndagskok.',
    color: 'from-orange-400 to-amber-500',
    features: ['Konsoliderade ingredienser', 'Parallellt arbete i köket', 'Interaktiv checklista med progress'],
  },
  {
    icon: Folder,
    title: 'Mer i appen',
    subtitle: 'Finns under "Mer"',
    body: 'Under Mer-knappen hittar du fler funktioner: Inkorg (recept som väntar på granskning), Samlingar (organisera recept i mappar), Bildbank (alla uppladdade bilder), Bokmärken (importera recept från webbläsarbokmärken), och Aktivitetslogg.',
    color: 'from-teal-400 to-cyan-500',
    features: ['Inkorg för granskade recept', 'Samlingar / mappar', 'Bokmärkesimport'],
  },
  {
    icon: Download,
    title: 'Installera som app',
    subtitle: 'Snabbaste sättet att öppna Skaffio',
    body: 'Skaffio fungerar som en riktig app på din telefon — utan App Store. Öppna sidan i webbläsaren och installera den direkt på hemskärmen.',
    color: 'from-blue-400 to-indigo-500',
    features: [
      'Android (Chrome): Tryck på ⋮ → "Lägg till på startskärmen"',
      'iPhone (Safari): Tryck på dela-ikonen → "Lägg till på hemskärmen"',
      'Fungerar offline och startar utan adressfält — precis som en vanlig app',
      'OBS: öppna sidan i webbläsaren (inte PWA-ikonen) för att installera om du inte ser alternativet',
    ],
  },
]

const STORAGE_KEY = 'skaffio.onboarded'

export function useOnboarding() {
  const [show, setShow] = useState(() => !localStorage.getItem(STORAGE_KEY))

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setShow(false)
  }

  const reopen = () => setShow(true)

  return { show, dismiss, reopen }
}

export default function OnboardingModal({ onDone }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const isFirst = step === 0

  const next = () => isLast ? onDone() : setStep((s) => s + 1)
  const prev = () => setStep((s) => s - 1)

  const Icon = current.icon

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onDone} />

      {/* Sheet / Modal */}
      <div className="relative w-full md:max-w-md bg-canvas-light dark:bg-canvas-dark
                      rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden
                      flex flex-col max-h-[90vh] overscroll-contain">

        {/* Gradient header */}
        <div className={`bg-gradient-to-br ${current.color} p-6 flex flex-col items-center justify-center gap-3 shrink-0`}>
          <button
            onClick={onDone}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/20 flex items-center justify-center text-white"
          >
            <X size={14} />
          </button>
          {Icon ? (
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
              <Icon size={32} className="text-white" strokeWidth={1.8} />
            </div>
          ) : (
            <MascotFrasse size={80} animation="wob" />
          )}
          <div className="text-center">
            <h2 className="text-xl font-bold text-white">{current.title}</h2>
            {current.subtitle && (
              <p className="text-white/80 text-sm mt-0.5">{current.subtitle}</p>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
            {current.body}
          </p>
          {current.features && (
            <ul className="space-y-2">
              {current.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-400">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <Check size={9} className="text-primary" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2 space-y-4 shrink-0">
          {/* Step dots */}
          <div className="flex justify-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === step
                    ? 'w-5 h-2 bg-primary'
                    : 'w-2 h-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300'
                }`}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={prev}
                className="btn-ghost flex items-center gap-1.5 px-4"
              >
                <ArrowLeft size={16} />
                Föregående
              </button>
            )}
            <button
              onClick={next}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {isLast ? (
                <>
                  <Check size={16} strokeWidth={2.5} />
                  Kom igång!
                </>
              ) : (
                <>
                  Nästa
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
