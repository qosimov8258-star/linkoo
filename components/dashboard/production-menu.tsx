"use client"

import Link from "next/link"

import { useLanguage } from "@/lib/i18n/language-context"

type MenuItem = { label: string; href: string }

type Props = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const items: MenuItem[] = [
  { label: "Производство", href: "/analytics/production" },
  { label: "Партии", href: "/analytics/production-batches" },
  { label: "Этапы производства", href: "/analytics/production-stages" },
]

export function ProductionMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="w-[200px]">
      <div className="mt-1 rounded-b-xl border border-slate-200 bg-white px-5 py-3 text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2">
        <ul className="flex flex-col">
          {items.map((item, index) => (
            <li key={item.label} className={index === 0 ? "" : "border-t border-slate-100"}>
              <Link
                href={item.href}
                onClick={() => onSelect(item.label)}
                className="block w-full py-2.5 text-left text-[13px] font-semibold text-slate-700 transition-colors hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
              >
                {t(item.label)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
