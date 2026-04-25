import { useEffect, useState } from "react"
import type { Device, Fundo } from "@/types"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createDevice, rotateApiKey, updateDevice } from "@/api/admin-devices"
import { getFundos } from "@/api/admin"
import { toast } from "sonner"
import ApiKeyDisplay from "./ApiKeyDisplay"

const NO_FUNDO = "__none__"

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
  const [fundoUuid, setFundoUuid] = useState<string>(NO_FUNDO)
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCreatedApiKey(null)
      getFundos().then(setFundos).catch(() => setFundos([]))
      if (editing) {
        setDeviceId(editing.id)
        setLabel(editing.label)
        setIsActive(editing.is_active)
        setFundoUuid(editing.fundo_uuid ?? NO_FUNDO)
      } else {
        setDeviceId("")
        setLabel("")
        setIsActive(true)
        setFundoUuid(NO_FUNDO)
      }
    }
  }, [editing, open])

  const handleSubmit = async () => {
    if (!editing && (!deviceId.trim() || !label.trim())) {
      toast.error("ID y Label son obligatorios")
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await updateDevice(editing.id, {
          label,
          is_active: isActive,
          fundo_uuid: fundoUuid === NO_FUNDO ? null : fundoUuid,
        })
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
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editing ? "Nueva API key generada" : "Dispositivo registrado"}</DialogTitle>
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
            <>
              <div className="space-y-2">
                <Label>Fundo</Label>
                <Select value={fundoUuid} onValueChange={setFundoUuid}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar fundo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FUNDO}>Sin fundo</SelectItem>
                    {fundos.map((f) => (
                      <SelectItem key={f.uuid} value={f.uuid}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="device-active"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <Label htmlFor="device-active">Activo</Label>
              </div>
              <div className="pt-1 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rotating}
                  onClick={async () => {
                    setRotating(true)
                    try {
                      const res = await rotateApiKey(editing.id)
                      setCreatedApiKey(res.api_key)
                    } catch {
                      toast.error("Error al regenerar API key")
                    } finally {
                      setRotating(false)
                    }
                  }}
                >
                  {rotating ? "Regenerando..." : "Regenerar API key"}
                </Button>
              </div>
            </>
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
