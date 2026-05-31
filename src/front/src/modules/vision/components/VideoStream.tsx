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
    // The frame is a fixed 16:9 box (the largest that fits the available area),
    // so the displayed size stays constant regardless of camera resolution.
    // The media fills the frame with `object-contain` (letterboxed); overlays
    // align to the content rect via getContentRect — not the element box — so
    // the bars don't throw off detection/line/ROI positioning.
    <div
      className="flex min-h-0 flex-1 items-center justify-center bg-black"
      style={{ containerType: "size" }}
    >
      <div
        className="relative bg-black"
        style={{ width: "min(100cqw, 100cqh * 16 / 9)", aspectRatio: "16 / 9" }}
      >
        {kind === "video" ? (
          <video
            ref={mediaRef as RefObject<HTMLVideoElement | null>}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <canvas
            ref={mediaRef as RefObject<HTMLCanvasElement | null>}
            className="absolute inset-0 h-full w-full object-contain"
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
    </div>
  )
}
