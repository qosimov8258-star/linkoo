"use client"

import Link from "next/link"

import { clientsMenuGroups, type ClientModule } from "@/lib/clients-catalog"

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
  return (
    <section
      className={`min-w-0 px-[25px] py-6 md:h-[337px] md:self-start md:pb-0 ${
        index === 0 ? "" : "border-t border-[#e5e7eb] md:border-l md:border-t-0"
      }`}
      aria-labelledby={`clients-menu-group-${index}`}
    >
      <h3
        id={`clients-menu-group-${index}`}
        className="h-6 px-3 text-[16px] font-bold leading-6 text-[#536dfe]"
      >
        {title}
      </h3>

      <ul className="mt-2 flex flex-col">
        {items.map((item, itemIndex) => (
          <li
            key={item.slug}
            className={`h-14 ${itemIndex === items.length - 1 ? "" : "border-b border-[#ececec]"}`}
          >
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="flex h-full w-full items-center whitespace-nowrap px-3 text-left text-[16px] font-semibold leading-6 text-[#3b3b3b] transition-colors hover:bg-[#f7f8ff] hover:text-[#536dfe] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[#536dfe]"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ClientsMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      id="clients-mega-menu"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute -left-[25px] top-full z-50 w-[816px] max-w-[calc(100vw-1rem)]"
    >
      <div
        className="mt-2 grid min-h-[363px] grid-cols-1 overflow-hidden rounded-[15px] border border-[#d0d3d8] bg-white text-[#3b3b3b] shadow-[0_2px_4px_rgba(15,23,42,0.20)] duration-150 animate-in fade-in-0 slide-in-from-top-1 md:grid-cols-[46%_26.5%_27.5%]"
        role="menu"
        aria-label="Разделы клиентов"
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
