import type { Session, Camellon } from "@/types"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type SessionsTableProps = {
  sessions: Session[]
  camellones: Map<number, Camellon>
  selectedId: number | null
  onSelect: (session: Session) => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function SessionsTable({
  sessions,
  camellones,
  selectedId,
  onSelect,
}: SessionsTableProps) {
  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        No hay sesiones registradas
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Camellon</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead>Clase</TableHead>
          <TableHead className="text-right">Conteo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((s) => (
          <TableRow
            key={s.id}
            className={
              s.id === selectedId
                ? "bg-muted cursor-pointer"
                : "cursor-pointer"
            }
            onClick={() => onSelect(s)}
          >
            <TableCell>
              {camellones.get(s.camellon_id)?.nombre ?? `#${s.camellon_id}`}
            </TableCell>
            <TableCell>{formatDate(s.start_time)}</TableCell>
            <TableCell>
              <Badge variant="outline">{s.target_class}</Badge>
            </TableCell>
            <TableCell className="text-right">{s.total_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
