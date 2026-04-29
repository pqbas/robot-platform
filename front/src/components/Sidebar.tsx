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
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
} from "lucide-react"
import { toast } from "sonner"
import { useAppMode } from "@/context/AppModeContext"
import { useAuth } from "@/context/AuthContext"
import { forceSyncPull, forceSyncPush } from "@/api/sync"
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
  const { mode } = useAppMode()
  const { user } = useAuth()
  const [syncing, setSyncing] = useState(false)

  const handleSync = async () => {
    setSyncing(true)
    try {
      await Promise.all([forceSyncPush(), forceSyncPull()])
      toast.success("Sincronizado")
    } catch {
      toast.error("Error de sincronización — revisa la conexión al server")
    } finally {
      setSyncing(false)
    }
  }

  const items = useMemo<NavItem[]>(() => {
    if (mode === "robot") {
      const robotItems: NavItem[] = [
        { label: "Vision", path: "/vision", icon: Eye },
        { label: "Mapa", path: "/mapa", icon: Map },
        { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
        { label: "Grabaciones", path: "/recordings", icon: Video },
      ]
      return robotItems
    }

    const base: NavItem[] = [
      { label: "Dashboard", path: "/dashboard", icon: BarChart3 },
      { label: "Mapa", path: "/mapa", icon: Map },
      { label: "Grabaciones", path: "/recordings", icon: Video },
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

        <div className="p-2 space-y-1">
          {mode === "robot" && (
            <>
              <button
                onClick={() => navigate("/settings")}
                title="Configuración"
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  location.pathname.startsWith("/settings")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                } ${collapsed ? "justify-center" : ""}`}
              >
                <Settings className="size-5 shrink-0" />
                {!collapsed && <span className="whitespace-nowrap">Configuración</span>}
              </button>
              <button
                onClick={handleSync}
                disabled={syncing}
                title={syncing ? "Sincronizando..." : "Sincronizar ahora"}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground disabled:opacity-50 ${
                  collapsed ? "justify-center" : ""
                }`}
              >
                <RefreshCw className={`size-5 shrink-0 ${syncing ? "animate-spin" : ""}`} />
                {!collapsed && (
                  <span className="whitespace-nowrap">
                    {syncing ? "Sincronizando..." : "Sincronizar"}
                  </span>
                )}
              </button>
            </>
          )}
          {mode === "server" && user && <UserMenu collapsed={collapsed} />}
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expandir" : "Colapsar"}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5 shrink-0" />
            ) : (
              <PanelLeftClose className="size-5 shrink-0" />
            )}
            {!collapsed && <span className="whitespace-nowrap">Colapsar</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
