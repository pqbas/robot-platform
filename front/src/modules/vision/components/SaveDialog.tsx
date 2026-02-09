import { useState } from "react"
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
import { Label } from "@/components/ui/label"
import type { MapLocation } from "@/types"

type SaveDialogProps = {
  open: boolean
  totalCount: number
  duration: string
  locations: MapLocation[]
  onSave: (locationLabel: string) => void
  onDiscard: () => void
}

export default function SaveDialog({
  open,
  totalCount,
  duration,
  locations,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  const [selectedId, setSelectedId] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const loc = locations.find((l) => String(l.id) === selectedId)
    if (!loc) return
    setSaving(true)
    try {
      onSave(loc.label)
    } finally {
      setSaving(false)
      setSelectedId("")
    }
  }

  const handleDiscard = () => {
    setSelectedId("")
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
            Selecciona una ubicacion para guardar la sesion
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3">
          <Badge variant="secondary">Conteo: {totalCount}</Badge>
          <Badge variant="outline">Duracion: {duration}</Badge>
        </div>

        <div className="space-y-2">
          <Label>Ubicacion</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona una ubicacion" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={String(loc.id)}>
                  {loc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleDiscard} disabled={saving}>
            Descartar
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedId || saving}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
