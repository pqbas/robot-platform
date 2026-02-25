import { Badge } from "@/components/ui/badge"

type CountOverlayProps = {
  count: number
  sessionTotal: number
  targetClass: string
}

export default function CountOverlay({
  count,
  sessionTotal,
  targetClass,
}: CountOverlayProps) {
  return (
    <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5 md:right-3 md:top-3 md:gap-2">
      <div className="rounded-md bg-black/70 px-2 py-1.5 tabular-nums md:px-3 md:py-2">
        <p className="text-xl font-bold text-white md:text-2xl">{sessionTotal}</p>
        <p className="text-muted-foreground text-xs">total ({targetClass})</p>
      </div>
      <Badge variant="secondary" className="text-xs tabular-nums">
        En frame: {count}
      </Badge>
    </div>
  )
}
