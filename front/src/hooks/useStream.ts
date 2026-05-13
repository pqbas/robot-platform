import { useMjpegStream } from "./useMjpegStream"
import { useWebRTC } from "./useWebRTC"
import type { StreamHandle, StreamMode } from "@/types/stream"

function readMode(): StreamMode {
  if (typeof window === "undefined") return "webrtc"
  return localStorage.getItem("stream.mode") === "mjpeg" ? "mjpeg" : "webrtc"
}

// Read once at module load — hook choice is fixed for this page lifetime to
// preserve hooks-rules ordering. Switching modes requires a full reload.
const MODE: StreamMode = readMode()

export function getStreamMode(): StreamMode {
  return MODE
}

export function useStream(): StreamHandle {
  /* eslint-disable react-hooks/rules-of-hooks */
  if (MODE === "mjpeg") {
    const h = useMjpegStream()
    return {
      kind: "canvas",
      mediaRef: h.canvasRef,
      connectionState: h.connectionState,
      frameData: h.frameData,
      fps: h.fps,
      reconnectAttempt: h.reconnectAttempt,
      connect: h.connect,
      disconnect: h.disconnect,
    }
  }
  const h = useWebRTC()
  return {
    kind: "video",
    mediaRef: h.videoRef,
    connectionState: h.connectionState,
    frameData: h.frameData,
    fps: h.fps,
    reconnectAttempt: h.reconnectAttempt,
    connect: h.connect,
    disconnect: h.disconnect,
  }
  /* eslint-enable react-hooks/rules-of-hooks */
}
