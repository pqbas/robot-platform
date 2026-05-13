import type { RefObject } from "react"
import type { FrameData } from "@/types"
import type { ConnectionState, FpsStats } from "@/hooks/useWebRTC"

export type StreamMode = "webrtc" | "mjpeg"

export type MediaRef = RefObject<HTMLVideoElement | HTMLCanvasElement | null>

export type StreamHandle = {
  kind: "video" | "canvas"
  mediaRef: MediaRef
  connectionState: ConnectionState
  frameData: FrameData | null
  fps: FpsStats
  reconnectAttempt: number
  connect: () => Promise<void> | void
  disconnect: () => void
}
