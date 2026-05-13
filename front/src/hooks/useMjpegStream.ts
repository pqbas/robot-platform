import { useCallback, useEffect, useRef, useState } from "react"
import type { FrameData } from "@/types"
import type { ConnectionState, FpsStats } from "./useWebRTC"

const RECONNECT_DELAYS = [1000, 2000, 4000, 10000]

export function useMjpegStream() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [frameData, setFrameData] = useState<FrameData | null>(null)
  const [fps, setFps] = useState<FpsStats>({ streamFps: 0, inferenceFps: 0 })
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  const frameCountRef = useRef(0)
  const inferenceFrameCountRef = useRef(0)
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const closingRef = useRef(false)
  // Slot del último JPEG recibido + sus metadatos. onmessage sobreescribe
  // (drop-oldest natural); decodeLoop consume y dibuja.
  const pendingJpegRef = useRef<Uint8Array | null>(null)
  const pendingFrameDataRef = useRef<FrameData | null>(null)
  const decodingRef = useRef(false)

  const openWsRef = useRef<(() => void) | null>(null)

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

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current
    if (attempt >= RECONNECT_DELAYS.length) {
      console.warn("[mjpeg] Max reconnect attempts reached — marking failed")
      setConnectionState("failed")
      return
    }
    const delay = RECONNECT_DELAYS[attempt]
    console.log(`[mjpeg] Reconectando intento ${attempt + 1} en ${delay}ms`)
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptRef.current = attempt + 1
      setReconnectAttempt(attempt + 1)
      openWsRef.current?.()
    }, delay)
  }, [])

  const openWs = useCallback(() => {
    clearFpsInterval()
    frameCountRef.current = 0
    inferenceFrameCountRef.current = 0
    pendingJpegRef.current = null
    pendingFrameDataRef.current = null
    setConnectionState("connecting")

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${proto}//${window.location.host}/ws/stream`
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    wsRef.current = ws
    closingRef.current = false

    ws.onopen = () => {
      setConnectionState("connected")
      // Crédito inicial: autoriza al server a enviar el primer frame. A partir
      // de ahí el decodeLoop devuelve un "ready" por cada frame consumido.
      ws.send("ready")
    }

    ws.onclose = () => {
      if (closingRef.current) {
        setConnectionState("disconnected")
        return
      }
      clearFpsInterval()
      setConnectionState("failed")
      scheduleReconnect()
    }

    ws.onerror = (e) => {
      console.debug("[mjpeg] ws error", e)
    }

    const decodeLoop = async () => {
      if (decodingRef.current) return
      decodingRef.current = true
      try {
        while (pendingJpegRef.current) {
          const jpeg = pendingJpegRef.current
          const data = pendingFrameDataRef.current!
          pendingJpegRef.current = null
          pendingFrameDataRef.current = null

          let bitmap: ImageBitmap | null = null
          try {
            const blob = new Blob([jpeg as BlobPart], { type: "image/jpeg" })
            bitmap = await createImageBitmap(blob)
            const canvas = canvasRef.current
            if (canvas) {
              if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                canvas.width = bitmap.width
                canvas.height = bitmap.height
              }
              const ctx = canvas.getContext("2d")
              ctx?.drawImage(bitmap, 0, 0)
            }

            frameCountRef.current++
            if (data.session_active) inferenceFrameCountRef.current++
            setFrameData(data)
          } catch (e) {
            console.error("[mjpeg] decode error:", e)
          } finally {
            bitmap?.close()
            // Devuelve crédito al server SIEMPRE — aunque el decode falle —
            // para no quedarnos sin frames. Si el WS ya cerró, no enviamos.
            const sock = wsRef.current
            if (sock && sock.readyState === WebSocket.OPEN) {
              sock.send("ready")
            }
          }
        }
      } finally {
        decodingRef.current = false
      }
    }

    ws.onmessage = (ev) => {
      try {
        const buf = ev.data as ArrayBuffer
        const view = new DataView(buf)
        const headerLen = view.getUint32(0, false) // big-endian
        const headerBytes = new Uint8Array(buf, 4, headerLen)
        const header = JSON.parse(new TextDecoder("utf-8").decode(headerBytes))
        const jpegBytes = new Uint8Array(buf, 4 + headerLen)

        // Slot pendiente — sobreescribe si había uno (drop-oldest natural).
        pendingJpegRef.current = jpegBytes
        pendingFrameDataRef.current = {
          count: 0,
          target_class: header.target_class ?? "",
          detections: header.detections ?? [],
          session_active: !!header.session_active,
          session_total: header.session_total ?? 0,
          error: header.error ?? null,
        }
        void decodeLoop()
      } catch (e) {
        console.error("[mjpeg] message parse error:", e)
      }
    }

    fpsIntervalRef.current = setInterval(() => {
      setFps({
        streamFps: frameCountRef.current,
        inferenceFps: inferenceFrameCountRef.current,
      })
      frameCountRef.current = 0
      inferenceFrameCountRef.current = 0
    }, 1000)
  }, [clearFpsInterval, scheduleReconnect])

  useEffect(() => {
    openWsRef.current = openWs
  }, [openWs])

  const connect = useCallback(async () => {
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    openWs()
  }, [openWs])

  const disconnect = useCallback(() => {
    closingRef.current = true
    clearFpsInterval()
    clearReconnectTimeout()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setFrameData(null)
    setFps({ streamFps: 0, inferenceFps: 0 })
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    setConnectionState("disconnected")
  }, [clearFpsInterval, clearReconnectTimeout])

  useEffect(() => {
    return () => {
      closingRef.current = true
      clearFpsInterval()
      clearReconnectTimeout()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [clearFpsInterval, clearReconnectTimeout])

  return {
    canvasRef,
    connectionState,
    frameData,
    fps,
    reconnectAttempt,
    connect,
    disconnect,
  }
}
