"use client"

import Link from "next/link"

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
    <div className="min-w-0 px-5 py-5">
      <h3 className="mb-3 text-[13px] font-bold text-brand-blue">{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className="border-b border-slate-100 last:border-b-0">
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block w-full py-2.5 text-left text-[13px] font-semibold text-slate-700 transition-colors hover:text-brand-blue"
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
      className="w-[800px] max-w-[calc(100vw-2rem)]"
    >
      <div className="mt-1 grid grid-cols-1 divide-slate-200 overflow-hidden rounded-b-xl border border-slate-200 bg-white text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        <LinkColumn title="Персонал" items={personnel} onSelect={onSelect} />
        <LinkColumn title="KPI" items={kpi} onSelect={onSelect} />
        <LinkColumn title="Контроль" items={control} onSelect={onSelect} />
        <LinkColumn title="Заказ" items={order} onSelect={onSelect} />
      </div>
    </div>
  )
}
