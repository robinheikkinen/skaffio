import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { Inbox, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'
import SkaffioLogo from '../components/SkaffioLogo'
import { queueInboxUrl } from '../api'

export default function ShareReceiver() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState('loading') // loading | success | error | no-url
  const [error, setError] = useState('')

  const url = searchParams.get('url') || searchParams.get('text') || ''
  const title = searchParams.get('title') || ''

  useEffect(() => {
    if (!url) {
      setState('no-url')
      return
    }

    const importUrl = url.startsWith('http') ? url : null
    if (!importUrl) {
      setState('no-url')
      return
    }

    queueInboxUrl(importUrl, title)
      .then(() => {
        setState('success')
        // Auto-navigera till inkorg efter 2 sekunder
        setTimeout(() => navigate('/inbox'), 2000)
      })
      .catch((e) => {
        setError(e.message || 'Något gick fel')
        setState('error')
      })
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6
                    bg-canvas-light dark:bg-canvas-dark">
      <SkaffioLogo size={48} />

      {state === 'loading' && (
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
          <p className="font-semibold text-lg">Hämtar recept...</p>
          {url && (
            <p className="text-sm text-gray-500 max-w-xs truncate">{url}</p>
          )}
          <p className="text-xs text-gray-400">Firecrawl + AI analyserar sidan</p>
        </div>
      )}

      {state === 'success' && (
        <div className="text-center space-y-3">
          <CheckCircle size={48} className="mx-auto text-sage-500" />
          <p className="font-semibold text-lg">Receptet är i kö!</p>
          <p className="text-sm text-gray-500">
            AI bearbetar det nu — du hittar det i inkorgen.
          </p>
          <p className="text-xs text-gray-400">Vidarebefordrar till inkorg...</p>
        </div>
      )}

      {state === 'error' && (
        <div className="text-center space-y-4">
          <AlertCircle size={48} className="mx-auto text-red-500" />
          <p className="font-semibold text-lg">Något gick fel</p>
          <p className="text-sm text-gray-500">{error}</p>
          <div className="flex gap-3 justify-center">
            <Link to="/inbox" className="btn-primary">
              <Inbox size={16} />
              Gå till inkorg
            </Link>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                <ExternalLink size={16} />
                Öppna original
              </a>
            )}
          </div>
        </div>
      )}

      {state === 'no-url' && (
        <div className="text-center space-y-4">
          <AlertCircle size={48} className="mx-auto text-amber-500" />
          <p className="font-semibold text-lg">Ingen URL hittades</p>
          <p className="text-sm text-gray-500">
            Dela en receptsida från din webbläsare till Skaffio.
          </p>
          <Link to="/" className="btn-secondary">
            Gå till recepten
          </Link>
        </div>
      )}
    </div>
  )
}
