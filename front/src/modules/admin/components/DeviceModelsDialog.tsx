import { useEffect, useState } from "react"
import type { DetectionModel, Device } from "@/types"
import { getDetectionModels } from "@/api/admin-models"
import { getDeviceModels, setDeviceModels } from "@/api/admin-devices"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

type Props = {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function DeviceModelsDialog({ device, open, onOpenChange }: Props) {
  const [allModels, setAllModels] = useState<DetectionModel[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([getDetectionModels(), getDeviceModels(device.id)])
      .then(([all, assigned]) => {
        setAllModels(all)
        setSelected(new Set(assigned.map((m) => m.uuid)))
      })
      .catch(() => toast.error("Error al cargar modelos"))
      .finally(() => setLoading(false))
  }, [open, device.id])

  function toggle(uuid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDeviceModels(device.id, [...selected])
      toast.success("Modelos asignados")
      onOpenChange(false)
    } catch {
      toast.error("Error al guardar asignaciones")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modelos — {device.label}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando...</p>
        ) : allModels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No hay modelos registrados</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto py-1">
            {allModels.map((m) => (
              <label
                key={m.uuid}
                className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.uuid)}
                  onChange={() => toggle(m.uuid)}
                  className="accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.filename}</p>
                  <p className="text-xs text-muted-foreground">{m.version}</p>
                </div>
                {m.is_active && (
                  <span className="text-xs text-green-600 font-medium">activo</span>
                )}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
