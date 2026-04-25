import { useEffect, useMemo, useRef, useState } from "react"
import { useBlocker } from "react-router-dom"
import { toast } from "sonner"
import { Circle, MapPin, Settings, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { Camellon } from "@/types"
import { getCamellones } from "@/api/camellones"
import { useWebRTC } from "@/hooks/useWebRTC"
import { useCounting } from "@/hooks/useCounting"
import { useDeviceContext } from "@/hooks/useDeviceContext"
import { useRecording } from "@/hooks/useRecording"
import { useAppMode } from "@/context/AppModeContext"
import VideoStream from "./components/VideoStream"
import ObjectPicker from "./components/ObjectPicker"
import CountOverlay from "./components/CountOverlay"
import CountingConfigDialog from "./components/CountingConfigDialog"
import SaveDialog from "./components/SaveDialog"

function formatDuration(start: Date | null): string {
  if (!start) return "0s"
  const secs = Math.floor((Date.now() - start.getTime()) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function VisionPage() {
  const { videoRef, connectionState, frameData, fps, connect, disconnect } =
    useWebRTC()
  const counting = useCounting()
  const recording = useRecording()
  const { mode } = useAppMode()
  const { context: deviceContext } = useDeviceContext(mode === "robot")

  const [step, setStep] = useState<"pick" | "operate">("pick")
  const [selectedClass, setSelectedClass] = useState("")
  const [durationStr, setDurationStr] = useState("0s")
  const [camellones, setCamellones] = useState<Camellon[]>([])
  const [configOpen, setConfigOpen] = useState(false)

  const loadCamellones = () => {
    getCamellones().then(setCamellones).catch(console.error)
  }

  useEffect(() => {
    loadCamellones()
  }, [])

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

  // Block navigation while camera is active
  const blocker = useBlocker(busy || isRecording)
  useEffect(() => {
    if (blocker.state === "blocked") {
      blocker.reset()
      if (isRecording) {
        toast.warning("Detene la grabación antes de salir")
      } else if (isCounting) {
        toast.warning("Detene el conteo y desconecta la camara antes de salir")
      } else {
        toast.warning("Desconecta la camara antes de salir")
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

  const handleDisconnect = async () => {
    if (isRecording) {
      await handleStopRecording()
    }
    disconnect()
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

  if (step === "pick") {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-auto md:flex-1">
        <ObjectPicker
          onSelect={(label) => {
            setSelectedClass(label)
            setStep("operate")
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-auto md:flex-1">
      {/* Config bar: selected class + settings */}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep("pick")}
          disabled={busy}
        >
          ← Cambiar
        </Button>
        <span className="text-sm text-muted-foreground">
          Detectando: <span className="font-medium text-foreground capitalize">{selectedClass}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => setConfigOpen(true)}
          disabled={isCounting}
          title="Configuracion de conteo"
          aria-label="Configuracion de conteo"
        >
          <Settings className="size-4" />
        </Button>
      </div>

      <VideoStream
        videoRef={videoRef}
        connected={connected}
        detections={frameData?.detections}
        showDetections={isCounting && !!frameData}
      >
        {isCounting && frameData && (
          <CountOverlay
            count={frameData.count}
            sessionTotal={counting.sessionTotal}
            targetClass={selectedClass}
          />
        )}
        {connected && (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-2">
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
          </div>
        )}
        {connected && mode === "robot" && (
          <div className="absolute top-2 left-2">
            <Badge
              variant="outline"
              className={`flex items-center gap-1.5 border-none text-xs ${
                deviceContext?.fundo
                  ? "bg-black/60 text-white"
                  : "bg-amber-500/80 text-white"
              }`}
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
          </div>
        )}
      </VideoStream>

      {/* Action bar: connect + counting controls */}
      <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
        {connectionState === "disconnected" || connectionState === "failed" ? (
          <Button onClick={connect}>Conectar</Button>
        ) : connectionState === "connecting" ? (
          <Button disabled>Conectando...</Button>
        ) : (
          <Button variant="destructive" onClick={handleDisconnect}>
            Desconectar
          </Button>
        )}

        {connected && counting.state === "IDLE" && (
          <Button onClick={handleStart}>Iniciar conteo</Button>
        )}

        {connected && isCounting && (
          <>
            <Button variant="destructive" onClick={handleStop}>
              Detener conteo
            </Button>
            <Badge variant="secondary">
              {durationStr}
            </Badge>
          </>
        )}

        {connected && (
          <div className="ml-auto">
            {!isRecording ? (
              <Button
                variant="outline"
                onClick={handleStartRecording}
                disabled={recording.loading}
              >
                <Circle className="size-4 mr-1 fill-red-500 text-red-500" />
                Grabar
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleStopRecording}
                disabled={recording.loading}
              >
                <Square className="size-4 mr-1" />
                Detener grabación
              </Button>
            )}
          </div>
        )}
      </div>

      <CountingConfigDialog open={configOpen} onOpenChange={setConfigOpen} />

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
