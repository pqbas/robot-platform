import { Outlet } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import Sidebar from "@/components/Sidebar"

function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

export default App
