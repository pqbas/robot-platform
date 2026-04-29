import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
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
import { useCameraResolution } from "@/hooks/useCameraResolution"
import { useAppMode } from "@/context/AppModeContext"

const SELECTED_LABEL_KEY = "vision.selectedLabel"

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

function CountingTab() {
  const { mode } = useAppMode()
  const resolution = useCameraResolution(mode === "robot")

  const [config, setConfig] = useState<CountingConfig | null>(null)
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [cameraConfig, setCameraConfig] = useState<CameraConfig | null>(null)
  const [labels, setLabels] = useState<AvailableLabelItem[]>([])
  const [draftLabel, setDraftLabel] = useState<string>(
    () => localStorage.getItem(SELECTED_LABEL_KEY) ?? "",
  )
  const [draftResolution, setDraftResolution] = useState<CameraPreset | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCountingConfig()
      .then(setConfig)
      .catch(() => toast.error("Error al cargar configuración"))
    listCameras().then(setCameras).catch(() => {})
    getCameraConfig().then(setCameraConfig).catch(() => {})
    getAvailableLabels().then(setLabels).catch(() => {})
  }, [])

  useEffect(() => {
    if (resolution.preset && draftResolution === null) {
      setDraftResolution(resolution.preset)
    }
  }, [resolution.preset, draftResolution])

  function handleModeChange(m: string) {
    if (!config) return
    const defaultDir = directionsByMode[m][0].value
    setConfig({ ...config, count_mode: m, direction: defaultDir })
  }

  async function handleSave() {
    if (!config) return
    setSaving(true)
    try {
      await updateCountingConfig(config)
      if (cameraConfig) await updateCameraConfig(cameraConfig)

      const storedLabel = localStorage.getItem(SELECTED_LABEL_KEY) ?? ""
      if (draftLabel && draftLabel !== storedLabel) {
        const item = labels.find((l) => l.label === draftLabel)
        if (item) {
          await selectLabel(item.label, item.model_filename)
          localStorage.setItem(SELECTED_LABEL_KEY, item.label)
        }
      }
      if (draftResolution && draftResolution !== resolution.preset) {
        await resolution.change(draftResolution)
      }
      toast.success("Configuración guardada")
    } catch {
      toast.error("Error al guardar configuración")
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return (
      <div className="text-sm text-muted-foreground">Cargando configuración</div>
    )
  }

  const directions =
    directionsByMode[config.count_mode] ?? directionsByMode.vertical

  return (
    <div className="space-y-4">
      {labels.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="object-select">Objeto a detectar</Label>
          <Select value={draftLabel} onValueChange={setDraftLabel}>
            <SelectTrigger id="object-select" className="w-full capitalize">
              <SelectValue placeholder="Selecciona un objeto" />
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

      {resolution.preset && (
        <div className="space-y-2">
          <Label htmlFor="resolution-select">Resolución de captura</Label>
          <Select
            value={draftResolution ?? resolution.preset}
            onValueChange={(v) => setDraftResolution(v as CameraPreset)}
          >
            <SelectTrigger id="resolution-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1080p">1080p</SelectItem>
              <SelectItem value="720p">720p</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            El cambio reinicia la cámara; detén conteo y grabación antes.
          </p>
        </div>
      )}

      {(labels.length > 0 || resolution.preset) && <Separator />}

      {cameras.length > 0 && cameraConfig && (
        <>
          <div className="space-y-2">
            <Label htmlFor="camera-select">Cámara</Label>
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
            <p className="text-xs text-muted-foreground">
              El cambio se aplica en la próxima conexión.
            </p>
          </div>
          <Separator />
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="count-mode">Modo de conteo</Label>
        <Select value={config.count_mode} onValueChange={handleModeChange}>
          <SelectTrigger id="count-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vertical">Vertical (línea horizontal)</SelectItem>
            <SelectItem value="horizontal">Horizontal (línea vertical)</SelectItem>
          </SelectContent>
        </Select>
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
      </div>

      <div className="space-y-2">
        <Label htmlFor="direction">Dirección de cruce</Label>
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
        <p className="text-xs text-muted-foreground">
          Detecciones por debajo de este valor se descartan (0.0 – 1.0).
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  )
}

function ServerTab() {
  const [serverUrl, setServerUrl] = useState("")
  const [deviceId, setDeviceId] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!serverUrl.trim() || !apiKey.trim()) {
      setError("Server URL y API Key son obligatorios")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/config/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_url: serverUrl.trim(),
          device_id: deviceId.trim(),
          api_key: apiKey.trim(),
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text)
      }
      toast.success("Conexión al servidor actualizada")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de conexión"
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="serverUrl">Server URL</Label>
        <Input
          id="serverUrl"
          placeholder="http://192.168.1.100:9090"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="deviceId">Device ID</Label>
        <Input
          id="deviceId"
          placeholder="jetson-campo-01"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          placeholder="rbt_..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold">Configuración</h1>
      <Tabs defaultValue="conteo">
        <TabsList>
          <TabsTrigger value="conteo">Conteo</TabsTrigger>
          <TabsTrigger value="servidor">Servidor</TabsTrigger>
        </TabsList>
        <TabsContent value="conteo" className="mt-4">
          <CountingTab />
        </TabsContent>
        <TabsContent value="servidor" className="mt-4">
          <ServerTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
