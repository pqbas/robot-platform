import { useEffect, useRef, useState } from "react"
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
import { updateModel } from "@/api/admin-models"
import type { DetectionModel } from "@/types"
import { toast } from "sonner"

type Props = {
  model: DetectionModel
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function ModelEditDialog({
  model,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [version, setVersion] = useState("")
  const [classMapping, setClassMapping] = useState("")
  const [epochs, setEpochs] = useState("")
  const [map50, setMap50] = useState("")
  const [map50_95, setMap50_95] = useState("")
  const [precision, setPrecision] = useState("")
  const [recall, setRecall] = useState("")
  const [datasetSize, setDatasetSize] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setVersion(model.version ?? "")
      setClassMapping(
        model.class_mapping && model.class_mapping.length > 0
          ? JSON.stringify(model.class_mapping)
          : "",
      )
      setEpochs(model.epochs != null ? String(model.epochs) : "")
      setMap50(model.map50 != null ? String(model.map50) : "")
      setMap50_95(model.map50_95 != null ? String(model.map50_95) : "")
      setPrecision(model.precision != null ? String(model.precision) : "")
      setRecall(model.recall != null ? String(model.recall) : "")
      setDatasetSize(model.dataset_size != null ? String(model.dataset_size) : "")
      setNotes(model.notes ?? "")
      if (fileRef.current) fileRef.current.value = ""
    }
  }, [open, model])

  const handleSubmit = async () => {
    if (!version.trim()) {
      toast.error("La version es obligatoria")
      return
    }

    let mappingJson: string | null = null
    if (classMapping.trim()) {
      try {
        JSON.parse(classMapping.trim())
        mappingJson = classMapping.trim()
      } catch {
        toast.error("Class mapping debe ser JSON valido. Ej: [\"person\", \"car\"]")
        return
      }
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append("version", version)
      if (mappingJson !== null) fd.append("class_mapping", mappingJson)
      if (epochs) fd.append("epochs", epochs)
      if (map50) fd.append("map50", map50)
      if (map50_95) fd.append("map50_95", map50_95)
      if (precision) fd.append("precision", precision)
      if (recall) fd.append("recall", recall)
      if (datasetSize) fd.append("dataset_size", datasetSize)
      if (notes) fd.append("notes", notes)

      const file = fileRef.current?.files?.[0]
      if (file) fd.append("file", file)

      await updateModel(model.uuid, fd)
      toast.success("Modelo actualizado")
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error("Error al actualizar modelo")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar modelo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Archivo actual:</span>{" "}
            <span className="font-mono">{model.filename}</span>
          </div>
          <div className="space-y-2">
            <Label>Version *</Label>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="v1.0"
            />
          </div>
          <div className="space-y-2">
            <Label>Clases (JSON)</Label>
            <Input
              value={classMapping}
              onChange={(e) => setClassMapping(e.target.value)}
              placeholder='["person", "car"] o [{"model_label": "cls0", "system_label": "manzana"}]'
            />
            <p className="text-xs text-muted-foreground">
              Lista de clases que detecta el modelo. Dejar vacío para no cambiar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Epochs</Label>
              <Input
                type="number"
                value={epochs}
                onChange={(e) => setEpochs(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Dataset size</Label>
              <Input
                type="number"
                value={datasetSize}
                onChange={(e) => setDatasetSize(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>mAP50</Label>
              <Input
                type="number"
                step="0.01"
                value={map50}
                onChange={(e) => setMap50(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>mAP50-95</Label>
              <Input
                type="number"
                step="0.01"
                value={map50_95}
                onChange={(e) => setMap50_95(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Precision</Label>
              <Input
                type="number"
                step="0.01"
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Recall</Label>
              <Input
                type="number"
                step="0.01"
                value={recall}
                onChange={(e) => setRecall(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notas</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label>Reemplazar archivo .pt</Label>
            <Input type="file" accept=".pt" ref={fileRef} />
            <p className="text-xs text-muted-foreground">
              Dejar vacío para conservar el archivo actual.
            </p>
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
