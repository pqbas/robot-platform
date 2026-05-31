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
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Modelos — {device.label}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando...</p>
        ) : allModels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No hay modelos registrados</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 py-1">
            {[
              { label: "Modelos subidos", items: allModels.filter((m) => m.source === "uploaded") },
              { label: "Modelos de librería", items: allModels.filter((m) => m.source === "library") },
            ].map(({ label, items }) => items.length === 0 ? null : (
              <div key={label} className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">{label}</p>
                {items.map((m) => (
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
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{m.filename}</p>
                        {m.is_active && (
                          <span className="shrink-0 text-[10px] text-green-600 font-medium">activo</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {m.version}
                        {m.class_mapping && m.class_mapping.length > 0 && (
                          <span className="ml-2">
                            {m.class_mapping.map((c) => typeof c === "string" ? c : c.system_label || c.model_label).join(", ")}
                          </span>
                        )}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
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
