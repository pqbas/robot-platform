import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Eye,
  Map,
  BarChart3,
  Users,
  Building2,
  MapPin,
  HardDrive,
  Brain,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { useAppMode } from "@/context/AppModeContext"
import { useAuth } from "@/context/AuthContext"
import { useDeviceContext } from "@/hooks/useDeviceContext"
import UserMenu from "./UserMenu"
import { Separator } from "@/components/ui/separator"

type NavItem = {
  label: string
  path: string
  icon: typeof Eye
  separator?: boolean
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { mode, configured } = useAppMode()
  const { user } = useAuth()
  const { context: deviceContext } = useDeviceContext(mode === "robot")

  const items = useMemo<NavItem[]>(() => {
    if (mode === "robot") {
      const robotItems: NavItem[] = [
        { label: "Vision", path: "/vision", icon: Eye },
        { label: "Mapa", path: "/mapa", icon: Map },
        { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
      ]
      if (!configured) {
        robotItems.push({ label: "Servidor", path: "/setup", icon: Settings, separator: true })
      }
      return robotItems
    }

    const base: NavItem[] = [
      { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
      { label: "Mapa", path: "/mapa", icon: Map },
    ]

    if (user?.role === "admin") {
      base.push(
        { label: "Usuarios", path: "/admin/users", icon: Users, separator: true },
        { label: "Empresas", path: "/admin/empresas", icon: Building2 },
        { label: "Fundos", path: "/admin/fundos", icon: MapPin },
        { label: "Dispositivos", path: "/admin/devices", icon: HardDrive },
        { label: "Modelos", path: "/admin/models", icon: Brain },
      )
    }

    return base
  }, [mode, user?.role])

  return (
    <>
      {/* Mobile: fixed bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around overflow-x-auto border-t bg-sidebar text-sidebar-foreground md:hidden">
        {items
          .filter((item) => !item.separator)
          .map((item) => {
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
        {mode === "robot" && !collapsed && (
          <div className="border-b border-sidebar-border px-3 py-2 text-xs">
            {deviceContext?.fundo ? (
              <>
                <div className="text-sidebar-foreground/60 truncate">
                  {deviceContext.empresa?.name ?? "—"}
                </div>
                <div className="font-medium truncate">
                  {deviceContext.fundo.name}
                </div>
              </>
            ) : (
              <div className="text-sidebar-foreground/50 italic">
                Sin fundo asignado
              </div>
            )}
          </div>
        )}
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => {
            const active = location.pathname.startsWith(item.path)
            return (
              <div key={item.path}>
                {item.separator && <Separator className="my-2" />}
                <button
                  onClick={() => navigate(item.path)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <item.icon className="size-5 shrink-0" />
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </button>
              </div>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          {mode === "server" && user && <UserMenu collapsed={collapsed} />}
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
