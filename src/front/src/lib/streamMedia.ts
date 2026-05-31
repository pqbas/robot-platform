export function getNaturalSize(
  el: HTMLVideoElement | HTMLCanvasElement,
): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) {
    return { w: el.videoWidth, h: el.videoHeight }
  }
  return { w: el.width, h: el.height }
}

/**
 * Viewport-space rectangle of the actually-displayed image inside a media
 * element rendered with `object-fit: contain`. The element box may be larger
 * than the image (letterbox bars), so overlays must align to this content rect
 * — not to `getBoundingClientRect()` — when the frame is a fixed size.
 *
 * Falls back to the element box while the natural size is still unknown.
 */
export function getContentRect(
  el: HTMLVideoElement | HTMLCanvasElement,
): { left: number; top: number; width: number; height: number } {
  const rect = el.getBoundingClientRect()
  const { w: nw, h: nh } = getNaturalSize(el)
  if (!nw || !nh) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }
  const elAspect = rect.width / rect.height
  const natAspect = nw / nh
  let width: number
  let height: number
  if (elAspect > natAspect) {
    // Element is wider than the image → bars on left/right, height fills.
    height = rect.height
    width = height * natAspect
  } else {
    // Element is taller than the image → bars on top/bottom, width fills.
    width = rect.width
    height = width / natAspect
  }
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  }
}
