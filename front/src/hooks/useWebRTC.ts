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
  const streamFrameCount = useRef(0)
  const inferenceFrameCount = useRef(0)
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

        // Count stream frames via requestVideoFrameCallback
        const video = videoRef.current
        if ("requestVideoFrameCallback" in video) {
          const countFrame = () => {
            streamFrameCount.current++
            video.requestVideoFrameCallback(countFrame)
          }
          video.requestVideoFrameCallback(countFrame)
        }
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

    // Update FPS display every second
    fpsIntervalRef.current = setInterval(() => {
      setFps({
        streamFps: streamFrameCount.current,
        inferenceFps: inferenceFrameCount.current,
      })
      streamFrameCount.current = 0
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
