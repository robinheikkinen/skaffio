import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import SkaffioLogo from '../components/SkaffioLogo'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-canvas-light dark:bg-canvas-dark px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <SkaffioLogo size={40} />
          <div className="flex items-center gap-2 text-primary">
            <Shield size={18} />
            <h1 className="text-2xl font-bold">Integritetspolicy</h1>
          </div>
          <p className="text-sm text-gray-500">Senast uppdaterad: juni 2026</p>
        </div>

        <div className="surface-card p-6 space-y-6 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">

          <section className="space-y-2">
            <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">Personuppgiftsansvarig</h2>
            <p>
              Robin Heikkinen<br />
              <a href="mailto:contact@example.com" className="text-primary underline">
                contact@example.com
              </a>
            </p>
            <p className="text-gray-500 text-xs">
              Skaffio är en privat app för inbjudna användare. Den drivs inte i kommersiellt syfte.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">Vilka uppgifter lagras</h2>
            <ul className="space-y-1 ml-3 list-disc list-inside">
              <li>E-postadress och namn (via Google-inloggning)</li>
              <li>Recept, ingredienser och instruktioner</li>
              <li>Pantry-varor med mängd och utgångsdatum</li>
              <li>Inköpslistor och måltidsplaner</li>
              <li>IP-adresser (inloggningshistorik för kontosäkerhet)</li>
              <li>Aktivitetslogg (vad du gjort i appen)</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">Syfte och rättslig grund</h2>
            <p>
              Uppgifterna används uteslutande för att driva Skaffio-appen — planera mat,
              hantera skafferi och generera recept. Rättslig grund är berättigat intresse
              (du har accepterat en personlig inbjudan).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">Var lagras data</h2>
            <ul className="space-y-1 ml-3 list-disc list-inside">
              <li>Primär databas: privat server i Sverige (SQLite)</li>
              <li>Krypterade backuper: Backblaze B2 och lokal backup-server</li>
              <li>Inloggning hanteras via Cloudflare Access (Google OAuth)</li>
            </ul>
            <p className="text-gray-500 text-xs">Retention: data bevaras tills kontot raderas. Backuper behålls 7 dagar.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">AI-tjänster</h2>
            <p>
              När du använder AI-funktioner (recept-förslag, pantry-analys, bildtolkning) kan
              relevanta delar av din data — som ingredienslistor och pantryinnehåll — skickas
              till en eller flera av följande tjänster:
            </p>
            <ul className="space-y-1 ml-3 list-disc list-inside text-gray-500">
              <li>Staik (lokal AI-instans)</li>
              <li>Google Gemini</li>
              <li>GitHub Models</li>
              <li>Anthropic Claude</li>
            </ul>
            <p>Ingen data säljs eller delas i annat syfte.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">Dina rättigheter</h2>
            <ul className="space-y-1 ml-3 list-disc list-inside">
              <li>
                <strong>Rätt till export</strong> — ladda ner all din data under
                Säkerhet → "Ladda ner mina uppgifter"
              </li>
              <li>
                <strong>Rätt till radering</strong> — radera ditt konto och all data under
                Säkerhet → "Radera konto permanent"
              </li>
              <li>
                <strong>Rätt att kontakta</strong> — frågor skickas till{' '}
                <a href="mailto:contact@example.com" className="text-primary underline">
                  contact@example.com
                </a>
              </li>
            </ul>
          </section>

        </div>

        <div className="text-center">
          <Link to="/login" className="text-sm text-primary hover:underline">
            ← Tillbaka till appen
          </Link>
        </div>
      </div>
    </div>
  )
}
