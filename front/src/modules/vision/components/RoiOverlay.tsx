import { useEffect, useRef } from "react"

type RoiOverlayProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  visible: boolean
}

const COLOR = "rgba(0, 220, 255, 0.9)"

export default function RoiOverlay({ videoRef, visible }: RoiOverlayProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!visible) return
    const box = boxRef.current
    const video = videoRef.current
    if (!box || !video) return

    function position() {
      if (!video || !box) return
      const videoRect = video.getBoundingClientRect()
      const parentRect = box.parentElement?.getBoundingClientRect()
      if (!parentRect || !video.videoWidth || !video.videoHeight) {
        rafRef.current = requestAnimationFrame(position)
        return
      }

      // Centered square ROI of side = min(videoW, videoH), in display pixels.
      const offsetX = videoRect.left - parentRect.left
      const offsetY = videoRect.top - parentRect.top
      const sxRatio = videoRect.width / video.videoWidth
      const syRatio = videoRect.height / video.videoHeight
      const sqNative = Math.min(video.videoWidth, video.videoHeight)
      const xOffNative = (video.videoWidth - sqNative) / 2

      box.style.left = `${offsetX + xOffNative * sxRatio}px`
      box.style.top = `${offsetY}px`
      box.style.width = `${sqNative * sxRatio}px`
      box.style.height = `${video.videoHeight * syRatio}px`

      rafRef.current = requestAnimationFrame(position)
    }

    rafRef.current = requestAnimationFrame(position)
    return () => cancelAnimationFrame(rafRef.current)
  }, [videoRef, visible])

  if (!visible) return null

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute"
      style={{ outline: `2px dashed ${COLOR}` }}
    />
  )
}
