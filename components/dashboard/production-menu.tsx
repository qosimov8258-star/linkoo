"use client"

import Link from "next/link"

type MenuItem = { label: string; href: string }

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
      <h3 className="mb-4 text-base font-bold text-brand-blue">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block rounded-md px-2 py-3.5 text-left text-[15px] text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const parties: MenuItem[] = [
  { label: "Партии", href: "/analytics/production-batches" },
]

const stages: MenuItem[] = [
  { label: "Этапы производства", href: "/analytics/production-stages" },
]

export function ProductionMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute left-1/2 top-full z-50 w-[600px] max-w-[calc(100vw-2rem)] -translate-x-1/2 px-4"
    >
      <div className="mt-1 grid grid-cols-1 gap-x-10 gap-y-6 rounded-lg border border-slate-200 bg-white p-8 text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2 sm:grid-cols-2">
        <LinkColumn title="Производство" items={parties} onSelect={onSelect} />
        <LinkColumn title="Этапы" items={stages} onSelect={onSelect} />
      </div>
    </div>
  )
}
