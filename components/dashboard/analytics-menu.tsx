"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  analyticsMenuGroups,
  analyticsReports,
  analyticsResources,
  type AnalyticsMenuGroup,
} from "@/lib/analytics-catalog"
import { useLanguage } from "@/lib/i18n/language-context"

const resourceImages: Record<string, string> = {
  sales: "/nav/menu-0.svg",
  "warehouse-logistics": "/nav/menu-1.svg",
  "finance-cash": "/nav/menu-2.svg",
  general: "/nav/menu-3.svg",
}


type MenuEntry = {
  label: string
  href: string
}

type ResourceMenuGroup = {
  title: string
  items: MenuEntry[]
}

const reportBySlug = new Map(analyticsReports.map((report) => [report.slug, report]))

function menuEntry(slug: string, label: string, fallbackHref: string): MenuEntry {
  if (slug === "new-report-builder") return { label, href: "/analytics/general" }
  if (slug === "old-report-builder") return { label, href: "/analytics/old-report-builder" }
  if (slug === "trend-builder") return { label, href: "/analytics/trend-builder" }
  if (slug === "product-profit") return { label, href: "/analytics/product-profit" }
  if (slug === "coverage-analysis") return { label, href: `/analytics/coverage-analysis?beginDate=${todayIso()}&endDate=${todayIso()}&fetchFirstTime=true` }
  if (slug === "material-report") return { label, href: "/analytics/stock-by-date?toggle=price&pageSize=25" }
  if (slug === "goods-movement") return { label, href: "/analytics/receipt-transfer-plan?tab=movement" }
  if (slug === "agent-profit") return { label, href: "/analytics/agent-profit" }
  if (slug === "product-type-profit") return { label, href: "/analytics/product-type-profit" }
  if (slug === "report-list") return { label, href: "/analytics/report-list" }
  if (slug === "dashboard-settings") return { label, href: "/analytics/dashboard-settings" }
  const report = reportBySlug.get(slug)
  return {
    label,
    href: report?.href ?? fallbackHref,
  }
}

const todayIso = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

const warehouseHref = "/analytics/warehouse-logistics"
const financeHref = "/analytics/finance-cash"
const generalHref = "/analytics/general"

const resourceMenuGroups: Record<string, ResourceMenuGroup[]> = {
  sales: [
    {
      title: "Контроль визитов",
      items: [
        menuEntry("visits-by-day", "Визиты по дням", "/analytics/visits-by-day"),
        menuEntry("agent-visits", "Визиты агента", "/analytics/agent-visits"),
        menuEntry("system-distribution", "Системная дистрибуция", "/analytics/system-distribution"),
        menuEntry("supervisor-agent-visits", "Визиты агентов по супервайзерам", "/analytics/supervisor-agent-visits"),
        menuEntry("photo-report-review", "Проверка фотоотчетов", "/analytics/photo-report-review"),
        menuEntry("agent-working-time", "Время работы агента", "/analytics/agent-working-time"),
        menuEntry("visit-builder", "Конструктор по визитам", "/analytics/visit-builder"),
        menuEntry("store-time", "Время нахождения в магазинах", "/analytics/store-time"),
        menuEntry("store-check-completion", "Выполнение Store Check", "/analytics/store-check-completion"),
      ],
    },
    {
      title: "Контроль продаж",
      items: [
        menuEntry("kpi-performance", "Выполнения KPI", "/analytics/kpi-performance"),
        menuEntry("abc-analysis", "ABC анализ", "/analytics/abc-analysis"),
        menuEntry("sales-by-agents", "Продажа по агентам", "/analytics/sales-by-agents"),
        menuEntry("sales-by-products", "Продажа по товарам", "/analytics/sales-by-products"),
        menuEntry("client-sales-payments", "Продажа и оплата по клиентам", "/analytics/client-sales-payments"),
        menuEntry("client-dynamics", "Классификация и динамика клиентов", "/analytics/client-dynamics"),
        menuEntry("sales-builder", "Конструктор по продажам", "/analytics/sales-builder"),
        menuEntry("price-analysis", "Анализ цен", "/analytics/price-analysis"),
        menuEntry("product-store-check", "Store check по продуктам", "/analytics/product-store-check"),
      ],
    },
    {
      title: "Дополнительные инструменты",
      items: [
        menuEntry("coverage-analysis", "Анализ охвата", `/analytics/coverage-analysis?beginDate=${todayIso()}&endDate=${todayIso()}&fetchFirstTime=true`),
        { label: "Клиенты на карте", href: "/tracking?view=clients" },
        { label: "Отслеживание", href: "/tracking?view=agents" },
        menuEntry("attendance", "Посещаемость", "/analytics/attendance"),
        menuEntry("duplicate-analysis", "Анализ дублей", "/analytics/duplicate-analysis"),
        menuEntry("equipment-efficiency", "Эффективность оборудования", "/analytics/equipment-efficiency"),
      ],
    },
  ],
  "warehouse-logistics": [
    {
      title: "Контроль склада",
      items: [
        menuEntry("stock-level", "Остаток", warehouseHref),
        menuEntry("material-report", "Материальный отчёт", warehouseHref),
        menuEntry("goods-movement", "Движение товаров", warehouseHref),
        menuEntry("inventory", "Инвентаризация", warehouseHref),
        menuEntry(
          "current-stock-report-builder",
          "Конструктор отчетов по текущим остаткам",
          warehouseHref,
        ),
      ],
    },
    {
      title: "Контроль логистики",
      items: [
        menuEntry("tracking", "Отслеживание", warehouseHref),
        menuEntry("customer-payments", "Оплаты от клиентов", warehouseHref),
        menuEntry("vansell-balance", "Баланс вансел", warehouseHref),
      ],
    },
    {
      title: "Дополнительные инструменты",
      items: [
        menuEntry("reorder-level", "Рекомендованный запас", warehouseHref),
        menuEntry("repricing", "Переоценка цен", warehouseHref),
        menuEntry("internal-transfers", "Передачи между складами", warehouseHref),
        menuEntry("inventory-management", "Работа с инвентарем", warehouseHref),
      ],
    },
  ],
  "finance-cash": [
    {
      title: "Баланс",
      items: [
        menuEntry("cash-balance", "Баланс кассы", financeHref),
        menuEntry("client-balance", "Баланс клиентов", financeHref),
        menuEntry("supplier-balance", "Баланс поставщиков", financeHref),
        menuEntry("vansell-balance", "Баланс вансел", financeHref),
        menuEntry("branch-balance", "Баланс филиалов", financeHref),
        menuEntry("employee-balance", "Баланс сотрудников", financeHref),
      ],
    },
    {
      title: "Контроль финансов",
      items: [
        menuEntry("profit-and-loss", "P&L", financeHref),
        menuEntry("order-debts", "Долги с заказов", financeHref),
        menuEntry("category-expenses", "Расходы по категориям", financeHref),
        menuEntry("payroll-expenses", "Расходы на персонал", financeHref),
        menuEntry("customer-payments", "Оплаты от клиентов", financeHref),
        menuEntry("expected-expenses", "Ожидаемые расходы", financeHref),
      ],
    },
    {
      title: "Дополнительные инструменты",
      items: [
        menuEntry("account-reconciliation", "Сверка через бот", financeHref),
        menuEntry("loyalty-card", "Накопительная карта", financeHref),
        menuEntry("debt-limits", "Установка ограничение на долги", financeHref),
      ],
    },
  ],
  general: [
    {
      title: "Отчёты",
      items: [
        { label: "Виджеты", href: "/?widgets=1" },
        menuEntry("flexible-dashboard", "Гибкий дашборд", generalHref),
        menuEntry("new-report-builder", "Новый конструктор отчетов", generalHref),
        menuEntry("old-report-builder", "Старый конструктор отчетов", generalHref),
        menuEntry("trend-builder", "Конструктор тенденция", generalHref),
      ],
    },
    {
      title: "Прибыль",
      items: [
        menuEntry("product-profit", "Прибыль от товаров", generalHref),
        menuEntry("agent-profit", "Прибыль от агентов", generalHref),
        menuEntry("product-type-profit", "Прибыль по типам продуктов", generalHref),
      ],
    },
    {
      title: "Дополнительные инструменты",
      items: [
        menuEntry("report-list", "Список отчетов", generalHref),
        menuEntry("dashboard-settings", "Настройка дашбордов", generalHref),
      ],
    },
  ],
}

