import { useCallback, useEffect, useState } from "react"
import type { DetectionModel, ClassMappingItem } from "@/types"
import {
  getDetectionModels,
  activateModel,
  deactivateModel,
  deleteModel,
} from "@/api/admin-models"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import ModelUploadDialog from "./components/ModelUploadDialog"
import ModelEditDialog from "./components/ModelEditDialog"
import { toast } from "sonner"

function formatClasses(mapping: ClassMappingItem[]): string {
  if (!mapping || mapping.length === 0) return "—"
  return mapping
    .map((item) =>
      typeof item === "string"
        ? item
        : `${item.model_label} → ${item.system_label}`,
    )
    .join(", ")
}

export default function ModelsPage() {
  const [models, setModels] = useState<DetectionModel[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<DetectionModel | null>(null)

  const load = useCallback(async () => {
    try {
      setModels(await getDetectionModels())
    } catch {
      toast.error("Error al cargar modelos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleActivate = async (uuid: string) => {
    try {
      await activateModel(uuid)
      toast.success("Modelo activado")
      load()
    } catch {
      toast.error("Error al activar modelo")
    }
  }

  const handleDeactivate = async (uuid: string) => {
    try {
      await deactivateModel(uuid)
      toast.success("Modelo desactivado")
      load()
    } catch {
      toast.error("Error al desactivar modelo")
    }
  }

  const handleDelete = async (uuid: string) => {
    if (!window.confirm("Eliminar este modelo permanentemente?")) return
    try {
      await deleteModel(uuid)
      toast.success("Modelo eliminado")
      load()
    } catch {
      toast.error("Error al eliminar modelo")
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Cargando...
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 md:p-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Modelos de deteccion</h2>
          <Button onClick={() => setUploadOpen(true)}>Subir modelo</Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Archivo</TableHead>
                <TableHead>Clases</TableHead>
                <TableHead>mAP50</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-[140px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.uuid}>
                  <TableCell>{model.version}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {model.filename}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {formatClasses(model.class_mapping)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {model.map50 != null ? model.map50.toFixed(3) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={model.is_active ? "default" : "outline"}>
                      {model.is_active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingModel(model)}
                      >
                        Editar
                      </Button>
                      {model.is_active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeactivate(model.uuid)}
                        >
                          Desactivar
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleActivate(model.uuid)}
                        >
                          Activar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(model.uuid)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {models.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    No hay modelos registrados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <ModelUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={load}
      />
      {editingModel && (
        <ModelEditDialog
          model={editingModel}
          open={!!editingModel}
          onOpenChange={(open) => { if (!open) setEditingModel(null) }}
          onSuccess={load}
        />
      )}
    </div>
  )
}
