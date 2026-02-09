import type { CamellonGeoSummary } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type UnlocatedListProps = {
  camellones: CamellonGeoSummary[]
  locatingId: number | null
  onLocate: (id: number | null) => void
}

export default function UnlocatedList({
  camellones,
  locatingId,
  onLocate,
}: UnlocatedListProps) {
  if (camellones.length === 0) return null

  return (
    <Card className="absolute right-4 top-4 z-10 w-56 max-h-80 overflow-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sin ubicacion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {camellones.map((c) => (
          <Button
            key={c.id}
            variant={locatingId === c.id ? "secondary" : "ghost"}
            size="sm"
            className="w-full justify-start"
            onClick={() => onLocate(locatingId === c.id ? null : c.id)}
          >
            {c.nombre}
            {locatingId === c.id && (
              <span className="ml-auto text-xs text-muted-foreground">
                Click en mapa...
              </span>
            )}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
