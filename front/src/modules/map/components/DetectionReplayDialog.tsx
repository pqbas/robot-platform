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
import { toast } from "sonner"

type Props = {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function DetectionReplayDialog({ session, open, onOpenChange }: Props) {
  const [detData, setDetData] = useState<RecordingDetections | null>(null)
  const [currentDets, setCurrentDets] = useState<Detection[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)

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
    const fps = detData.fps ?? 0
    if (fps <= 0) return
    const frameIdx = Math.floor(video.currentTime * fps)
    const frame = detData.frames[frameIdx]
    if (!frame) {
      setCurrentDets([])
      return
    }
    setCurrentDets(
      frame.dets.map((d) => ({
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
        <div className="relative">
          {session.recording_uuid && (
            <video
              ref={videoRef}
              src={getRecordingFileUrl(session.recording_uuid)}
              controls
              className="w-full"
              onTimeUpdate={onTimeUpdate}
            />
          )}
          <DetectionOverlay
            mediaRef={videoRef as MediaRef}
            detections={currentDets}
            visible={true}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
