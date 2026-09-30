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
    .filter((dialog) => dialog.getClientRects().length > 0)
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
}

export function installDialogAccessibility() {
  let activeDialog: HTMLElement | null = null
  let returnFocus: HTMLElement | null = null
  let focusFrame = 0

  const syncDialog = () => {
    const dialogs = visibleDialogs()
    const nextDialog = dialogs.at(-1) ?? null
    if (nextDialog === activeDialog) return

    if (!activeDialog && nextDialog && document.activeElement instanceof HTMLElement) {
      returnFocus = document.activeElement
    }

    activeDialog = nextDialog
    window.cancelAnimationFrame(focusFrame)

    if (activeDialog) {
      if (!activeDialog.hasAttribute('tabindex')) activeDialog.tabIndex = -1
      focusFrame = window.requestAnimationFrame(() => {
        const current = visibleDialogs().at(-1)
        if (!current || current !== activeDialog) return
        const first = focusableElements(current)[0]
        ;(first ?? current).focus({ preventScroll: true })
      })
      return
    }

    if (returnFocus?.isConnected) {
      focusFrame = window.requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }))
    }
    returnFocus = null
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

  syncDialog()
}
