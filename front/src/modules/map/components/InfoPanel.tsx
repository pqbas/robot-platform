import { useNavigate } from "react-router-dom"
import type { CamellonGeoSummary } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type InfoPanelProps = {
  camellon: CamellonGeoSummary
  onClose: () => void
}

export default function InfoPanel({ camellon, onClose }: InfoPanelProps) {
  const navigate = useNavigate()

  return (
    <Card className="absolute bottom-4 left-4 z-10 w-64">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{camellon.nombre}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ✕
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">Conteo total</span>
          <span className="font-semibold">{camellon.total_count}</span>

          <span className="text-muted-foreground">Lat</span>
          <span>{camellon.lat?.toFixed(5) ?? "—"}</span>

          <span className="text-muted-foreground">Lng</span>
          <span>{camellon.lng?.toFixed(5) ?? "—"}</span>
        </div>

        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => navigate(`/registro?camellon=${camellon.id}`)}
        >
          Ver sesiones
        </Button>
      </CardContent>
    </Card>
  )
}
