import { useState } from "react"
import { toast } from "sonner"
import type { Session, Camellon } from "@/types"
import { deleteSession } from "@/api/sessions"
import { pushSessionNow } from "@/api/sync"
import { useAppMode } from "@/context/AppModeContext"
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
import { Download, Loader2, Pencil, Play, RefreshCw, Trash2, UploadCloud } from "lucide-react"
import { getRecordingFileUrl } from "@/api/recordings"
import { LocationCell } from "@/components/LocationCell"
import { formatDateTime, formatDuration, formatSize, rowStatus } from "@/lib/recordingFormat"
import { StatusBadge } from "@/components/StatusBadge"
import SessionEditDialog from "./SessionEditDialog"
import DetectionReplayDialog from "./DetectionReplayDialog"
import RecountConfigDialog from "./RecountConfigDialog"

const PAGE_SIZE = 13

type SessionsTableProps = {
  sessions: Session[]
  camellones: Map<number, Camellon>
  selectedId: number | null
  onSelect: (session: Session) => void
  onSessionUpdated: (updated: Session) => void
  onSessionDeleted: (id: number) => void
}

export default function SessionsTable({
  sessions,
  camellones,
  selectedId,
  onSelect,
  onSessionUpdated,
  onSessionDeleted,
}: SessionsTableProps) {
  const { mode } = useAppMode()
  const [page, setPage] = useState(0)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [replaySession, setReplaySession] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  // Session whose re-process config dialog is open. The dialog shows the params
  // that will be used, lets the operator review/edit them, and only then runs
  // the count.
  const [recountSession, setRecountSession] = useState<Session | null>(null)

  const handleSync = async (s: Session) => {
    setSyncingId(s.id)
    try {
      const res = await pushSessionNow(s.id)
      if (res.metadata !== "ok") {
        toast.error("Servidor no alcanzable — no se pudo sincronizar")
        return
      }
      // Metadata landed; the MP4 outcome decides the tone of the message.
      if (res.mp4 === "uploaded" || res.mp4 === "already") {
        toast.success("Sesión sincronizada (video incluido)")
      } else if (res.mp4 === "pending") {
        toast.warning("Metadata enviada — MP4 pendiente (se reintenta solo)")
      } else if (res.mp4 === "missing") {
        toast.warning("Metadata enviada — el archivo de video local no existe")
      } else {
        toast.success("Sesión sincronizada (sin video)")
      }
    } catch {
      toast.error("No se pudo sincronizar la sesión")
    } finally {
      setSyncingId(null)
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
        <Table className="table-fixed [&_th]:text-center [&_td]:text-center">
          <TableHeader>
            <TableRow>
              {mode === "server" && <TableHead>Ubicación</TableHead>}
              <TableHead>Fecha</TableHead>
              <TableHead className="hidden md:table-cell">Clase</TableHead>
              <TableHead>Conteo</TableHead>
              <TableHead className="hidden md:table-cell">Duración</TableHead>
              <TableHead className="hidden lg:table-cell">Tamaño</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((s) => (
              <TableRow
                key={s.id}
                className={s.id === selectedId ? "bg-muted/50 cursor-pointer" : "cursor-pointer"}
                onClick={() => onSelect(s)}
              >
                {mode === "server" && (
                  <TableCell>
                    {(() => {
                      const cam =
                        s.camellon_id == null
                          ? undefined
                          : camellones.get(s.camellon_id)
                      return (
                        <LocationCell
                          camellon={
                            s.camellon_id == null
                              ? null
                              : cam?.nombre ?? `#${s.camellon_id}`
                          }
                          fundo={cam?.fundo_nombre ?? null}
                          empresa={cam?.empresa_nombre ?? null}
                        />
                      )
                    })()}
                  </TableCell>
                )}
                <TableCell>{formatDateTime(s.start_time)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline">{s.target_class}</Badge>
                </TableCell>
                <TableCell>
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
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatDuration(s.duration_seconds)}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {formatSize(s.file_size_bytes)}
                </TableCell>
                <TableCell>
                  {s.recording_uuid == null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <StatusBadge
                      status={rowStatus({
                        uuid: s.recording_uuid,
                        ended_at: s.end_time,
                        uploaded_at: s.uploaded_at,
                      })}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-center gap-0.5">
                    {mode === "robot" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Sincronizar al servidor (metadata + video)"
                        disabled={syncingId === s.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSync(s)
                        }}
                      >
                        {syncingId === s.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <UploadCloud className="size-3.5" />
                        )}
                      </Button>
                    )}
                    {mode === "robot" && s.recording_uuid != null && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Procesar el video"
                        disabled={s.count_status === "counting"}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRecountSession(s)
                        }}
                      >
                        <RefreshCw className="size-3.5" />
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
                        <Play className="size-3.5" />
                      </Button>
                    )}
                    {s.recording_uuid != null &&
                      (mode === "robot" || s.uploaded_at != null) && (
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Descargar video"
                        >
                          <a
                            href={getRecordingFileUrl(s.recording_uuid)}
                            download={`${s.recording_uuid}.mp4`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download className="size-3.5" />
                          </a>
                        </Button>
                      )}
                    {mode === "server" && (
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
                    )}
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
          recordingUuid={replaySession.recording_uuid}
          title={`Replay de sesión #${replaySession.id}`}
          open={!!replaySession}
          onOpenChange={(open) => { if (!open) setReplaySession(null) }}
        />
      )}

      {recountSession?.recording_uuid && (
        <RecountConfigDialog
          recordingUuid={recountSession.recording_uuid}
          open={!!recountSession}
          onOpenChange={(open) => { if (!open) setRecountSession(null) }}
          onEnqueued={() =>
            onSessionUpdated({ ...recountSession, count_status: "counting" })
          }
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
