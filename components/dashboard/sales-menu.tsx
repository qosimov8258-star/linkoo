"use client"

import Link from "next/link"

import { useLanguage } from "@/lib/i18n/language-context"

type Props = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const columns = [
  {
    title: "Заказ",
    items: [
      ["Заказы", "/analytics/sales"],
      ["Возвраты", "/analytics/returns"],
      ["Отказы", "/analytics/refusals"],
      ["Фотоотчеты", "/analytics/photo-reports"],
      ["Perfect store", "/analytics/perfect-store"],
    ],
  },
  {
    title: "Маркетинг",
    items: [
      ["Маркетинговые акции", "/analytics/marketing-campaigns"],
      ["Бонусы клиентов", "/analytics/client-bonuses"],
      ["Рассылка", "/analytics/mailing"],
      ["Опросник", "/analytics/surveys"],
      ["План опроса", "/analytics/survey-plans"],
    ],
  },
  {
    title: "Дополнительно",
    items: [
      ["Эффективность оборудования", "/analytics/equipment-efficiency"],
      ["Страницы телеграм бота", "/analytics/telegram-pages"],
      ["Тип отказа", "/analytics/refusal-types"],
      ["Интеграция", "/settings/integrations"],
      ["Смена", "/analytics/shifts"],
    ],
  },
] as const

// Used by top-nav.tsx to decide when the "Продажи" tab should be
// highlighted — most of these pages live under the shared /analytics/[slug]
// route, which "Аналитика" would otherwise claim first.
export const salesHrefs: string[] = columns.flatMap((column) => column.items.map(([, href]) => href))

export function SalesMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="w-[700px] max-w-[calc(100vw-1rem)]">
      <div className="grid grid-cols-3 overflow-hidden rounded-b-xl border border-slate-200 bg-white shadow-xl">
        {columns.map((column, index) => (
          <section key={column.title} className={`px-4 py-4 ${index ? "border-l border-slate-200" : ""}`}>
            <h3 className="mb-3 text-[13px] font-bold text-[#5a70e6]">{t(column.title)}</h3>
            <ul>
              {column.items.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} onClick={() => onSelect(label)} className="block border-b border-slate-200 py-2.5 text-[13px] font-semibold text-slate-700 last:border-b-0 hover:text-[#5870e8]">
                    {t(label)}
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
