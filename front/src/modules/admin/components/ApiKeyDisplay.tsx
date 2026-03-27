import { useState } from "react"
import { Button } from "@/components/ui/button"

type Props = {
  apiKey: string
}

export default function ApiKeyDisplay({ apiKey }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select the text so user can copy manually
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-destructive">
        Esta API key solo se muestra una vez. Copiala ahora.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-muted px-3 py-2 text-sm break-all">
          {apiKey}
        </code>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </div>
  )
}
