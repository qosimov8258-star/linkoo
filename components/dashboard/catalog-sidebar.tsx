"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

type MenuItem = { label: string; href: string }
type MenuGroup = { title: string; items: MenuItem[] }

// Mirrors the left-hand reference-data navigation shown on pos.linko.uz for
// every settings/catalog page (e.g. /#/brand) — items link only to pages that
// already exist in this app, grouped the same way as the reference.
const groups: MenuGroup[] = [
  {
    title: "Персонал",
    items: [
      { label: "Подписки", href: "/analytics/subscriptions" },
      { label: "Сотрудники", href: "/analytics/employees" },
      { label: "Смены", href: "/analytics/shifts" },
      { label: "Должности", href: "/analytics/positions" },
      { label: "Права доступа", href: "/analytics/access-rights" },
      { label: "Транспорт", href: "/analytics/transport" },
      { label: "Сессия", href: "/analytics/sessions" },
    ],
  },
  {
    title: "Финансы",
    items: [
      { label: "Валюты", href: "/analytics/currencies" },
      { label: "Кассы", href: "/analytics/cashboxes" },
      { label: "Категории приходов", href: "/analytics/income-categories" },
      { label: "Категории расходов", href: "/analytics/expense-categories" },
    ],
  },
  {
    title: "Продукты",
    items: [
      { label: "Типы продуктов", href: "/analytics/product-types" },
      { label: "Измерения", href: "/analytics/units-of-measure" },
      { label: "Бренд", href: "/analytics/brands" },
    ],
  },
  {
    title: "Клиенты",
    items: [
      { label: "Типы клиентов", href: "/clients/client-types" },
      { label: "Атрибуты", href: "/clients/attributes" },
      { label: "Значение атрибута", href: "/clients/attribute-values" },
    ],
  },
  {
    title: "Разное",
    items: [
      { label: "Прайс-листы", href: "/analytics/price-lists" },
      { label: "Тип отказа", href: "/analytics/refusal-types" },
      { label: "Филиалы", href: "/analytics/branches" },
      { label: "Организация", href: "/analytics/organization" },
      { label: "Объединение", href: "/analytics/duplicate-analysis" },
      { label: "Ограничение времени", href: "/analytics/time-restrictions" },
      { label: "Интеграция", href: "/settings/integrations" },
      { label: "Уведомления", href: "/settings/notifications" },
    ],
  },
]

export const catalogSidebarHrefs: string[] = groups.flatMap((group) => group.items.map((item) => item.href))

export function CatalogSidebar() {
  const pathname = usePathname()
  const { t } = useLanguage()

  return (
    <aside className="hidden w-[245px] shrink-0 bg-slate-100 px-9 pt-9 lg:block">
      {groups.map((group) => (
        <section key={group.title} className="mb-9">
          <h2 className="mb-3 font-bold text-slate-800">{t(group.title)}</h2>
          <div className="space-y-3 pl-8 text-[16px]">
            {group.items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block ${active ? "font-semibold text-[#4f70e7]" : "text-slate-700 hover:text-[#4f70e7]"}`}
                >
                  {t(item.label)}
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </aside>
  )
}

export function CatalogPageLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-white">
      <div className="flex min-h-[calc(100vh-4rem)]">
        <CatalogSidebar />
        {children}
      </div>
    </main>
  )
}
