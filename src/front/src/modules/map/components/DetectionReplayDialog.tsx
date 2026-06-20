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
import CountingLineOverlay from "@/modules/vision/components/CountingLineOverlay"
import RoiOverlay from "@/modules/vision/components/RoiOverlay"
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
  // Running accumulated count at the currently displayed frame. Null when the
  // sidecar predates the per-frame count field (re-count to populate it).
  const [currentCount, setCurrentCount] = useState<number | null>(null)
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
    setCurrentCount(null)
    getRecordingDetections(session.recording_uuid)
      .then(setDetData)
      .catch(() => toast.error("Error al cargar las detecciones"))
  }, [open, session.recording_uuid])

  // Associate detections to the exact video frame. The MP4 is variable-frame-
  // rate, so a frame's position can't be derived from index*fps; instead each
  // sidecar line carries the frame's own presentation timestamp (`pts`), and we
  // match the player's mediaTime to the frame whose pts is the largest ≤ it.
  // requestVideoFrameCallback gives frame-accurate sync (fires per presented
  // frame, mediaTime = that frame's pts); timeupdate is the fallback.
  useEffect(() => {
    const video = videoRef.current as RVFCVideo | null
    if (!open || !video || !detData) return
    const frames = detData.frames
    if (frames.length === 0) {
      setCurrentDets([])
      return
    }
    // New sidecars carry per-frame `pts`; old ones (pre-VFR-fix) don't — fall
    // back to index*fps for those so their replay still works (re-count to get
    // frame-accurate sync).
    const hasPts = frames[0].pts != null
    const fps = detData.fps ?? 0
    // Solo pintar la clase configurada para el conteo (igual que el contador la
    // filtra). El sidecar `cls` es el model_label, así que filtramos por
    // target_model_label; fallback a target_class (sidecars/configs viejos) y a
    // pintar todas si no hay clase definida.
    const targetClass =
      detData.count_config?.target_model_label ??
      detData.count_config?.target_class ??
      null

    const applyAt = (mediaTime: number) => {
      let idx: number
      if (hasPts) {
        // Largest frame with pts <= mediaTime (the frame currently displayed).
        let lo = 0
        let hi = frames.length - 1
        idx = 0
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          if (frames[mid].pts <= mediaTime) {
            idx = mid
            lo = mid + 1
          } else {
            hi = mid - 1
          }
        }
      } else {
        idx = Math.min(
          frames.length - 1,
          Math.max(0, Math.round(mediaTime * fps)),
        )
      }
      setCurrentDets(
        frames[idx].dets
          .filter((d) => targetClass == null || d.cls === targetClass)
          .map((d) => ({
            class_name: d.cls,
            confidence: d.conf,
            bbox: d.bbox,
            track_id: d.track_id,
          })),
      )
      const c = frames[idx].count
      setCurrentCount(c ?? null)
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

  const cfg = detData?.count_config ?? null

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
          {/* The line/ROI/direction actually used for this count, so the
              operator can see where the counting line was — a 0 count with the
              line off where nothing crosses, or the wrong target class, is then
              obvious. */}
          {cfg && cfg.count_mode && cfg.threshold != null && cfg.direction && (
            <CountingLineOverlay
              mediaRef={videoRef as MediaRef}
              mode={cfg.count_mode}
              threshold={cfg.threshold}
              direction={cfg.direction}
              visible={true}
            />
          )}
          {cfg?.roi_mode === "square" && (
            <RoiOverlay mediaRef={videoRef as MediaRef} visible={true} />
          )}
          {/* Una sola tarjeta arriba a la izquierda: el número contado grande
              fusionado con la config usada para el conteo (clase/línea/ROI). */}
          {(cfg || currentCount !== null) && (
            <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded bg-black/55 px-3 py-2 text-white">
              {currentCount !== null && (
                <div className="flex flex-col items-start leading-none tabular-nums">
                  <span className="text-4xl font-semibold drop-shadow-md md:text-5xl">
                    {currentCount}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-white/70">
                    contados
                  </span>
                </div>
              )}
              {cfg && (
                <div className="flex flex-col gap-0.5 text-[11px] leading-tight text-white/90">
                  {currentCount !== null && (
                    <span className="my-0.5 h-px w-full bg-white/20" />
                  )}
                  <span>
                    Clase: <span className="font-semibold">{cfg.target_class ?? "—"}</span>
                  </span>
                  <span>
                    Línea: {cfg.count_mode ?? "—"} @ {cfg.threshold != null ? cfg.threshold.toFixed(2) : "—"} · {cfg.direction ?? "—"}
                  </span>
                  <span>ROI: {cfg.roi_mode ?? "—"}</span>
                </div>
              )}
            </div>
          )}
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
