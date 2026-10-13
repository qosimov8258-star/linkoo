"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// href is omitted for items that have no page in this app yet: they render as plain text, like the
// reference's full settings navigation, instead of producing dead links.
type MenuItem = { label: string; href?: string }
type MenuGroup = { title: string; items: MenuItem[] }

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
      { label: "Атрибуты", href: "/analytics/product-attributes" },
      { label: "Значение атрибута", href: "/analytics/product-attribute-values" },
      { label: "Продукты конкурентов", href: "/analytics/rival-products" },
    ],
  },
  {
    title: "Клиенты",
    items: [
      { label: "Типы клиентов", href: "/clients/client-types" },
      { label: "Атрибуты", href: "/clients/attributes" },
      { label: "Значение атрибута", href: "/clients/attribute-values" },
      { label: "Категория магазина", href: "/analytics/store-categories" },
    ],
  },
  {
    title: "Конструкторы",
    items: [
      { label: "Конструктор документов" },
      { label: "Дашборды", href: "/analytics/dashboard-settings" },
      { label: "Настройка EXCEL заказов" },
    ],
  },
  {
    title: "Поставщики",
    items: [{ label: "Категории поставщиков", href: "/analytics/supplier-categories" }],
  },
  {
    title: "Склад",
    items: [
      { label: "Склады", href: "/analytics/warehouses" },
      { label: "Настройка чека" },
      { label: "Тип ячейки" },
      { label: "Ячейки" },
    ],
  },
  {
    title: "Разное",
    items: [
      { label: "Прайс-листы", href: "/analytics/price-lists" },
      { label: "Тип отказа", href: "/analytics/refusal-types" },
      { label: "Филиалы", href: "/analytics/branches" },
      { label: "Оборудования" },
      { label: "Организация", href: "/analytics/organization" },
      { label: "Объединение", href: "/analytics/duplicate-analysis" },
      { label: "Ограничение времени", href: "/analytics/time-restrictions" },
      { label: "Закрытия дня/месяца" },
      { label: "Интеграция", href: "/settings/integrations" },
      { label: "Уведомления", href: "/settings/notifications" },
    ],
  },
]

export const catalogSidebarHrefs: string[] = groups.flatMap((group) => group.items.flatMap((item) => (item.href ? [item.href] : [])))

export function CatalogSidebar() {
  const pathname = usePathname()
  const { t } = useLanguage()

  return (
    <aside className="hidden w-[225px] shrink-0 bg-[#f2f5f8] pb-6 pt-[30px] text-[13px] text-[#333] lg:block">
      {groups.map((group) => (
        <section key={group.title} className="mb-[20px]">
          <h2 className="mb-[10px] pl-[30px] font-bold leading-4">{t(group.title)}</h2>
          <div className="pl-[56px] pr-[44px] text-[12px]">
            {group.items.map((item, index) => {
              const active = item.href !== undefined && pathname === item.href
              const cls = `mb-[12px] block leading-[15px] ${active ? "text-[#5273dd]" : "text-[#333]"}`
              return item.href ? (
                <Link key={`${item.label}-${index}`} href={item.href} className={`${cls} hover:text-[#5273dd]`}>
                  {t(item.label)}
                </Link>
              ) : (
                <span key={`${item.label}-${index}`} className={cls}>{t(item.label)}</span>
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
    <main className="min-h-[calc(100vh-50px)] bg-white">
      <div className="flex min-h-[calc(100vh-50px)]">
        <CatalogSidebar />
        {children}
      </div>
    </main>
  )
}
