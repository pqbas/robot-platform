import { useEffect, useState } from "react"
import { Download, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  deleteRecording,
  getRecordingFileUrl,
  getRecordings,
} from "@/api/recordings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAppMode } from "@/context/AppModeContext"
import type { Recording } from "@/types"

const POLL_INTERVAL_MS = 30_000

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`
}

function formatSize(bytes: number | null): string {
  if (bytes == null || bytes === 0) return "—"
  const mb = bytes / 1_048_576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

type RowStatus = "active" | "uploaded" | "pending" | "missing"

function rowStatus(rec: Recording): RowStatus {
  if (rec.ended_at == null) return "active"
  return rec.uploaded_at ? "uploaded" : "pending"
}

function StatusBadge({ status }: { status: RowStatus }) {
  switch (status) {
    case "active":
      return <Badge variant="destructive">grabando</Badge>
    case "uploaded":
      return <Badge variant="default">✓ subido</Badge>
    case "pending":
      return <Badge variant="secondary">⏳ pendiente</Badge>
    case "missing":
      return <Badge variant="outline">⚠ archivo perdido</Badge>
  }
}

export default function RecordingsPage() {
  const { mode } = useAppMode()
  const [rows, setRows] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await getRecordings()
        if (!cancelled) setRows(data)
      } catch (err) {
        if (!cancelled) toast.error("Error cargando grabaciones")
        console.error(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = window.setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const handleConfirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteRecording(deleting.uuid)
      setRows((prev) => prev.filter((r) => r.uuid !== deleting.uuid))
      toast.success("Grabación eliminada")
    } catch {
      toast.error("Error eliminando")
    } finally {
      setDeleteBusy(false)
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">Grabaciones</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "robot"
              ? "Videos guardados localmente — sincronizan al server cuando hay red."
              : "Videos sincronizados desde los robots."}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-md border">
        <Table className="min-w-[600px]">
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead>Inicio</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Tamaño</TableHead>
              {mode === "server" && <TableHead>Robot</TableHead>}
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <Loader2 className="size-5 animate-spin inline" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No hay grabaciones todavía.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const status = rowStatus(r)
                const canDownload = mode === "robot" || r.uploaded_at != null
                return (
                  <TableRow key={r.uuid}>
                    <TableCell className="font-mono text-xs">
                      {formatDate(r.started_at)}
                    </TableCell>
                    <TableCell>{formatDuration(r.duration_seconds)}</TableCell>
                    <TableCell>{formatSize(r.file_size_bytes)}</TableCell>
                    {mode === "server" && (
                      <TableCell className="font-mono text-xs">{r.device_id}</TableCell>
                    )}
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {canDownload && status !== "active" && (
                        <Button asChild size="sm" variant="outline">
                          <a
                            href={getRecordingFileUrl(r.uuid)}
                            download={`${r.uuid}.mp4`}
                          >
                            <Download className="size-4 mr-1" /> Descargar
                          </a>
                        </Button>
                      )}
                      {status !== "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar grabación</DialogTitle>
            <DialogDescription>
              Esta acción borra el archivo y la fila en la base de datos. No se
              puede deshacer.
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
              {deleteBusy ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
