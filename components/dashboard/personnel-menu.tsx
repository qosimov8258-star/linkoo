"use client"

import Link from "next/link"

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
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-base font-bold text-brand-blue">{title}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className="border-b border-slate-100 last:border-b-0">
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block w-full py-3.5 text-left text-[15px] text-slate-700 transition-colors hover:text-brand-blue"
            >
              {item.label}
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
      className="absolute left-1/2 top-full z-50 w-[1000px] max-w-[calc(100vw-2rem)] -translate-x-1/2 px-4"
    >
      <div className="mt-1 grid grid-cols-1 gap-x-10 gap-y-6 rounded-lg border border-slate-200 bg-white p-8 text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2 sm:grid-cols-2 lg:grid-cols-4">
        <LinkColumn title="Персонал" items={personnel} onSelect={onSelect} />
        <LinkColumn title="KPI" items={kpi} onSelect={onSelect} />
        <LinkColumn title="Контроль" items={control} onSelect={onSelect} />
        <LinkColumn title="Заказ" items={order} onSelect={onSelect} />
      </div>
    </div>
  )
}
