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

const finances: MenuItem[] = [
  { label: "Входящие счет фактуры", href: "/analytics/invoice-incomings" },
  { label: "Организация", href: "/analytics/organization" },
  { label: "Кассы", href: "/analytics/cashboxes" },
  { label: "Категории приходов", href: "/analytics/income-categories" },
  { label: "Категории расходов", href: "/analytics/expense-categories" },
]

const balance: MenuItem[] = [
  { label: "Баланс кассы", href: "/analytics/cash-balance" },
  { label: "Баланс клиентов", href: "/analytics/client-balance" },
  { label: "Долги по счетам", href: "/analytics/account-debts" },
  { label: "Баланс поставщиков", href: "/analytics/supplier-balance" },
  { label: "Баланс вансел", href: "/analytics/vansell-balance" },
  { label: "Баланс филиалов", href: "/analytics/branch-balance" },
  { label: "Баланс сотрудников", href: "/analytics/employee-balance" },
  { label: "Управленческий баланс по филиалам", href: "/analytics/management-balance" },
]

const cashOperations: MenuItem[] = [
  { label: "Управления кассой", href: "/analytics/cash-management" },
  { label: "Оплаты от клиентов", href: "/analytics/customer-payments" },
  { label: "Оплаты поставщикам", href: "/analytics/supplier-payments" },
  // Demo menu query {pageSize: 25, status: "pending"}; the reports catalog opens «Все» (no status).
  { label: "Ожидаемые расходы", href: "/analytics/expected-expenses?pageSize=25&status=pending" },
  { label: "Ожидаемые оплаты", href: "/analytics/expected-payments" },
  { label: "Расходы по категориям", href: "/analytics/category-expenses" },
  { label: "Расходы на персонал", href: "/analytics/payroll-expenses" },
]

const additional: MenuItem[] = [
  { label: "Долги поставщиков", href: "/analytics/supplier-debts" },
  { label: "Долги с заказов", href: "/analytics/order-debts" },
  { label: "Сверка магазина через бот", href: "/analytics/store-reconciliation-bot" },
  { label: "Сверка счетов", href: "/analytics/account-reconciliation" },
  { label: "Договоры", href: "/analytics/contracts" },
  { label: "Накопительная карта", href: "/analytics/loyalty-card" },
  { label: "Запросы на снятие кэшбэка", href: "/analytics/cashback-withdrawal-requests" },
  { label: "KPI план филиалов", href: "/analytics/branch-kpi-plans" },
]

// Used by top-nav.tsx to decide when the "Финансы" tab should be
// highlighted — most of these pages live under the shared /analytics/[slug]
// route, which "Аналитика" would otherwise claim first.
export const financeHrefs: string[] = [...finances, ...balance, ...cashOperations, ...additional].map((item) => item.href)

export function FinanceMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-[960px] max-w-[calc(100vw-2rem)]"
    >
      <div className="mt-1 grid grid-cols-1 divide-slate-200 overflow-hidden rounded-b-xl border border-slate-200 bg-white text-slate-700 shadow-2xl duration-150 animate-in fade-in-0 slide-in-from-top-2 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        <LinkColumn title="Финансы" items={finances} onSelect={onSelect} />
        <LinkColumn title="Баланс" items={balance} onSelect={onSelect} />
        <LinkColumn title="Работа с кассой" items={cashOperations} onSelect={onSelect} />
        <LinkColumn title="Дополнительно" items={additional} onSelect={onSelect} />
      </div>
    </div>
  )
}
