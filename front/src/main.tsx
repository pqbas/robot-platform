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
import RecordingsPage from "./modules/recordings/RecordingsPage"
import UsersPage from "./modules/admin/UsersPage"
import EmpresasPage from "./modules/admin/EmpresasPage"
import FundosPage from "./modules/admin/FundosPage"
import DevicesPage from "./modules/admin/DevicesPage"
import ModelsPage from "./modules/admin/ModelsPage"
import SetupPage from "./modules/setup/SetupPage"

function ModeRedirect() {
  const { mode, configured } = useAppMode()
  if (mode === "robot" && !configured) return <Navigate to="/setup" replace />
  return <Navigate to={mode === "robot" ? "/vision" : "/dashboard"} replace />
}

const router = createBrowserRouter([
  { path: "login", element: <LoginPage /> },
  { path: "setup", element: <SetupPage /> },
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
      { path: "recordings", element: <RecordingsPage /> },
      {
        path: "admin/users",
        element: (
          <ProtectedRoute requiredRole="admin">
            <UsersPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/empresas",
        element: (
          <ProtectedRoute requiredRole="admin">
            <EmpresasPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/fundos",
        element: (
          <ProtectedRoute requiredRole="admin">
            <FundosPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/devices",
        element: (
          <ProtectedRoute requiredRole="admin">
            <DevicesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/models",
        element: (
          <ProtectedRoute requiredRole="admin">
            <ModelsPage />
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
