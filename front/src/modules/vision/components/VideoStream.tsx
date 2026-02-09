import type { ReactNode } from "react"

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
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-muted-foreground">Sin conexion</p>
        </div>
      )}
      {children}
    </div>
  )
}
