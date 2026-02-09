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
    <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
      <div className="rounded-md bg-black/70 px-3 py-2 tabular-nums">
        <p className="text-2xl font-bold text-white">{sessionTotal}</p>
        <p className="text-muted-foreground text-xs">total ({targetClass})</p>
      </div>
      <Badge variant="secondary" className="text-xs tabular-nums">
        En frame: {count}
      </Badge>
    </div>
  )
}
