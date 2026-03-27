import { useEffect, useRef, useState } from "react"
import type { FruitType } from "@/types"
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
import { uploadDetectionModel } from "@/api/admin-models"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  fruitTypes: FruitType[]
  onSuccess: () => void
}

export default function ModelUploadDialog({
  open,
  onOpenChange,
  fruitTypes,
  onSuccess,
}: Props) {
  const [fruitTypeUuid, setFruitTypeUuid] = useState("")
  const [objectType, setObjectType] = useState("")
  const [version, setVersion] = useState("")
  const [uploadedBy, setUploadedBy] = useState("")
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
      setFruitTypeUuid("")
      setObjectType("")
      setVersion("")
      setUploadedBy("")
      setEpochs("")
      setMap50("")
      setMap50_95("")
      setPrecision("")
      setRecall("")
      setDatasetSize("")
      setNotes("")
      if (fileRef.current) fileRef.current.value = ""
    }
  }, [open])

  const handleSubmit = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !fruitTypeUuid || !objectType || !version || !uploadedBy) {
      toast.error("Completa los campos obligatorios")
      return
    }

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append("fruit_type_uuid", fruitTypeUuid)
      fd.append("object_type", objectType)
      fd.append("version", version)
      fd.append("uploaded_by", uploadedBy)
      fd.append("file", file)
      if (epochs) fd.append("epochs", epochs)
      if (map50) fd.append("map50", map50)
      if (map50_95) fd.append("map50_95", map50_95)
      if (precision) fd.append("precision", precision)
      if (recall) fd.append("recall", recall)
      if (datasetSize) fd.append("dataset_size", datasetSize)
      if (notes) fd.append("notes", notes)

      await uploadDetectionModel(fd)
      toast.success("Modelo subido")
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error("Error al subir modelo")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir modelo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo de fruta *</Label>
            <Select value={fruitTypeUuid || "__none__"} onValueChange={(v) => setFruitTypeUuid(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>Seleccionar</SelectItem>
                {fruitTypes.map((ft) => (
                  <SelectItem key={ft.uuid} value={ft.uuid}>
                    {ft.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo objeto *</Label>
              <Input
                value={objectType}
                onChange={(e) => setObjectType(e.target.value)}
                placeholder="flower"
              />
            </div>
            <div className="space-y-2">
              <Label>Version *</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v1.0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Subido por *</Label>
            <Input
              value={uploadedBy}
              onChange={(e) => setUploadedBy(e.target.value)}
              placeholder="nombre"
            />
          </div>
          <div className="space-y-2">
            <Label>Archivo .pt *</Label>
            <Input type="file" accept=".pt" ref={fileRef} />
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
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Subiendo..." : "Subir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
