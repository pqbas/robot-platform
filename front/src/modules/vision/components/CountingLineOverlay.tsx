import { useEffect, useRef } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react"
import type { MediaRef } from "@/types/stream"

type CountingLineOverlayProps = {
  mediaRef: MediaRef
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
  mediaRef,
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
    const media = mediaRef.current
    if (!line || !arrow || !media) return

    function position() {
      if (!media || !line || !arrow) return
      const mediaRect = media.getBoundingClientRect()
      const parentRect = line.parentElement?.getBoundingClientRect()
      if (!parentRect) {
        rafRef.current = requestAnimationFrame(position)
        return
      }

      const offsetX = mediaRect.left - parentRect.left
      const offsetY = mediaRect.top - parentRect.top
      const t = Math.max(0, Math.min(1, threshold))

      if (mode === "horizontal") {
        const lineX = offsetX + t * mediaRect.width
        line.style.left = `${lineX}px`
        line.style.top = `${offsetY}px`
        line.style.width = `${LINE_WIDTH}px`
        line.style.height = `${mediaRect.height}px`
        line.style.backgroundImage = `repeating-linear-gradient(to bottom, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`

        const arrowDelta = direction === "left2right" ? ARROW_OFFSET : -ARROW_OFFSET
        arrow.style.left = `${lineX + arrowDelta - 12}px`
        arrow.style.top = `${offsetY + mediaRect.height / 2 - 12}px`
      } else {
        const lineY = offsetY + t * mediaRect.height
        line.style.left = `${offsetX}px`
        line.style.top = `${lineY}px`
        line.style.width = `${mediaRect.width}px`
        line.style.height = `${LINE_WIDTH}px`
        line.style.backgroundImage = `repeating-linear-gradient(to right, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`

        const arrowDelta = direction === "top2down" ? ARROW_OFFSET : -ARROW_OFFSET
        arrow.style.left = `${offsetX + mediaRect.width / 2 - 12}px`
        arrow.style.top = `${lineY + arrowDelta - 12}px`
      }

      rafRef.current = requestAnimationFrame(position)
    }

    rafRef.current = requestAnimationFrame(position)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mediaRef, mode, threshold, direction, visible])

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
