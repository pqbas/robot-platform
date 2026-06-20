import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type SaveDialogProps = {
  open: boolean
  duration: string
  onSave: () => void
  onDiscard: () => void
}

// The robot only captures and counts: a session is saved without a location.
// Empresa/fundo/camellón are assigned and managed entirely on the server.
export default function SaveDialog({
  open,
  duration,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  return (
    <Dialog open={open} modal={false} onOpenChange={(v) => { if (!v) onDiscard() }}>
      <DialogContent
        className="sm:w-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Resultado del conteo</DialogTitle>
          <DialogDescription>
            La sesión se guarda en el robot y se envía al servidor, donde se
            asigna su ubicación.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-sm">
          <li>
            <span className="text-muted-foreground">Conteo:</span>{" "}
            <span className="text-muted-foreground italic">
              procesando… (aparecerá en la lista de sesiones)
            </span>
          </li>
          <li><span className="text-muted-foreground">Duración:</span> {duration}</li>
        </ul>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={onDiscard}>
            Descartar
          </Button>
          <Button size="sm" onClick={onSave}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
