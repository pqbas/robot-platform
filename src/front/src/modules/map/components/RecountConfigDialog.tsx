import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  getRecountConfig,
  recountWithConfig,
  type RecountConfig,
} from "@/api/recordings"
import { getCountingOptions, type CountingOption } from "@/api/config"
import { toast } from "sonner"

type Props = {
  recordingUuid: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Called after the count is successfully enqueued, so the table can reflect
  // the "counting" state immediately.
  onEnqueued: () => void
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

// Unique key for a model+class option (a model may expose several classes).
const optionKey = (o: CountingOption) => `${o.model_uuid}::${o.label}`

export default function RecountConfigDialog({
  recordingUuid,
  open,
  onOpenChange,
  onEnqueued,
}: Props) {
  const [cfg, setCfg] = useState<RecountConfig | null>(null)
  const [options, setOptions] = useState<CountingOption[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setCfg(null)
    Promise.all([getRecountConfig(recordingUuid), getCountingOptions()])
      .then(([preview, opts]) => {
        setOptions(opts)
        // Prefer the video's pinned model+class; if it doesn't match any current
        // option (e.g. never counted, or the model was removed), default to the
        // first available option.
        const match = opts.find(
          (o) =>
            o.model_uuid === preview.model_uuid &&
            o.label === preview.target_class,
        )
        const chosen = match ?? opts[0]
        if (chosen) {
          // TensorRT only if that model has a built engine; else PyTorch.
          const runtime =
            preview.runtime === "tensorrt" && !chosen.tensorrt_available
              ? "pytorch"
              : preview.runtime ?? (chosen.tensorrt_available ? "tensorrt" : "pytorch")
          setCfg({
            ...preview,
            target_class: chosen.label,
            model_uuid: chosen.model_uuid,
            runtime,
          })
        } else {
          setCfg(preview)
        }
      })
      .catch(() => toast.error("No se pudo cargar la configuración"))
  }, [open, recordingUuid])

  const selectedOption = cfg
    ? options.find(
        (o) => o.model_uuid === cfg.model_uuid && o.label === cfg.target_class,
      ) ?? null
    : null

  const handleOptionChange = (key: string) => {
    if (!cfg) return
    const opt = options.find((o) => optionKey(o) === key)
    if (!opt) return
    // Switching model may invalidate the runtime (new model has no engine).
    const runtime =
      cfg.runtime === "tensorrt" && !opt.tensorrt_available
        ? "pytorch"
        : cfg.runtime
    setCfg({
      ...cfg,
      target_class: opt.label,
      model_uuid: opt.model_uuid,
      runtime,
    })
  }

  // Switching mode invalidates the previous direction — reset to the first valid.
  const handleModeChange = (m: string) => {
    if (!cfg) return
    setCfg({ ...cfg, count_mode: m, direction: directionsByMode[m][0].value })
  }

  // Tiled fixes the geometry: horizontal mode (vertical line), square ROI, line
  // at center. Only direction (left/right) + confidence stay configurable, so we
  // coerce those fields and the dialog hides mode/line/ROI for tiled.
  const handleMethodChange = (m: string) => {
    if (!cfg) return
    if (m === "tiled") {
      const dir = cfg.direction === "right2left" ? "right2left" : "left2right"
      setCfg({
        ...cfg,
        method: "tiled",
        count_mode: "horizontal",
        roi_mode: "square",
        threshold: 0.5,
        direction: dir,
      })
    } else {
      setCfg({ ...cfg, method: "single" })
    }
  }

  const handleProcess = async () => {
    if (!cfg) return
    setSubmitting(true)
    try {
      await recountWithConfig(recordingUuid, cfg)
      toast.success("Procesando…")
      onEnqueued()
      onOpenChange(false)
    } catch {
      toast.error("No se pudo procesar")
    } finally {
      setSubmitting(false)
    }
  }

  // Tiled always uses horizontal directions (vertical line); single follows the
  // chosen count_mode.
  const directions = cfg
    ? cfg.method === "tiled"
      ? directionsByMode.horizontal
      : directionsByMode[cfg.count_mode] ?? directionsByMode.horizontal
    : []
  const isTiled = cfg?.method === "tiled"

  const sources = ["uploaded", "library"] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configuración del conteo</DialogTitle>
        </DialogHeader>

        {!cfg ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="space-y-5 py-2">
            <Field label="Modelo a usar" htmlFor="rc-model">
              <Select
                value={selectedOption ? optionKey(selectedOption) : ""}
                onValueChange={handleOptionChange}
              >
                <SelectTrigger id="rc-model" className="w-full capitalize">
                  <SelectValue placeholder="Selecciona un objeto" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((src) => {
                    const group = options.filter((o) => o.source === src)
                    if (group.length === 0) return null
                    return (
                      <SelectGroup key={src}>
                        <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {src === "uploaded" ? "Subidos" : "Librería"}
                        </SelectLabel>
                        {group.map((o) => (
                          <SelectItem
                            key={optionKey(o)}
                            value={optionKey(o)}
                            className="capitalize"
                          >
                            <span>{o.label}</span>
                            <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
                              {o.model_filename}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Formato del modelo"
              htmlFor="rc-runtime"
              hint={
                selectedOption && !selectedOption.tensorrt_available
                  ? "Este modelo no tiene engine TensorRT construido; solo PyTorch."
                  : "TensorRT es más rápido; PyTorch usa el .pt original."
              }
            >
              <Select
                value={cfg.runtime ?? "pytorch"}
                onValueChange={(v) =>
                  setCfg({ ...cfg, runtime: v as "pytorch" | "tensorrt" })
                }
              >
                <SelectTrigger id="rc-runtime" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pytorch">PyTorch (.pt)</SelectItem>
                  <SelectItem
                    value="tensorrt"
                    disabled={!selectedOption?.tensorrt_available}
                  >
                    TensorRT (.engine)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Método de conteo"
              htmlFor="rc-method"
              hint={
                isTiled
                  ? "Tiled: dos cuadrados (lado H/2) apilados y centrados en el eje vertical del frame, cada uno con su tracker; línea de cruce al centro de cada uno. Mejor para arándanos. No usa el Área de detección."
                  : "Single: line-crossing clásico sobre el Área de detección."
              }
            >
              <Select value={cfg.method} onValueChange={handleMethodChange}>
                <SelectTrigger id="rc-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single (line-crossing)</SelectItem>
                  <SelectItem value="tiled">Tiled (2 tiles)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {!isTiled && (
              <Field label="Modo de conteo" htmlFor="rc-mode">
                <Select value={cfg.count_mode} onValueChange={handleModeChange}>
                  <SelectTrigger id="rc-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vertical">Vertical (línea horizontal)</SelectItem>
                    <SelectItem value="horizontal">Horizontal (línea vertical)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}

            {!isTiled && (
              <Field
                label={`Línea de cruce (${cfg.count_mode === "vertical" ? "Y" : "X"} normalizada, 0–1)`}
                htmlFor="rc-threshold"
                hint="Posición relativa de la línea sobre el frame (0 = borde inicial, 1 = borde opuesto)."
              >
                <Input
                  id="rc-threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={cfg.threshold}
                  onChange={(e) =>
                    setCfg({ ...cfg, threshold: Number(e.target.value) })
                  }
                  className="max-w-[10rem]"
                />
              </Field>
            )}

            <Field label="Dirección de cruce" htmlFor="rc-direction">
              <Select
                value={cfg.direction}
                onValueChange={(v) => setCfg({ ...cfg, direction: v })}
              >
                <SelectTrigger id="rc-direction" className="w-full">
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

            {!isTiled && (
              <Field label="Área de análisis (ROI)" htmlFor="rc-roi">
                <Select
                  value={cfg.roi_mode}
                  onValueChange={(v) =>
                    setCfg({ ...cfg, roi_mode: v as "square" | "full" })
                  }
                >
                  <SelectTrigger id="rc-roi" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="square">Cuadrado central</SelectItem>
                    <SelectItem value="full">Frame completo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field
              label="Umbral de confianza (0–1)"
              htmlFor="rc-conf"
              hint="Confianza mínima de detección para considerar un objeto."
            >
              <Input
                id="rc-conf"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={cfg.confidence}
                onChange={(e) =>
                  setCfg({ ...cfg, confidence: Number(e.target.value) })
                }
                className="max-w-[10rem]"
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleProcess}
            disabled={!cfg || submitting || !cfg.target_class || !cfg.model_uuid}
          >
            {submitting ? "Procesando…" : "Procesar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Mirrors the Field used in SettingsPage so this dialog matches the look of the
// normal counting config (label + control + optional hint, consistent spacing).
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