function normalizeGroups(groups: AnalyticsMenuGroup[]): ResourceMenuGroup[] {
  return groups.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({ label: item.label, href: item.href })),
  }))
}

type Props = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

function LinkColumn({
  title,
  items,
  onSelect,
}: {
  title: string
  items: MenuEntry[]
  onSelect: (item: string) => void
}) {
  const { t } = useLanguage()
  const pathname = usePathname()
  return (
    <div className="min-w-0 shrink-0">
      <h3 className="mb-3 ml-3 text-[13px] font-bold text-[#5869f0]">{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`} className={`rounded-[12px] border-b border-[#f1f1f1] py-[10px] pl-[5px] pr-[5px] transition-colors hover:bg-white ${item.href === pathname ? "bg-white" : ""}`}>
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block w-full rounded-[5px] p-[5px] text-left font-[Arial,Helvetica,sans-serif] text-[13px] font-semibold leading-5 text-[#333]"
            >
              {t(item.label)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AnalyticsMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()
  const [activeResource, setActiveResource] = useState("sales")
  const activeGroups =
    resourceMenuGroups[activeResource] ?? normalizeGroups(analyticsMenuGroups)

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-[1160px] max-w-[calc(100vw-1rem)]"
    >
      <div className="mt-[7px] grid grid-cols-[320px_minmax(0,1fr)] overflow-hidden rounded-[10px] bg-[#f9fafb] font-sans text-[#333] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.24)]">
        <div className="bg-white px-5 pb-5 pt-5">
          <h3 className="mb-3 ml-3 text-[13px] font-bold text-[#5869f0]">Resources</h3>
          <ul className="flex flex-col">
            {analyticsResources
              .filter((resource) => resource.slug !== "production")
              .map((resource) => {
                const isActive = activeResource === resource.slug

                return (
                  <li key={resource.slug}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveResource(resource.slug)}
                      onFocus={() => setActiveResource(resource.slug)}
                      onClick={() => setActiveResource(resource.slug)}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex w-full items-start gap-3 rounded-[10px] border-b border-[#f1f1f1] p-4 text-left transition-colors ${
                        "hover:bg-[#f9fafb]"
                      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue`}
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-slate-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={resourceImages[resource.slug] ?? ""} alt="" className="h-6 w-6" />
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[13px] font-bold text-black">{t(resource.title)}</span>
                        <span className="text-[14px] leading-[21px] text-[#666]">
                          {t("Необходимо описание меню")}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </div>

        <div
          key={activeResource}
          className="flex items-start gap-[4px] px-5 py-8 animate-in fade-in-0 duration-150"
        >
          {activeGroups.map((group) => (
            <LinkColumn
              key={group.title}
              title={group.title}
              items={group.items}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
