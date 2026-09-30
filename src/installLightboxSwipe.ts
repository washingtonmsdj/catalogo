const SWIPE_MIN_DISTANCE = 56
const HORIZONTAL_INTENT_RATIO = 1.25

type TouchOrigin = {
  identifier: number
  x: number
  y: number
}

export function installLightboxSwipe() {
  let origin: TouchOrigin | null = null

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) {
      origin = null
      return
    }

    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest('.image-lightbox__stage')) return
    if (target.closest('button, a, input, textarea, select')) return

    const touch = event.touches[0]
    origin = {
      identifier: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
    }
  }, { passive: true })

  document.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) origin = null
  }, { passive: true })

  document.addEventListener('touchcancel', () => {
    origin = null
  }, { passive: true })

  document.addEventListener('touchend', (event) => {
    const start = origin
    origin = null
    if (!start) return

    const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.identifier)
    if (!touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const horizontal = Math.abs(deltaX)
    const vertical = Math.abs(deltaY)

    if (horizontal < SWIPE_MIN_DISTANCE) return
    if (horizontal < vertical * HORIZONTAL_INTENT_RATIO) return

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: deltaX < 0 ? 'ArrowRight' : 'ArrowLeft',
      bubbles: true,
    }))
  }, { passive: true })
}
