import { useState } from "react"
import type { Session, Camellon } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 13

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
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE))
  const safeePage = Math.min(page, totalPages - 1)
  const paged = sessions.slice(safeePage * PAGE_SIZE, (safeePage + 1) * PAGE_SIZE)

  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        No hay sesiones registradas
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Camellon</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="hidden md:table-cell">Clase</TableHead>
              <TableHead className="text-right">Conteo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((s) => (
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
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline">{s.target_class}</Badge>
                </TableCell>
                <TableCell className="text-right">{s.total_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1 border-t pt-2">
          {Array.from({ length: totalPages }, (_, i) => (
            <Button
              key={i}
              variant={i === safeePage ? "default" : "ghost"}
              size="sm"
              className="h-7 w-7 p-0 text-xs"
              onClick={() => setPage(i)}
            >
              {i + 1}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
