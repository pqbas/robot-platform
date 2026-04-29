import { useEffect, useRef } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react"

type CountingLineOverlayProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  mode: string
  threshold: number
  direction: string
  visible: boolean
}

const LINE_COLOR = "rgba(255, 200, 0, 0.9)"
const LINE_WIDTH = 2
const DASH_LEN = 8
const GAP_LEN = 6
const ARROW_OFFSET = 28

const ARROW_BY_DIRECTION: Record<string, React.ComponentType<{ className?: string }>> = {
  left2right: ArrowRight,
  right2left: ArrowLeft,
  top2down: ArrowDown,
  down2top: ArrowUp,
}

export default function CountingLineOverlay({
  videoRef,
  mode,
  threshold,
  direction,
  visible,
}: CountingLineOverlayProps) {
  const lineRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!visible) return
    const line = lineRef.current
    const arrow = arrowRef.current
    const video = videoRef.current
    if (!line || !arrow || !video) return

    function position() {
      if (!video || !line || !arrow) return
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
        const lineX = offsetX + t * videoRect.width
        line.style.left = `${lineX}px`
        line.style.top = `${offsetY}px`
        line.style.width = `${LINE_WIDTH}px`
        line.style.height = `${videoRect.height}px`
        line.style.backgroundImage = `repeating-linear-gradient(to bottom, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`

        // Arrow vertically centered on the line; horizontally pushed to the after-side.
        const arrowDelta = direction === "left2right" ? ARROW_OFFSET : -ARROW_OFFSET
        arrow.style.left = `${lineX + arrowDelta - 12}px`
        arrow.style.top = `${offsetY + videoRect.height / 2 - 12}px`
      } else {
        const lineY = offsetY + t * videoRect.height
        line.style.left = `${offsetX}px`
        line.style.top = `${lineY}px`
        line.style.width = `${videoRect.width}px`
        line.style.height = `${LINE_WIDTH}px`
        line.style.backgroundImage = `repeating-linear-gradient(to right, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`

        const arrowDelta = direction === "top2down" ? ARROW_OFFSET : -ARROW_OFFSET
        arrow.style.left = `${offsetX + videoRect.width / 2 - 12}px`
        arrow.style.top = `${lineY + arrowDelta - 12}px`
      }

      rafRef.current = requestAnimationFrame(position)
    }

    rafRef.current = requestAnimationFrame(position)
    return () => cancelAnimationFrame(rafRef.current)
  }, [videoRef, mode, threshold, direction, visible])

  if (!visible) return null

  const ArrowIcon = ARROW_BY_DIRECTION[direction] ?? ArrowRight

  return (
    <>
      <div ref={lineRef} className="pointer-events-none absolute" />
      <div
        ref={arrowRef}
        className="pointer-events-none absolute flex size-6 items-center justify-center rounded-full bg-black/60"
        style={{ color: LINE_COLOR }}
      >
        <ArrowIcon className="size-4" />
      </div>
    </>
  )
}
