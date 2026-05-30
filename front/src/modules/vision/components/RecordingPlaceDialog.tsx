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
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import type { Camellon, DeviceContext, Empresa, Fundo } from "@/types"
import { getCamellones, createCamellon } from "@/api/camellones"
import { getEmpresas, createEmpresa, getFundos, createFundo } from "@/api/admin"
import { setRecordingPlace } from "@/api/recordings"

type RecordingPlaceDialogProps = {
  open: boolean
  recordingUuid: string | null
  deviceContext: DeviceContext | null
  currentFundoUuid?: string | null
  currentCamellonId?: number | null
  onSaved: () => void
  onSkip: () => void
}

export default function RecordingPlaceDialog({
  open,
  recordingUuid,
  deviceContext,
  currentFundoUuid,
  currentCamellonId,
  onSaved,
  onSkip,
}: RecordingPlaceDialogProps) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [camellones, setCamellones] = useState<Camellon[]>([])

  const [selectedEmpresaUuid, setSelectedEmpresaUuid] = useState("")
  const [selectedFundoUuid, setSelectedFundoUuid] = useState("")
  const [selectedCamellonId, setSelectedCamellonId] = useState("")
  const [saving, setSaving] = useState(false)

  const [empMode, setEmpMode] = useState<"idle" | "creating">("idle")
  const [empInput, setEmpInput] = useState("")
  const [fundoMode, setFundoMode] = useState<"idle" | "creating">("idle")
  const [fundoInput, setFundoInput] = useState("")
  const [camMode, setCamMode] = useState<"idle" | "creating">("idle")
  const [camInput, setCamInput] = useState("")

  useEffect(() => {
    if (!open) return
    setEmpMode("idle")
    setFundoMode("idle")
    setCamMode("idle")
    setSelectedCamellonId("")

    const targetFundoUuid = currentFundoUuid ?? deviceContext?.fundo?.uuid ?? null

    Promise.all([getEmpresas(), getFundos()])
      .then(([empItems, allFundos]) => {
        setEmpresas(empItems)
        if (targetFundoUuid) {
          const f = allFundos.find((x) => x.uuid === targetFundoUuid)
          if (f) {
            setSelectedEmpresaUuid(f.empresa_uuid)
            return
          }
        }
        const def = deviceContext?.empresa
          ? empItems.find((e) => e.uuid === deviceContext!.empresa!.uuid)
          : null
        if (def) setSelectedEmpresaUuid(def.uuid)
        else if (empItems.length > 0) setSelectedEmpresaUuid(empItems[0].uuid)
        else setSelectedEmpresaUuid("")
      })
      .catch(() => toast.error("Error al cargar empresas"))
  }, [open, deviceContext, currentFundoUuid])

  useEffect(() => {
    if (!selectedEmpresaUuid) {
      setFundos([])
      setSelectedFundoUuid("")
      setCamellones([])
      setSelectedCamellonId("")
      return
    }
    setSelectedCamellonId("")

    getFundos()
      .then((all) => {
        const filtered = all.filter((f) => f.empresa_uuid === selectedEmpresaUuid)
        setFundos(filtered)
        const targetUuid =
          (currentFundoUuid && filtered.find((f) => f.uuid === currentFundoUuid)?.uuid) ??
          (deviceContext?.fundo && filtered.find((f) => f.uuid === deviceContext.fundo!.uuid)?.uuid) ??
          null
        if (targetUuid) setSelectedFundoUuid(targetUuid)
        else if (filtered.length > 0) setSelectedFundoUuid(filtered[0].uuid)
        else setSelectedFundoUuid("")
      })
      .catch(() => toast.error("Error al cargar fundos"))
  }, [selectedEmpresaUuid, deviceContext, currentFundoUuid])

  useEffect(() => {
    if (!selectedFundoUuid) {
      setCamellones([])
      setSelectedCamellonId("")
      return
    }
    getCamellones(selectedFundoUuid)
      .then((items) => {
        setCamellones(items)
        if (currentCamellonId != null && items.some((c) => c.id === currentCamellonId)) {
          setSelectedCamellonId(String(currentCamellonId))
        } else {
          setSelectedCamellonId("")
        }
      })
      .catch(() => toast.error("Error al cargar camellones"))
  }, [selectedFundoUuid, currentCamellonId])

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

  async function handleSave() {
    if (!recordingUuid || !selectedCamellonId) return
    setSaving(true)
    try {
      await setRecordingPlace(recordingUuid, Number(selectedCamellonId))
      onSaved()
    } catch {
      toast.error("Error al guardar el lugar")
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    !saving &&
    !!selectedCamellonId &&
    empMode === "idle" &&
    fundoMode === "idle" &&
    camMode === "idle"

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onSkip() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Lugar de la grabación</DialogTitle>
          <DialogDescription>
            Asigna empresa, fundo y camellón (opcional — puedes omitir).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Empresa */}
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

          {/* Fundo */}
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

          {/* Camellón */}
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
                    <SelectValue placeholder="Selecciona camellón" />
                  </SelectTrigger>
                  <SelectContent>
                    {camellones.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
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
                  placeholder="Nombre del nuevo camellón"
                  value={camInput}
                  onChange={(e) => setCamInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateCamellon() }}
                  autoFocus
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={handleCreateCamellon} disabled={saving || !camInput.trim()}>
                  Crear
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCamMode("idle")}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={onSkip} disabled={saving}>
            Omitir
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="size-4 animate-spin mr-1" />}
            Guardar lugar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
