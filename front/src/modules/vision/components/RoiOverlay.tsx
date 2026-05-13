import { useEffect, useRef } from "react"
import type { MediaRef } from "@/types/stream"
import { getNaturalSize } from "@/lib/streamMedia"

type RoiOverlayProps = {
  mediaRef: MediaRef
  visible: boolean
}

const COLOR = "rgba(0, 220, 255, 0.9)"

export default function RoiOverlay({ mediaRef, visible }: RoiOverlayProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!visible) return
    const box = boxRef.current
    const media = mediaRef.current
    if (!box || !media) return

    function position() {
      if (!media || !box) return
      const mediaRect = media.getBoundingClientRect()
      const parentRect = box.parentElement?.getBoundingClientRect()
      const { w: nw, h: nh } = getNaturalSize(media)
      if (!parentRect || !nw || !nh) {
        rafRef.current = requestAnimationFrame(position)
        return
      }

      // Centered square ROI of side = min(natural w, h), in display pixels.
      const offsetX = mediaRect.left - parentRect.left
      const offsetY = mediaRect.top - parentRect.top
      const sxRatio = mediaRect.width / nw
      const syRatio = mediaRect.height / nh
      const sqNative = Math.min(nw, nh)
      const xOffNative = (nw - sqNative) / 2

      box.style.left = `${offsetX + xOffNative * sxRatio}px`
      box.style.top = `${offsetY}px`
      box.style.width = `${sqNative * sxRatio}px`
      box.style.height = `${nh * syRatio}px`

      rafRef.current = requestAnimationFrame(position)
    }

    rafRef.current = requestAnimationFrame(position)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mediaRef, visible])

  if (!visible) return null

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute"
      style={{ outline: `2px dashed ${COLOR}` }}
    />
  )
}
