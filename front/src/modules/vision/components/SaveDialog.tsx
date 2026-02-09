import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type SaveDialogProps = {
  open: boolean
  lastFrameCount: number
  duration: string
  onSave: (camellon: string) => void
  onDiscard: () => void
}

export default function SaveDialog({
  open,
  lastFrameCount,
  duration,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  const [camellon, setCamellon] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!camellon.trim()) return
    setSaving(true)
    try {
      onSave(camellon.trim())
    } finally {
      setSaving(false)
      setCamellon("")
    }
  }

  const handleDiscard = () => {
    setCamellon("")
    onDiscard()
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Resultado del conteo</DialogTitle>
        </DialogHeader>

        <div className="flex gap-3">
          <Badge variant="secondary">Conteo: {lastFrameCount}</Badge>
          <Badge variant="outline">Duracion: {duration}</Badge>
        </div>

        <div className="space-y-2">
          <Label htmlFor="camellon">Camellon</Label>
          <Input
            id="camellon"
            placeholder="Nombre del camellon"
            value={camellon}
            onChange={(e) => setCamellon(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleDiscard} disabled={saving}>
            Descartar
          </Button>
          <Button
            onClick={handleSave}
            disabled={!camellon.trim() || saving}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
