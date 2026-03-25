import { useCallback, useEffect, useRef, useState } from "react"
import type { FrameData } from "@/types"

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed"

export function useWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const [frameData, setFrameData] = useState<FrameData | null>(null)

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
        setFrameData(data)
      } catch (e) {
        console.error("[WebRTC] Data channel parse error:", e)
      }
    }

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
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setFrameData(null)
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

  return { videoRef, connectionState, frameData, connect, disconnect }
}
