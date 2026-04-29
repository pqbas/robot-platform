import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import type { Detection } from "@/types"
import DetectionOverlay from "./DetectionOverlay"

type VideoStreamProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  connected: boolean
  detections?: Detection[]
  showDetections?: boolean
  children?: ReactNode
}

export default function VideoStream({
  videoRef,
  connected,
  detections = [],
  showDetections = false,
  children,
}: VideoStreamProps) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="max-h-full max-w-full"
      />
      <DetectionOverlay
        videoRef={videoRef}
        detections={detections}
        visible={showDetections}
      />
      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader2 className="size-8 animate-spin text-white/60" />
          <p className="text-sm text-white/60">Conectando...</p>
        </div>
      )}
      {children}
    </div>
  )
}
