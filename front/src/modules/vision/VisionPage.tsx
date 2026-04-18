import { useEffect, useMemo, useRef, useState } from "react"
import { useBlocker } from "react-router-dom"
import { toast } from "sonner"
import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { MapLocation } from "@/types"
import { getLocations } from "@/api/locations"
import { useWebRTC } from "@/hooks/useWebRTC"
import { useCounting } from "@/hooks/useCounting"
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

  const [step, setStep] = useState<"pick" | "operate">("pick")
  const [selectedClass, setSelectedClass] = useState("")
  const [durationStr, setDurationStr] = useState("0s")
  const [locations, setLocations] = useState<MapLocation[]>([])
  const [configOpen, setConfigOpen] = useState(false)

  useEffect(() => {
    getLocations().then(setLocations).catch(console.error)
  }, [])

  const connected = connectionState === "connected"
  const isCounting = counting.state === "COUNTING"
  const busy = connected || connectionState === "connecting"

  // Block navigation while camera is active
  const blocker = useBlocker(busy)
  useEffect(() => {
    if (blocker.state === "blocked") {
      blocker.reset()
      if (isCounting) {
        toast.warning("Detene el conteo y desconecta la camara antes de salir")
      } else {
        toast.warning("Desconecta la camara antes de salir")
      }
    }
  }, [blocker, isCounting])

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
          <div className="absolute top-2 right-2 flex gap-2">
            <Badge variant="outline" className="bg-black/60 text-white border-none text-xs">
              Stream: {fps.streamFps} FPS
            </Badge>
            {isCounting && (
              <Badge variant="outline" className="bg-black/60 text-white border-none text-xs">
                YOLO: {fps.inferenceFps} FPS
              </Badge>
            )}
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
          <Button variant="destructive" onClick={disconnect}>
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
      </div>

      <CountingConfigDialog open={configOpen} onOpenChange={setConfigOpen} />

      <SaveDialog
        open={counting.state === "SAVING"}
        totalCount={counting.sessionTotal}
        duration={savedDuration}
        locations={locations}
        onSave={handleSave}
        onDiscard={counting.discard}
      />
    </div>
  )
}
