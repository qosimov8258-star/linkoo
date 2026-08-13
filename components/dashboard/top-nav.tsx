"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  Factory,
  Menu,
  Settings,
  User,
  UserRound,
  Users,
  Video,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react"

import { AccountDropdown } from "./account-dropdown"
import { AnalyticsMenu } from "./analytics-menu"
import { BrandMenu, type CustomServer, type WorkspaceId } from "./brand-menu"
import { ClientsMenu } from "./clients-menu"
import { FinanceMenu } from "./finance-menu"
import { NotificationsMenu } from "./notifications-menu"
import { PersonnelMenu } from "./personnel-menu"
import { ProductionMenu } from "./production-menu"
import { SalesMenu } from "./sales-menu"
import { SettingsMenu } from "./settings-menu"
import { WarehouseMenu } from "./warehouse-menu"

type MenuProps = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  matches: (pathname: string) => boolean
  menu: ComponentType<MenuProps>
}

const navItems: NavItem[] = [
  {
    label: "Аналитика",
    href: "/analytics",
    icon: BarChart3,
    matches: (pathname) => pathname === "/analytics" || pathname.startsWith("/analytics/"),
    menu: AnalyticsMenu,
  },
  {
    label: "Клиенты",
    href: "/clients",
    icon: Users,
    matches: (pathname) => pathname === "/clients" || pathname.startsWith("/clients/"),
    menu: ClientsMenu,
  },
  {
    label: "Продажи",
    href: "/analytics/sales",
    icon: Video,
    matches: (pathname) => pathname.startsWith("/analytics/sales"),
    menu: SalesMenu,
  },
  {
    label: "Персонал",
    href: "/tracking",
    icon: UserRound,
    matches: (pathname) => pathname.startsWith("/tracking"),
    menu: PersonnelMenu,
  },
  {
    label: "Склад",
    href: "/analytics/warehouse-logistics",
    icon: Warehouse,
    matches: (pathname) => pathname.startsWith("/analytics/warehouse"),
    menu: WarehouseMenu,
  },
  {
    label: "Финансы",
    href: "/analytics/finance-cash",
    icon: BriefcaseBusiness,
    matches: (pathname) => pathname.startsWith("/analytics/finance"),
    menu: FinanceMenu,
  },
  {
    label: "Производство",
    href: "/analytics/production",
    icon: Factory,
    matches: (pathname) => pathname.startsWith("/analytics/production"),
    menu: ProductionMenu,
  },
]

