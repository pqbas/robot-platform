import { useEffect, useState } from "react"
import type { Session, Camellon } from "@/types"
import { patchSession } from "@/api/sessions"
import { getCamellones, createCamellon, renameCamellon } from "@/api/camellones"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
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
import { Plus } from "lucide-react"
import { toast } from "sonner"

type Props = {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Session) => void
}

type Mode = "idle" | "creating" | "renaming"

export default function SessionEditDialog({ session, open, onOpenChange, onSaved }: Props) {
  const [camellones, setCamellones] = useState<Camellon[]>([])
  const [camellonId, setCamellonId] = useState(String(session.camellon_id))
  const [mode, setMode] = useState<Mode>("idle")
  const [inputValue, setInputValue] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    getCamellones().then(setCamellones).catch(() => toast.error("Error al cargar camellones"))
    setMode("idle")
  }, [open])

  const selectedCamellon = camellones.find((c) => String(c.id) === camellonId)

  async function handleCreate() {
    const nombre = inputValue.trim()
    if (!nombre) return
    setSaving(true)
    try {
      const cam = await createCamellon(nombre)
      setCamellones((prev) => [...prev, cam])
      setCamellonId(String(cam.id))
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

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await patchSession(session.id, Number(camellonId))
      onSaved(updated)
      onOpenChange(false)
      toast.success("Sesión actualizada")
    } catch {
      toast.error("Error al actualizar la sesión")
    } finally {
      setSaving(false)
    }
  }

  function handleConfirm() {
    if (mode === "creating") handleCreate()
    else if (mode === "renaming") handleRename()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar sesión #{session.id}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {mode === "idle" ? (
            <Select value={camellonId} onValueChange={(v) => setCamellonId(v)}>
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
                onClick={() => { setMode("renaming"); setInputValue(selectedCamellon?.nombre ?? "") }}
                disabled={!selectedCamellon}
              >
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { setMode("creating"); setInputValue("") }}
              >
                <Plus className="size-3.5" />
                Nuevo
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleConfirm} disabled={saving || !inputValue.trim()}>
                Confirmar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setMode("idle")}>
                Cancelar
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="ml-auto" onClick={handleSave} disabled={saving || mode !== "idle"}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
