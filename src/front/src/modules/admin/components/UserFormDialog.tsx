import { useEffect, useState } from "react"
import type { User, Empresa } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createUser, updateUser } from "@/api/admin"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: User | null
  empresas: Empresa[]
  onSuccess: () => void
}

export default function UserFormDialog({
  open,
  onOpenChange,
  editing,
  empresas,
  onSuccess,
}: Props) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState("viewer")
  const [empresaUuid, setEmpresaUuid] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      if (editing) {
        setUsername(editing.username)
        setPassword("")
        setRole(editing.role)
        setEmpresaUuid(editing.empresa_uuid ?? "")
      } else {
        setUsername("")
        setPassword("")
        setRole("viewer")
        setEmpresaUuid("")
      }
    }
  }, [editing, open])

  const handleSubmit = async () => {
    setSaving(true)
    try {
      if (editing) {
        await updateUser(editing.id, {
          role,
          empresa_uuid: empresaUuid || null,
        })
        toast.success("Usuario actualizado")
      } else {
        await createUser({
          username,
          password,
          role,
          empresa_uuid: empresaUuid || null,
        })
        toast.success("Usuario creado")
      }
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error("Error al guardar usuario")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar" : "Nuevo"} usuario
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Usuario</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!!editing}
            />
          </div>
          {!editing && (
            <div className="space-y-2">
              <Label>Contrasena</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select value={empresaUuid || "__none__"} onValueChange={(v) => setEmpresaUuid(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Sin empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin empresa</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.uuid} value={e.uuid}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
