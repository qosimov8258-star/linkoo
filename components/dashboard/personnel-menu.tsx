"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { useLanguage } from "@/lib/i18n/language-context"

type MenuItem = { label: string; href: string }

const personnel: MenuItem[] = [
  { label: "Филиалы", href: "/analytics/branches" },
  { label: "Сотрудники", href: "/analytics/employees" },
  { label: "Должности", href: "/analytics/positions" },
  { label: "Права доступа", href: "/analytics/access-rights" },
]

const kpi: MenuItem[] = [
  { label: "KPI задачи", href: "/analytics/kpi-tasks" },
  { label: "Зарплата и установка планов", href: "/analytics/salary-planning" },
  { label: "KPI план филиалов", href: "/analytics/branch-kpi-plans" },
]

const control: MenuItem[] = [
  { label: "Активность", href: "/analytics/activity" },
  { label: "Отслеживание", href: "/tracking?view=agents" },
  { label: "Посещения на работу", href: "/analytics/work-attendance" },
  { label: "Задачи", href: "/analytics/tasks" },
]

const order: MenuItem[] = [
  { label: "Ограничение времени", href: "/analytics/time-restrictions" },
  { label: "База знания", href: "/analytics/knowledge-base" },
  { label: "Ограничение продуктов", href: "/analytics/product-restrictions" },
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
  return (
    <div className={MENU_COLUMN}>
      <h3 className={MENU_HEADING}>{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className={MENU_ITEM}>
            <Link
              href={item.href}
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
