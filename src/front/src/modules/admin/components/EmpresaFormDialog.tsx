import { useEffect, useState } from "react"
import type { Empresa } from "@/types"
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
import { createEmpresa, updateEmpresa } from "@/api/admin"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Empresa | null
  onSuccess: () => void
}

export default function EmpresaFormDialog({
  open,
  onOpenChange,
  editing,
  onSuccess,
}: Props) {
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "")
    }
  }, [editing, open])

  const handleSubmit = async () => {
    setSaving(true)
    try {
      if (editing) {
        await updateEmpresa(editing.uuid, { name })
        toast.success("Empresa actualizada")
      } else {
        await createEmpresa({ name })
        toast.success("Empresa creada")
      }
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error("Error al guardar empresa")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar" : "Nueva"} empresa
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
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
