"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Factory,
  Menu,
  Settings,
  UserRound,
  Users,
  Video,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react"

import { analyticsReports } from "@/lib/analytics-catalog"
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

const NAV_ICONS: Record<string, string> = {
  "Аналитика": "/nav/analytics.svg",
  "Клиенты": "/nav/clients.svg",
  "Продажи": "/nav/sales.svg",
  "Персонал": "/nav/personnel.svg",
  "Склад": "/nav/warehouse.svg",
  "Финансы": "/nav/finance.svg",
  "Производство": "/nav/production.svg",
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

const analyticsTabPaths = ["/analytics/pnl", "/analytics/flexible-dashboard", "/analytics/order-debts", "/analytics/client-debts", "/analytics/quick-report"]

/** Section shown in the reference's title tooltip per page (it does not always follow the top-nav grouping). */
const PAGE_SECTION: Record<string, string | null> = {
  "/analytics/management-balance": null,
  "/analytics/kpi-performance": null,
  "/analytics/balance-tab": null,
  "/analytics/kpi-tab": null,
  "/": "Аналитика",
  "/analytics/abc-analysis": "Аналитика",
  "/analytics/account-debts": "Финансы",
  "/analytics/account-reconciliation": "Финансы",
  "/analytics/activity": "Персонал",
  "/analytics/agent-visits": "Аналитика",
  "/analytics/agent-working-time": "Аналитика",
  "/analytics/attendance": "Аналитика",
  "/analytics/branch-balance": "Аналитика",
  "/analytics/branch-kpi-plans": "Персонал",
  "/analytics/cash-balance": "Аналитика",
  "/analytics/cash-flow": "Финансы",
  "/analytics/cash-management": "Финансы",
  "/analytics/cash-shifts": "Продажи",
  "/analytics/cashback-withdrawal-requests": "Финансы",
  "/analytics/category-expenses": "Финансы",
  "/analytics/client-balance": "Аналитика",
  "/analytics/client-bonuses": "Продажи",
  "/analytics/client-dynamics": "Клиенты",
  "/analytics/client-sales-payments": "Аналитика",
  "/analytics/contracts": "Финансы",
  "/analytics/cost-of-goods": "Склад",
  "/analytics/coverage-analysis": "Аналитика",
  "/analytics/current-stock-report-builder": "Аналитика",
  "/analytics/customer-payments": "Финансы",
  "/analytics/draft-orders": "Продажи",
  "/analytics/employee-balance": "Аналитика",
  "/analytics/equipment-efficiency": "Аналитика",
  "/analytics/expected-expenses": "Финансы",
  "/analytics/expected-payments": "Финансы",
  "/analytics/flexible-dashboard": "Аналитика",
  "/analytics/internal-transfers": "Склад",
  "/analytics/inventory": "Склад",
  "/analytics/inventory-management": "Склад",
  "/analytics/invoice-incomings": "Клиенты",
  "/analytics/kpi-tasks": "Персонал",
  "/analytics/loyalty-card": "Финансы",
  "/analytics/mailing": "Продажи",
  "/analytics/marketing-campaigns": "Продажи",
  "/analytics/order-debts": "Аналитика",
  "/analytics/payroll-expenses": "Финансы",
  "/analytics/perfect-store": "Продажи",
  "/analytics/photo-report-review": "Персонал",
  "/analytics/photo-reports": "Продажи",
  "/analytics/price-analysis": "Аналитика",
  "/analytics/price-formation": "Склад",
  "/analytics/product-restrictions": "Персонал",
  "/analytics/product-store-check": "Аналитика",
  "/analytics/production-batches": "Производство",
  "/analytics/production-stages": "Производство",
  "/analytics/products": "Склад",
  "/analytics/quick-report": "Аналитика",
  "/analytics/raw-materials": "Склад",
  "/analytics/receipt-transfer-plan": "Склад",
  "/analytics/refusals": "Продажи",
  "/analytics/reorder-level": "Аналитика",
  "/analytics/repricing": "Склад",
  "/analytics/returns": "Продажи",
  "/analytics/salary-planning": "Персонал",
  "/analytics/sales": "Продажи",
  "/analytics/sales-builder": "Аналитика",
  "/analytics/sales-by-agents": "Аналитика",
  "/analytics/sales-by-products": "Аналитика",
  "/analytics/stock-by-date": "Аналитика",
  "/analytics/stock-level": "Аналитика",
  "/analytics/store-check-completion": "Аналитика",
  "/analytics/store-reconciliation-bot": "Финансы",
  "/analytics/store-time": "Аналитика",
  "/analytics/supervisor-agent-visits": "Аналитика",
  "/analytics/supplier-balance": "Аналитика",
  "/analytics/supplier-debts": "Аналитика",
  "/analytics/supplier-incomings": "Склад",
  "/analytics/supplier-payments": "Финансы",
  "/analytics/supplier-returns": "Склад",
  "/analytics/survey-plans": "Продажи",
  "/analytics/surveys": "Продажи",
  "/analytics/system-distribution": "Аналитика",
  "/analytics/tasks": "Персонал",
  "/analytics/telegram-pages": "Продажи",
  "/analytics/vansell-balance": "Аналитика",
  "/analytics/visit-builder": "Аналитика",
  "/analytics/visits-by-day": "Аналитика",
  "/analytics/work-attendance": "Аналитика",
  "/analytics/write-offs": "Склад",
  "/clients": "Клиенты",
  "/clients/client-restrictions": "Клиенты",
  "/clients/financial-accounts": "Клиенты",
  "/clients/routes": "Аналитика",
  "/clients/telegram-users": "Клиенты",
  "/clients/territory": "Клиенты",
}

/**
 * Top-nav section a page belongs to — the reference shows it as a tooltip on the page title.
 * Settings pages (gear menu) belong to no section and get none.
 */
export function navSectionLabel(pathname: string): string | null {
  if (pathname in PAGE_SECTION) return PAGE_SECTION[pathname]
  const specific = [...navItems].reverse().find((item) => item.label !== "Аналитика" && item.matches(pathname))
  if (specific) return specific.label
  const isAnalytics =
    pathname === "/" ||
    pathname.endsWith("-tab") ||
    analyticsTabPaths.some((base) => pathname === base || pathname.startsWith(`${base}/`)) ||
    analyticsReports.some((report) => report.href.split("?")[0] === pathname)
  return isAnalytics ? "Аналитика" : null
}

/** Branch picked in the account menu: `linko-branch` (id, read by the API) + `linko-branch-name` (label of the menu button). */
function writeBranchCookies(id: number | undefined, name: string) {
  const maxAge = id ? 60 * 60 * 24 * 365 : 0
  document.cookie = `linko-branch=${id ?? ""}; path=/; max-age=${maxAge}; samesite=lax`
  document.cookie = `linko-branch-name=${id ? encodeURIComponent(name) : ""}; path=/; max-age=${maxAge}; samesite=lax`
}

function readBranchName(): string {
  const match = document.cookie.match(/(?:^|;\s*)linko-branch-name=([^;]*)/)
  try {
    return match ? decodeURIComponent(match[1]) : ""
  } catch {
    return ""
  }
}

export function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useLanguage()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [branch, setBranch] = useState("Все филиалы")
  useEffect(() => {
    const saved = readBranchName()
    if (saved) setBranch(saved)
  }, [])
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
      // Wide menus sit centred under the bar, narrow ones hang off their own button.
      let desired = (headerRect.width - wrapper.offsetWidth) / 2
      if (openMenu === "Клиенты") desired = buttonRect.left - headerRect.left - 19
      if (openMenu === "Производство") desired = buttonRect.right - headerRect.left - wrapper.offsetWidth
      const left = Math.min(Math.max(desired, margin), maxLeft)
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
    <header ref={headerRef} className="sticky top-0 z-40 bg-[#272780] text-white shadow-[0_5px_10px_2px_rgba(79,113,220,0.3)]">
      <div className="flex h-[50px] items-center px-4 xl:pl-6 xl:pr-[29px]">
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
              <span className="flex items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/nav/logo.svg" alt="linko" className="h-7 w-[55px]" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/nav/caret.svg" alt="" className="relative top-[5.8px] -mr-5 h-5 w-5" />
              </span>
              <span className="mt-[3px] text-[10px] font-normal leading-[12.5px]">
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

        <nav ref={navRef} className="ml-[91px] min-[1440px]:ml-[calc(50vw-697.87px)] max-[1439px]:ml-[max(20px,calc(50vw-582.37px))] hidden h-full min-w-0 shrink-0 items-stretch border-l border-white/[0.12] lg:flex">
          {navItems.map(({ label }) => {
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
                className={`flex h-full shrink-0 items-center gap-[5px] border-r border-white/[0.12] pl-[18px] pr-[25px] max-[1439px]:pl-[5px] max-[1439px]:pr-[5px] last:border-r-0 font-[Arial,Helvetica,sans-serif] text-[13px] font-normal transition-colors duration-200 ${
                  isOpen
                    ? "bg-[#5c6df3] hover:bg-[#5c6df3]"
                    : "hover:bg-[#3a3897]"
                } focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={NAV_ICONS[label]} alt="" className={`w-[25px] ${label === "Производство" ? "h-5" : "h-6"}`} />
                <span className="relative top-[-0.3px]">{t(label)}</span>
              </button>
            )
          })}

          {desktopMenu && (
            <div ref={menuWrapperRef} className="nav-menu-in absolute top-full z-50" style={{ left: menuLeft }}>
              <desktopMenu.menu
                onSelect={() => setOpenMenu(null)}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              />
            </div>
          )}
        </nav>

        <div className="flex-1" />

        <div ref={accountRef} className="hidden h-full shrink-0 items-center lg:flex">
          <div className="flex h-full items-center border-x border-white/[0.12]">
          <div ref={notificationsRef}>
            <button
              type="button"
              onClick={() => {
                setNotificationsOpen((current) => !current)
                setNotificationsBadge(0)
              }}
              aria-haspopup="menu"
              aria-expanded={notificationsOpen}
              className="relative flex h-10 w-[51px] items-center justify-start border-r border-white/[0.12] pl-[13px] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label={t("Уведомления")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nav/bell.svg" alt="" className="h-6 w-6" />
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
              className="flex h-10 w-[50px] items-center justify-center transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label={t("Настройки")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nav/gear.svg" alt="" className="h-6 w-6" />
            </button>
            {settingsOpen && <SettingsMenu onClose={() => setSettingsOpen(false)} />}
          </div>
          </div>
          <button
            type="button"
            onClick={() => setAccountOpen((current) => !current)}
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            className="ml-[5px] flex h-10 items-center text-left transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
          >
            <span className="flex h-10 w-[50px] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nav/user.svg" alt="" className="h-6 w-[25px]" />
            </span>
            <span className="hidden w-[146px] flex-col xl:flex">
              <span className="text-[14px] font-medium leading-[18px]">{displayName}</span>
              <span className="truncate text-[12px] font-normal leading-[18px]">{t(branch)}</span>
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nav/chevron.svg" alt="" className={`h-6 w-6 transition-transform ${accountOpen ? "rotate-180" : ""}`} />
          </button>

          {accountOpen && (
            <AccountDropdown
              selected={branch}
              onSelect={(selectedBranch, branchId) => {
                // Like the reference: every API call is scoped to the branch (cookie read by the server) and the dashboard reopens.
                setBranch(selectedBranch)
                setAccountOpen(false)
                writeBranchCookies(branchId, selectedBranch)
                router.push("/")
                router.refresh()
              }}
              onSignOut={() => {
                setBranch("Все филиалы")
                writeBranchCookies(undefined, "Все филиалы")
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
                className="rounded-md bg-[#4f71dc] px-5 py-2.5 font-semibold text-white"
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
