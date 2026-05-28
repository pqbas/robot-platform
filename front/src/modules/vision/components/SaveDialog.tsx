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
import { Plus } from "lucide-react"
import { toast } from "sonner"
import type { Camellon } from "@/types"
import { getCamellones, createCamellon, renameCamellon } from "@/api/camellones"

type Mode = "idle" | "creating" | "renaming"

type SaveDialogProps = {
  open: boolean
  totalCount: number
  duration: string
  onSave: (camellonNombre: string) => void
  onDiscard: () => void
}

export default function SaveDialog({
  open,
  totalCount,
  duration,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  const [camellones, setCamellones] = useState<Camellon[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [mode, setMode] = useState<Mode>("idle")
  const [inputValue, setInputValue] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    getCamellones().then(setCamellones).catch(() => toast.error("Error al cargar camellones"))
    setMode("idle")
    setSelectedId("")
    setInputValue("")
  }, [open])

  const selectedCamellon = camellones.find((c) => String(c.id) === selectedId)

  async function handleCreate() {
    const nombre = inputValue.trim()
    if (!nombre) return
    setSaving(true)
    try {
      const cam = await createCamellon(nombre)
      setCamellones((prev) => [...prev, cam])
      setSelectedId(String(cam.id))
      setInputValue("")
      setMode("idle")
      toast.success(`Camellón "${cam.nombre}" creado`)
    } catch {
      toast.error("Error al crear el camellón")
    } finally {
      setSaving(false)
    }
  }

  async function handleRename() {
    const nombre = inputValue.trim()
    if (!nombre || !selectedCamellon) return
    setSaving(true)
    try {
      const updated = await renameCamellon(selectedCamellon.id, nombre)
      setCamellones((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setInputValue("")
      setMode("idle")
      toast.success("Camellón renombrado")
    } catch {
      toast.error("Error al renombrar el camellón")
    } finally {
      setSaving(false)
    }
  }

  function handleConfirm() {
    if (mode === "creating") handleCreate()
    else if (mode === "renaming") handleRename()
  }

  function handleSave() {
    if (!selectedCamellon) return
    onSave(selectedCamellon.nombre)
  }

  return (
    <Dialog open={open} modal={false} onOpenChange={(v) => { if (!v) onDiscard() }}>
      <DialogContent
        className="sm:w-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Resultado del conteo</DialogTitle>
          <DialogDescription>
            Selecciona o crea un camellón para guardar la sesión
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-sm">
          <li><span className="text-muted-foreground">Conteo:</span> {totalCount}</li>
          <li><span className="text-muted-foreground">Duración:</span> {duration}</li>
        </ul>

        <div className="space-y-2">
          <Label>Camellón</Label>
          {mode === "idle" ? (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecciona un camellón" />
              </SelectTrigger>
              <SelectContent>
                {camellones.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder={mode === "creating" ? "Nombre del nuevo camellón" : `Renombrar "${selectedCamellon?.nombre}"`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm() }}
              autoFocus
            />
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-start">
          {mode === "idle" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => { setMode("renaming"); setInputValue(selectedCamellon?.nombre ?? "") }}
                disabled={!selectedCamellon}
              >
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => { setMode("creating"); setInputValue("") }}
              >
                <Plus className="size-3.5" />
                Nuevo
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" className="flex-1" onClick={handleConfirm} disabled={saving || !inputValue.trim()}>
                Confirmar
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setMode("idle")}>
                Cancelar
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="flex-1" onClick={handleSave} disabled={saving || !selectedCamellon || mode !== "idle"}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
