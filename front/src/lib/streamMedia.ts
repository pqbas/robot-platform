export function getNaturalSize(
  el: HTMLVideoElement | HTMLCanvasElement,
): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) {
    return { w: el.videoWidth, h: el.videoHeight }
  }
  return { w: el.width, h: el.height }
}
