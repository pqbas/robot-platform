import type { ReactNode } from "react"
import { Video } from "lucide-react"

type VideoStreamProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  connected: boolean
  children?: ReactNode
}

export default function VideoStream({
  videoRef,
  connected,
  children,
}: VideoStreamProps) {
  return (
    <div className="relative flex flex-1 items-center justify-center bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="max-h-full max-w-full"
      />
      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Video className="text-muted-foreground size-10 opacity-40" />
          <p className="text-muted-foreground text-sm">
            Presiona <span className="font-medium text-foreground">Conectar</span> para iniciar la camara
          </p>
        </div>
      )}
      {children}
    </div>
  )
}
