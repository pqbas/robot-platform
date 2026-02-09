import type { Session } from "@/types"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import ExportButton from "./ExportButton"

type SessionDetailProps = {
  session: Session
  camellonName: string
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "En curso"
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const secs = Math.floor(ms / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function SessionDetail({
  session,
  camellonName,
}: SessionDetailProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sesion #{session.id}</CardTitle>
        <ExportButton sessionId={session.id} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-muted-foreground">Camellon</span>
          <span>{camellonName}</span>

          <span className="text-muted-foreground">Inicio</span>
          <span>{formatDateTime(session.start_time)}</span>

          <span className="text-muted-foreground">Fin</span>
          <span>
            {session.end_time
              ? formatDateTime(session.end_time)
              : "En curso"}
          </span>

          <span className="text-muted-foreground">Duracion</span>
          <span>{formatDuration(session.start_time, session.end_time)}</span>

          <span className="text-muted-foreground">Clase</span>
          <span>
            <Badge variant="outline">{session.target_class}</Badge>
          </span>

          <span className="text-muted-foreground">Conteo total</span>
          <span className="text-lg font-semibold">{session.total_count}</span>
        </div>
      </CardContent>
    </Card>
  )
}
