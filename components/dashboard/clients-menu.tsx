"use client"

import Link from "next/link"

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
      className={`min-w-0 px-5 py-5 md:self-start md:pb-0 ${
        index === 0 ? "" : "border-t border-[#e5e7eb] md:border-l md:border-t-0"
      }`}
      aria-labelledby={`clients-menu-group-${index}`}
    >
      <h3
        id={`clients-menu-group-${index}`}
        className="mb-3 px-3 text-[13px] font-bold leading-4 text-[#536dfe]"
      >
        {t(title)}
      </h3>

      <ul className="flex flex-col">
        {items.map((item, itemIndex) => (
          <li
            key={item.slug}
            className={itemIndex === items.length - 1 ? "" : "border-b border-[#ececec]"}
          >
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block w-full px-3 py-2.5 text-left text-[13px] font-semibold leading-4 text-[#3b3b3b] transition-colors hover:bg-[#f7f8ff] hover:text-[#536dfe] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[#536dfe]"
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
      className="w-[660px] max-w-[calc(100vw-1rem)]"
    >
      <div
        className="mt-1 grid grid-cols-1 overflow-hidden rounded-b-xl border border-[#d0d3d8] bg-white text-[#3b3b3b] shadow-[0_2px_4px_rgba(15,23,42,0.20)] duration-150 animate-in fade-in-0 slide-in-from-top-1 md:grid-cols-[38%_31%_31%]"
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
