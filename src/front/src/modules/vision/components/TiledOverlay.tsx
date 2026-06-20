import { useEffect, useRef } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import type { MediaRef } from "@/types/stream"
import { getContentRect, getNaturalSize } from "@/lib/streamMedia"

type TiledOverlayProps = {
  mediaRef: MediaRef
  // Movement direction (tiled is always horizontal): left2right | right2left.
  direction: string
  visible: boolean
}

// Mirrors the worker's tiled geometry (_tile_geometry): two squares of side =
// H/2 (natural height / 2), stacked top/bottom, both centered on the frame's
// vertical axis (x = W/2). Each tile's crossing line is its vertical center —
// which is x = W/2 for both, so a single full-height center line covers both.
const TILE_COLOR = "rgba(0, 220, 255, 0.9)"
const LINE_COLOR = "rgba(255, 200, 0, 0.9)"
const LINE_WIDTH = 2
const DASH_LEN = 8
const GAP_LEN = 6
const ARROW_OFFSET = 28

export default function TiledOverlay({ mediaRef, direction, visible }: TiledOverlayProps) {
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!visible) return
    const top = topRef.current
    const bottom = bottomRef.current
    const line = lineRef.current
    const arrow = arrowRef.current
    const media = mediaRef.current
    if (!top || !bottom || !line || !arrow || !media) return

    function position() {
      if (!media || !top || !bottom || !line || !arrow) return
      const mediaRect = getContentRect(media)
      const parentRect = top.parentElement?.getBoundingClientRect()
      const { w: nw, h: nh } = getNaturalSize(media)
      if (!parentRect || !nw || !nh) {
        rafRef.current = requestAnimationFrame(position)
        return
      }

      const offsetX = mediaRect.left - parentRect.left
      const offsetY = mediaRect.top - parentRect.top
      const sxRatio = mediaRect.width / nw
      const syRatio = mediaRect.height / nh

      // Tile side = H/2 (native), centered horizontally on x = W/2.
      const tileNative = nh / 2
      const xOffNative = (nw - tileNative) / 2
      const left = offsetX + xOffNative * sxRatio
      const wDisp = tileNative * sxRatio
      const hDisp = tileNative * syRatio

      top.style.left = `${left}px`
      top.style.top = `${offsetY}px`
      top.style.width = `${wDisp}px`
      top.style.height = `${hDisp}px`

      bottom.style.left = `${left}px`
      bottom.style.top = `${offsetY + hDisp}px`
      bottom.style.width = `${wDisp}px`
      bottom.style.height = `${hDisp}px`

      // Crossing line at the vertical center (W/2), full height (both tiles).
      const lineX = offsetX + (nw / 2) * sxRatio
      line.style.left = `${lineX}px`
      line.style.top = `${offsetY}px`
      line.style.width = `${LINE_WIDTH}px`
      line.style.height = `${mediaRect.height}px`
      line.style.backgroundImage = `repeating-linear-gradient(to bottom, ${LINE_COLOR} 0 ${DASH_LEN}px, transparent ${DASH_LEN}px ${DASH_LEN + GAP_LEN}px)`

      const arrowDelta = direction === "right2left" ? -ARROW_OFFSET : ARROW_OFFSET
      arrow.style.left = `${lineX + arrowDelta - 12}px`
      arrow.style.top = `${offsetY + mediaRect.height / 2 - 12}px`

      rafRef.current = requestAnimationFrame(position)
    }

    rafRef.current = requestAnimationFrame(position)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mediaRef, direction, visible])

  if (!visible) return null

  const ArrowIcon = direction === "right2left" ? ArrowLeft : ArrowRight

  return (
    <>
      <div
        ref={topRef}
        className="pointer-events-none absolute"
        style={{ outline: `2px dashed ${TILE_COLOR}` }}
      />
      <div
        ref={bottomRef}
        className="pointer-events-none absolute"
        style={{ outline: `2px dashed ${TILE_COLOR}` }}
      />
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
