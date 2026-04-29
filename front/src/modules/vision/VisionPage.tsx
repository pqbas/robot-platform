import { useEffect, useMemo, useRef, useState } from "react"
import { useBlocker } from "react-router-dom"
import { toast } from "sonner"
import { Circle, MapPin, Monitor, ScanEye, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { Camellon } from "@/types"
import { getCamellones } from "@/api/camellones"
import { useWebRTC } from "@/hooks/useWebRTC"
import { useCounting } from "@/hooks/useCounting"
import { useDeviceContext } from "@/hooks/useDeviceContext"
import { useRecording } from "@/hooks/useRecording"
import { useCameraResolution } from "@/hooks/useCameraResolution"
import { useAppMode } from "@/context/AppModeContext"
import VideoStream from "./components/VideoStream"
import CountOverlay from "./components/CountOverlay"
import SaveDialog from "./components/SaveDialog"
import {
  getAvailableLabels,
  selectLabel,
  type AvailableLabelItem,
} from "@/api/vision"
import { apiFetch } from "@/api/client"

const SELECTED_LABEL_KEY = "vision.selectedLabel"

function formatDuration(start: Date | null): string {
  if (!start) return "0s"
  const secs = Math.floor((Date.now() - start.getTime()) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function VisionPage() {
  const { videoRef, connectionState, frameData, fps, connect } = useWebRTC()
  const counting = useCounting()
  const recording = useRecording()
  const { mode } = useAppMode()
  const { context: deviceContext } = useDeviceContext(mode === "robot")
  const resolution = useCameraResolution(mode === "robot")

  const [selectedClass, setSelectedClass] = useState("")
  const [labels, setLabels] = useState<AvailableLabelItem[]>([])
  const [labelsLoading, setLabelsLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [durationStr, setDurationStr] = useState("0s")
  const [camellones, setCamellones] = useState<Camellon[]>([])

  const loadCamellones = () => {
    getCamellones().then(setCamellones).catch(console.error)
  }

  useEffect(() => {
    loadCamellones()
  }, [])

  // Fetch labels, restore last selection from localStorage
  useEffect(() => {
    let cancelled = false
    getAvailableLabels()
      .then((items) => {
        if (cancelled) return
        setLabels(items)
        setLabelsLoading(false)
        if (items.length === 0) return
        const stored = localStorage.getItem(SELECTED_LABEL_KEY) ?? ""
        const initial = items.find((i) => i.label === stored) ?? items[0]
        setSelectedClass(initial.label)
        selectLabel(initial.label, initial.model_filename).catch(console.error)
      })
      .catch(() => {
        if (!cancelled) setLabelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist selection
  useEffect(() => {
    if (selectedClass) localStorage.setItem(SELECTED_LABEL_KEY, selectedClass)
  }, [selectedClass])

  // Auto-connect when an object is selected and we're idle
  useEffect(() => {
    if (selectedClass && connectionState === "disconnected") {
      connect()
    }
  }, [selectedClass, connectionState, connect])

  const handleForcePull = async () => {
    setSyncing(true)
    try {
      await apiFetch("/api/sync/pull", { method: "POST" })
      const fresh = await getAvailableLabels()
      setLabels(fresh)
      if (fresh.length > 0 && !selectedClass) {
        const first = fresh[0]
        setSelectedClass(first.label)
        await selectLabel(first.label, first.model_filename)
      }
    } finally {
      setSyncing(false)
    }
  }

  const connected = connectionState === "connected"
  const isCounting = counting.state === "COUNTING"
  const isRecording = recording.recording != null
  const busy = connected || connectionState === "connecting"

  const handleStartRecording = async () => {
    try {
      await recording.start()
      toast.success("Grabación iniciada")
    } catch (e) {
      toast.error(
        "Error al iniciar grabación: " +
          (e instanceof Error ? e.message : "desconocido"),
      )
    }
  }

  const handleStopRecording = async () => {
    try {
      const row = await recording.stop()
      const dur = row.duration_seconds
        ? `${Math.round(row.duration_seconds)}s`
        : "—"
      const size = row.file_size_bytes
        ? `${(row.file_size_bytes / 1_048_576).toFixed(1)} MB`
        : "—"
      toast.success(`Video guardado — ${dur}, ${size}`)
    } catch (e) {
      toast.error(
        "Error al detener grabación: " +
          (e instanceof Error ? e.message : "desconocido"),
      )
    }
  }

  // Block navigation only while counting or recording — idle connections
  // disconnect automatically via useWebRTC's unmount cleanup.
  const blocker = useBlocker(isCounting || isRecording)
  useEffect(() => {
    if (blocker.state === "blocked") {
      blocker.reset()
      if (isRecording) {
        toast.warning("Detén la grabación antes de salir")
      } else if (isCounting) {
        toast.warning("Detén el conteo antes de salir")
      }
    }
  }, [blocker, isCounting, isRecording])

  // Feed frame data to counting hook
  useEffect(() => {
    if (frameData && isCounting) {
      counting.updateFrame(frameData)
    }
  }, [frameData, isCounting, counting.updateFrame])

  // Show inference errors as toast (debounced to avoid spam)
  const lastErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (frameData?.error && frameData.error !== lastErrorRef.current) {
      lastErrorRef.current = frameData.error
      toast.error(`Error de inferencia: ${frameData.error}`)
      setTimeout(() => { lastErrorRef.current = null }, 10_000)
    }
  }, [frameData?.error])

  // Update duration display while counting
  useEffect(() => {
    if (!isCounting) return
    const id = setInterval(() => {
      setDurationStr(formatDuration(counting.startTime))
    }, 1000)
    return () => clearInterval(id)
  }, [isCounting, counting.startTime])

  // Capture duration when stopping
  const savedDuration = useMemo(() => {
    if (counting.state === "SAVING") return durationStr
    return "0s"
  }, [counting.state, durationStr])

  const handleStart = async () => {
    try {
      await counting.startCounting(selectedClass)
    } catch (e) {
      toast.error("Error al iniciar conteo: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  const handleStop = async () => {
    setDurationStr(formatDuration(counting.startTime))
    try {
      await counting.stopCounting()
    } catch (e) {
      toast.error("Error al detener conteo: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  const handleSave = async (camellon: string) => {
    try {
      await counting.save(camellon)
      toast.success("Sesion guardada")
      loadCamellones()
    } catch (e) {
      toast.error("Error al guardar: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  if (labelsLoading) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] flex-1 items-center justify-center text-sm text-muted-foreground">
        Cargando etiquetas
      </div>
    )
  }

  if (labels.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>No hay modelos asignados a este robot.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleForcePull}
          disabled={syncing}
        >
          {syncing ? "Sincronizando" : "Sincronizar ahora"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-auto md:flex-1">
      <VideoStream
        videoRef={videoRef}
        connected={connected}
        detections={frameData?.detections}
        showDetections={isCounting && !!frameData}
      >
        {isCounting && frameData && (
          <CountOverlay
            sessionTotal={counting.sessionTotal}
            targetClass={selectedClass}
          />
        )}
        {connected && (
          <div className="absolute top-2 left-2 flex flex-col items-start gap-2">
            <div className="flex gap-2">
              <Badge variant="outline" className="bg-black/60 text-white border-none text-xs">
                Stream: {fps.streamFps} FPS
              </Badge>
              {isCounting && (
                <Badge variant="outline" className="bg-black/60 text-white border-none text-xs">
                  YOLO: {fps.inferenceFps} FPS
                </Badge>
              )}
            </div>
            {isRecording && (
              <Badge
                variant="destructive"
                className="bg-red-600/90 text-white border-none text-xs flex items-center gap-1.5 animate-pulse"
              >
                <Circle className="size-2 fill-current" />
                REC {recording.durationStr}
              </Badge>
            )}
            {mode === "robot" && (
              <Badge
                variant="outline"
                className="bg-black/60 text-white border-none text-xs flex items-center gap-1.5"
              >
                <MapPin className="size-3" />
                {deviceContext?.fundo ? (
                  <span>
                    <span className="opacity-70">
                      {deviceContext.empresa?.name ?? "—"}
                    </span>
                    <span className="mx-1 opacity-50">›</span>
                    <span className="font-medium">
                      {deviceContext.fundo.name}
                    </span>
                  </span>
                ) : (
                  <span>Sin fundo asignado</span>
                )}
              </Badge>
            )}
            {selectedClass && (
              <Badge
                variant="outline"
                className="bg-black/60 text-white border-none text-xs flex items-center gap-1.5"
              >
                <ScanEye className="size-3" />
                <span className="opacity-70">Detectando</span>
                <span className="font-medium capitalize">{selectedClass}</span>
              </Badge>
            )}
            {mode === "robot" && resolution.preset && (
              <Badge
                variant="outline"
                className="bg-black/60 text-white border-none text-xs flex items-center gap-1.5"
              >
                <Monitor className="size-3" />
                <span className="opacity-70">Resolución</span>
                <span className="font-medium">{resolution.preset}</span>
              </Badge>
            )}
          </div>
        )}
      </VideoStream>

      {/* Action bar */}
      <div className="flex shrink-0 items-center justify-center gap-3 px-4 py-3">
        {connectionState === "failed" && (
          <Button variant="outline" onClick={connect}>
            Reintentar conexión
          </Button>
        )}

        {connected && !isCounting && (
          <Button
            size="lg"
            className="min-w-[180px]"
            onClick={handleStart}
            disabled={counting.state !== "IDLE"}
          >
            <ScanEye className="size-4 mr-2" />
            Contar
          </Button>
        )}

        {connected && isCounting && (
          <Button
            size="lg"
            variant="destructive"
            className="min-w-[180px]"
            onClick={handleStop}
          >
            <Square className="size-4 mr-2 fill-current" />
            Detener
          </Button>
        )}

        {connected && (
          !isRecording ? (
            <Button
              size="lg"
              className="min-w-[180px]"
              onClick={handleStartRecording}
              disabled={recording.loading || counting.state === "SAVING"}
              title="Iniciar grabación"
            >
              <Circle className="size-4 mr-2 fill-red-500 text-red-500" />
              Grabar
            </Button>
          ) : (
            <Button
              size="lg"
              variant="destructive"
              className="min-w-[180px]"
              onClick={handleStopRecording}
              disabled={recording.loading || counting.state === "SAVING"}
              title="Detener grabación"
            >
              <Square className="size-4 mr-2" />
              Detener {recording.durationStr}
            </Button>
          )
        )}
      </div>

      <SaveDialog
        open={counting.state === "SAVING"}
        totalCount={counting.sessionTotal}
        duration={savedDuration}
        camellones={camellones}
        onSave={handleSave}
        onDiscard={counting.discard}
      />
    </div>
  )
}
