import { useState } from "react"
import { toast } from "sonner"
import type { Session, Camellon } from "@/types"
import { deleteSession } from "@/api/sessions"
import { recountRecording } from "@/api/recordings"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Pencil, RefreshCw, Trash2, Video } from "lucide-react"
import SessionEditDialog from "./SessionEditDialog"
import DetectionReplayDialog from "./DetectionReplayDialog"

const PAGE_SIZE = 13

type SessionsTableProps = {
  sessions: Session[]
  camellones: Map<number, Camellon>
  selectedId: number | null
  onSelect: (session: Session) => void
  onSessionUpdated: (updated: Session) => void
  onSessionDeleted: (id: number) => void
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
  onSessionUpdated,
  onSessionDeleted,
}: SessionsTableProps) {
  const [page, setPage] = useState(0)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [replaySession, setReplaySession] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [recountingId, setRecountingId] = useState<number | null>(null)

  const handleRecount = async (s: Session) => {
    if (!s.recording_uuid) return
    setRecountingId(s.id)
    // A recording that was never counted has no pinned count_config to
    // reproduce → count with the currently active model. Otherwise reproduce
    // the pinned model, but fall back to the active one if the pin is gone
    // (engine no longer cached → backend returns 409).
    const useActive = s.count_status === "none"
    try {
      let rec
      try {
        rec = await recountRecording(s.recording_uuid, useActive)
      } catch {
        if (useActive) throw new Error("recount failed")
        rec = await recountRecording(s.recording_uuid, true)
      }
      // Reflect the new counting state immediately (poller fills the number).
      onSessionUpdated({ ...s, count_status: rec.count_status, count: rec.count })
      toast.success("Recontando…")
    } catch {
      toast.error("No se pudo re-contar")
    } finally {
      setRecountingId(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteSession(deleting.id)
      onSessionDeleted(deleting.id)
      toast.success("Sesión eliminada")
      setDeleting(null)
    } catch {
      toast.error("Error eliminando la sesión")
    } finally {
      setDeleteBusy(false)
    }
  }

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
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[22%]">Camellon</TableHead>
              <TableHead className="w-[20%]">Fecha</TableHead>
              <TableHead className="hidden md:table-cell w-[16%]">Clase</TableHead>
              <TableHead className="hidden lg:table-cell w-[22%]">Device</TableHead>
              <TableHead className="w-[8%] text-right">Conteo</TableHead>
              <TableHead className="w-[12%] text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((s) => (
              <TableRow
                key={s.id}
                className={s.id === selectedId ? "bg-muted/50 cursor-pointer" : "cursor-pointer"}
                onClick={() => onSelect(s)}
              >
                <TableCell>
                  {camellones.get(s.camellon_id)?.nombre ?? `#${s.camellon_id}`}
                </TableCell>
                <TableCell>{formatDate(s.start_time)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline">{s.target_class}</Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {s.device_id}
                </TableCell>
                <TableCell className="text-right">
                  {s.count_status === "counting" || s.count_status === "pending" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      procesando…
                    </span>
                  ) : s.count_status === "done" ? (
                    s.count ?? s.total_count
                  ) : s.count_status === "error" ? (
                    <span
                      className="text-xs text-destructive"
                      title="Error al contar el video"
                    >
                      error
                    </span>
                  ) : (
                    s.total_count
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-0.5">
                    {s.recording_uuid != null && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Re-contar el video"
                        disabled={
                          recountingId === s.id || s.count_status === "counting"
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRecount(s)
                        }}
                      >
                        {recountingId === s.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                      </Button>
                    )}
                    {s.recording_uuid != null && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Ver grabación"
                        onClick={(e) => {
                          e.stopPropagation()
                          setReplaySession(s)
                        }}
                      >
                        <Video className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Editar"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSession(s)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Eliminar"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(s)
                      }}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
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

      {editingSession && (
        <SessionEditDialog
          session={editingSession}
          open={!!editingSession}
          onOpenChange={(open) => { if (!open) setEditingSession(null) }}
          onSaved={(updated) => {
            onSessionUpdated(updated)
            setEditingSession(null)
          }}
        />
      )}

      {replaySession && (
        <DetectionReplayDialog
          session={replaySession}
          open={!!replaySession}
          onOpenChange={(open) => { if (!open) setReplaySession(null) }}
        />
      )}

      <Dialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar sesión</DialogTitle>
            <DialogDescription>
              Se borran la sesión y sus eventos
              {deleting?.recording_uuid != null
                ? ", junto con la grabación (MP4) vinculada"
                : ""}
              . No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteBusy}
            >
              {deleteBusy ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
