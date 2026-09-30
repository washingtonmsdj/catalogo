const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]'
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function visibleDialogs() {
  return Array.from(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR))
    .filter((dialog) => dialog.isConnected && dialog.getClientRects().length > 0)
}

function focusables(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
}

export function installDialogFocusManagement() {
  let activeDialog: HTMLElement | null = null
  const returnFocus = new WeakMap<HTMLElement, HTMLElement>()

  const sync = () => {
    const dialogs = visibleDialogs()
    const nextDialog = dialogs.at(-1) ?? null
    if (nextDialog === activeDialog) return

    const previousDialog = activeDialog
    activeDialog = nextDialog

    if (nextDialog) {
      if (!returnFocus.has(nextDialog)) {
        const origin = document.activeElement
        if (origin instanceof HTMLElement) returnFocus.set(nextDialog, origin)
      }

      queueMicrotask(() => {
        if (activeDialog !== nextDialog || !nextDialog.isConnected) return
        if (nextDialog.contains(document.activeElement)) return
        const [first] = focusables(nextDialog)
        if (first) {
          first.focus({ preventScroll: true })
          return
        }
        nextDialog.tabIndex = -1
        nextDialog.focus({ preventScroll: true })
      })
      return
    }

    if (previousDialog) {
      const origin = returnFocus.get(previousDialog)
      if (origin?.isConnected) queueMicrotask(() => origin.focus({ preventScroll: true }))
    }
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !activeDialog?.isConnected) return

    const items = focusables(activeDialog)
    if (!items.length) {
      event.preventDefault()
      activeDialog.tabIndex = -1
      activeDialog.focus({ preventScroll: true })
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const focused = document.activeElement

    if (event.shiftKey && (focused === first || !activeDialog.contains(focused))) {
      event.preventDefault()
      last.focus({ preventScroll: true })
      return
    }

    if (!event.shiftKey && (focused === last || !activeDialog.contains(focused))) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }, true)

  document.addEventListener('focusin', (event) => {
    if (!activeDialog?.isConnected) return
    const target = event.target
    if (target instanceof Node && activeDialog.contains(target)) return
    const [first] = focusables(activeDialog)
    ;(first ?? activeDialog).focus({ preventScroll: true })
  })

  sync()
}
