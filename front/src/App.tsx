import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const tabs = [
  { value: "vision", label: "Vision", path: "/vision" },
  { value: "mapa", label: "Mapa", path: "/mapa" },
]

function App() {
  const location = useLocation()
  const navigate = useNavigate()

  const activeTab =
    tabs.find((t) => location.pathname.startsWith(t.path))?.value ?? "vision"

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-4 py-2">
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            const tab = tabs.find((t) => t.value === v)
            if (tab) navigate(tab.path)
          }}
        >
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

export default App
