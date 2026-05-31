import { useCallback, useEffect, useState } from "react"
import type { Fundo, Empresa } from "@/types"
import { getFundos, getEmpresas } from "@/api/admin"
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
import FundoFormDialog from "./components/FundoFormDialog"
import { toast } from "sonner"

export default function FundosPage() {
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Fundo | null>(null)

  const load = useCallback(async () => {
    try {
      const [f, e] = await Promise.all([
        getFundos(),
        getEmpresas(),
      ])
      setFundos(f)
      setEmpresas(e)
    } catch {
      toast.error("Error al cargar fundos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const empresaName = (uuid: string) =>
    empresas.find((e) => e.uuid === uuid)?.name ?? "—"

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Cargando...
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 overflow-auto p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fundos</h1>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          Nuevo fundo
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fundos.map((fundo) => (
              <TableRow key={fundo.uuid}>
                <TableCell className="font-medium">{fundo.name}</TableCell>
                <TableCell>{empresaName(fundo.empresa_uuid)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {fundo.region ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={fundo.is_active ? "default" : "outline"}>
                    {fundo.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(fundo)
                      setDialogOpen(true)
                    }}
                  >
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FundoFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        empresas={empresas}
        onSuccess={load}
      />
    </div>
  )
}
