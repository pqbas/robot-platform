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
  onSaved: () => void
  onSkip: () => void
}

export default function RecordingPlaceDialog({
  open,
  recordingUuid,
  deviceContext,
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

    getEmpresas()
      .then((items) => {
        setEmpresas(items)
        const def = deviceContext?.empresa
          ? items.find((e) => e.uuid === deviceContext.empresa!.uuid)
          : null
        if (def) {
          setSelectedEmpresaUuid(def.uuid)
        } else if (items.length > 0) {
          setSelectedEmpresaUuid(items[0].uuid)
        } else {
          setSelectedEmpresaUuid("")
        }
      })
      .catch(() => toast.error("Error al cargar empresas"))
  }, [open, deviceContext])

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
        const def = deviceContext?.fundo
          ? filtered.find((f) => f.uuid === deviceContext.fundo!.uuid)
          : null
        if (def) {
          setSelectedFundoUuid(def.uuid)
        } else if (filtered.length > 0) {
          setSelectedFundoUuid(filtered[0].uuid)
        } else {
          setSelectedFundoUuid("")
        }
      })
      .catch(() => toast.error("Error al cargar fundos"))
  }, [selectedEmpresaUuid, deviceContext])

  useEffect(() => {
    if (!selectedFundoUuid) {
      setCamellones([])
      setSelectedCamellonId("")
      return
    }
    setSelectedCamellonId("")
    getCamellones(selectedFundoUuid)
      .then(setCamellones)
      .catch(() => toast.error("Error al cargar camellones"))
  }, [selectedFundoUuid])

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
