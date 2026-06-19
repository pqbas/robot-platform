type CountOverlayProps = {
  count: number
  targetClass: string
}

// Live inference is a visual overlay only. The number shown is the count of
// bounding boxes visible in the current frame (instantaneous, not a session
// total) — the authoritative count is computed offline and shown in the
// sessions list.
export default function CountOverlay({ count, targetClass }: CountOverlayProps) {
  return (
    <div className="absolute right-3 top-3 flex flex-col items-end gap-0.5 text-white tabular-nums">
      <span className="text-6xl font-semibold leading-none drop-shadow-md md:text-7xl">
        {count}
      </span>
      <span className="text-xs uppercase tracking-wider text-white/70">
        <span className="capitalize-first">{targetClass}</span> en pantalla
      </span>
    </div>
  )
}
