import { useCallback, useEffect, useRef, useState } from "react"
import type { FrameData } from "@/types"
import type { ConnectionState, FpsStats } from "./useWebRTC"
import { parseFrame } from "@/lib/streamFraming"

const RECONNECT_DELAYS = [1000, 2000, 4000, 10000]
const CODEC = "avc1.42E01E" // H.264 Baseline 3.0 — HW decode garantizado en Android moderno
const DECODE_QUEUE_THRESHOLD = 3

// Acceso tipado a la API global sin depender de DOM lib WebCodecs (vite/tsconfig
// puede no incluirla). Usamos any-cast localizado.
type AnyVideoDecoder = {
  new (init: {
    output: (frame: VideoFrameLike) => void
    error: (e: Error) => void
  }): VideoDecoderLike
  isConfigSupported: (config: VideoDecoderConfig) => Promise<{ supported: boolean }>
}

type VideoDecoderConfig = {
  codec: string
  hardwareAcceleration?: "no-preference" | "prefer-hardware" | "prefer-software"
  optimizeForLatency?: boolean
}

type VideoDecoderLike = {
  configure: (config: VideoDecoderConfig) => void
  decode: (chunk: EncodedVideoChunkLike) => void
  close: () => void
  state: string
  decodeQueueSize: number
}

type EncodedVideoChunkLike = unknown
type VideoFrameLike = {
  displayWidth: number
  displayHeight: number
  close: () => void
}

function getVideoDecoder(): AnyVideoDecoder | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { VideoDecoder?: AnyVideoDecoder }
  return w.VideoDecoder ?? null
}

function makeChunk(
  type: "key" | "delta",
  timestamp: number,
  data: BufferSource,
): EncodedVideoChunkLike {
  const Ctor = (window as unknown as { EncodedVideoChunk: new (init: unknown) => EncodedVideoChunkLike })
    .EncodedVideoChunk
  return new Ctor({ type, timestamp, data })
}

