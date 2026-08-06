"use client"

import Link from "next/link"

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
      ["Опросник", "/analytics/questionnaire"],
      ["План опроса", "/analytics/survey-plan"],
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

export function SalesMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="absolute left-0 top-full z-50 w-[730px]">
      <div className="grid min-h-[360px] grid-cols-3 overflow-hidden rounded-br-2xl border border-slate-200 bg-white shadow-xl">
        {columns.map((column, index) => (
          <section key={column.title} className={`px-6 py-6 ${index ? "border-l border-slate-200" : ""}`}>
            <h3 className="mb-4 text-[18px] font-bold text-[#5a70e6]">{column.title}</h3>
            <ul>
              {column.items.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} onClick={() => onSelect(label)} className="block border-b border-slate-200 py-4 text-[16px] font-semibold text-slate-700 hover:text-[#5870e8]">
                    {label}
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
