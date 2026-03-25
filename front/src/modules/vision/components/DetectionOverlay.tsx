import { useEffect, useRef } from "react"
import type { Detection } from "@/types"

type DetectionOverlayProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  detections: Detection[]
  visible: boolean
}

const BOX_COLOR = "#00FF00"
const FONT = "12px Arial"
const LINE_WIDTH = 2

export default function DetectionOverlay({
  videoRef,
  detections,
  visible,
}: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    function draw() {
      if (!video || !canvas || !ctx) return

      // Position canvas exactly over the video element
      const videoRect = video.getBoundingClientRect()
      const parentRect = canvas.parentElement?.getBoundingClientRect()
      if (!parentRect) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      // Offset of video within parent container
      const offsetX = videoRect.left - parentRect.left
      const offsetY = videoRect.top - parentRect.top

      canvas.style.left = `${offsetX}px`
      canvas.style.top = `${offsetY}px`
      canvas.style.width = `${videoRect.width}px`
      canvas.style.height = `${videoRect.height}px`

      // Set canvas resolution to match video display size
      if (canvas.width !== videoRect.width || canvas.height !== videoRect.height) {
        canvas.width = videoRect.width
        canvas.height = videoRect.height
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (!visible || detections.length === 0) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      // Scale factors: bbox coordinates are in original frame pixels,
      // canvas is in displayed pixels
      const vw = video.videoWidth || 1
      const vh = video.videoHeight || 1
      const sx = canvas.width / vw
      const sy = canvas.height / vh

      ctx.strokeStyle = BOX_COLOR
      ctx.lineWidth = LINE_WIDTH
      ctx.font = FONT

      for (const det of detections) {
        const [x1, y1, x2, y2] = det.bbox
        const dx = x1 * sx
        const dy = y1 * sy
        const dw = (x2 - x1) * sx
        const dh = (y2 - y1) * sy

        ctx.strokeRect(dx, dy, dw, dh)

        const label = det.track_id != null
          ? `${det.class_name} #${det.track_id} ${(det.confidence * 100).toFixed(0)}%`
          : `${det.class_name} ${(det.confidence * 100).toFixed(0)}%`

        const textWidth = ctx.measureText(label).width
        ctx.fillStyle = "rgba(0,0,0,0.6)"
        ctx.fillRect(dx, dy - 16, textWidth + 6, 16)
        ctx.fillStyle = BOX_COLOR
        ctx.fillText(label, dx + 3, dy - 4)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [videoRef, detections, visible])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute"
    />
  )
}
