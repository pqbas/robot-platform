import { useEffect, useRef } from "react"
import type { Detection } from "@/types"
import type { MediaRef } from "@/types/stream"
import { getNaturalSize } from "@/lib/streamMedia"

type DetectionOverlayProps = {
  mediaRef: MediaRef
  detections: Detection[]
  visible: boolean
}

const FALLBACK_COLOR = "#00FF00"
const FONT = "12px Arial"
const LINE_WIDTH = 2

// Golden-angle hue stepping keeps adjacent track IDs visually distinct.
function colorForTrackId(id: number | null): string {
  if (id == null) return FALLBACK_COLOR
  const hue = (id * 137.508) % 360
  return `hsl(${hue}, 80%, 55%)`
}

export default function DetectionOverlay({
  mediaRef,
  detections,
  visible,
}: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const media = mediaRef.current
    if (!canvas || !media) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    function draw() {
      if (!media || !canvas || !ctx) return

      const mediaRect = media.getBoundingClientRect()
      const parentRect = canvas.parentElement?.getBoundingClientRect()
      if (!parentRect) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const offsetX = mediaRect.left - parentRect.left
      const offsetY = mediaRect.top - parentRect.top

      canvas.style.left = `${offsetX}px`
      canvas.style.top = `${offsetY}px`
      canvas.style.width = `${mediaRect.width}px`
      canvas.style.height = `${mediaRect.height}px`

      if (canvas.width !== mediaRect.width || canvas.height !== mediaRect.height) {
        canvas.width = mediaRect.width
        canvas.height = mediaRect.height
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (!visible || detections.length === 0) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const { w: nw, h: nh } = getNaturalSize(media)
      const sx = canvas.width / (nw || 1)
      const sy = canvas.height / (nh || 1)

      ctx.lineWidth = LINE_WIDTH
      ctx.font = FONT

      for (const det of detections) {
        const [x1, y1, x2, y2] = det.bbox
        const dx = x1 * sx
        const dy = y1 * sy
        const dw = (x2 - x1) * sx
        const dh = (y2 - y1) * sy

        const color = colorForTrackId(det.track_id)
        ctx.strokeStyle = color
        ctx.strokeRect(dx, dy, dw, dh)

        const label = det.track_id != null
          ? `${det.class_name} #${det.track_id} ${(det.confidence * 100).toFixed(0)}%`
          : `${det.class_name} ${(det.confidence * 100).toFixed(0)}%`

        const textWidth = ctx.measureText(label).width
        ctx.fillStyle = "rgba(0,0,0,0.6)"
        ctx.fillRect(dx, dy - 16, textWidth + 6, 16)
        ctx.fillStyle = color
        ctx.fillText(label, dx + 3, dy - 4)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [mediaRef, detections, visible])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute"
    />
  )
}
