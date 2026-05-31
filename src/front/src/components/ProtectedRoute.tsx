import { Navigate } from "react-router-dom"
import { useAppMode } from "@/context/AppModeContext"
import { useAuth } from "@/context/AuthContext"
import type { ReactNode } from "react"

type Props = {
  children: ReactNode
  requiredRole?: string
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { mode } = useAppMode()
  const { isAuthenticated, user, loading } = useAuth()

  // Robot mode: no auth needed
  if (mode === "robot") return <>{children}</>

  // Server mode: wait for auth validation
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    )
  }

  // Server mode: not authenticated
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Server mode: check role if required
  if (requiredRole && user?.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
