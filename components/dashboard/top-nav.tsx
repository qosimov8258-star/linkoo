"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react"
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

import { useLanguage } from "@/lib/i18n/language-context"

import { AccountDropdown } from "./account-dropdown"
import { AnalyticsMenu } from "./analytics-menu"
import { BrandMenu, type CustomServer, type WorkspaceId } from "./brand-menu"
import { ClientsMenu } from "./clients-menu"
import { FinanceMenu, financeHrefs } from "./finance-menu"
import { NotificationsMenu } from "./notifications-menu"
import { PersonnelMenu, personnelHrefs } from "./personnel-menu"
import { ProductionMenu } from "./production-menu"
import { SalesMenu, salesHrefs } from "./sales-menu"
import { SettingsMenu } from "./settings-menu"
import { WarehouseMenu, warehouseHrefs } from "./warehouse-menu"

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

// Most of a tab's menu pages live under the shared /analytics/[slug] route
// rather than a prefix unique to that tab, so highlighting has to check the
// tab's actual link list instead of a path prefix.
function matchesHrefs(pathname: string, hrefs: string[]): boolean {
  return hrefs.some((href) => {
    const base = href.split("?")[0]
    return pathname === base || pathname.startsWith(`${base}/`)
  })
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
    matches: (pathname) => matchesHrefs(pathname, salesHrefs),
    menu: SalesMenu,
  },
  {
    label: "Персонал",
    href: "/tracking",
    icon: UserRound,
    matches: (pathname) => pathname.startsWith("/tracking") || matchesHrefs(pathname, personnelHrefs),
    menu: PersonnelMenu,
  },
  {
    label: "Склад",
    href: "/analytics/warehouse-logistics",
    icon: Warehouse,
    matches: (pathname) => matchesHrefs(pathname, warehouseHrefs),
    menu: WarehouseMenu,
  },
  {
    label: "Финансы",
    href: "/analytics/finance-cash",
    icon: BriefcaseBusiness,
    matches: (pathname) => matchesHrefs(pathname, financeHrefs),
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
  const { t } = useLanguage()
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
  const [notificationsBadge, setNotificationsBadge] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [displayName, setDisplayName] = useState("admin")
  const accountRef = useRef<HTMLDivElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const navButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const menuWrapperRef = useRef<HTMLDivElement>(null)
  const [menuLeft, setMenuLeft] = useState(0)

  const activeItem = [...navItems].reverse().find((item) => item.matches(pathname))
  const desktopMenu = navItems.find((item) => item.label === openMenu)

  // Each mega-menu has its own natural width, so it can't be positioned with
  // a fixed Tailwind offset — it has to align with its own trigger button and
  // then get nudged left if that would push it past the right edge of the
  // header (which is what makes buttons on the right side of the bar, like
  // "Финансы" or "Производство", not overflow off-screen).
  useLayoutEffect(() => {
    if (!openMenu) return

    function recompute() {
      const header = headerRef.current
      const button = navButtonRefs.current[openMenu!]
      const wrapper = menuWrapperRef.current
      if (!header || !button || !wrapper) return

      const headerRect = header.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const margin = 8
      const maxLeft = Math.max(margin, headerRect.width - wrapper.offsetWidth - margin)
      const left = Math.min(Math.max(buttonRect.left - headerRect.left, margin), maxLeft)
      setMenuLeft(left)
    }

    recompute()
    window.addEventListener("resize", recompute)
    return () => window.removeEventListener("resize", recompute)
  }, [openMenu])

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

  if (pathname === "/login" || pathname.startsWith("/login/")) return null

  return (
    <header ref={headerRef} className="relative z-40 bg-[#272780] text-white shadow-[0_6px_14px_rgba(30,41,90,0.24)]">
      <div className="flex h-[50px] items-center gap-3 px-4 xl:px-6">
        <div ref={brandRef} className="relative mr-auto shrink-0 lg:mr-3">
          <button
            type="button"
            onClick={() => setBrandMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={brandMenuOpen}
            className="flex shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            aria-label="Linko menyusi"
          >
            <span className="flex flex-col text-left leading-none">
              <span className="text-xl font-bold tracking-tight lg:text-2xl">
                l<span className="text-brand-sky">i</span>nko
                <span className="ml-1 text-sm font-normal opacity-80">▾</span>
              </span>
              <span className="text-[11px] font-light tracking-wide opacity-80">
                {workspace === "distribution"
                  ? t("Дистрибуция")
                  : workspace === "store"
                    ? t("Магазин")
                    : workspace === "edo"
                      ? t("ЭДО & ЭДИ")
                      : (customServers.find((server) => server.id === workspace)?.name ?? t("Дистрибуция"))}
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

        <nav ref={navRef} className="hidden h-full min-w-0 shrink-0 items-stretch lg:flex">
          {navItems.map(({ label, icon: Icon }) => {
            const isActive = activeItem?.label === label
            const isOpen = openMenu === label

            return (
              <button
                key={label}
                ref={(el) => {
                  navButtonRefs.current[label] = el
                }}
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
                className={`flex h-full shrink-0 items-center gap-[5px] py-0 pl-[18px] pr-[25px] text-[13px] font-normal transition-colors ${
                  isActive || isOpen
                    ? "bg-[#5c6df3] hover:bg-[#5c6df3]"
                    : "hover:bg-[#3a3897]"
                } focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white`}
              >
                <Icon className="h-4 w-4" strokeWidth={2.2} />
                <span>{t(label)}</span>
              </button>
            )
          })}

          {desktopMenu && (
            <div ref={menuWrapperRef} className="absolute top-full z-50" style={{ left: menuLeft }}>
              <desktopMenu.menu
                onSelect={() => setOpenMenu(null)}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              />
            </div>
          )}
        </nav>

        <div className="flex-1" />

        <div ref={accountRef} className="hidden shrink-0 items-center gap-1 lg:flex xl:gap-2">
          <div ref={notificationsRef}>
            <button
              type="button"
              onClick={() => {
                setNotificationsOpen((current) => !current)
                setNotificationsBadge(0)
              }}
              aria-haspopup="menu"
              aria-expanded={notificationsOpen}
              className="relative rounded-full p-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label={t("Уведомления")}
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
          <div ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              className="rounded-full p-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label={t("Настройки")}
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
            <span className="hidden flex-col leading-tight xl:flex">
              <span className="text-sm font-bold">{displayName}</span>
              <span className="max-w-28 truncate text-xs opacity-80">{t(branch)}</span>
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
              onAddAccount={() => navigate("/login/add-account")}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((current) => !current)}
          className="rounded-md p-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white lg:hidden"
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
          className="absolute left-0 right-0 top-full max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-white/10 bg-[#2d2a84] p-3 shadow-2xl lg:hidden"
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
                {t(label)}
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
              {t("Уведомления")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-3 font-semibold hover:bg-white/15"
            >
              <Settings className="h-5 w-5" />
              {t("Настройки")}
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
            <h2 className="mb-4 text-lg font-bold text-slate-800">{t("Создать сервер")}</h2>
            <label className="mb-6 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Название сервера")}
              <input
                autoFocus
                value={newServerName}
                onChange={(event) => setNewServerName(event.target.value)}
                placeholder={t("Например, Мой филиал")}
                className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateServerOpen(false)}
                className="rounded-md border border-slate-200 px-5 py-2.5 font-semibold text-slate-600"
              >
                {t("Отмена")}
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
                {t("Создать")}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
