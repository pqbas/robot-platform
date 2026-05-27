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
import { Check, Pencil, Plus, X } from "lucide-react"
import { toast } from "sonner"

type Props = {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Session) => void
}

export default function SessionEditDialog({ session, open, onOpenChange, onSaved }: Props) {
  const [camellones, setCamellones] = useState<Camellon[]>([])
  const [camellonId, setCamellonId] = useState(String(session.camellon_id))
  const [creating, setCreating] = useState(false)
  const [newNombre, setNewNombre] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editNombre, setEditNombre] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    getCamellones().then(setCamellones).catch(() => toast.error("Error al cargar camellones"))
  }, [open])

  async function handleCreate() {
    const nombre = newNombre.trim()
    if (!nombre) return
    setSaving(true)
    try {
      const cam = await createCamellon(nombre)
      setCamellones((prev) => [...prev, cam])
      setCamellonId(String(cam.id))
      setNewNombre("")
      setCreating(false)
      toast.success(`Camellón "${cam.nombre}" creado`)
    } catch {
      toast.error("Error al crear el camellón")
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(id: number) {
    const nombre = editNombre.trim()
    if (!nombre) return
    setSaving(true)
    try {
      const updated = await renameCamellon(id, nombre)
      setCamellones((prev) => prev.map((c) => (c.id === id ? updated : c)))
      setEditingId(null)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar sesión #{session.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Select value={camellonId} onValueChange={setCamellonId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecciona un camellón" />
            </SelectTrigger>
            <SelectContent>
              {camellones.map((c) => (
                <SelectItem key={c.id} value={String(c.id)} className="pr-1">
                  <div className="flex w-full items-center justify-between gap-2">
                    {editingId === c.id ? (
                      <>
                        <Input
                          className="h-6 text-sm"
                          value={editNombre}
                          onChange={(e) => setEditNombre(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === "Enter") handleRename(c.id)
                            if (e.key === "Escape") setEditingId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRename(c.id) }}
                          className="text-primary"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(null) }}
                          className="text-muted-foreground"
                        >
                          <X className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{c.nombre}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingId(c.id)
                            setEditNombre(c.nombre)
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                        </button>
                      </>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {creating ? (
            <div className="flex gap-2">
              <Input
                placeholder="Nombre del camellón"
                value={newNombre}
                onChange={(e) => setNewNombre(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
              <Button size="sm" onClick={handleCreate} disabled={saving || !newNombre.trim()}>
                Crear
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" />
              Nuevo camellón
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
