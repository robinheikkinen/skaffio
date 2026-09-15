import { useEffect, useRef } from 'react'

/**
 * Request a screen wake lock while the component is mounted and `active` is true.
 * Falls back silently on browsers without the API (Firefox, older iOS Safari).
 *
 * Re-acquires automatically when the tab becomes visible again — wake locks
 * are released by the OS as soon as the page is hidden.
 */
export function useWakeLock(active) {
  const lockRef = useRef(null)

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return

    let cancelled = false

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await lock.release().catch(() => {})
          return
        }
        lockRef.current = lock
        lock.addEventListener('release', () => { lockRef.current = null })
      } catch (e) {
        // user-denied / battery saver / etc. — silent
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !lockRef.current) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (lockRef.current) {
        lockRef.current.release().catch(() => {})
        lockRef.current = null
      }
    }
  }, [active])
}
