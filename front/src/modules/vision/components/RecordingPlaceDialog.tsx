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
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { Camellon, DeviceContext, Empresa, Fundo } from "@/types"
import { getCamellones } from "@/api/camellones"
import { getEmpresas, getFundos } from "@/api/admin"
import { setRecordingPlace } from "@/api/recordings"

type RecordingPlaceDialogProps = {
  open: boolean
  recordingUuid: string | null
  deviceContext: DeviceContext | null
  // For pre-selecting existing place when editing a tagged recording
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

  useEffect(() => {
    if (!open) return
    setSelectedCamellonId("")

    Promise.all([getEmpresas(), getFundos()])
      .then(([empItems, fundoItems]) => {
        setEmpresas(empItems)
        // Prefer current fundo > device context fundo > first empresa
        const targetFundoUuid = currentFundoUuid ?? deviceContext?.fundo?.uuid ?? null
        if (targetFundoUuid) {
          const fundo = fundoItems.find((f) => f.uuid === targetFundoUuid)
          if (fundo) {
            setSelectedEmpresaUuid(fundo.empresa_uuid)
            return
          }
        }
        const defEmpresa = deviceContext?.empresa
          ? empItems.find((e) => e.uuid === deviceContext.empresa!.uuid)
          : null
        if (defEmpresa) {
          setSelectedEmpresaUuid(defEmpresa.uuid)
        } else if (empItems.length > 0) {
          setSelectedEmpresaUuid(empItems[0].uuid)
        } else {
          setSelectedEmpresaUuid("")
        }
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
        // Prefer currentFundoUuid > device context fundo > first fundo
        const targetUuid =
          (currentFundoUuid && filtered.find((f) => f.uuid === currentFundoUuid)?.uuid) ??
          (deviceContext?.fundo && filtered.find((f) => f.uuid === deviceContext.fundo!.uuid)?.uuid) ??
          null
        if (targetUuid) {
          setSelectedFundoUuid(targetUuid)
        } else if (filtered.length > 0) {
          setSelectedFundoUuid(filtered[0].uuid)
        } else {
          setSelectedFundoUuid("")
        }
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

  const canSave = !saving && !!selectedCamellonId

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onSkip() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Lugar de la grabación</DialogTitle>
          <DialogDescription>
            Asigna empresa, fundo y camellón (opcional — puedes omitir).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Empresa</Label>
            <Select value={selectedEmpresaUuid} onValueChange={setSelectedEmpresaUuid}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.uuid} value={e.uuid}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Fundo</Label>
            <Select
              value={selectedFundoUuid}
              onValueChange={setSelectedFundoUuid}
              disabled={!selectedEmpresaUuid}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona fundo" />
              </SelectTrigger>
              <SelectContent>
                {fundos.map((f) => (
                  <SelectItem key={f.uuid} value={f.uuid}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Camellón</Label>
            <Select
              value={selectedCamellonId}
              onValueChange={setSelectedCamellonId}
              disabled={!selectedFundoUuid}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona camellón" />
              </SelectTrigger>
              <SelectContent>
                {camellones.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
