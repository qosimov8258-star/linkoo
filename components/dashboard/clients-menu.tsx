"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { clientsMenuGroups, type ClientModule } from "@/lib/clients-catalog"
import { useLanguage } from "@/lib/i18n/language-context"

type Props = {
  onSelect: (item: string) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

function LinkColumn({
  title,
  items,
  index,
  onSelect,
}: {
  title: string
  items: ClientModule[]
  index: number
  onSelect: (item: string) => void
}) {
  const { t } = useLanguage()
  return (
    <section
      className={MENU_COLUMN}
      aria-labelledby={`clients-menu-group-${index}`}
    >
      <h3
        id={`clients-menu-group-${index}`}
        className={MENU_HEADING}
      >
        {t(title)}
      </h3>

      <ul className="flex flex-col">
        {items.map((item, itemIndex) => (
          <li
            key={item.slug}
            className={MENU_ITEM}
          >
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
    </section>
  )
}

export function ClientsMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  const { t } = useLanguage()
  return (
    <div
      id="clients-mega-menu"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-max"
    >
      <div
        className={MENU_BOX}
        role="menu"
        aria-label={t("Разделы клиентов")}
      >
        {clientsMenuGroups.map((group, index) => (
          <LinkColumn
            key={group.title}
            title={group.title}
            items={group.items}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
