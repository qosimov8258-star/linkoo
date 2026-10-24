"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

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
      ["Заказы", "/analytics/sales?pageSize=25&showCheckboxes=true&status=0-1-5"],
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
      ["Интеграция", "/analytics/draft-orders"],
      ["Смена", "/analytics/cash-shifts"],
    ],
  },
] as const

// Used by top-nav.tsx to decide when the "Продажи" tab should be
// highlighted — most of these pages live under the shared /analytics/[slug]
// route, which "Аналитика" would otherwise claim first.
export const salesHrefs: string[] = columns.flatMap((column) => column.items.map(([, href]) => href.split("?")[0]))

export function SalesMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="w-max">
      <div className={MENU_BOX}>
        {columns.map((column, index) => (
          <section key={column.title} className={MENU_COLUMN} data-i={index}>
            <h3 className={MENU_HEADING}>{t(column.title)}</h3>
            <ul>
              {column.items.map(([label, href]) => (
                <li key={label} className={MENU_ITEM}>
                  <Link href={href} onClick={() => onSelect(label)} className={MENU_LINK}>
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
