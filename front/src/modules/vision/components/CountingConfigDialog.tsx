import { useEffect, useState } from "react"
import { toast } from "sonner"
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
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  type CameraConfig,
  type CameraDevice,
  type CameraPreset,
  type CountingConfig,
  getCameraConfig,
  getCountingConfig,
  listCameras,
  updateCameraConfig,
  updateCountingConfig,
} from "@/api/config"
import {
  getAvailableLabels,
  selectLabel,
  type AvailableLabelItem,
} from "@/api/vision"

const directionsByMode: Record<string, { value: string; label: string }[]> = {
  vertical: [
    { value: "top2down", label: "Arriba → Abajo" },
    { value: "down2top", label: "Abajo → Arriba" },
  ],
  horizontal: [
    { value: "left2right", label: "Izquierda → Derecha" },
    { value: "right2left", label: "Derecha → Izquierda" },
  ],
}

type CountingConfigDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedClass: string
  onObjectChanged: (label: string) => void
  resolutionPreset: CameraPreset | null
  onResolutionChange: (preset: CameraPreset) => Promise<unknown>
  resolutionLocked: boolean
}

export default function CountingConfigDialog({
  open,
  onOpenChange,
  selectedClass,
  onObjectChanged,
  resolutionPreset,
  onResolutionChange,
  resolutionLocked,
}: CountingConfigDialogProps) {
  const [config, setConfig] = useState<CountingConfig | null>(null)
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [cameraConfig, setCameraConfig] = useState<CameraConfig | null>(null)
  const [labels, setLabels] = useState<AvailableLabelItem[]>([])
  const [draftLabel, setDraftLabel] = useState<string>(selectedClass)
  const [draftResolution, setDraftResolution] = useState<CameraPreset | null>(
    resolutionPreset,
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDraftLabel(selectedClass)
      setDraftResolution(resolutionPreset)
      getCountingConfig()
        .then(setConfig)
        .catch(() => toast.error("Error al cargar configuracion"))
      listCameras()
        .then(setCameras)
        .catch(() => {})
      getCameraConfig()
        .then(setCameraConfig)
        .catch(() => {})
      getAvailableLabels()
        .then(setLabels)
        .catch(() => {})
    }
  }, [open, selectedClass, resolutionPreset])

  function handleModeChange(mode: string) {
    if (!config) return
    const defaultDir = directionsByMode[mode][0].value
    setConfig({ ...config, count_mode: mode, direction: defaultDir })
  }

  async function handleSave() {
    if (!config) return
    setSaving(true)
    try {
      const updated = await updateCountingConfig(config)
      setConfig(updated)
      if (cameraConfig) {
        await updateCameraConfig(cameraConfig)
      }
      if (draftLabel && draftLabel !== selectedClass) {
        const item = labels.find((l) => l.label === draftLabel)
        if (item) {
          await selectLabel(item.label, item.model_filename)
          onObjectChanged(item.label)
        }
      }
      if (draftResolution && draftResolution !== resolutionPreset) {
        await onResolutionChange(draftResolution)
      }
      toast.success("Configuracion guardada")
      onOpenChange(false)
    } catch {
      toast.error("Error al guardar configuracion")
    } finally {
      setSaving(false)
    }
  }

  const directions =
    config
      ? (directionsByMode[config.count_mode] ?? directionsByMode.vertical)
      : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configuracion de conteo</DialogTitle>
          <DialogDescription>
            Parametros de la linea de cruce para el conteo por tracking
          </DialogDescription>
        </DialogHeader>

        {config && (
          <div className="space-y-4">
            {labels.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="object-select">Objeto a detectar</Label>
                <Select
                  value={draftLabel}
                  onValueChange={setDraftLabel}
                >
                  <SelectTrigger id="object-select" className="w-full capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {labels.map((l) => (
                      <SelectItem
                        key={`${l.model_filename}-${l.label}`}
                        value={l.label}
                        className="capitalize"
                      >
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {resolutionPreset && (
              <div className="space-y-2">
                <Label htmlFor="resolution-select">Resolución de captura</Label>
                <Select
                  value={draftResolution ?? resolutionPreset}
                  onValueChange={(v) => setDraftResolution(v as CameraPreset)}
                  disabled={resolutionLocked}
                >
                  <SelectTrigger id="resolution-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1080p">1080p</SelectItem>
                    <SelectItem value="720p">720p</SelectItem>
                  </SelectContent>
                </Select>
                {resolutionLocked && (
                  <p className="text-muted-foreground text-xs">
                    Desconecta la cámara y detén conteo/grabación para cambiar la resolución
                  </p>
                )}
              </div>
            )}

            {(labels.length > 0 || resolutionPreset) && <Separator />}

            {cameras.length > 0 && cameraConfig && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="camera-select">Camara</Label>
                  <Select
                    value={String(cameraConfig.index)}
                    onValueChange={(v) =>
                      setCameraConfig({ ...cameraConfig, index: Number(v) })
                    }
                  >
                    <SelectTrigger id="camera-select" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cameras.map((cam) => (
                        <SelectItem key={cam.index} value={String(cam.index)}>
                          {cam.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Dispositivo de captura de video. El cambio se aplica en la proxima conexion.
                  </p>
                </div>
                <Separator />
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="count-mode">Modo de conteo</Label>
              <Select
                value={config.count_mode}
                onValueChange={handleModeChange}
              >
                <SelectTrigger id="count-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical">Vertical (linea horizontal)</SelectItem>
                  <SelectItem value="horizontal">Horizontal (linea vertical)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {config.count_mode === "vertical"
                  ? "Cuenta objetos que cruzan la linea en el eje Y"
                  : "Cuenta objetos que cruzan la linea en el eje X"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="threshold">
                Threshold ({config.count_mode === "vertical" ? "Y" : "X"} en px)
              </Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                value={config.threshold}
                onChange={(e) =>
                  setConfig({ ...config, threshold: Number(e.target.value) })
                }
              />
              <p className="text-muted-foreground text-xs">
                Posicion en pixeles de la linea de conteo
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="direction">Direccion de cruce</Label>
              <Select
                value={config.direction}
                onValueChange={(v) => setConfig({ ...config, direction: v })}
              >
                <SelectTrigger id="direction" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {directions.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="confidence">Umbral de confianza</Label>
              <Input
                id="confidence"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={config.confidence_threshold}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    confidence_threshold: Number(e.target.value),
                  })
                }
              />
              <p className="text-muted-foreground text-xs">
                Detecciones con confianza menor a este valor se descartan (0.0 – 1.0)
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!config || saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
