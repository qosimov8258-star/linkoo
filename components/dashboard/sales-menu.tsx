"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

type Props = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

// `query` mirrors the reference menu links, which open each page with its default period / page size.
type MenuItem = { label: string; href: string; query?: (today: string) => string }

const PAGE = () => "pageSize=25"

const columns: Array<{ title: string; items: MenuItem[] }> = [
  {
    title: "Заказ",
    items: [
      { label: "Заказы", href: "/analytics/sales", query: () => "pageSize=25&showCheckboxes=true&status=0-1-5" },
      { label: "Возвраты", href: "/analytics/returns", query: PAGE },
      { label: "Отказы", href: "/analytics/refusals", query: PAGE },
      { label: "Фотоотчеты", href: "/analytics/photo-reports", query: (today) => `fromDate=${monthStartIso(today)}&pageSize=25&toDate=${monthEndIso(today)}` },
      { label: "Perfect store", href: "/analytics/perfect-store", query: (today) => `fromDate=${today}&pageSize=25&toDate=${today}` },
    ],
  },
  {
    title: "Маркетинг",
    items: [
      { label: "Маркетинговые акции", href: "/analytics/marketing-campaigns", query: PAGE },
      { label: "Бонусы клиентов", href: "/analytics/client-bonuses", query: PAGE },
      { label: "Рассылка", href: "/analytics/mailing", query: PAGE },
      { label: "Опросник", href: "/analytics/surveys", query: PAGE },
      { label: "План опроса", href: "/analytics/survey-plans", query: PAGE },
    ],
  },
  {
    title: "Дополнительно",
    items: [
      { label: "Эффективность оборудования", href: "/analytics/equipment-efficiency", query: () => "pageSize=25&toggle=client&withProfit=True" },
      { label: "Страницы телеграм бота", href: "/analytics/telegram-pages", query: PAGE },
      { label: "Тип отказа", href: "/analytics/refusal-types" },
      { label: "Интеграция", href: "/analytics/draft-orders", query: PAGE },
      { label: "Смена", href: "/analytics/cash-shifts", query: PAGE },
    ],
  },
]

// Used by top-nav.tsx to decide when the "Продажи" tab should be
// highlighted — most of these pages live under the shared /analytics/[slug]
// route, which "Аналитика" would otherwise claim first.
export const salesHrefs: string[] = columns.flatMap((column) => column.items.map((item) => item.href))

export function SalesMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()
  const today = todayIso()

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="w-max">
      <div className={MENU_BOX}>
        {columns.map((column, index) => (
          <section key={column.title} className={MENU_COLUMN} data-i={index}>
            <h3 className={MENU_HEADING}>{t(column.title)}</h3>
            <ul>
              {column.items.map((item) => (
                <li key={item.label} className={MENU_ITEM}>
                  <Link href={item.query ? `${item.href}?${item.query(today)}` : item.href} onClick={() => onSelect(item.label)} className={MENU_LINK}>
                    {t(item.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
