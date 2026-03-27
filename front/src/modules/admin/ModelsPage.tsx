import { useCallback, useEffect, useState } from "react"
import type { FruitType, DetectionModel } from "@/types"
import {
  getFruitTypes,
  createFruitType,
  getDetectionModels,
  activateModel,
  deleteModel,
} from "@/api/admin-models"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import ModelUploadDialog from "./components/ModelUploadDialog"
import { toast } from "sonner"

export default function ModelsPage() {
  const [fruitTypes, setFruitTypes] = useState<FruitType[]>([])
  const [models, setModels] = useState<DetectionModel[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [newFruitName, setNewFruitName] = useState("")
  const [addingFruit, setAddingFruit] = useState(false)

  const load = useCallback(async () => {
    try {
      const [ft, m] = await Promise.all([getFruitTypes(), getDetectionModels()])
      setFruitTypes(ft)
      setModels(m)
    } catch {
      toast.error("Error al cargar datos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAddFruit = async () => {
    if (!newFruitName.trim() || addingFruit) return
    setAddingFruit(true)
    try {
      await createFruitType({ name: newFruitName.trim() })
      setNewFruitName("")
      toast.success("Tipo de fruta creado")
      load()
    } catch {
      toast.error("Error al crear tipo de fruta")
    } finally {
      setAddingFruit(false)
    }
  }

  const handleActivate = async (uuid: string) => {
    try {
      await activateModel(uuid)
      toast.success("Modelo activado")
      load()
    } catch {
      toast.error("Error al activar modelo")
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

  const fruitName = (uuid: string) =>
    fruitTypes.find((ft) => ft.uuid === uuid)?.name ?? "—"

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Cargando...
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 md:p-6">
      {/* Fruit Types section */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tipos de fruta</h2>
        <div className="flex items-center gap-2">
          <Input
            value={newFruitName}
            onChange={(e) => setNewFruitName(e.target.value)}
            placeholder="Nombre del tipo"
            className="max-w-xs"
            onKeyDown={(e) => e.key === "Enter" && handleAddFruit()}
          />
          <Button onClick={handleAddFruit} disabled={addingFruit} size="sm">
            {addingFruit ? "Creando..." : "Agregar"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {fruitTypes.map((ft) => (
            <Badge key={ft.uuid} variant="secondary">
              {ft.name}
            </Badge>
          ))}
          {fruitTypes.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No hay tipos de fruta registrados
            </span>
          )}
        </div>
      </section>

      {/* Detection Models section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Modelos de deteccion</h2>
          <Button onClick={() => setUploadOpen(true)}>Subir modelo</Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fruta</TableHead>
                <TableHead>Objeto</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Archivo</TableHead>
                <TableHead>mAP50</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-[140px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.uuid}>
                  <TableCell>{fruitName(model.fruit_type_uuid)}</TableCell>
                  <TableCell>{model.object_type}</TableCell>
                  <TableCell>{model.version}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {model.filename}
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
                      {!model.is_active && (
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
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
        fruitTypes={fruitTypes}
        onSuccess={load}
      />
    </div>
  )
}
