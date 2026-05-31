import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  getCameraResolution,
  setCameraResolution,
  type CameraPreset,
} from "@/api/config"
import { ApiError } from "@/api/client"

type State = {
  preset: CameraPreset | null
  loading: boolean
  changing: boolean
  error: string | null
}

/** Tracks the camera resolution preset (1080p / 720p) and exposes a setter
 *  that persists to the backend, which in turn reloads the camera-worker. */
export function useCameraResolution(enabled: boolean) {
  const [state, setState] = useState<State>({
    preset: null,
    loading: enabled,
    changing: false,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }))
      return
    }
    let cancelled = false
    getCameraResolution()
      .then((res) => {
        if (cancelled) return
        setState({
          preset: res.preset,
          loading: false,
          changing: false,
          error: null,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          preset: null,
          loading: false,
          changing: false,
          error: err instanceof Error ? err.message : "no disponible",
        })
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const change = useCallback(async (preset: CameraPreset) => {
    setState((prev) => ({ ...prev, changing: true, error: null }))
    try {
      const res = await setCameraResolution(preset)
      setState({ preset: res.preset, loading: false, changing: false, error: null })
      toast.success(`Resolución cambiada a ${res.preset}`)
      return res
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "error desconocido"
      setState((prev) => ({ ...prev, changing: false, error: msg }))
      toast.error(`No se pudo cambiar la resolución: ${msg}`)
      throw err
    }
  }, [])

  return {
    preset: state.preset,
    loading: state.loading,
    changing: state.changing,
    error: state.error,
    change,
  }
}
