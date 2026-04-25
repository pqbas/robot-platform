import { useEffect, useState } from "react"
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
import { registerLibraryModel } from "@/api/admin-models"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function LibraryModelDialog({
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [filename, setFilename] = useState("yolo11n.pt")
  const [version, setVersion] = useState("yolo11n-coco-v1")
  const [uploadedBy, setUploadedBy] = useState("")
  const [classMapping, setClassMapping] = useState(
    '[{"model_label":"person","system_label":"Persona"}]',
  )
  const [notes, setNotes] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setFilename("yolo11n.pt")
      setVersion("yolo11n-coco-v1")
      setUploadedBy("")
      setClassMapping('[{"model_label":"person","system_label":"Persona"}]')
      setNotes("")
      setIsActive(true)
    }
  }, [open])

  const handleSubmit = async () => {
    if (!filename || !version || !uploadedBy) {
      toast.error("Completa los campos obligatorios")
      return
    }

    if (classMapping.trim()) {
      try {
        JSON.parse(classMapping.trim())
      } catch {
        toast.error('Class mapping debe ser JSON valido. Ej: [{"model_label":"person","system_label":"Persona"}]')
        return
      }
    }

    setSaving(true)
    try {
      await registerLibraryModel({
        filename,
        version,
        uploaded_by: uploadedBy,
        class_mapping: classMapping.trim() || "[]",
        notes: notes || null,
        is_active: isActive,
      })
      toast.success("Modelo de libreria registrado")
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al registrar modelo")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar modelo de libreria</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Para modelos que vienen con la libreria <code>ultralytics</code> (ej. <code>yolo11n.pt</code>).
            No se sube archivo — se descarga automaticamente cuando el worker lo carga la primera vez.
          </p>
          <div className="space-y-2">
            <Label>Filename *</Label>
            <Input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="yolo11n.pt"
            />
            <p className="text-xs text-muted-foreground">
              Nombre que <code>ultralytics</code> reconoce (yolo11n.pt, yolov8n.pt, etc.).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Version *</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Registrado por *</Label>
              <Input
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
                placeholder="nombre"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Clases (JSON)</Label>
            <Input
              value={classMapping}
              onChange={(e) => setClassMapping(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lista de clases que se mostraran en el picker. Para yolo11n con personas:
              {' '}<code>[{'{'}"model_label":"person","system_label":"Persona"{'}'}]</code>
            </p>
          </div>
          <div className="space-y-2">
            <Label>Notas</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="library-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <Label htmlFor="library-active">Activar al registrar</Label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
