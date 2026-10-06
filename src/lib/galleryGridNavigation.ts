export type GalleryDirection = 'left' | 'right' | 'up' | 'down'

export function galleryGridColumnCount(gridTemplateColumns: string) {
  const columns = gridTemplateColumns.trim().split(/\s+/).filter(Boolean)
  return Math.max(1, columns.length)
}

export function nextGalleryGridIndex(
  currentIndex: number,
  itemCount: number,
  columns: number,
  direction: GalleryDirection,
) {
  if (itemCount <= 0) return -1
  const current = Math.max(0, Math.min(itemCount - 1, Math.trunc(currentIndex)))
  const step = Math.max(1, Math.trunc(columns))

  if (direction === 'left') return Math.max(0, current - 1)
  if (direction === 'right') return Math.min(itemCount - 1, current + 1)
  if (direction === 'up') return Math.max(0, current - step)
  return Math.min(itemCount - 1, current + step)
}
