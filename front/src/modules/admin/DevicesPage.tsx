import { useCallback, useEffect, useState } from "react"
import type { Device } from "@/types"
import { getDevices } from "@/api/admin-devices"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import DeviceFormDialog from "./components/DeviceFormDialog"
import DeviceModelsDialog from "./components/DeviceModelsDialog"
import { toast } from "sonner"

const ONLINE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

function isOnline(last_sync_at: string | null): boolean {
  if (!last_sync_at) return false
  return Date.now() - new Date(last_sync_at).getTime() < ONLINE_THRESHOLD_MS
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [modelsDevice, setModelsDevice] = useState<Device | null>(null)

  const load = useCallback(async () => {
    try {
      setDevices(await getDevices())
    } catch {
      toast.error("Error al cargar dispositivos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Cargando...
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 overflow-auto p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dispositivos</h1>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          Nuevo dispositivo
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Ultimo sync</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[140px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="font-mono text-sm">{device.id}</TableCell>
                <TableCell className="font-medium">{device.label}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full shrink-0 ${isOnline(device.last_sync_at) ? "bg-green-500" : "bg-muted-foreground/40"}`}
                      title={isOnline(device.last_sync_at) ? "Online" : "Offline"}
                    />
                    {device.last_sync_at
                      ? new Date(device.last_sync_at).toLocaleString()
                      : "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={device.is_active ? "default" : "outline"}>
                    {device.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(device)
                        setDialogOpen(true)
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setModelsDevice(device)}
                    >
                      Modelos
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DeviceFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSuccess={load}
      />
      {modelsDevice && (
        <DeviceModelsDialog
          device={modelsDevice}
          open={!!modelsDevice}
          onOpenChange={(open) => { if (!open) setModelsDevice(null) }}
        />
      )}
    </div>
  )
}