export function useWebCodecsStream() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const decoderRef = useRef<VideoDecoderLike | null>(null)
  const configuredRef = useRef(false)
  const droppedCountRef = useRef(0)
  // Config resuelta por isConfigSupported — reusada en decoder.configure()
  // para evitar "Unsupported configuration" cuando el browser normaliza flags
  // (e.g. hardwareAcceleration "prefer-hardware" → "no-preference" en laptops
  // sin HW H264 decode).
  const probedConfigRef = useRef<VideoDecoderConfig | null>(null)

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

  const closeDecoder = useCallback(() => {
    const dec = decoderRef.current
    if (dec) {
      try {
        if (dec.state !== "closed") dec.close()
      } catch (e) {
        console.debug("[wc] decoder.close error:", e)
      }
      decoderRef.current = null
    }
    configuredRef.current = false
  }, [])

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current
    if (attempt >= RECONNECT_DELAYS.length) {
      console.warn("[wc] Max reconnect attempts reached — marking failed")
      setConnectionState("failed")
      return
    }
    const delay = RECONNECT_DELAYS[attempt]
    console.log(`[wc] Reconectando intento ${attempt + 1} en ${delay}ms`)
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptRef.current = attempt + 1
      setReconnectAttempt(attempt + 1)
      openWsRef.current?.()
    }, delay)
  }, [])

  const openWs = useCallback(async () => {
    clearFpsInterval()
    frameCountRef.current = 0
    inferenceFrameCountRef.current = 0
    droppedCountRef.current = 0
    setConnectionState("connecting")

    const Decoder = getVideoDecoder()
    if (!Decoder) {
      console.warn("[wc] VideoDecoder API no disponible en este navegador")
      setConnectionState("failed")
      return
    }

    // Intentamos primero con prefer-hardware (Android moderno HW garantizado);
    // si falla bajamos a la config minimal. Guardamos la config normalizada
    // que retorna isConfigSupported para reusarla en configure() y evitar
    // mismatch entre lo probado y lo configurado.
    const attempts: VideoDecoderConfig[] = [
      { codec: CODEC, hardwareAcceleration: "prefer-hardware", optimizeForLatency: true },
      { codec: CODEC, optimizeForLatency: true },
      { codec: CODEC },
    ]
    let workingConfig: VideoDecoderConfig | null = null
    for (const cfg of attempts) {
      try {
        const probe = await Decoder.isConfigSupported(cfg)
        if (probe.supported) {
          const resolved = (probe as { config?: VideoDecoderConfig }).config
          workingConfig = resolved ?? cfg
          break
        }
      } catch (e) {
        console.debug("[wc] probe threw, trying next:", e)
      }
    }
    if (!workingConfig) {
      console.warn(
        "[wc] codec no soportado en este navegador — cambiar a modo mjpeg o webrtc",
      )
      setConnectionState("failed")
      return
    }
    probedConfigRef.current = workingConfig
    console.log("[wc] decoder config:", workingConfig)

    closeDecoder()
    const decoder = new Decoder({
      output: (frame: VideoFrameLike) => {
        const canvas = canvasRef.current
        if (!canvas) {
          frame.close()
          return
        }
        if (
          canvas.width !== frame.displayWidth ||
          canvas.height !== frame.displayHeight
        ) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
        }
        const ctx = canvas.getContext("2d")
        // drawImage acepta VideoFrame (WebCodecs CanvasImageSource extension).
        // El tipo del DOM lib base no lo refleja; cast localizado.
        ctx?.drawImage(frame as unknown as CanvasImageSource, 0, 0)
        frame.close()
        frameCountRef.current++
      },
      error: (e: Error) => {
        console.error("[wc] decoder error:", e)
        setConnectionState("failed")
      },
    })
    decoderRef.current = decoder
    configuredRef.current = false

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${proto}//${window.location.host}/ws/wc-stream`
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    wsRef.current = ws
    closingRef.current = false

    ws.onopen = () => {
      setConnectionState("connected")
    }

    ws.onclose = () => {
      if (closingRef.current) {
        setConnectionState("disconnected")
        return
      }
      clearFpsInterval()
      closeDecoder()
      setConnectionState("failed")
      scheduleReconnect()
    }

    ws.onerror = (e) => {
      console.debug("[wc] ws error", e)
    }

    ws.onmessage = (ev) => {
      const dec = decoderRef.current
      if (!dec) return
      let header
      let payload: Uint8Array
      try {
        const parsed = parseFrame(ev.data as ArrayBuffer)
        header = parsed.header
        payload = parsed.payload
      } catch (e) {
        console.error("[wc] message parse error:", e)
        return
      }

      // Antes de tener el primer keyframe no podemos configure() — descartamos
      // P-frames silenciosamente hasta el próximo IDR.
      if (!configuredRef.current && !header.is_keyframe) {
        return
      }
      if (!configuredRef.current && header.is_keyframe) {
        const cfg = probedConfigRef.current ?? { codec: CODEC }
        try {
          dec.configure(cfg)
          configuredRef.current = true
        } catch (e) {
          console.error("[wc] decoder.configure failed:", e, "config:", cfg)
          setConnectionState("failed")
          return
        }
      }

      // Drop policy: si la cola interna se acumula y no es keyframe, descartar
      // P-frames hasta el próximo IDR para no acumular latencia.
      if (
        dec.decodeQueueSize > DECODE_QUEUE_THRESHOLD &&
        !header.is_keyframe
      ) {
        droppedCountRef.current++
        return
      }

      try {
        // Copia fresca para que el tipo sea Uint8Array<ArrayBuffer> (no
        // ArrayBufferLike). EncodedVideoChunk va a copiar igual, así que el
        // costo extra es nulo en la práctica.
        const data = new Uint8Array(payload)
        const chunk = makeChunk(
          header.is_keyframe ? "key" : "delta",
          header.timestamp_us ?? 0,
          data,
        )
        dec.decode(chunk)
      } catch (e) {
        console.error("[wc] decode dispatch failed:", e)
        return
      }

      setFrameData({
        count: 0,
        target_class: header.target_class ?? "",
        detections: header.detections ?? [],
        session_active: !!header.session_active,
        session_total: header.session_total ?? 0,
        error: header.error ?? null,
      })
      if (header.session_active) inferenceFrameCountRef.current++
    }

    fpsIntervalRef.current = setInterval(() => {
      setFps({
        streamFps: frameCountRef.current,
        inferenceFps: inferenceFrameCountRef.current,
      })
      if (droppedCountRef.current > 0) {
        console.log(
          `[wc] dropped ${droppedCountRef.current} P-frames waiting for keyframe`,
        )
      }
      frameCountRef.current = 0
      inferenceFrameCountRef.current = 0
      droppedCountRef.current = 0
    }, 1000)
  }, [clearFpsInterval, closeDecoder, scheduleReconnect])

  useEffect(() => {
    openWsRef.current = () => {
      void openWs()
    }
  }, [openWs])

  const connect = useCallback(async () => {
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    await openWs()
  }, [openWs])

  const disconnect = useCallback(() => {
    closingRef.current = true
    clearFpsInterval()
    clearReconnectTimeout()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    closeDecoder()
    setFrameData(null)
    setFps({ streamFps: 0, inferenceFps: 0 })
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)
    setConnectionState("disconnected")
  }, [clearFpsInterval, clearReconnectTimeout, closeDecoder])

  useEffect(() => {
    return () => {
      closingRef.current = true
      clearFpsInterval()
      clearReconnectTimeout()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      closeDecoder()
    }
  }, [clearFpsInterval, clearReconnectTimeout, closeDecoder])

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
