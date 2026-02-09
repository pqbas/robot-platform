import { Badge } from "@/components/ui/badge"

type CountOverlayProps = {
  count: number
  targetClass: string
}

export default function CountOverlay({ count, targetClass }: CountOverlayProps) {
  return (
    <div className="absolute right-3 top-3">
      <Badge variant="secondary" className="text-sm">
        En frame: {count} ({targetClass})
      </Badge>
    </div>
  )
}
