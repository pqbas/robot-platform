import { useEffect, useState } from "react"
import type { DeviceContext } from "@/types"
import { getDeviceContext } from "@/api/device-context"

const POLL_MS = 60_000

export function useDeviceContext(enabled: boolean) {
  const [context, setContext] = useState<DeviceContext | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const ctx = await getDeviceContext()
        if (!cancelled) setContext(ctx)
      } catch {
        // keep last cached value
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchOnce()
    const id = setInterval(fetchOnce, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled])

  return { context, loading }
}
