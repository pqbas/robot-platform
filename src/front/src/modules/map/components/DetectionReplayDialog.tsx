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

// requestVideoFrameCallback isn't in every TS DOM lib version; type it locally.
type VideoFrameMeta = { mediaTime: number }
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, metadata: VideoFrameMeta) => void,
  ) => number
  cancelVideoFrameCallback?: (handle: number) => void
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

  // Associate detections to the video by FRAME, never by time. The sidecar is
  // dense (counting-worker writes one line per MP4 frame: line N ↔ frame N), so
  // we map the displayed media time to a frame index `round(mediaTime * fps)`
  // and index `frames` directly. requestVideoFrameCallback gives frame-accurate
  // sync (fires per presented frame); timeupdate is the fallback.
  useEffect(() => {
    const video = videoRef.current as RVFCVideo | null
    if (!open || !video || !detData) return
    const fps = detData.fps
    const frames = detData.frames
    if (!fps || frames.length === 0) {
      setCurrentDets([])
      return
    }

    const applyAt = (mediaTime: number) => {
      const idx = Math.min(
        frames.length - 1,
        Math.max(0, Math.round(mediaTime * fps)),
      )
      setCurrentDets(
        frames[idx].dets.map((d) => ({
          class_name: d.cls,
          confidence: d.conf,
          bbox: d.bbox,
          track_id: d.track_id,
        })),
      )
    }

    let cancelled = false
    let handle = 0
    const onSeeked = () => applyAt(video.currentTime)
    video.addEventListener("seeked", onSeeked)
    applyAt(video.currentTime) // initial paint

    if (typeof video.requestVideoFrameCallback === "function") {
      const loop = (_now: number, metadata: VideoFrameMeta) => {
        if (cancelled) return
        applyAt(metadata.mediaTime)
        handle = video.requestVideoFrameCallback!(loop)
      }
      handle = video.requestVideoFrameCallback(loop)
      return () => {
        cancelled = true
        video.cancelVideoFrameCallback?.(handle)
        video.removeEventListener("seeked", onSeeked)
      }
    }

    const onTimeUpdate = () => applyAt(video.currentTime)
    video.addEventListener("timeupdate", onTimeUpdate)
    return () => {
      cancelled = true
      video.removeEventListener("timeupdate", onTimeUpdate)
      video.removeEventListener("seeked", onSeeked)
    }
  }, [open, detData])

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
