import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Camellon } from "@/types"

const NEW_OPTION = "__new__"

type SaveDialogProps = {
  open: boolean
  totalCount: number
  duration: string
  camellones: Camellon[]
  onSave: (camellonNombre: string) => void
  onDiscard: () => void
}

export default function SaveDialog({
  open,
  totalCount,
  duration,
  camellones,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  const [selectedId, setSelectedId] = useState("")
  const [newName, setNewName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelectedId("")
      setNewName("")
    }
  }, [open])

  const isNew = selectedId === NEW_OPTION
  const trimmedNew = newName.trim()
  const canSave = isNew
    ? trimmedNew.length > 0
    : selectedId !== "" && camellones.some((c) => String(c.id) === selectedId)

  const handleSave = async () => {
    let nombre: string
    if (isNew) {
      if (!trimmedNew) return
      nombre = trimmedNew
    } else {
      const cam = camellones.find((c) => String(c.id) === selectedId)
      if (!cam) return
      nombre = cam.nombre
    }
    setSaving(true)
    try {
      onSave(nombre)
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setSelectedId("")
    setNewName("")
    onDiscard()
  }

  return (
    <Dialog open={open} modal={false}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Resultado del conteo</DialogTitle>
          <DialogDescription>
            Selecciona o crea un camellon para guardar la sesion
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3">
          <Badge variant="secondary">Conteo: {totalCount}</Badge>
          <Badge variant="outline">Duracion: {duration}</Badge>
        </div>

        <div className="space-y-2">
          <Label>Camellon</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un camellon" />
            </SelectTrigger>
            <SelectContent>
              {camellones.map((cam) => (
                <SelectItem key={cam.id} value={String(cam.id)}>
                  {cam.nombre}
                </SelectItem>
              ))}
              <SelectItem value={NEW_OPTION}>+ Nuevo camellon</SelectItem>
            </SelectContent>
          </Select>
          {isNew && (
            <div className="space-y-1 pt-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del camellon"
              />
              <p className="text-xs text-muted-foreground">
                Se crea sin coordenadas — asignar desde Mapa luego.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleDiscard} disabled={saving}>
            Descartar
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
