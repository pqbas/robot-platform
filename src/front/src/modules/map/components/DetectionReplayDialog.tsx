import { useEffect, useRef, useState } from "react"
import type { Session, Detection, RecordingDetections } from "@/types"
import type { MediaRef } from "@/types/stream"
import { getRecordingDetections, getRecordingFileUrl } from "@/api/recordings"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import DetectionOverlay from "@/modules/vision/components/DetectionOverlay"
import { Button } from "@/components/ui/button"
import { Maximize, Minimize } from "lucide-react"
import { toast } from "sonner"

type Props = {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function DetectionReplayDialog({ session, open, onOpenChange }: Props) {
  const [detData, setDetData] = useState<RecordingDetections | null>(null)
  const [currentDets, setCurrentDets] = useState<Detection[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current?.requestFullscreen()
    }
  }

  useEffect(() => {
    if (!open || !session.recording_uuid) return
    setDetData(null)
    setCurrentDets([])
    getRecordingDetections(session.recording_uuid)
      .then(setDetData)
      .catch(() => toast.error("Error al cargar las detecciones"))
  }, [open, session.recording_uuid])

  function onTimeUpdate() {
    const video = videoRef.current
    if (!video || !detData) return
    const frames = detData.frames
    if (frames.length === 0) return
    // El campo `frame` del JSONL es el contador de inferencias, no el índice
    // de frame del video, y la inferencia corre más lento que el video. El
    // único eje común es el timestamp `t` (epoch). Anclamos al inicio de la
    // grabación (started_epoch = tiempo 0 del video), NO a la primera detección:
    // hay un warmup de cámara/inferencia antes de la primera detección, así que
    // anclar a frames[0].t adelantaría todo el track ese tiempo. Fallback a
    // frames[0].t para grabaciones viejas sin started_epoch.
    const anchor = detData.started_epoch ?? frames[0].t
    const target = anchor + video.currentTime
    let lo = 0
    let hi = frames.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (frames[mid].t <= target) {
        idx = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (idx < 0) {
      setCurrentDets([])
      return
    }
    setCurrentDets(
      frames[idx].dets.map((d) => ({
        class_name: d.cls,
        confidence: d.conf,
        bbox: d.bbox,
        track_id: d.track_id,
      })),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Replay de sesión #{session.id}</DialogTitle>
        </DialogHeader>
        {/* El overlay es hermano del video, así que el fullscreen nativo del
            <video> lo dejaría fuera. Hacemos fullscreen sobre este contenedor
            (video + canvas juntos) y desactivamos el botón nativo. */}
        <div
          ref={containerRef}
          className="relative flex items-center justify-center bg-black"
        >
          {session.recording_uuid && (
            <video
              ref={videoRef}
              src={getRecordingFileUrl(session.recording_uuid)}
              controls
              controlsList="nofullscreen"
              className={isFullscreen ? "h-full w-full object-contain" : "w-full"}
              onTimeUpdate={onTimeUpdate}
            />
          )}
          <DetectionOverlay
            mediaRef={videoRef as MediaRef}
            detections={currentDets}
            visible={true}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7 bg-black/40 text-white hover:bg-black/60 hover:text-white"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
