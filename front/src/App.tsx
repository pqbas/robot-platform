import { Outlet } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import Sidebar from "@/components/Sidebar"

function App() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <Sidebar />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-14 md:pb-0">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

export default App
