import { useCallback, useEffect, useRef, useState } from "react"
import type { FrameData } from "@/types"

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed"

export type FpsStats = {
  streamFps: number
  inferenceFps: number
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 10000]
const FREEZE_CYCLES_THRESHOLD = 3 // consecutive 1s cycles with 0 new frames
const ICE_DISCONNECT_CYCLES = 2  // cycles before treating as failed
const NO_FIRST_FRAME_CYCLES = 5  // cycles connected without ever decoding a frame

export function useWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const [frameData, setFrameData] = useState<FrameData | null>(null)
  const [fps, setFps] = useState<FpsStats>({ streamFps: 0, inferenceFps: 0 })
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  // FPS counters (refs to avoid re-renders on every frame)
  const inferenceFrameCount = useRef(0)
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastStreamSample = useRef<{ framesDecoded: number; timestamp: number } | null>(null)

  // Freeze detection state (refs — no re-renders needed)
  const freezeCycleCount = useRef(0)
  const hasDecodedFrames = useRef(false)   // arms the freeze detector after first real frame
  const iceDisconnectCycles = useRef(0)
  const noFirstFrameCycles = useRef(0)     // cycles connected with never-decoded video
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)    // ref mirror so interval closure sees latest value

  // --- helpers ---------------------------------------------------------------

  const clearFpsInterval = useCallback(() => {
    if (fpsIntervalRef.current) {
      clearInterval(fpsIntervalRef.current)
      fpsIntervalRef.current = null
    }
  }, [])

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  // openPeer is forward-declared; reconnect references it via ref so the
  // closure does not capture a stale version.
  const openPeerRef = useRef<(() => Promise<void>) | null>(null)

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current
    if (attempt >= RECONNECT_DELAYS.length) {
      console.warn("[WebRTC] Max reconnect attempts reached — marking failed")
      setConnectionState("failed")
      return
    }
    const delay = RECONNECT_DELAYS[attempt]
    console.log(`[WebRTC] Reconectando intento ${attempt + 1} en ${delay}ms`)
    reconnectTimeoutRef.current = setTimeout(async () => {
      reconnectAttemptRef.current = attempt + 1
      setReconnectAttempt(attempt + 1)
      if (openPeerRef.current) {
        await openPeerRef.current()
      }
    }, delay)
  }, [])

  // ---------------------------------------------------------------------------

  const openPeer = useCallback(async () => {
    clearFpsInterval()

    // Reset freeze-detection state for new peer
    freezeCycleCount.current = 0
    hasDecodedFrames.current = false
    iceDisconnectCycles.current = 0
    noFirstFrameCycles.current = 0
    lastStreamSample.current = null
    inferenceFrameCount.current = 0

    setConnectionState("connecting")

    const pc = new RTCPeerConnection()
    pcRef.current = pc

    pc.addTransceiver("video", { direction: "recvonly" })

    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState)
    }

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState)
      if (pc.connectionState === "connected") {
        setConnectionState("connected")
        iceDisconnectCycles.current = 0
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        setConnectionState("failed")
      }
    }

    pc.ontrack = (event) => {
      console.log("Track received:", event.track.kind)
      if (videoRef.current) {
        videoRef.current.srcObject = event.streams[0]
        videoRef.current.play().catch((e) => console.error("Play error:", e))
      }
    }

    // Create data channel from the frontend side
    const dc = pc.createDataChannel("detections")
    console.log("[WebRTC] Data channel created:", dc.label, "state:", dc.readyState)
    dc.onopen = () => {
      console.log("[WebRTC] Data channel opened:", dc.label)
    }
    dc.onclose = () => {
      console.log("[WebRTC] Data channel closed:", dc.label)
    }
    dc.onmessage = (msg) => {
      try {
        const data: FrameData = JSON.parse(msg.data)
        inferenceFrameCount.current++
        setFrameData(data)
      } catch (e) {
        console.error("[WebRTC] Data channel parse error:", e)
      }
    }

    // FPS + freeze-detection interval (1 s)
    fpsIntervalRef.current = setInterval(async () => {
      let streamFps = 0
      let framesDecodedNow = 0
      try {
        const stats = await pc.getStats()
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            framesDecodedNow = report.framesDecoded ?? 0
            const timestamp = report.timestamp
            const last = lastStreamSample.current
            if (last && timestamp > last.timestamp) {
              const dtSec = (timestamp - last.timestamp) / 1000
              if (dtSec > 0) {
                streamFps = Math.round((framesDecodedNow - last.framesDecoded) / dtSec)
              }
            }
            lastStreamSample.current = { framesDecoded: framesDecodedNow, timestamp }
          }
        })
      } catch (e) {
        console.debug("[WebRTC] getStats failed", e)
      }

      setFps({
        streamFps,
        inferenceFps: inferenceFrameCount.current,
      })
      inferenceFrameCount.current = 0

      // --- freeze / disconnect detection ------------------------------------
      if (pc.connectionState !== "connected") {
        // Track ICE-level disconnects (peer connection still "connected" at
        // connection level but ICE dropped)
        if (pc.iceConnectionState === "disconnected") {
          iceDisconnectCycles.current++
          if (iceDisconnectCycles.current >= ICE_DISCONNECT_CYCLES) {
            console.warn("[WebRTC] ICE disconnected demasiado tiempo, reconectando")
            clearFpsInterval()
            pc.close()
            scheduleReconnect()
          }
        } else {
          iceDisconnectCycles.current = 0
        }
        return
      }

      // Arm the freeze detector only after we have decoded at least one frame
      if (framesDecodedNow > 0) {
        hasDecodedFrames.current = true
      }

      if (!hasDecodedFrames.current) {
        // Connected but no frames ever decoded — backend says ready but the
        // pipeline never primed (black-frame bug after navigating to /vision).
        // Force a reconnect after NO_FIRST_FRAME_CYCLES seconds.
        noFirstFrameCycles.current++
        if (noFirstFrameCycles.current >= NO_FIRST_FRAME_CYCLES) {
          console.warn(
            `[WebRTC] Conectado pero sin frames después de ${NO_FIRST_FRAME_CYCLES}s, reconectando`,
          )
          clearFpsInterval()
          pc.close()
          scheduleReconnect()
        }
        return
      }
      noFirstFrameCycles.current = 0

      if (streamFps === 0) {
        freezeCycleCount.current++
        if (freezeCycleCount.current >= FREEZE_CYCLES_THRESHOLD) {
          console.warn(
            `[WebRTC] Freeze detectado (${FREEZE_CYCLES_THRESHOLD}s sin frames decodificados), reconectando intento ${reconnectAttemptRef.current + 1}`,
          )
          clearFpsInterval()
          pc.close()
          scheduleReconnect()
        }
      } else {
        freezeCycleCount.current = 0
        iceDisconnectCycles.current = 0
      }
    }, 1000)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const response = await fetch("/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: pc.localDescription!.sdp,
          type: pc.localDescription!.type,
        }),
      })

      if (!response.ok) {
        if (response.status === 503) {
          console.warn("[WebRTC] Camera worker not ready (503), reintentando con backoff")
          pc.close()
          scheduleReconnect()
          return
        }
        throw new Error(`Offer rejected: ${response.status}`)
      }

      const answer = await response.json()
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (e) {
      console.error("WebRTC connection error:", e)
      setConnectionState("failed")
    }
  }, [clearFpsInterval, scheduleReconnect])

  // Keep openPeerRef in sync so scheduleReconnect can call the latest version
  useEffect(() => {
    openPeerRef.current = openPeer
  }, [openPeer])

  const connect = useCallback(async () => {
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    await openPeer()
  }, [openPeer])

  const disconnect = useCallback(() => {
    clearFpsInterval()
    clearReconnectTimeout()
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setFrameData(null)
    setFps({ streamFps: 0, inferenceFps: 0 })
    lastStreamSample.current = null
    freezeCycleCount.current = 0
    hasDecodedFrames.current = false
    iceDisconnectCycles.current = 0
    noFirstFrameCycles.current = 0
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    setConnectionState("disconnected")
  }, [clearFpsInterval, clearReconnectTimeout])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearFpsInterval()
      clearReconnectTimeout()
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
    }
  }, [clearFpsInterval, clearReconnectTimeout])

  return { videoRef, connectionState, frameData, fps, reconnectAttempt, connect, disconnect }
}
