import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, MapPin, Pencil, Play, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  deleteRecording,
  getRecordingFileUrl,
  getRecordings,
  getUploadingUuids,
} from "@/api/recordings"
import { getEmpresas, getFundos } from "@/api/admin"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAppMode } from "@/context/AppModeContext"
import type { Empresa, Fundo, Recording } from "@/types"
import RecordingPlaceDialog from "@/modules/vision/components/RecordingPlaceDialog"

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

// Local YYYY-MM-DD for date-range filtering (matches the date shown to the user).
function localDateStr(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

type RowStatus = "active" | "uploaded" | "uploading" | "pending" | "missing"

function rowStatus(rec: Recording, uploadingSet: Set<string>): RowStatus {
  if (rec.ended_at == null) return "active"
  if (rec.uploaded_at == null && uploadingSet.has(rec.uuid)) return "uploading"
  return rec.uploaded_at ? "uploaded" : "pending"
}

function StatusBadge({ status }: { status: RowStatus }) {
  switch (status) {
    case "active":
      return <Badge variant="destructive">grabando</Badge>
    case "uploaded":
      return <Badge variant="default">subido</Badge>
    case "uploading":
      return <Badge variant="outline">subiendo</Badge>
    case "pending":
      return <Badge variant="secondary">pendiente</Badge>
    case "missing":
      return <Badge variant="outline">archivo perdido</Badge>
  }
}

function LugarCell({ rec }: { rec: Recording }) {
  if (!rec.camellon_nombre) {
    return <span className="text-muted-foreground text-xs">— sin lugar</span>
  }
  return (
    <span className="text-xs">
      {rec.camellon_nombre}
    </span>
  )
}

export default function RecordingsPage() {
  const { mode } = useAppMode()
  const [rows, setRows] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [playing, setPlaying] = useState<Recording | null>(null)
  const [editingUuid, setEditingUuid] = useState<string | null>(null)
  const [editingRec, setEditingRec] = useState<Recording | null>(null)
  const [uploadingUuids, setUploadingUuids] = useState<Set<string>>(new Set())

  // Empresa/Fundo filter cascade
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [empresaFilter, setEmpresaFilter] = useState("all")
  const [fundoFilter, setFundoFilter] = useState("all")
  const [deviceFilter, setDeviceFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)

  const loadBase = useCallback(async () => {
    try {
      const [empData, fundoData] = await Promise.all([getEmpresas(), getFundos()])
      setEmpresas(empData)
      setFundos(fundoData)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await getRecordings()
      setRows(data)
    } catch (err) {
      toast.error("Error cargando grabaciones")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    let cancelled = false
    const doLoad = async () => {
      await load()
    }
    doLoad()
    const id = window.setInterval(() => {
      if (!cancelled) load()
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [load])

  useEffect(() => {
    let cancelled = false
    let wasUploading = false
    const pollUploading = async () => {
      try {
        const { uuids } = await getUploadingUuids()
        if (cancelled) return
        const nowUploading = uuids.length > 0
        setUploadingUuids(new Set(uuids))
        if (wasUploading && !nowUploading) load()
        wasUploading = nowUploading
      } catch {
        // silently ignore — uploading indicator is best-effort
      }
    }
    pollUploading()
    const id = window.setInterval(() => {
      if (!cancelled) pollUploading()
    }, 3_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [load])

  // Build lookup maps for fundo_uuid → empresa_uuid
  const fundoToEmpresa = useMemo(
    () => new Map(fundos.map((f) => [f.uuid, f.empresa_uuid])),
    [fundos],
  )

  // Empresa options: derive from rows so we never show empresas with no recordings
  const empresaOptions = useMemo(() => {
    const empresaById = new Map(empresas.map((e) => [e.uuid, e]))
    const seen = new Map<string, string>()
    for (const r of rows) {
      if (!r.fundo_uuid) continue
      const empUuid = fundoToEmpresa.get(r.fundo_uuid)
      if (!empUuid || seen.has(empUuid)) continue
      const e = empresaById.get(empUuid)
      seen.set(empUuid, e?.name ?? empUuid)
    }
    return Array.from(seen, ([uuid, name]) => ({ uuid, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [rows, empresas, fundoToEmpresa])

  const rowsByEmpresa = useMemo(() => {
    if (empresaFilter === "all") return rows
    return rows.filter((r) => {
      if (!r.fundo_uuid) return false
      return fundoToEmpresa.get(r.fundo_uuid) === empresaFilter
    })
  }, [rows, empresaFilter, fundoToEmpresa])

  // Fundo options: from empresa-narrowed rows
  const fundoOptions = useMemo(() => {
    const fundoById = new Map(fundos.map((f) => [f.uuid, f]))
    const seen = new Map<string, string>()
    for (const r of rowsByEmpresa) {
      if (!r.fundo_uuid || seen.has(r.fundo_uuid)) continue
      const f = fundoById.get(r.fundo_uuid)
      seen.set(r.fundo_uuid, f?.name ?? r.fundo_uuid)
    }
    return Array.from(seen, ([uuid, name]) => ({ uuid, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [rowsByEmpresa, fundos])

  // Distinct robots seen in the rows (for the Device filter, like Sessions).
  const devices = useMemo(
    () => Array.from(new Set(rows.map((r) => r.device_id))).sort(),
    [rows],
  )

  const filteredRows = useMemo(() => {
    return rowsByEmpresa.filter((r) => {
      if (fundoFilter !== "all" && r.fundo_uuid !== fundoFilter) return false
      if (deviceFilter !== "all" && r.device_id !== deviceFilter) return false
      const d = localDateStr(r.started_at)
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })
  }, [rowsByEmpresa, fundoFilter, deviceFilter, dateFrom, dateTo])

  // Reset child filter when parent filter changes and selection is no longer valid
  useEffect(() => {
    if (empresaFilter !== "all" && !empresaOptions.some((e) => e.uuid === empresaFilter)) {
      setEmpresaFilter("all")
    }
  }, [empresaOptions, empresaFilter])

  useEffect(() => {
    if (fundoFilter !== "all" && !fundoOptions.some((f) => f.uuid === fundoFilter)) {
      setFundoFilter("all")
    }
  }, [fundoOptions, fundoFilter])

  const hasActiveFilters =
    empresaFilter !== "all" ||
    fundoFilter !== "all" ||
    deviceFilter !== "all" ||
    dateFrom != null ||
    dateTo != null

  const clearAllFilters = () => {
    setEmpresaFilter("all")
    setFundoFilter("all")
    setDeviceFilter("all")
    setDateFrom(null)
    setDateTo(null)
  }

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
    <div className="flex-1 space-y-4 overflow-auto p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Grabaciones
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            ({filteredRows.length})
          </span>
        </h1>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={clearAllFilters}
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 items-end gap-3 landscape:grid-cols-4 landscape:gap-2 md:flex md:gap-4">
        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Empresa</Label>
          <Select value={empresaFilter} onValueChange={setEmpresaFilter}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {empresaOptions.map((e) => (
                <SelectItem key={e.uuid} value={e.uuid}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Fundo</Label>
          <Select value={fundoFilter} onValueChange={setFundoFilter}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {fundoOptions.map((f) => (
                <SelectItem key={f.uuid} value={f.uuid}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {devices.length > 1 && (
          <div className="space-y-1 md:min-w-0 md:flex-1">
            <Label className="text-xs">Device</Label>
            <Select value={deviceFilter} onValueChange={setDeviceFilter}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Desde</Label>
          <Input
            type="date"
            className="h-9"
            value={dateFrom ?? ""}
            onChange={(e) => setDateFrom(e.target.value || null)}
          />
        </div>

        <div className="space-y-1 md:min-w-0 md:flex-1">
          <Label className="text-xs">Hasta</Label>
          <Input
            type="date"
            className="h-9"
            value={dateTo ?? ""}
            onChange={(e) => setDateTo(e.target.value || null)}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead>Inicio</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Tamaño</TableHead>
              <TableHead>
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" /> Lugar
                </span>
              </TableHead>
              {mode === "server" && <TableHead>Robot</TableHead>}
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="size-5 animate-spin inline" />
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No hay grabaciones todavía.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((r) => {
                const status = rowStatus(r, uploadingUuids)
                const canDownload = mode === "robot" || r.uploaded_at != null
                return (
                  <TableRow key={r.uuid}>
                    <TableCell className="font-mono text-xs">
                      {formatDate(r.started_at)}
                    </TableCell>
                    <TableCell>{formatDuration(r.duration_seconds)}</TableCell>
                    <TableCell>{formatSize(r.file_size_bytes)}</TableCell>
                    <TableCell>
                      <LugarCell rec={r} />
                    </TableCell>
                    {mode === "server" && (
                      <TableCell className="font-mono text-xs">{r.device_id}</TableCell>
                    )}
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        {status !== "active" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Editar lugar"
                            onClick={() => { setEditingUuid(r.uuid); setEditingRec(r) }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                        {canDownload && status !== "active" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Reproducir"
                            onClick={() => setPlaying(r)}
                          >
                            <Play className="size-3.5" />
                          </Button>
                        )}
                        {canDownload && status !== "active" && (
                          <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Descargar">
                            <a
                              href={getRecordingFileUrl(r.uuid)}
                              download={`${r.uuid}.mp4`}
                            >
                              <Download className="size-3.5" />
                            </a>
                          </Button>
                        )}
                        {status !== "active" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Eliminar"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
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

      {/* Reproductor simple: solo el MP4, sin overlay de detecciones (las
          grabaciones no tienen un conteo/sidecar asociado). */}
      <Dialog open={playing != null} onOpenChange={(open) => !open && setPlaying(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Reproducir grabación</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {playing ? formatDate(playing.started_at) : ""}
            </DialogDescription>
          </DialogHeader>
          {playing && (
            <video
              src={getRecordingFileUrl(playing.uuid)}
              controls
              autoPlay
              className="w-full rounded-md bg-black"
            />
          )}
        </DialogContent>
      </Dialog>

      <RecordingPlaceDialog
        open={editingUuid != null}
        recordingUuid={editingUuid}
        deviceContext={null}
        currentFundoUuid={editingRec?.fundo_uuid}
        currentCamellonId={editingRec?.camellon_id}
        onSaved={() => {
          setEditingUuid(null)
          setEditingRec(null)
          load()
        }}
        onSkip={() => { setEditingUuid(null); setEditingRec(null) }}
      />
    </div>
  )
}
