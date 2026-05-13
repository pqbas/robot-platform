import { useMjpegStream } from "./useMjpegStream"
import { useWebCodecsStream } from "./useWebCodecsStream"
import { useWebRTC } from "./useWebRTC"
import type { StreamHandle, StreamMode } from "@/types/stream"

function readMode(): StreamMode {
  if (typeof window === "undefined") return "wc"
  const value = localStorage.getItem("stream.mode")
  if (value === "webrtc") return "webrtc"
  if (value === "mjpeg") return "mjpeg"
  return "wc"
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
  if (MODE === "wc") {
    const h = useWebCodecsStream()
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
