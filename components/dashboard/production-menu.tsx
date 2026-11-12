"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { useLanguage } from "@/lib/i18n/language-context"

type MenuItem = { label: string; href: string }

type Props = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const items: MenuItem[] = [
  { label: "Партии", href: "/analytics/production-batches" },
  { label: "Этапы производства", href: "/analytics/production-stages" },
]

export function ProductionMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()
  // As the other menus of the reference: one column under the blue heading «Производство».
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="w-max">
      <div className={MENU_BOX}>
        <div className={MENU_COLUMN}>
          <h3 className={MENU_HEADING}>{t("Производство")}</h3>
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.label} className={MENU_ITEM}>
                <Link href={item.href} onClick={() => onSelect(item.label)} className={MENU_LINK}>
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
