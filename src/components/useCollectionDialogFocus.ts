import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Shared modal keyboard contract for collections panels:
 * focus on open, keep Tab/Shift+Tab inside, Escape closes, restore the opener.
 * Dialog visibility and content remain owned by each existing component.
 */
export function useCollectionDialogFocus(open: boolean, onDismiss: () => void) {
  const dialogRef = useRef<HTMLElement>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden')
    const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? focusable()[0] ?? dialog
    initial.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        dismissRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const targets = focusable()
      if (!targets.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = targets[0]
      const last = targets[targets.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (opener?.isConnected && opener !== document.body) opener.focus()
    }
  }, [open])

  return dialogRef
}
