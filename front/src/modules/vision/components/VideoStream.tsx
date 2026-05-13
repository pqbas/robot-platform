import type { ReactNode, RefObject } from "react"
import { Loader2 } from "lucide-react"
import type { Detection } from "@/types"
import type { MediaRef } from "@/types/stream"
import DetectionOverlay from "./DetectionOverlay"
import CountingLineOverlay from "./CountingLineOverlay"
import RoiOverlay from "./RoiOverlay"

type VideoStreamProps = {
  kind: "video" | "canvas"
  mediaRef: MediaRef
  connected: boolean
  detections?: Detection[]
  showDetections?: boolean
  countingLine?: { mode: string; threshold: number; direction: string } | null
  showRoi?: boolean
  children?: ReactNode
}

export default function VideoStream({
  kind,
  mediaRef,
  connected,
  detections = [],
  showDetections = false,
  countingLine = null,
  showRoi = true,
  children,
}: VideoStreamProps) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      {kind === "video" ? (
        <video
          ref={mediaRef as RefObject<HTMLVideoElement | null>}
          autoPlay
          playsInline
          muted
          className="max-h-full max-w-full"
        />
      ) : (
        <canvas
          ref={mediaRef as RefObject<HTMLCanvasElement | null>}
          className="max-h-full max-w-full"
        />
      )}
      <RoiOverlay mediaRef={mediaRef} visible={connected && showRoi} />
      <DetectionOverlay
        mediaRef={mediaRef}
        detections={detections}
        visible={showDetections}
      />
      <CountingLineOverlay
        mediaRef={mediaRef}
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
