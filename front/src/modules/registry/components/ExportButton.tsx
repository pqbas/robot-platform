import { Button } from "@/components/ui/button"
import { exportSession } from "@/api/sessions"

type ExportButtonProps = {
  sessionId: number
}

export default function ExportButton({ sessionId }: ExportButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={() => exportSession(sessionId)}>
      Exportar CSV
    </Button>
  )
}
