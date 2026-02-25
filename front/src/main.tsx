import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import "./index.css"
import App from "./App"
import VisionPage from "./modules/vision/VisionPage"
import MapPage from "./modules/map/MapPage"
import DashboardPage from "./modules/dashboard/DashboardPage"

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/vision" replace /> },
      { path: "vision", element: <VisionPage /> },
      { path: "mapa", element: <MapPage /> },
      { path: "dashboard", element: <DashboardPage /> },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
