import { useEffect, useState } from 'react'
import { Droppable } from 'react-beautiful-dnd'

/**
 * react-beautiful-dnd:s <Droppable> registrerar sig inte under React 18
 * StrictMode (dubbel-mount i dev) — känd bugg, biblioteket underhålls ej.
 * Standard-workaround: aktivera Droppable först efter en animation frame,
 * så att den bara monteras en gång. Påverkar inte produktion.
 */
export default function StrictModeDroppable({ children, ...props }) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEnabled(true))
    return () => {
      cancelAnimationFrame(frame)
      setEnabled(false)
    }
  }, [])

  if (!enabled) return null
  return <Droppable {...props}>{children}</Droppable>
}
