import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { uploadRecordingCount } from "@/api/recordings"
import { toast } from "sonner"
import { FileCheck, FileUp } from "lucide-react"
import type { Recording } from "@/types"

type Props = {
  open: boolean
  recordingUuid: string | null
  onOpenChange: (open: boolean) => void
  onSuccess: (updated: Recording) => void
}

export default function UploadCountDialog({
  open,
  recordingUuid,
  onOpenChange,
  onSuccess,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [totalCount, setTotalCount] = useState("")
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFile(null)
      setTotalCount("")
    }
  }, [open])

  const acceptFile = (f: File) => {
    if (!f.name.endsWith(".jsonl")) {
      toast.error("Solo se aceptan archivos .jsonl")
      return
    }
    setFile(f)
  }

  const handleSubmit = async () => {
    if (!recordingUuid || !totalCount.trim()) {
      toast.error("Ingresa el total contado")
      return
    }
    setSaving(true)
    try {
      const updated = await uploadRecordingCount(
        recordingUuid,
        Number(totalCount),
        file ?? undefined,
      )
      toast.success("Conteo subido")
      onSuccess(updated)
      onOpenChange(false)
    } catch {
      toast.error("Error al subir el conteo")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir conteo manual</DialogTitle>
          <DialogDescription>
            Ingresa el total contado fuera del robot. Opcionalmente adjunta el
            JSONL de detecciones por frame (mismo formato que el
            counting-worker: una línea por frame con <code>dets</code>) para
            que el replay pueda dibujar el overlay de detecciones.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Total contado *</Label>
            <Input
              type="number"
              min={0}
              value={totalCount}
              onChange={(e) => setTotalCount(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="space-y-2">
            <Label>Archivo .jsonl (opcional)</Label>
            <div
              className={[
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
                dragging
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-primary/40 bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50",
              ].join(" ")}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files[0]
                if (f) acceptFile(f)
              }}
            >
              {file ? (
                <>
                  <FileCheck className="h-8 w-8 text-primary" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB — click para cambiar
                  </span>
                </>
              ) : (
                <>
                  <FileUp className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Arrastra el archivo aquí o{" "}
                    <span className="text-foreground underline">selecciona</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Solo archivos .jsonl
                  </span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) acceptFile(f)
              }}
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
