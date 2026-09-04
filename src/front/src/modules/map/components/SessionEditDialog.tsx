import { useEffect, useState } from "react"
import type { Session, Camellon, Empresa, Fundo } from "@/types"
import { patchSession, patchSessionDate } from "@/api/sessions"
import { getAllCamellones, createCamellon, renameCamellon } from "@/api/camellones"
import { getEmpresas, createEmpresa, getFundos, createFundo } from "@/api/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Plus } from "lucide-react"
import { toast } from "sonner"

type Props = {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Session) => void
  // Robot mode has no empresa/fundo/camellón catalog — only the date is editable.
  dateOnly?: boolean
}

type InlineMode = "idle" | "creating" | "renaming"

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in the browser's local time.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SessionEditDialog({
  session,
  open,
  onOpenChange,
  onSaved,
  dateOnly = false,
}: Props) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [camellones, setCamellones] = useState<Camellon[]>([])

  const [selectedEmpresaUuid, setSelectedEmpresaUuid] = useState("")
  const [selectedFundoUuid, setSelectedFundoUuid] = useState("")
  const [selectedCamellonId, setSelectedCamellonId] = useState("")
  const [startTime, setStartTime] = useState("")

  const [saving, setSaving] = useState(false)

  // Load the full catalog when the dialog opens and default the cascade to the
  // session's current location (camellón → fundo → empresa), if any.
  useEffect(() => {
    if (!open) return
    setEmpMode("idle")
    setFundoMode("idle")
    setCamMode("idle")
    setStartTime(toLocalInputValue(session.start_time))
    if (dateOnly) return

    Promise.all([getEmpresas(), getFundos(), getAllCamellones()])
      .then(([emps, fnds, cams]) => {
        setEmpresas(emps)
        setFundos(fnds)
        setCamellones(cams)

        const cam =
          session.camellon_id == null
            ? undefined
            : cams.find((c) => c.id === session.camellon_id)
        const fundo = cam?.fundo_uuid
          ? fnds.find((f) => f.uuid === cam.fundo_uuid)
          : undefined
        setSelectedEmpresaUuid(fundo?.empresa_uuid ?? "")
        setSelectedFundoUuid(fundo?.uuid ?? "")
        setSelectedCamellonId(cam ? String(cam.id) : "")
      })
      .catch(() => toast.error("Error al cargar ubicaciones"))
  }, [open, dateOnly, session.camellon_id, session.start_time])

  const fundosForEmpresa = fundos.filter((f) => f.empresa_uuid === selectedEmpresaUuid)
  const camellonesForFundo = camellones.filter((c) => c.fundo_uuid === selectedFundoUuid)
  const selectedCamellon = camellones.find((c) => String(c.id) === selectedCamellonId)

  function handleEmpresaChange(uuid: string) {
    setSelectedEmpresaUuid(uuid)
    setSelectedFundoUuid("")
    setSelectedCamellonId("")
  }

  function handleFundoChange(uuid: string) {
    setSelectedFundoUuid(uuid)
    setSelectedCamellonId("")
  }

  // --- Create empresa inline ---
  const [empMode, setEmpMode] = useState<"idle" | "creating">("idle")
  const [empInput, setEmpInput] = useState("")

  async function handleCreateEmpresa() {
    const name = empInput.trim()
    if (!name) return
    setSaving(true)
    try {
      const emp = await createEmpresa({ name })
      setEmpresas((prev) => [...prev, emp])
      handleEmpresaChange(emp.uuid)
      setEmpInput("")
      setEmpMode("idle")
      toast.success(`Empresa "${emp.name}" creada`)
    } catch {
      toast.error("Error al crear la empresa")
    } finally {
      setSaving(false)
    }
  }

  // --- Create fundo inline ---
  const [fundoMode, setFundoMode] = useState<"idle" | "creating">("idle")
  const [fundoInput, setFundoInput] = useState("")

  async function handleCreateFundo() {
    const name = fundoInput.trim()
    if (!name || !selectedEmpresaUuid) return
    setSaving(true)
    try {
      const fundo = await createFundo({ empresa_uuid: selectedEmpresaUuid, name })
      setFundos((prev) => [...prev, fundo])
      handleFundoChange(fundo.uuid)
      setFundoInput("")
      setFundoMode("idle")
      toast.success(`Fundo "${fundo.name}" creado`)
    } catch {
      toast.error("Error al crear el fundo")
    } finally {
      setSaving(false)
    }
  }

  // --- Create / rename camellón inline ---
  const [camMode, setCamMode] = useState<InlineMode>("idle")
  const [camInput, setCamInput] = useState("")

  async function handleCreateCamellon() {
    const nombre = camInput.trim()
    if (!nombre || !selectedFundoUuid) return
    setSaving(true)
    try {
      const cam = await createCamellon(nombre, selectedFundoUuid)
      setCamellones((prev) => [...prev, cam])
      setSelectedCamellonId(String(cam.id))
      setCamInput("")
      setCamMode("idle")
      toast.success(`Camellón "${cam.nombre}" creado`)
    } catch {
      toast.error("Error al crear el camellón")
    } finally {
      setSaving(false)
    }
  }

  async function handleRenameCamellon() {
    const nombre = camInput.trim()
    if (!nombre || !selectedCamellon) return
    setSaving(true)
    try {
      const updated = await renameCamellon(selectedCamellon.id, nombre)
      setCamellones((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setCamInput("")
      setCamMode("idle")
      toast.success("Camellón renombrado")
    } catch {
      toast.error("Error al renombrar el camellón")
    } finally {
      setSaving(false)
    }
  }

  function handleCamConfirm() {
    if (camMode === "creating") handleCreateCamellon()
    else if (camMode === "renaming") handleRenameCamellon()
  }

  async function handleSave() {
    if (!startTime || (!dateOnly && !selectedCamellon)) return
    setSaving(true)
    try {
      const iso = new Date(startTime).toISOString()
      const updated = dateOnly
        ? await patchSessionDate(session.id, iso)
        : await patchSession(session.id, selectedCamellon!.id, iso)
      onSaved(updated)
      onOpenChange(false)
      toast.success("Sesión actualizada")
    } catch {
      toast.error("Error al actualizar la sesión")
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    !saving &&
    empMode === "idle" &&
    fundoMode === "idle" &&
    camMode === "idle" &&
    !!startTime &&
    (dateOnly || selectedCamellon != null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar sesión #{session.id}</DialogTitle>
          <DialogDescription>
            {dateOnly
              ? "Ajusta la fecha y hora de inicio de la sesión."
              : "Asigna empresa, fundo y camellón, y ajusta la fecha si es necesario. Puedes crear cualquiera en el momento."}
          </DialogDescription>
        </DialogHeader>

        {/* --- Fecha --- */}
        <div className="space-y-2">
          <Label>Fecha y hora de inicio</Label>
          <Input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>

        {!dateOnly && (
        <>
        {/* --- Empresa --- */}
        <div className="space-y-2">
          <Label>Empresa</Label>
          {empMode === "idle" ? (
            <div className="flex gap-2">
              <Select value={selectedEmpresaUuid} onValueChange={handleEmpresaChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecciona empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.uuid} value={e.uuid}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => { setEmpMode("creating"); setEmpInput("") }}
              >
                <Plus className="size-3.5" />
                Nuevo
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder="Nombre de la nueva empresa"
                value={empInput}
                onChange={(e) => setEmpInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateEmpresa() }}
                autoFocus
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleCreateEmpresa} disabled={saving || !empInput.trim()}>
                Crear
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEmpMode("idle")}>
                Cancelar
              </Button>
            </div>
          )}
        </div>

        {/* --- Fundo --- */}
        <div className="space-y-2">
          <Label>Fundo</Label>
          {fundoMode === "idle" ? (
            <div className="flex gap-2">
              <Select
                value={selectedFundoUuid}
                onValueChange={handleFundoChange}
                disabled={!selectedEmpresaUuid}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecciona fundo" />
                </SelectTrigger>
                <SelectContent>
                  {fundosForEmpresa.map((f) => (
                    <SelectItem key={f.uuid} value={f.uuid}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={!selectedEmpresaUuid}
                onClick={() => { setFundoMode("creating"); setFundoInput("") }}
              >
                <Plus className="size-3.5" />
                Nuevo
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder="Nombre del nuevo fundo"
                value={fundoInput}
                onChange={(e) => setFundoInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateFundo() }}
                autoFocus
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleCreateFundo} disabled={saving || !fundoInput.trim()}>
                Crear
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFundoMode("idle")}>
                Cancelar
              </Button>
            </div>
          )}
        </div>

        {/* --- Camellón --- */}
        <div className="space-y-2">
          <Label>Camellón</Label>
          {camMode === "idle" ? (
            <div className="flex gap-2">
              <Select
                value={selectedCamellonId}
                onValueChange={setSelectedCamellonId}
                disabled={!selectedFundoUuid}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecciona un camellón" />
                </SelectTrigger>
                <SelectContent>
                  {camellonesForFundo.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={!selectedFundoUuid}
                onClick={() => { setCamMode("creating"); setCamInput("") }}
              >
                <Plus className="size-3.5" />
                Nuevo
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder={
                  camMode === "creating"
                    ? "Nombre del nuevo camellón"
                    : `Renombrar "${selectedCamellon?.nombre}"`
                }
                value={camInput}
                onChange={(e) => setCamInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCamConfirm() }}
                autoFocus
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleCamConfirm} disabled={saving || !camInput.trim()}>
                Confirmar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCamMode("idle")}>
                Cancelar
              </Button>
            </div>
          )}
          {camMode === "idle" && selectedCamellon && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0 text-xs text-muted-foreground"
              onClick={() => { setCamMode("renaming"); setCamInput(selectedCamellon.nombre) }}
            >
              Renombrar seleccionado
            </Button>
          )}
        </div>
        </>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
