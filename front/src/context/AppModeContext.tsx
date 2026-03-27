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
  loading: boolean
}

const AppModeContext = createContext<AppModeState>({
  mode: null,
  loading: true,
})

export function useAppMode() {
  return useContext(AppModeContext)
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppModeState>({
    mode: null,
    loading: true,
  })

  useEffect(() => {
    fetch("/api/sync/health")
      .then((res) => res.json())
      .then((data: { mode: AppMode }) => {
        setState({ mode: data.mode, loading: false })
      })
      .catch(() => {
        // If health check fails, default to robot mode (offline/local)
        setState({ mode: "robot", loading: false })
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
