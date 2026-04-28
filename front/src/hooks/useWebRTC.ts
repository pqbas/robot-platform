import { useCallback, useEffect, useRef, useState } from "react"
import type { FrameData } from "@/types"

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed"

export type FpsStats = {
  streamFps: number
  inferenceFps: number
}

export function useWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const [frameData, setFrameData] = useState<FrameData | null>(null)
  const [fps, setFps] = useState<FpsStats>({ streamFps: 0, inferenceFps: 0 })

  // FPS counters (refs to avoid re-renders on every frame)
  const inferenceFrameCount = useRef(0)
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Stream FPS comes from RTCPeerConnection.getStats() — framesDecoded delta
  // over real elapsed time, matching what about:webrtc reports. Counting
  // requestVideoFrameCallback fires double-counts repaints.
  const lastStreamSample = useRef<{ framesDecoded: number; timestamp: number } | null>(null)

  const connect = useCallback(async () => {
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

    // Update FPS display every second.
    // Stream FPS: read framesDecoded from inbound-rtp video stats and divide
    // by real elapsed time. This matches about:webrtc's `framesPerSecond`.
    // Inference FPS: count of data channel messages received in the last second.
    fpsIntervalRef.current = setInterval(async () => {
      let streamFps = 0
      try {
        const stats = await pc.getStats()
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            const framesDecoded = report.framesDecoded ?? 0
            const timestamp = report.timestamp
            const last = lastStreamSample.current
            if (last && timestamp > last.timestamp) {
              const dtSec = (timestamp - last.timestamp) / 1000
              if (dtSec > 0) {
                streamFps = Math.round((framesDecoded - last.framesDecoded) / dtSec)
              }
            }
            lastStreamSample.current = { framesDecoded, timestamp }
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

      const answer = await response.json()
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (e) {
      console.error("WebRTC connection error:", e)
      setConnectionState("failed")
    }
  }, [])

  const disconnect = useCallback(() => {
    if (fpsIntervalRef.current) {
      clearInterval(fpsIntervalRef.current)
      fpsIntervalRef.current = null
    }
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
    setConnectionState("disconnected")
  }, [])

  // Cleanup on unmount — release camera on the backend
  useEffect(() => {
    return () => {
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
    }
  }, [])

  return { videoRef, connectionState, frameData, fps, connect, disconnect }
}
