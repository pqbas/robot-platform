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
import { uploadDetectionModel } from "@/api/admin-models"
import { toast } from "sonner"
import { Plus, Trash2, UploadCloud, FileCheck } from "lucide-react"

type ClassRow = { model_label: string; system_label: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export default function ModelUploadDialog({
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [version, setVersion] = useState("")
  const [uploadedBy, setUploadedBy] = useState("")
  const [classRows, setClassRows] = useState<ClassRow[]>([{ model_label: "", system_label: "" }])
  const [epochs, setEpochs] = useState("")
  const [map50, setMap50] = useState("")
  const [map50_95, setMap50_95] = useState("")
  const [precision, setPrecision] = useState("")
  const [recall, setRecall] = useState("")
  const [datasetSize, setDatasetSize] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [ptFile, setPtFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateRow = (i: number, field: keyof ClassRow, value: string) =>
    setClassRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const addRow = () => setClassRows((rows) => [...rows, { model_label: "", system_label: "" }])

  const removeRow = (i: number) =>
    setClassRows((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows))

  const acceptFile = (file: File) => {
    if (!file.name.endsWith(".pt")) {
      toast.error("Solo se aceptan archivos .pt")
      return
    }
    setPtFile(file)
  }

  useEffect(() => {
    if (open) {
      setVersion("")
      setUploadedBy("")
      setClassRows([{ model_label: "", system_label: "" }])
      setEpochs("")
      setMap50("")
      setMap50_95("")
      setPrecision("")
      setRecall("")
      setDatasetSize("")
      setNotes("")
      setPtFile(null)
    }
  }, [open])

  const handleSubmit = async () => {
    if (!ptFile || !version || !uploadedBy) {
      toast.error("Completa los campos obligatorios")
      return
    }

    const filledRows = classRows.filter((r) => r.model_label.trim())
    const mappingJson = JSON.stringify(
      filledRows.map((r) => ({
        model_label: r.model_label.trim(),
        system_label: r.system_label.trim() || r.model_label.trim(),
      }))
    )

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append("version", version)
      fd.append("uploaded_by", uploadedBy)
      fd.append("class_mapping", mappingJson)
      fd.append("file", ptFile)
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Version *</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v1.0"
              />
            </div>
            <div className="space-y-2">
              <Label>Subido por *</Label>
              <Input
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
                placeholder="nombre"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Archivo .pt *</Label>
            <div
              className={[
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : ptFile
                    ? "border-primary/40 bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50",
              ].join(" ")}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const file = e.dataTransfer.files[0]
                if (file) acceptFile(file)
              }}
            >
              {ptFile ? (
                <>
                  <FileCheck className="h-8 w-8 text-primary" />
                  <span className="text-sm font-medium">{ptFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(ptFile.size / 1024 / 1024).toFixed(1)} MB — click para cambiar
                  </span>
                </>
              ) : (
                <>
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Arrastra el archivo aquí o <span className="text-foreground underline">selecciona</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Solo archivos .pt</span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) acceptFile(file)
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Clases del modelo</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" />
                Agregar
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-x-2 gap-y-1 text-xs text-muted-foreground mb-1 px-1">
              <span>Clase del modelo</span>
              <span>Nombre en sistema</span>
              <span />
            </div>
            <div className="space-y-1">
              {classRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-x-2 items-center">
                  <Input
                    value={row.model_label}
                    onChange={(e) => updateRow(i, "model_label", e.target.value)}
                    placeholder="blueberry"
                    className="h-8 text-sm"
                  />
                  <Input
                    value={row.system_label}
                    onChange={(e) => updateRow(i, "system_label", e.target.value)}
                    placeholder="Arándano"
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(i)}
                    disabled={classRows.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Si "Nombre en sistema" queda vacío, se usa la clase del modelo.
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
