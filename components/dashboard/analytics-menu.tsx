"use client"

import { useState } from "react"
import Link from "next/link"
import { LayoutGrid, ShoppingCart, Truck, Wallet } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import {
  analyticsMenuGroups,
  analyticsReports,
  analyticsResources,
  type AnalyticsMenuGroup,
} from "@/lib/analytics-catalog"

const resourceIcons: Record<string, LucideIcon> = {
  sales: ShoppingCart,
  "warehouse-logistics": Truck,
  "finance-cash": Wallet,
  general: LayoutGrid,
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
        menuEntry("coverage-analysis", "Анализ охвата", "/analytics/coverage-analysis"),
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
        menuEntry("store-reconciliation-bot", "Сверка через бот", financeHref),
        menuEntry("loyalty-card", "Накопительная карта", financeHref),
        menuEntry("debt-limits", "Установка ограничение на долги", financeHref),
      ],
    },
  ],
  general: [
    {
      title: "Отчёты",
      items: [
        menuEntry("widgets", "Виджеты", generalHref),
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
  return (
    <div className="min-w-0">
      <h3 className="mb-4 text-base font-bold text-[#5868f5]">{title}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block rounded-xl border-b border-slate-200/70 px-3 py-3 text-left text-[15px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AnalyticsMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const [activeResource, setActiveResource] = useState("sales")
  const activeGroups =
    resourceMenuGroups[activeResource] ?? normalizeGroups(analyticsMenuGroups)

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute left-0 right-0 top-full z-50 mx-auto max-w-[1450px] px-2"
    >
      <div className="mt-1 grid min-h-[680px] grid-cols-[400px_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2">
        <div className="bg-white px-6 py-6">
          <h3 className="mb-5 px-4 text-base font-bold text-[#5868f5]">Resources</h3>
          <ul className="flex flex-col">
            {analyticsResources
              .filter((resource) => resource.slug !== "production")
              .map((resource) => {
                const Icon = resourceIcons[resource.slug] ?? LayoutGrid
                const isActive = activeResource === resource.slug

                return (
                  <li key={resource.slug}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveResource(resource.slug)}
                      onFocus={() => setActiveResource(resource.slug)}
                      onClick={() => setActiveResource(resource.slug)}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex w-full items-start gap-3 rounded-xl px-4 py-4 text-left transition-colors ${
                        isActive ? "bg-slate-100" : "hover:bg-slate-50"
                      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue`}
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-700">
                        <Icon className="h-7 w-7" strokeWidth={1.8} />
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[16px] font-bold text-slate-900">{resource.title}</span>
                        <span className="mt-1 text-[16px] text-slate-500">
                          Необходимо описание меню
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
          className="grid grid-cols-3 items-start gap-4 px-6 py-9 animate-in fade-in-0 duration-150"
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
