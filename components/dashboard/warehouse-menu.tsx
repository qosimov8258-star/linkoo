"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { useLanguage } from "@/lib/i18n/language-context"

// `query` mirrors the reference menu links, which open most pages with its page size.
type MenuItem = { label: string; href: string; query?: string }

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
  const { t } = useLanguage()
  return (
    <div className={MENU_COLUMN}>
      <h3 className={MENU_HEADING}>{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className={MENU_ITEM}>
            <Link
              href={item.query ? `${item.href}?${item.query}` : item.href}
              onClick={() => onSelect(item.label)}
              className={MENU_LINK}
            >
              {t(item.label)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const suppliers: MenuItem[] = [
  { label: "Приход от поставщиков", href: "/analytics/supplier-incomings", query: "pageSize=25" },
  { label: "Возврат поставщиков", href: "/analytics/supplier-returns", query: "pageSize=25&status=in_progress-completed" },
  { label: "Категории поставщиков", href: "/analytics/supplier-categories" },
  { label: "Поставщики", href: "/analytics/suppliers", query: "pageSize=25" },
  { label: "Формирование цен", href: "/analytics/price-formation", query: "pageSize=25" },
]

const stock: MenuItem[] = [
  { label: "Остаток", href: "/analytics/stock-level", query: "pageSize=25" },
  { label: "Остаток на определенную дату", href: "/analytics/stock-by-date", query: "pageSize=25" },
  { label: "Инвентаризация", href: "/analytics/inventory", query: "pageSize=25" },
  { label: "Рекомендованный запас", href: "/analytics/reorder-level" },
]

const warehouseOps: MenuItem[] = [
  { label: "Передачи между складами", href: "/analytics/internal-transfers", query: "pageSize=25" },
  { label: "План приемок и передач", href: "/analytics/receipt-transfer-plan" },
  { label: "Работа с инвентарем", href: "/analytics/inventory-management", query: "pageSize=25" },
  { label: "Списание", href: "/analytics/write-offs", query: "pageSize=25" },
  { label: "Склады", href: "/analytics/warehouses" },
]

const products: MenuItem[] = [
  { label: "Продукты", href: "/analytics/products", query: "pageSize=25" },
  { label: "Сырье", href: "/analytics/raw-materials", query: "pageSize=25" },
  { label: "Прайс-листы", href: "/analytics/price-lists" },
  { label: "Переоценка", href: "/analytics/repricing", query: "pageSize=25" },
  { label: "Типы продуктов", href: "/analytics/product-types" },
  { label: "Ед.измерения", href: "/analytics/units-of-measure" },
  { label: "Бренд", href: "/analytics/brands" },
  { label: "Себестоимость", href: "/analytics/cost-of-goods" },
]

// Used by top-nav.tsx to decide when the "Склад" tab should be highlighted
// — most of these pages live under the shared /analytics/[slug] route,
// which "Аналитика" would otherwise claim first.
export const warehouseHrefs: string[] = [...suppliers, ...stock, ...warehouseOps, ...products].map((item) => item.href)

export function WarehouseMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-max"
    >
      <div className={MENU_BOX}>
        <LinkColumn title="Поставщики" items={suppliers} onSelect={onSelect} />
        <LinkColumn title="Остаток" items={stock} onSelect={onSelect} />
        <LinkColumn title="Работа со складами" items={warehouseOps} onSelect={onSelect} />
        <LinkColumn title="Товары" items={products} onSelect={onSelect} />
      </div>
    </div>
  )
}
