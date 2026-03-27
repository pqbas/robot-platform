import { useEffect, useState } from "react"
import type { Device } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createDevice, updateDevice } from "@/api/admin-devices"
import { toast } from "sonner"
import ApiKeyDisplay from "./ApiKeyDisplay"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Device | null
  onSuccess: () => void
}

export default function DeviceFormDialog({
  open,
  onOpenChange,
  editing,
  onSuccess,
}: Props) {
  const [deviceId, setDeviceId] = useState("")
  const [label, setLabel] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCreatedApiKey(null)
      if (editing) {
        setDeviceId(editing.id)
        setLabel(editing.label)
        setIsActive(editing.is_active)
      } else {
        setDeviceId("")
        setLabel("")
        setIsActive(true)
      }
    }
  }, [editing, open])

  const handleSubmit = async () => {
    setSaving(true)
    try {
      if (editing) {
        await updateDevice(editing.id, { label, is_active: isActive })
        toast.success("Dispositivo actualizado")
        onSuccess()
        onOpenChange(false)
      } else {
        const res = await createDevice({ id: deviceId, label })
        setCreatedApiKey(res.api_key)
        toast.success("Dispositivo registrado")
        onSuccess()
      }
    } catch {
      toast.error("Error al guardar dispositivo")
    } finally {
      setSaving(false)
    }
  }

  if (createdApiKey) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispositivo registrado</DialogTitle>
          </DialogHeader>
          <ApiKeyDisplay apiKey={createdApiKey} />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar" : "Nuevo"} dispositivo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>ID</Label>
            <Input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={!!editing}
              placeholder="jetson-001"
            />
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Robot Mark 1"
            />
          </div>
          {editing && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="device-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <Label htmlFor="device-active">Activo</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
