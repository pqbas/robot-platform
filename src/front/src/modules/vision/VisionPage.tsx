import { useEffect, useMemo, useRef, useState } from "react"
import { useBlocker } from "react-router-dom"
import { toast } from "sonner"
import { Circle, Monitor, Play, RefreshCw, ScanEye, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useStream } from "@/hooks/useStream"
import { useCounting } from "@/hooks/useCounting"
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
import { getCountingConfig, type CountingConfig } from "@/api/config"
import { apiFetch } from "@/api/client"
import {
  NO_DETECTOR,
  SELECTED_LABEL_KEY,
  fromSelectKey,
  toSelectKey,
} from "@/lib/detectorSelection"

const PREFERRED_DEFAULT_LABEL = "blueberry"

function formatDuration(start: Date | null): string {
  if (!start) return "0s"
  const secs = Math.floor((Date.now() - start.getTime()) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function VisionPage() {
  const stream = useStream()
  const { kind, mediaRef, connectionState, frameData, fps, connect } = stream
  const counting = useCounting()
  const { mode } = useAppMode()
  const resolution = useCameraResolution(mode === "robot")

  const [selectedClass, setSelectedClass] = useState("")
  const [selectedModelFilename, setSelectedModelFilename] = useState("")
  // "Sin detector" picked in Settings: record the video, run no inference.
  // Read once on mount — navigating back here remounts the page.
  const [noDetector] = useState(
    () => localStorage.getItem(SELECTED_LABEL_KEY) === NO_DETECTOR,
  )
  const [labels, setLabels] = useState<AvailableLabelItem[]>([])
  const [labelsLoading, setLabelsLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [durationStr, setDurationStr] = useState("0s")
  const [countingConfig, setCountingConfig] = useState<CountingConfig | null>(null)

  // Fetch counting config once on mount so the line + arrow can render before
  // pressing "Contar". `handleStart` also refreshes it to catch /settings edits.
  useEffect(() => {
    getCountingConfig().then(setCountingConfig).catch(console.error)
  }, [])

  // Fetch labels, restore last selection from localStorage
  useEffect(() => {
    let cancelled = false
    getAvailableLabels()
      .then((items) => {
        if (cancelled) return
        setLabels(items)
        setLabelsLoading(false)
        const stored = localStorage.getItem(SELECTED_LABEL_KEY) ?? ""
        if (items.length === 0 || stored === NO_DETECTOR) return
        const { label: storedLabel, model_filename: storedFile } = fromSelectKey(stored)
        const initial =
          items.find((i) => i.label === storedLabel && i.model_filename === storedFile) ??
          items.find((i) => i.label === storedLabel) ??
          items.find((i) => i.label === PREFERRED_DEFAULT_LABEL) ??
          items[0]
        setSelectedClass(initial.label)
        setSelectedModelFilename(initial.model_filename)
        // Don't auto-push selection to backend on mount — that overrides
        // whatever the user last picked in Settings. ObjectPicker fires
        // selectLabel only when the user explicitly changes the class.
      })
      .catch(() => {
        if (!cancelled) setLabelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist selection in the SAME composite format Settings uses,
  // so the two pages stay in sync via localStorage.
  useEffect(() => {
    if (selectedClass && selectedModelFilename) {
      const key = toSelectKey({ label: selectedClass, model_filename: selectedModelFilename })
      localStorage.setItem(SELECTED_LABEL_KEY, key)
    }
  }, [selectedClass, selectedModelFilename])

  // Auto-connect once labels have resolved. The stream doesn't depend on a
  // model, so we connect even when none are assigned — only counting does.
  useEffect(() => {
    if (!labelsLoading && connectionState === "disconnected") {
      connect()
    }
  }, [labelsLoading, connectionState, connect])

  const handleForcePull = async () => {
    setSyncing(true)
    try {
      await apiFetch("/api/sync/pull", { method: "POST" })
      const fresh = await getAvailableLabels()
      setLabels(fresh)
      if (fresh.length > 0 && !selectedClass && !noDetector) {
        const first = fresh[0]
        setSelectedClass(first.label)
        setSelectedModelFilename(first.model_filename)
        await selectLabel(first.label, first.model_filename)
      }
    } finally {
      setSyncing(false)
    }
  }

  const connected = connectionState === "connected"
  const hasModels = labels.length > 0
  const isCounting = counting.state === "COUNTING"
  // The detector is optional: with no model configured the session records the
  // video and nothing else. Recording is owned by the session — there is no
  // separate "Grabar" button, so a run can never produce two videos.
  const hasDetector = hasModels && !!selectedClass && !noDetector

  // Block navigation only while a session is running — idle connections
  // disconnect automatically via useWebRTC's unmount cleanup.
  const blocker = useBlocker(isCounting)
  useEffect(() => {
    if (blocker.state === "blocked") {
      blocker.reset()
      if (isCounting) {
        toast.warning("Detén la sesión antes de salir")
      }
    }
  }, [blocker, isCounting])

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
      const cfg = await getCountingConfig()
      setCountingConfig(cfg)
      setDurationStr("0s")
      // No detector configured -> null: the session records without inference.
      await counting.startCounting(hasDetector ? selectedClass : null)
    } catch (e) {
      toast.error("Error al iniciar la sesión: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  const handleStop = async () => {
    setDurationStr(formatDuration(counting.startTime))
    try {
      await counting.stopCounting()
    } catch (e) {
      toast.error("Error al detener la sesión: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  const handleSave = async () => {
    try {
      await counting.save()
      toast.success("Sesion guardada")
    } catch (e) {
      toast.error("Error al guardar: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  if (labelsLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
        Cargando etiquetas
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col md:h-auto md:flex-1">
      <VideoStream
        kind={kind}
        mediaRef={mediaRef}
        connected={connected}
        detections={frameData?.detections}
        showDetections={isCounting && hasDetector && !!frameData}
        countingLine={
          connected && hasDetector && countingConfig
            ? {
                mode: countingConfig.count_mode,
                threshold: countingConfig.threshold,
                direction: countingConfig.direction,
              }
            : null
        }
        showRoi={hasDetector && countingConfig?.roi_mode === "square"}
      >
        {isCounting && hasDetector && frameData && (
          <CountOverlay
            count={frameData.detections?.length ?? 0}
            targetClass={selectedClass}
          />
        )}
        {connected && (
          <div className="absolute top-2 left-2 flex flex-col items-start gap-2">
            <div className="flex gap-2">
              <Badge variant="outline" className="bg-black/60 text-white border-none text-xs">
                Stream: {fps.streamFps} FPS
              </Badge>
              {isCounting && hasDetector && (
                <Badge variant="outline" className="bg-black/60 text-white border-none text-xs">
                  YOLO: {fps.inferenceFps} FPS
                </Badge>
              )}
            </div>
            {isCounting && (
              <Badge
                variant="destructive"
                className="bg-red-600/90 text-white border-none text-xs flex items-center gap-1.5 animate-pulse"
              >
                <Circle className="size-2 fill-current" />
                REC {durationStr}
              </Badge>
            )}
            <Badge
              variant="outline"
              className="bg-black/60 text-white border-none text-xs flex items-center gap-1.5"
            >
              <ScanEye className="size-3" />
              {hasDetector ? (
                <>
                  <span className="opacity-70">Detectando</span>
                  <span className="font-medium capitalize">{selectedClass}</span>
                </>
              ) : (
                <span className="opacity-70">Sin detector — solo video</span>
              )}
            </Badge>
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

      {!hasModels && (
        <div className="absolute bottom-4 left-2 z-10 flex max-w-[60%] flex-col items-start gap-2 rounded-md bg-background/80 px-3 py-2 text-xs backdrop-blur-sm sm:flex-row sm:items-center">
          <span className="text-muted-foreground">
            No hay modelos asignados a este robot — la sesión se grabará sin
            detector y se podrá contar después.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleForcePull}
            disabled={syncing}
          >
            {syncing ? "Sincronizando" : "Sincronizar ahora"}
          </Button>
        </div>
      )}

      {/* Action bar — overlay on bottom-right, Contar/Detener as last (closest to bottom) */}
      <div className="absolute bottom-4 right-2 z-10 flex flex-col gap-2">
        {connectionState === "failed" && (
          <Button
            variant="outline"
            onClick={connect}
            className="size-16 flex-col gap-1 p-1 text-[10px] leading-tight bg-background/80 backdrop-blur-sm"
            title="Reintentar conexión"
          >
            <RefreshCw className="size-5" />
            <span>Reintentar</span>
          </Button>
        )}

        {connected && counting.state === "IDLE" && (
          <Button
            onClick={handleStart}
            title={
              hasDetector
                ? `Iniciar sesión con detector (${selectedClass})`
                : "Iniciar sesión sin detector — solo graba el video"
            }
            className="size-16 flex-col gap-1 p-1 text-[11px] leading-tight bg-primary/85 backdrop-blur-sm hover:bg-primary"
          >
            <Play className="size-5 fill-current" />
            <span>Iniciar</span>
          </Button>
        )}

        {connected && isCounting && (
          <Button
            variant="destructive"
            onClick={handleStop}
            className="size-16 flex-col gap-1 p-1 text-[11px] leading-tight bg-destructive backdrop-blur-sm hover:bg-destructive"
          >
            <Square className="size-5 fill-current" />
            <span>Detener</span>
          </Button>
        )}
      </div>

      <SaveDialog
        open={counting.state === "SAVING"}
        duration={savedDuration}
        onSave={handleSave}
        onDiscard={counting.discard}
      />
    </div>
  )
}
