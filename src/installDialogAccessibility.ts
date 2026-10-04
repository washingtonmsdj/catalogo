const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function visibleDialogs() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter((dialog) => dialog.isConnected && dialog.getClientRects().length > 0)
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => (
      element.isConnected
      && element.getClientRects().length > 0
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.closest('[inert]')
    ))
}

export function installDialogAccessibility() {
  let activeDialog: HTMLElement | null = null
  const returnFocus = new WeakMap<HTMLElement, HTMLElement>()
  let focusFrame = 0

  const focusInside = (dialog: HTMLElement, preferred?: HTMLElement | null) => {
    window.cancelAnimationFrame(focusFrame)
    focusFrame = window.requestAnimationFrame(() => {
      const current = visibleDialogs().at(-1)
      if (!current || current !== dialog) return
      const items = focusableElements(dialog)
      if (preferred?.isConnected && dialog.contains(preferred) && items.includes(preferred)) {
        preferred.focus({ preventScroll: true })
        return
      }
      if (dialog.contains(document.activeElement)) return
      const first = items[0]
      ;(first ?? dialog).focus({ preventScroll: true })
    })
  }

  const syncDialog = () => {
    const nextDialog = visibleDialogs().at(-1) ?? null
    if (nextDialog === activeDialog) return

    const previousDialog = activeDialog
    activeDialog = nextDialog

    if (nextDialog) {
      if (!nextDialog.hasAttribute('tabindex')) nextDialog.tabIndex = -1
      if (!returnFocus.has(nextDialog) && document.activeElement instanceof HTMLElement) {
        returnFocus.set(nextDialog, document.activeElement)
      }

      const nestedReturn = previousDialog ? returnFocus.get(previousDialog) : null
      focusInside(
        nextDialog,
        nestedReturn?.isConnected && nextDialog.contains(nestedReturn) ? nestedReturn : null,
      )
      return
    }

    window.cancelAnimationFrame(focusFrame)
    const origin = previousDialog ? returnFocus.get(previousDialog) : null
    if (origin?.isConnected) {
      focusFrame = window.requestAnimationFrame(() => origin.focus({ preventScroll: true }))
    }
  }

  const observer = new MutationObserver(syncDialog)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const dialog = visibleDialogs().at(-1)
    if (!dialog) return

    const focusable = focusableElements(dialog)
    if (!focusable.length) {
      event.preventDefault()
      dialog.focus({ preventScroll: true })
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement

    if (event.shiftKey && (current === first || !dialog.contains(current))) {
      event.preventDefault()
      last.focus({ preventScroll: true })
      return
    }

    if (!event.shiftKey && (current === last || !dialog.contains(current))) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }, true)

  document.addEventListener('focusin', (event) => {
    const dialog = visibleDialogs().at(-1)
    if (!dialog) return

    const target = event.target
    if (target instanceof Node && dialog.contains(target)) return

    const first = focusableElements(dialog)[0]
    ;(first ?? dialog).focus({ preventScroll: true })
  }, true)

  syncDialog()
}
