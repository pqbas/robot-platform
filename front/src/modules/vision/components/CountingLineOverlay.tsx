import { useEffect, useRef } from "react"

type CountingLineOverlayProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  mode: string
  threshold: number
  visible: boolean
}

const LINE_COLOR = "rgba(255, 200, 0, 0.9)"
const LINE_WIDTH = 2
const DASH_LEN = 8
const GAP_LEN = 6

export default function CountingLineOverlay({
  videoRef,
  mode,
  threshold,
  visible,
}: CountingLineOverlayProps) {
  const lineRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!visible) return
    const line = lineRef.current
    const video = videoRef.current
    if (!line || !video) return

    function position() {
      if (!video || !line) return
      const videoRect = video.getBoundingClientRect()
      const parentRect = line.parentElement?.getBoundingClientRect()
      if (!parentRect) {
        rafRef.current = requestAnimationFrame(position)
        return
      }

      const offsetX = videoRect.left - parentRect.left
      const offsetY = videoRect.top - parentRect.top
      const t = Math.max(0, Math.min(1, threshold))

      if (mode === "horizontal") {
        // Vertical line at x = threshold * width — dashes stacked top→bottom
        line.style.left = `${offsetX + t * videoRect.width}px`
        line.style.top = `${offsetY}px`
        line.style.width = `${LINE_WIDTH}px`
        line.style.height = `${videoRect.height}px`
        line.style.backgroundImage = `repeating-linear-gradient(to bottom, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`
      } else {
        // Horizontal line at y = threshold * height — dashes stacked left→right
        line.style.left = `${offsetX}px`
        line.style.top = `${offsetY + t * videoRect.height}px`
        line.style.width = `${videoRect.width}px`
        line.style.height = `${LINE_WIDTH}px`
        line.style.backgroundImage = `repeating-linear-gradient(to right, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`
      }

      rafRef.current = requestAnimationFrame(position)
    }

    rafRef.current = requestAnimationFrame(position)
    return () => cancelAnimationFrame(rafRef.current)
  }, [videoRef, mode, threshold, visible])

  if (!visible) return null

  return (
    <div
      ref={lineRef}
      className="pointer-events-none absolute"
    />
  )
}