export function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [branch, setBranch] = useState("Все филиалы")
  const [brandMenuOpen, setBrandMenuOpen] = useState(false)
  const [workspace, setWorkspace] = useState<string>("distribution" satisfies WorkspaceId)
  const [customServers, setCustomServers] = useState<CustomServer[]>([])
  const [createServerOpen, setCreateServerOpen] = useState(false)
  const [newServerName, setNewServerName] = useState("")
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsBadge, setNotificationsBadge] = useState(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [displayName, setDisplayName] = useState("admin")
  const accountRef = useRef<HTMLDivElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeItem = [...navItems].reverse().find((item) => item.matches(pathname))
  const desktopMenu = navItems.find((item) => item.label === openMenu)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (accountOpen && accountRef.current && !accountRef.current.contains(target)) {
        setAccountOpen(false)
      }
      if (brandMenuOpen && brandRef.current && !brandRef.current.contains(target)) {
        setBrandMenuOpen(false)
      }
      if (notificationsOpen && notificationsRef.current && !notificationsRef.current.contains(target)) {
        setNotificationsOpen(false)
      }
      if (settingsOpen && settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false)
      }
      if (openMenu && navRef.current && !navRef.current.contains(target)) {
        setOpenMenu(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null)
        setAccountOpen(false)
        setBrandMenuOpen(false)
        setNotificationsOpen(false)
        setSettingsOpen(false)
        setMobileOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [accountOpen, brandMenuOpen, notificationsOpen, settingsOpen, openMenu])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { displayName?: string } | null) => {
        if (!cancelled && data?.displayName) setDisplayName(data.displayName)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pathname])

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function scheduleClose() {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpenMenu(null), 450)
  }

  function navigate(href: string) {
    setOpenMenu(null)
    setMobileOpen(false)
    router.push(href)
  }

  if (pathname === "/login") return null

  return (
    <header className="relative z-40 bg-[#2d2a84] text-white shadow-[0_6px_14px_rgba(30,41,90,0.24)]">
      <div className="flex h-16 items-center gap-3 px-4 xl:px-6">
        <div ref={brandRef} className="relative mr-auto shrink-0 xl:mr-3">
          <button
            type="button"
            onClick={() => setBrandMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={brandMenuOpen}
            className="flex shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            aria-label="Linko menyusi"
          >
            <span className="flex flex-col text-left leading-none">
              <span className="text-2xl font-bold tracking-tight">
                l<span className="text-brand-sky">i</span>nko
                <span className="ml-1 text-sm font-normal opacity-80">▾</span>
              </span>
              <span className="text-[11px] font-light tracking-wide opacity-80">
                {workspace === "distribution" ? "Дистрибуция" : workspace === "store" ? "Магазин" : workspace === "edo" ? "ЭДО & ЭДИ" : customServers.find((server) => server.id === workspace)?.name ?? "Дистрибуция"}
              </span>
            </span>
          </button>

          {brandMenuOpen && (
            <BrandMenu
              selected={workspace}
              customServers={customServers}
              onSelect={(id) => {
                setWorkspace(id)
                setBrandMenuOpen(false)
              }}
              onSelectServer={(id) => {
                setWorkspace(id)
                setBrandMenuOpen(false)
              }}
              onCreateServer={() => {
                setBrandMenuOpen(false)
                setCreateServerOpen(true)
              }}
            />
          )}
        </div>

        <nav ref={navRef} className="hidden h-full min-w-0 flex-1 items-stretch justify-center xl:flex">
          {navItems.map(({ label, icon: Icon }, index) => {
            const isActive = activeItem?.label === label
            const isOpen = openMenu === label

            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  cancelClose()
                  setOpenMenu(label)
                }}
                onMouseEnter={() => {
                  cancelClose()
                  setOpenMenu(label)
                }}
                onMouseLeave={scheduleClose}
                onFocus={() => setOpenMenu(label)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                className={`flex h-full shrink-0 items-center gap-2 border-l border-white/10 px-3 text-sm font-semibold transition-colors 2xl:px-5 2xl:text-[15px] ${
                  index === navItems.length - 1 ? "border-r" : ""
                } ${
                  isActive || isOpen
                    ? "bg-[#5c6df3] hover:bg-[#5c6df3]"
                    : "hover:bg-[#3a3897]"
                } focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white`}
              >
                <Icon className="h-5 w-5 2xl:h-6 2xl:w-6" strokeWidth={2.2} />
                <span>{label}</span>
              </button>
            )
          })}

          {desktopMenu && (
            <desktopMenu.menu
              onSelect={() => setOpenMenu(null)}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            />
          )}
        </nav>

        <div ref={accountRef} className="relative hidden shrink-0 items-center gap-2 xl:flex">
          <div ref={notificationsRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setNotificationsOpen((current) => !current)
                setNotificationsBadge(0)
              }}
              aria-haspopup="menu"
              aria-expanded={notificationsOpen}
              className="relative rounded-full p-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Уведомления"
            >
              <Bell className="h-5 w-5" />
              {notificationsBadge > 0 && (
                <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold">
                  {notificationsBadge}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <NotificationsMenu onClose={() => setNotificationsOpen(false)} />
            )}
          </div>
          <div ref={settingsRef} className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              className="rounded-full p-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Настройки"
            >
              <Settings className="h-5 w-5" />
            </button>
            {settingsOpen && <SettingsMenu onClose={() => setSettingsOpen(false)} />}
          </div>
          <button
            type="button"
            onClick={() => setAccountOpen((current) => !current)}
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-md py-1 pl-2 pr-3 text-left transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
          >
            <User className="h-7 w-7 rounded-full border border-white/40 p-0.5" />
            <span className="hidden flex-col leading-tight 2xl:flex">
              <span className="text-sm font-bold">{displayName}</span>
              <span className="max-w-28 truncate text-xs opacity-80">{branch}</span>
            </span>
            {accountOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {accountOpen && (
            <AccountDropdown
              selected={branch}
              onSelect={(selectedBranch) => {
                setBranch(selectedBranch)
                setAccountOpen(false)
              }}
              onSignOut={() => {
                setBranch("Все филиалы")
                setAccountOpen(false)
                fetch("/api/auth/logout", { method: "POST" }).finally(() => {
                  router.push("/login")
                  router.refresh()
                })
              }}
              onAddAccount={() => navigate("/settings")}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((current) => !current)}
          className="rounded-md p-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white xl:hidden"
          aria-label={mobileOpen ? "Menyuni yopish" : "Menyuni ochish"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-navigation"
          className="absolute left-0 right-0 top-full max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-white/10 bg-[#2d2a84] p-3 shadow-2xl xl:hidden"
        >
          <div className="grid gap-1 sm:grid-cols-2">
            {navItems.map(({ label, href, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => navigate(href)}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-left font-semibold transition-colors ${
                  activeItem?.label === label ? "bg-[#5c6df3]" : "hover:bg-white/10"
                } focus-visible:outline-2 focus-visible:outline-white`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => navigate("/notifications")}
              className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-3 font-semibold hover:bg-white/15"
            >
              <Bell className="h-5 w-5" />
              Уведомления
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-3 font-semibold hover:bg-white/15"
            >
              <Settings className="h-5 w-5" />
              Настройки
            </button>
          </div>
        </nav>
      )}

      {createServerOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCreateServerOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 text-foreground shadow-2xl"
          >
            <h2 className="mb-4 text-lg font-bold text-slate-800">Создать сервер</h2>
            <label className="mb-6 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              Название сервера
              <input
                autoFocus
                value={newServerName}
                onChange={(event) => setNewServerName(event.target.value)}
                placeholder="Например, Мой филиал"
                className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateServerOpen(false)}
                className="rounded-md border border-slate-200 px-5 py-2.5 font-semibold text-slate-600"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  const name = newServerName.trim()
                  if (!name) return
                  const id = `server-${Date.now()}`
                  setCustomServers((current) => [...current, { id, name }])
                  setWorkspace(id)
                  setNewServerName("")
                  setCreateServerOpen(false)
                }}
                className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
