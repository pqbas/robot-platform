import { useEffect, useState } from "react"
import type { Fundo, Empresa, FruitType } from "@/types"
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
import { createFundo, updateFundo } from "@/api/admin"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Fundo | null
  empresas: Empresa[]
  fruitTypes: FruitType[]
  onSuccess: () => void
}

export default function FundoFormDialog({
  open,
  onOpenChange,
  editing,
  empresas,
  fruitTypes,
  onSuccess,
}: Props) {
  const [name, setName] = useState("")
  const [empresaUuid, setEmpresaUuid] = useState("")
  const [region, setRegion] = useState("")
  const [fruitTypeUuid, setFruitTypeUuid] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name)
        setEmpresaUuid(editing.empresa_uuid)
        setRegion(editing.region ?? "")
        setFruitTypeUuid(editing.fruit_type_uuid ?? "")
      } else {
        setName("")
        setEmpresaUuid("")
        setRegion("")
        setFruitTypeUuid("")
      }
    }
  }, [editing, open])

  const handleSubmit = async () => {
    setSaving(true)
    try {
      if (editing) {
        await updateFundo(editing.uuid, {
          name,
          region: region || null,
          fruit_type_uuid: fruitTypeUuid || null,
        })
        toast.success("Fundo actualizado")
      } else {
        await createFundo({
          empresa_uuid: empresaUuid,
          name,
          region: region || null,
          fruit_type_uuid: fruitTypeUuid || null,
        })
        toast.success("Fundo creado")
      }
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error("Error al guardar fundo")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar" : "Nuevo"} fundo
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
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select
              value={empresaUuid}
              onValueChange={setEmpresaUuid}
              disabled={!!editing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.uuid} value={e.uuid}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Region</Label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo de fruta</Label>
            <Select value={fruitTypeUuid || "__none__"} onValueChange={(v) => setFruitTypeUuid(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Sin tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin tipo</SelectItem>
                {fruitTypes.map((ft) => (
                  <SelectItem key={ft.uuid} value={ft.uuid}>
                    {ft.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
