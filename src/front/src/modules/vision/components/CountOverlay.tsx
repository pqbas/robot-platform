type CountOverlayProps = {
  sessionTotal: number
  targetClass: string
}

export default function CountOverlay({
  sessionTotal,
  targetClass,
}: CountOverlayProps) {
  return (
    <div className="absolute right-3 top-3 flex flex-col items-end gap-0.5 text-white tabular-nums">
      <span className="text-6xl font-semibold leading-none drop-shadow-md md:text-7xl">
        {sessionTotal}
      </span>
      <span className="text-xs uppercase tracking-wider text-white/70 capitalize-first">
        {targetClass}
      </span>
    </div>
  )
}
