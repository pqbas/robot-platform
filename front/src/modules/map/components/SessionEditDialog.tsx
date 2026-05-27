import { useState } from "react"
import type { Session, Camellon } from "@/types"
import { patchSession } from "@/api/sessions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

type Props = {
  session: Session
  camellones: Camellon[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Session) => void
}

export default function SessionEditDialog({
  session,
  camellones,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [camellonId, setCamellonId] = useState(String(session.camellon_id))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await patchSession(session.id, Number(camellonId))
      onSaved(updated)
      onOpenChange(false)
      toast.success("Sesión actualizada")
    } catch {
      toast.error("Error al actualizar la sesión")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar sesión #{session.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Select value={camellonId} onValueChange={setCamellonId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecciona un camellón" />
            </SelectTrigger>
            <SelectContent>
              {camellones.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
