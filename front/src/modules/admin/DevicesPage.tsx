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
import { toast } from "sonner"

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)

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
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="font-mono text-sm">{device.id}</TableCell>
                <TableCell className="font-medium">{device.label}</TableCell>
                <TableCell className="text-muted-foreground">
                  {device.last_sync_at
                    ? new Date(device.last_sync_at).toLocaleString()
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={device.is_active ? "default" : "outline"}>
                    {device.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell>
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
    </div>
  )
}
