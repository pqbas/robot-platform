import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { AppMode } from "@/types"

type AppModeState = {
  mode: AppMode | null
  configured: boolean
  loading: boolean
}

const AppModeContext = createContext<AppModeState>({
  mode: null,
  configured: true,
  loading: true,
})

export function useAppMode() {
  return useContext(AppModeContext)
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppModeState>({
    mode: null,
    configured: true,
    loading: true,
  })

  useEffect(() => {
    fetch("/api/config/setup-status")
      .then((res) => res.json())
      .then((data: { mode: AppMode; configured: boolean }) => {
        setState({ mode: data.mode, configured: data.configured, loading: false })
      })
      .catch(() => {
        setState({ mode: "robot", configured: true, loading: false })
      })
  }, [])

  if (state.loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    )
  }

  return (
    <AppModeContext.Provider value={state}>{children}</AppModeContext.Provider>
  )
}
