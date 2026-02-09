import { useEffect, useMemo, useState } from "react"
import { useBlocker } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useWebRTC } from "@/hooks/useWebRTC"
import { useCounting } from "@/hooks/useCounting"
import VideoStream from "./components/VideoStream"
import ClassSelector from "./components/ClassSelector"
import CountOverlay from "./components/CountOverlay"
import SaveDialog from "./components/SaveDialog"

function formatDuration(start: Date | null): string {
  if (!start) return "0s"
  const secs = Math.floor((Date.now() - start.getTime()) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function VisionPage() {
  const { videoRef, connectionState, frameData, connect, disconnect } =
    useWebRTC()
  const counting = useCounting()

  const [selectedClass, setSelectedClass] = useState("person")
  const [durationStr, setDurationStr] = useState("0s")

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

  const handleStart = () => {
    counting.startCounting(selectedClass)
  }

  const handleStop = () => {
    setDurationStr(formatDuration(counting.startTime))
    counting.stopCounting()
  }

  const handleSave = async (camellon: string) => {
    try {
      await counting.save(camellon)
      toast.success("Sesion guardada")
    } catch (e) {
      toast.error("Error al guardar: " + (e instanceof Error ? e.message : "desconocido"))
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <VideoStream videoRef={videoRef} connected={connected}>
        {isCounting && frameData && (
          <CountOverlay
            count={frameData.count}
            targetClass={selectedClass}
          />
        )}
      </VideoStream>

      <div className="flex items-center gap-3 border-t px-4 py-3">
        {/* Connection controls */}
        {connectionState === "disconnected" || connectionState === "failed" ? (
          <Button onClick={connect}>Conectar</Button>
        ) : connectionState === "connecting" ? (
          <Button disabled>Conectando...</Button>
        ) : (
          <Button variant="destructive" onClick={disconnect}>
            Desconectar
          </Button>
        )}

        <Badge variant="outline">
          {connected
            ? "Conectado"
            : connectionState === "connecting"
              ? "Conectando"
              : connectionState === "failed"
                ? "Error"
                : "Desconectado"}
        </Badge>

        {connected && (
          <>
            <Separator orientation="vertical" className="h-6" />

            <ClassSelector
              value={selectedClass}
              onChange={setSelectedClass}
              disabled={isCounting}
            />

            {counting.state === "IDLE" && (
              <Button onClick={handleStart}>Iniciar conteo</Button>
            )}

            {isCounting && (
              <>
                <Button variant="destructive" onClick={handleStop}>
                  Detener conteo
                </Button>
                <Badge variant="secondary">
                  {durationStr}
                </Badge>
              </>
            )}
          </>
        )}
      </div>

      <SaveDialog
        open={counting.state === "SAVING"}
        lastFrameCount={counting.lastFrameCount}
        duration={savedDuration}
        onSave={handleSave}
        onDiscard={counting.discard}
      />
    </div>
  )
}
