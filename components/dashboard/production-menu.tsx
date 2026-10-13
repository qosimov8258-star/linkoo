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
  { label: "Производство", href: "/analytics/production" },
  { label: "Партии", href: "/analytics/production-batches" },
  { label: "Этапы производства", href: "/analytics/production-stages" },
]

export function ProductionMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="w-max">
      <div className={MENU_BOX}>
        <ul className={MENU_COLUMN}>
          <li className={`${MENU_HEADING} !ml-[10px]`}>{t("Производство")}</li>
          {items.filter((item) => item.label !== "Производство").map((item, index, list) => (
            <li key={item.label} className={index === list.length - 1 ? "py-[5px] pl-[5px]" : MENU_ITEM}>
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
    </div>
  )
}
