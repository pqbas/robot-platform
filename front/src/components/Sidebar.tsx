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
  Menu,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { useAppMode } from "@/context/AppModeContext"
import { useAuth } from "@/context/AuthContext"
import { forceSyncPull, forceSyncPush } from "@/api/sync"
import UserMenu from "./UserMenu"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"

type NavItem = {
  label: string
  path: string
  icon: typeof Eye
  separator?: boolean
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
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
        { label: "Grabaciones", path: "/recordings", icon: Video },
        { label: "Configuración", path: "/settings", icon: Settings },
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

  const mobileItems = items.filter((item) => !item.separator)

  return (
    <>
      {/* Mobile: floating button + anchored popup (same style/column as Vision action buttons) */}
      <Button
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
        className="fixed bottom-4 left-2 z-50 size-16 flex-col gap-1 p-1 text-[11px] leading-tight bg-primary/85 backdrop-blur-sm hover:bg-primary md:hidden"
      >
        {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        <span>{mobileOpen ? "Cerrar" : "Menú"}</span>
      </Button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          {/* centered modal — compact 2-col grid */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xs rounded-xl border border-sidebar-border bg-sidebar p-2 text-sidebar-foreground shadow-2xl"
          >
            <div className="grid grid-cols-2 gap-1.5">
              {mobileItems.map((item) => {
                const active = location.pathname.startsWith(item.path)
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path)
                      setMobileOpen(false)
                    }}
                    className={`flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2.5 text-[11px] font-medium leading-tight transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
                    }`}
                  >
                    <item.icon className="size-5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                )
              })}
              {mode === "robot" && (
                <button
                  onClick={() => {
                    setMobileOpen(false)
                    handleSync()
                  }}
                  disabled={syncing}
                  className="flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2.5 text-[11px] font-medium leading-tight text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 disabled:opacity-50"
                >
                  <RefreshCw className={`size-5 shrink-0 ${syncing ? "animate-spin" : ""}`} />
                  <span>{syncing ? "Sincronizando" : "Sincronizar"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
