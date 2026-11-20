"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// `query` mirrors the reference menu links, which open each page with its default period / page size.
type MenuItem = { label: string; href: string; query?: (today: string) => string }

/** The reference's ?month=&pageSize=&year= of the current month (its month is not zero-padded). */
const MONTH = (today: string) => `month=${Number(today.slice(5, 7))}&pageSize=25&year=${today.slice(0, 4)}`

/** Задачи: the reference's ?fromDateSecond=&pageSize=&toDateSecond= of the current month («Период задачи»). */
const TASK_MONTH = (today: string) => {
  const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
  return `fromDateSecond=${today.slice(0, 8)}01&pageSize=25&toDateSecond=${today.slice(0, 8)}${String(last).padStart(2, "0")}`
}

const personnel: MenuItem[] = [
  { label: "Филиалы", href: "/analytics/branches" },
  { label: "Сотрудники", href: "/analytics/employees" },
  { label: "Должности", href: "/analytics/positions" },
  { label: "Права доступа", href: "/analytics/access-rights" },
]

const kpi: MenuItem[] = [
  { label: "KPI задачи", href: "/analytics/kpi-tasks", query: () => "pageSize=25&status=active" },
  { label: "Зарплата и установка планов", href: "/analytics/salary-planning", query: MONTH },
  { label: "KPI план филиалов", href: "/analytics/branch-kpi-plans", query: MONTH },
]

const control: MenuItem[] = [
  { label: "Активность", href: "/analytics/activity" },
  { label: "Отслеживание", href: "/tracking?view=agents" },
  { label: "Посещения на работу", href: "/analytics/work-attendance" },
  { label: "Задачи", href: "/analytics/tasks", query: TASK_MONTH },
]

const order: MenuItem[] = [
  { label: "Ограничение времени", href: "/analytics/time-restrictions" },
  { label: "База знания", href: "/analytics/knowledge-base" },
  { label: "Ограничение продуктов", href: "/analytics/product-restrictions", query: () => "pageSize=25" },
]

// Used by top-nav.tsx to decide when the "Персонал" tab should be
// highlighted — most of these pages live under the shared /analytics/[slug]
// route, which "Аналитика" would otherwise claim first.
export const personnelHrefs: string[] = [...personnel, ...kpi, ...control, ...order].map((item) => item.href)

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
  items: MenuItem[]
  onSelect: (item: string) => void
}) {
  const { t } = useLanguage()
  const today = todayIso()
  return (
    <div className={MENU_COLUMN}>
      <h3 className={MENU_HEADING}>{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className={MENU_ITEM}>
            <Link
              href={item.query ? `${item.href}?${item.query(today)}` : item.href}
              onClick={() => onSelect(item.label)}
              className={MENU_LINK}
            >
              {t(item.label)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PersonnelMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-max"
    >
      <div className={MENU_BOX}>
        <LinkColumn title="Персонал" items={personnel} onSelect={onSelect} />
        <LinkColumn title="KPI" items={kpi} onSelect={onSelect} />
        <LinkColumn title="Контроль" items={control} onSelect={onSelect} />
        <LinkColumn title="Заказ" items={order} onSelect={onSelect} />
      </div>
    </div>
  )
}
