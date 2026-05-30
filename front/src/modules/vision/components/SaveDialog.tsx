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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import type { Camellon, DeviceContext, Empresa, Fundo } from "@/types"
import { getCamellones, createCamellon, renameCamellon } from "@/api/camellones"
import { getEmpresas, createEmpresa, getFundos, createFundo } from "@/api/admin"
import { setActiveContext } from "@/api/device-context"

type InlineMode = "idle" | "creating" | "renaming"

type SaveDialogProps = {
  open: boolean
  totalCount: number
  duration: string
  deviceContext: DeviceContext | null
  onSave: (camellonId: number) => void
  onDiscard: () => void
}

export default function SaveDialog({
  open,
  totalCount,
  duration,
  deviceContext,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [camellones, setCamellones] = useState<Camellon[]>([])

  const [selectedEmpresaUuid, setSelectedEmpresaUuid] = useState("")
  const [selectedFundoUuid, setSelectedFundoUuid] = useState("")
  const [selectedCamellonId, setSelectedCamellonId] = useState("")

  const [camMode, setCamMode] = useState<InlineMode>("idle")
  const [camInput, setCamInput] = useState("")
  const [saving, setSaving] = useState(false)

  // Load empresas and apply defaults from context when dialog opens
  useEffect(() => {
    if (!open) return
    setCamMode("idle")
    setCamInput("")
    setSelectedCamellonId("")

    getEmpresas()
      .then((items) => {
        setEmpresas(items)
        const defaultEmpresa = deviceContext?.empresa
          ? items.find((e) => e.uuid === deviceContext.empresa!.uuid)
          : null
        if (defaultEmpresa) {
          setSelectedEmpresaUuid(defaultEmpresa.uuid)
        } else if (items.length > 0) {
          setSelectedEmpresaUuid(items[0].uuid)
        } else {
          setSelectedEmpresaUuid("")
        }
      })
      .catch(() => toast.error("Error al cargar empresas"))
  }, [open, deviceContext])

  // Load fundos when empresa changes
  useEffect(() => {
    if (!selectedEmpresaUuid) {
      setFundos([])
      setSelectedFundoUuid("")
      setCamellones([])
      setSelectedCamellonId("")
      return
    }
    setSelectedFundoUuid("")
    setCamellones([])
    setSelectedCamellonId("")

    getFundos()
      .then((all) => {
        const filtered = all.filter((f) => f.empresa_uuid === selectedEmpresaUuid)
        setFundos(filtered)
        const defaultFundo = deviceContext?.fundo
          ? filtered.find((f) => f.uuid === deviceContext.fundo!.uuid)
          : null
        if (defaultFundo) {
          setSelectedFundoUuid(defaultFundo.uuid)
        } else if (filtered.length > 0) {
          setSelectedFundoUuid(filtered[0].uuid)
        } else {
          setSelectedFundoUuid("")
        }
      })
      .catch(() => toast.error("Error al cargar fundos"))
  }, [selectedEmpresaUuid, deviceContext])

  // Load camellones when fundo changes
  useEffect(() => {
    if (!selectedFundoUuid) {
      setCamellones([])
      setSelectedCamellonId("")
      return
    }
    setSelectedCamellonId("")

    getCamellones(selectedFundoUuid)
      .then((items) => {
        setCamellones(items)
      })
      .catch(() => toast.error("Error al cargar camellones"))
  }, [selectedFundoUuid])

  const selectedEmpresa = empresas.find((e) => e.uuid === selectedEmpresaUuid)
  const selectedFundo = fundos.find((f) => f.uuid === selectedFundoUuid)
  const selectedCamellon = camellones.find((c) => String(c.id) === selectedCamellonId)

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
      setSelectedEmpresaUuid(emp.uuid)
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
      setSelectedFundoUuid(fundo.uuid)
      setFundoInput("")
      setFundoMode("idle")
      toast.success(`Fundo "${fundo.name}" creado`)
    } catch {
      toast.error("Error al crear el fundo")
    } finally {
      setSaving(false)
    }
  }

  // --- Create/rename camellon inline ---
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
    if (!selectedCamellon || !selectedEmpresa || !selectedFundo) return
    setSaving(true)
    try {
      // Persist the sticky selection before saving the session
      await setActiveContext({
        empresa_uuid: selectedEmpresa.uuid,
        empresa_name: selectedEmpresa.name,
        fundo_uuid: selectedFundo.uuid,
        fundo_name: selectedFundo.name,
        fundo_region: selectedFundo.region,
      })
    } catch {
      // Non-fatal: proceed with save even if context update fails
    }
    setSaving(false)
    onSave(selectedCamellon.id)
  }

  const canSave =
    !saving &&
    !!selectedCamellon &&
    camMode === "idle" &&
    empMode === "idle" &&
    fundoMode === "idle"

  return (
    <Dialog open={open} modal={false} onOpenChange={(v) => { if (!v) onDiscard() }}>
      <DialogContent
        className="sm:w-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Resultado del conteo</DialogTitle>
          <DialogDescription>
            Selecciona empresa, fundo y camellón para guardar la sesión
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-sm">
          <li><span className="text-muted-foreground">Conteo:</span> {totalCount}</li>
          <li><span className="text-muted-foreground">Duración:</span> {duration}</li>
        </ul>

        {/* --- Empresa --- */}
        <div className="space-y-2">
          <Label>Empresa</Label>
          {empMode === "idle" ? (
            <div className="flex gap-2">
              <Select value={selectedEmpresaUuid} onValueChange={setSelectedEmpresaUuid}>
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
                onValueChange={setSelectedFundoUuid}
                disabled={!selectedEmpresaUuid}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecciona fundo" />
                </SelectTrigger>
                <SelectContent>
                  {fundos.map((f) => (
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
                  {camellones.map((c) => (
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

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={saving}
          >
            Descartar
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
