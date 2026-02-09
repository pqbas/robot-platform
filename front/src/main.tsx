import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import "./index.css"
import App from "./App"
import VisionPage from "./modules/vision/VisionPage"
import RegistryPage from "./modules/registry/RegistryPage"
import MapPage from "./modules/map/MapPage"

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/vision" replace /> },
      { path: "vision", element: <VisionPage /> },
      { path: "registro", element: <RegistryPage /> },
      { path: "mapa", element: <MapPage /> },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
