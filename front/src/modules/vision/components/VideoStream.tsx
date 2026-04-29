import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import type { Detection } from "@/types"
import DetectionOverlay from "./DetectionOverlay"
import CountingLineOverlay from "./CountingLineOverlay"

type VideoStreamProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  connected: boolean
  detections?: Detection[]
  showDetections?: boolean
  countingLine?: { mode: string; threshold: number; direction: string } | null
  children?: ReactNode
}

export default function VideoStream({
  videoRef,
  connected,
  detections = [],
  showDetections = false,
  countingLine = null,
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
      <CountingLineOverlay
        videoRef={videoRef}
        mode={countingLine?.mode ?? "horizontal"}
        threshold={countingLine?.threshold ?? 0.5}
        direction={countingLine?.direction ?? "left2right"}
        visible={countingLine != null}
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
