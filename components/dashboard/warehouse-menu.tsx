"use client"

import Link from "next/link"

import { useLanguage } from "@/lib/i18n/language-context"

type MenuItem = { label: string; href: string }

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
    <div className="min-w-0 px-5 py-5">
      <h3 className="mb-3 text-[13px] font-bold text-brand-blue">{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className="border-b border-slate-100 last:border-b-0">
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
  )
}

const suppliers: MenuItem[] = [
  { label: "Приход от поставщиков", href: "/analytics/supplier-incomings" },
  { label: "Возврат поставщиков", href: "/analytics/supplier-returns" },
  { label: "Категории поставщиков", href: "/analytics/supplier-categories" },
  { label: "Поставщики", href: "/analytics/suppliers" },
  { label: "Формирование цен", href: "/analytics/price-formation" },
]

const stock: MenuItem[] = [
  { label: "Остаток", href: "/analytics/stock-level" },
  { label: "Остаток на определенную дату", href: "/analytics/stock-by-date" },
  { label: "Инвентаризация", href: "/analytics/inventory" },
  { label: "Рекомендованный запас", href: "/analytics/reorder-level" },
]

const warehouseOps: MenuItem[] = [
  { label: "Передачи между складами", href: "/analytics/internal-transfers" },
  { label: "План приемок и передач", href: "/analytics/receipt-transfer-plan" },
  { label: "Работа с инвентарем", href: "/analytics/inventory-management" },
  { label: "Списание", href: "/analytics/write-offs" },
  { label: "Склады", href: "/analytics/warehouses" },
]

const products: MenuItem[] = [
  { label: "Продукты", href: "/analytics/products" },
  { label: "Сырье", href: "/analytics/raw-materials" },
  { label: "Прайс-листы", href: "/analytics/price-lists" },
  { label: "Переоценка", href: "/analytics/repricing" },
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
      className="w-[860px] max-w-[calc(100vw-2rem)]"
    >
      <div className="mt-1 grid grid-cols-1 divide-slate-200 overflow-hidden rounded-b-xl border border-slate-200 bg-white text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        <LinkColumn title="Поставщики" items={suppliers} onSelect={onSelect} />
        <LinkColumn title="Остаток" items={stock} onSelect={onSelect} />
        <LinkColumn title="Работа со складами" items={warehouseOps} onSelect={onSelect} />
        <LinkColumn title="Товары" items={products} onSelect={onSelect} />
      </div>
    </div>
  )
}
