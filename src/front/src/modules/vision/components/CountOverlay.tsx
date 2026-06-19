type CountOverlayProps = {
  targetClass: string
}

// Live inference is a visual overlay only: detection boxes (rendered upstream)
// plus a recording indicator. The authoritative count is computed offline and
// shown in the sessions list, so there is no live number here.
export default function CountOverlay({ targetClass }: CountOverlayProps) {
  return (
    <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-white">
      <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
      <span className="text-xs uppercase tracking-wider">
        Grabando · <span className="capitalize-first">{targetClass}</span>
      </span>
    </div>
  )
}
