import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import "./index.css"
import App from "./App"
import { AppModeProvider, useAppMode } from "./context/AppModeContext"
import { AuthProvider } from "./context/AuthContext"
import ProtectedRoute from "./components/ProtectedRoute"
import LoginPage from "./modules/auth/LoginPage"
import VisionPage from "./modules/vision/VisionPage"
import MapPage from "./modules/map/MapPage"
import DashboardPage from "./modules/dashboard/DashboardPage"

function ModeRedirect() {
  const { mode } = useAppMode()
  return <Navigate to={mode === "robot" ? "/vision" : "/dashboard"} replace />
}

function AdminPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      {title} — proximamente
    </div>
  )
}

const router = createBrowserRouter([
  { path: "login", element: <LoginPage /> },
  {
    element: (
      <ProtectedRoute>
        <App />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <ModeRedirect /> },
      { path: "vision", element: <VisionPage /> },
      { path: "mapa", element: <MapPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      {
        path: "admin/users",
        element: (
          <ProtectedRoute requiredRole="admin">
            <AdminPlaceholder title="Usuarios" />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/empresas",
        element: (
          <ProtectedRoute requiredRole="admin">
            <AdminPlaceholder title="Empresas" />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/fundos",
        element: (
          <ProtectedRoute requiredRole="admin">
            <AdminPlaceholder title="Fundos" />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/devices",
        element: (
          <ProtectedRoute requiredRole="admin">
            <AdminPlaceholder title="Dispositivos" />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/models",
        element: (
          <ProtectedRoute requiredRole="admin">
            <AdminPlaceholder title="Modelos" />
          </ProtectedRoute>
        ),
      },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppModeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppModeProvider>
  </StrictMode>,
)
