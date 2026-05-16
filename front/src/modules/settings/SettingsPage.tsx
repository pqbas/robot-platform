import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { forceSyncPull, forceSyncPush } from "@/api/sync"
import ModelStatusInline from "./components/ModelStatusInline"

const SELECTED_LABEL_KEY = "vision.selectedLabel.v3"
const PREFERRED_DEFAULT_LABEL = "blueberry"

function toSelectKey(l: AvailableLabelItem) {
  return `${l.label}::${l.model_filename}`
}
function fromSelectKey(key: string) {
  const idx = key.indexOf("::")
  if (idx === -1) return { label: key, model_filename: "" }
  return { label: key.slice(0, idx), model_filename: key.slice(idx + 2) }
}

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

type SectionId =
  | "camera"
  | "detection"
  | "counting"
  | "sync"
  | "server"

type Section = {
  id: SectionId
  label: string
  description?: string
}

export default function SettingsPage() {
  const { mode } = useAppMode()
  const resolution = useCameraResolution(mode === "robot")

  // Shared state across sections
  const [config, setConfig] = useState<CountingConfig | null>(null)
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [cameraConfig, setCameraConfig] = useState<CameraConfig | null>(null)
  const [labels, setLabels] = useState<AvailableLabelItem[]>([])
  const [draftKey, setDraftKey] = useState<string>(
    () => localStorage.getItem(SELECTED_LABEL_KEY) ?? "",
  )
  const [draftResolution, setDraftResolution] = useState<CameraPreset | null>(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const sections = useMemo<Section[]>(() => {
    const all: Section[] = [
      { id: "camera", label: "Cámara", description: "Dispositivo y resolución" },
      { id: "detection", label: "Detección", description: "Qué detectar y cómo" },
      { id: "counting", label: "Conteo", description: "Línea de cruce y dirección" },
    ]
    if (mode === "robot") {
      all.push({ id: "sync", label: "Sincronización", description: "Forzar sync ahora" })
    }
    all.push({ id: "server", label: "Servidor", description: "Conexión y credenciales" })
    return all
  }, [mode])

  const [activeId, setActiveId] = useState<SectionId>("camera")

  useEffect(() => {
    getCountingConfig()
      .then(setConfig)
      .catch(() => toast.error("Error al cargar configuración"))
    listCameras().then(setCameras).catch(() => {})
    getCameraConfig().then(setCameraConfig).catch(() => {})
    getAvailableLabels()
      .then((items) => {
        setLabels(items)
        if (!draftKey && items.length > 0) {
          const preferred =
            items.find((l) => l.label === PREFERRED_DEFAULT_LABEL) ?? items[0]
          setDraftKey(toSelectKey(preferred))
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      const storedKey = localStorage.getItem(SELECTED_LABEL_KEY) ?? ""
      if (draftKey && draftKey !== storedKey) {
        const { label, model_filename } = fromSelectKey(draftKey)
        const item = labels.find((l) => l.label === label && l.model_filename === model_filename)
        if (item) {
          await selectLabel(item.label, item.model_filename)
          localStorage.setItem(SELECTED_LABEL_KEY, draftKey)
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

  async function handleSync() {
    setSyncing(true)
    try {
      await Promise.all([forceSyncPush(), forceSyncPull()])
      toast.success("Sincronizado")
    } catch {
      toast.error("Error de sincronización — revisa la conexión al server")
    } finally {
      setSyncing(false)
    }
  }

  const directions =
    config && (directionsByMode[config.count_mode] ?? directionsByMode.vertical)

  return (
    <div className="mx-auto h-full w-full max-w-5xl overflow-y-auto p-4 md:p-6">
      <h1 className="mb-6 text-xl font-semibold md:text-2xl">Configuración</h1>

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <SectionNav
          sections={sections}
          activeId={activeId}
          onChange={setActiveId}
        />

        <div className="min-w-0 flex-1">
          {activeId === "camera" && (
            <SectionPanel title="Cámara" description="Dispositivo de captura y resolución de la imagen">
              {cameras.length > 0 && cameraConfig && (
                <Field label="Cámara" htmlFor="camera-select" hint="El cambio se aplica en la próxima conexión.">
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
                </Field>
              )}

              {resolution.preset && (
                <Field
                  label="Resolución de captura"
                  htmlFor="resolution-select"
                  hint="El cambio reinicia la cámara; detén conteo y grabación antes."
                >
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
                </Field>
              )}

              <SaveBar onClick={handleSave} disabled={saving} saving={saving} />
            </SectionPanel>
          )}

          {activeId === "detection" && config && (
            <SectionPanel title="Detección" description="Qué objetos detectar y con qué exigencia">
              {labels.length > 0 && (
                <Field label="Objeto a detectar" htmlFor="object-select">
                  <Select value={draftKey} onValueChange={setDraftKey}>
                    <SelectTrigger id="object-select" className="w-full capitalize">
                      <SelectValue placeholder="Selecciona un objeto" />
                    </SelectTrigger>
                    <SelectContent>
                      {(["uploaded", "library"] as const).map((src) => {
                        const group = labels.filter((l) => l.source === src)
                        if (group.length === 0) return null
                        return (
                          <div key={src}>
                            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {src === "uploaded" ? "Subidos" : "Librería"}
                            </div>
                            {group.map((l) => (
                              <SelectItem
                                key={`${l.model_filename}-${l.label}`}
                                value={l.label}
                                className="capitalize"
                              >
                                <span>{l.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground font-normal normal-case">
                                  {l.model_filename}
                                </span>
                              </SelectItem>
                            ))}
                          </div>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  {mode === "robot" && (
                    <ModelStatusInline
                      filename={labels.find((l) => l.label === draftLabel)?.model_filename ?? null}
                    />
                  )}
                </Field>
              )}

              <Field
                label="Área de detección"
                htmlFor="roi-mode"
                hint="Cuadrado central: YOLO ve un cuadrado de lado = altura del frame, sin letterbox. Frame completo: usa toda la imagen (con padding interno)."
              >
                <Select
                  value={config.roi_mode}
                  onValueChange={(v) =>
                    setConfig({ ...config, roi_mode: v as "square" | "full" })
                  }
                >
                  <SelectTrigger id="roi-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="square">Cuadrado central (recomendado)</SelectItem>
                    <SelectItem value="full">Frame completo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Umbral de confianza"
                htmlFor="confidence"
                hint="Detecciones por debajo de este valor se descartan (0.0 – 1.0)."
              >
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
                  className="max-w-[10rem]"
                />
              </Field>

              <SaveBar onClick={handleSave} disabled={saving} saving={saving} />
            </SectionPanel>
          )}

          {activeId === "counting" && config && directions && (
            <SectionPanel title="Conteo" description="Línea virtual que cuenta objetos al cruzarla">
              <Field label="Modo de conteo" htmlFor="count-mode">
                <Select value={config.count_mode} onValueChange={handleModeChange}>
                  <SelectTrigger id="count-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vertical">Vertical (línea horizontal)</SelectItem>
                    <SelectItem value="horizontal">Horizontal (línea vertical)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={`Línea de cruce (${config.count_mode === "vertical" ? "Y" : "X"} normalizada, 0–1)`}
                htmlFor="threshold"
                hint="Posición relativa de la línea sobre el frame (0 = borde inicial, 1 = borde opuesto). Independiente de la resolución."
              >
                <Input
                  id="threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.threshold}
                  onChange={(e) =>
                    setConfig({ ...config, threshold: Number(e.target.value) })
                  }
                  className="max-w-[10rem]"
                />
              </Field>

              <Field label="Dirección de cruce" htmlFor="direction">
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
              </Field>

              <SaveBar onClick={handleSave} disabled={saving} saving={saving} />
            </SectionPanel>
          )}

          {activeId === "sync" && mode === "robot" && (
            <SectionPanel
              title="Sincronización"
              description="Forzar una sincronización con el servidor ahora"
            >
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={syncing}
                className="gap-2"
              >
                <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando..." : "Sincronizar ahora"}
              </Button>
            </SectionPanel>
          )}

          {activeId === "server" && (
            <SectionPanel
              title="Servidor"
              description="URL y credenciales del servidor central"
            >
              <ServerForm />
            </SectionPanel>
          )}
        </div>
      </div>
    </div>
  )
}

type SectionNavProps = {
  sections: Section[]
  activeId: SectionId
  onChange: (id: SectionId) => void
}

function SectionNav({ sections, activeId, onChange }: SectionNavProps) {
  return (
    <>
      {/* Mobile: horizontal scroll pills */}
      <div className="-mx-4 overflow-x-auto px-4 md:hidden">
        <div className="flex gap-2 pb-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => onChange(s.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                activeId === s.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: vertical sidebar */}
      <nav className="hidden md:block md:w-56 md:shrink-0">
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onChange(s.id)}
                className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${
                  activeId === s.id
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-transparent hover:bg-accent/50"
                }`}
              >
                <span className="block text-sm font-medium">{s.label}</span>
                {s.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}

type SectionPanelProps = {
  title: string
  description?: string
  children: React.ReactNode
}

function SectionPanel({ title, description, children }: SectionPanelProps) {
  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

type FieldProps = {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}

function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

type SaveBarProps = {
  onClick: () => void
  disabled?: boolean
  saving?: boolean
}

function SaveBar({ onClick, disabled, saving }: SaveBarProps) {
  return (
    <div className="flex justify-end pt-2">
      <Button onClick={onClick} disabled={disabled}>
        {saving ? "Guardando..." : "Guardar"}
      </Button>
    </div>
  )
}

function ServerForm() {
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
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Server URL" htmlFor="serverUrl">
        <Input
          id="serverUrl"
          placeholder="http://192.168.1.100:9090"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </Field>
      <Field label="Device ID" htmlFor="deviceId">
        <Input
          id="deviceId"
          placeholder="jetson-campo-01"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        />
      </Field>
      <Field label="API Key" htmlFor="apiKey">
        <Input
          id="apiKey"
          placeholder="rbt_..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  )
}
