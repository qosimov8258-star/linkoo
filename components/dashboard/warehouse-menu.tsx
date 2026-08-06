"use client"

import Link from "next/link"

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
  return (
    <div className="min-w-0">
      <h3 className="mb-4 text-base font-bold text-brand-blue">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              onClick={() => onSelect(item.label)}
              className="block rounded-md px-2 py-3.5 text-left text-[15px] text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            >
              {item.label}
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

export function WarehouseMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute left-1/2 top-full z-50 w-[1000px] max-w-[calc(100vw-2rem)] -translate-x-1/2 px-4"
    >
      <div className="mt-1 grid grid-cols-1 gap-x-10 gap-y-6 rounded-lg border border-slate-200 bg-white p-8 text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2 sm:grid-cols-2 lg:grid-cols-4">
        <LinkColumn title="Поставщики" items={suppliers} onSelect={onSelect} />
        <LinkColumn title="Остаток" items={stock} onSelect={onSelect} />
        <LinkColumn title="Работа со складами" items={warehouseOps} onSelect={onSelect} />
        <LinkColumn title="Товары" items={products} onSelect={onSelect} />
      </div>
    </div>
  )
}
