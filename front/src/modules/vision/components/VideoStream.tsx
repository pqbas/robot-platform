import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import type { Detection } from "@/types"
import DetectionOverlay from "./DetectionOverlay"
import CountingLineOverlay from "./CountingLineOverlay"
import RoiOverlay from "./RoiOverlay"

type VideoStreamProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  connected: boolean
  detections?: Detection[]
  showDetections?: boolean
  countingLine?: { mode: string; threshold: number; direction: string } | null
  showRoi?: boolean
  children?: ReactNode
}

export default function VideoStream({
  videoRef,
  connected,
  detections = [],
  showDetections = false,
  countingLine = null,
  showRoi = true,
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
      <RoiOverlay videoRef={videoRef} visible={connected && showRoi} />
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
