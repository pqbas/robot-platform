import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Eye, Map, BarChart3, PanelLeftClose, PanelLeftOpen } from "lucide-react"

const items = [
  { label: "Vision", path: "/vision", icon: Eye },
  { label: "Mapa", path: "/mapa", icon: Map },
  { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <>
      {/* Mobile: fixed bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t bg-sidebar text-sidebar-foreground md:hidden">
        {items.map((item) => {
          const active = location.pathname.startsWith(item.path)
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70"
              }`}
            >
              <item.icon className="size-5" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Desktop: side bar */}
      <aside
        className={`hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 md:flex ${
          collapsed ? "md:w-14" : "md:w-[180px]"
        }`}
      >
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => {
            const active = location.pathname.startsWith(item.path)
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="size-5 shrink-0" />
                {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center rounded-md px-3 py-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
      </aside>
    </>
  )
}
