"use client"

import Link from "next/link"

import { MENU_BOX, MENU_COLUMN, MENU_HEADING, MENU_ITEM, MENU_LINK } from "./menu-style"

import { monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// `query` mirrors the reference menu links, which open each page with its default period / page size.
type MenuItem = { label: string; href: string; query?: (today: string, monthStart: string) => string }

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
  const today = todayIso()
  const monthStart = monthStartIso(today)
  return (
    <div className={MENU_COLUMN}>
      <h3 className={MENU_HEADING}>{t(title)}</h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.label} className={MENU_ITEM}>
            <Link
              href={item.query ? `${item.href}?${item.query(today, monthStart)}` : item.href}
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

const finances: MenuItem[] = [
  // The reference opens the dashboard for this entry (the module is not available there); the page itself stays at
  // /analytics/invoice-incomings.
  { label: "Входящие счет фактуры", href: "/", query: (today) => `beginDate=${today}&endDate=${today}` },
  { label: "Организация", href: "/analytics/organization" },
  { label: "Кассы", href: "/analytics/cashboxes" },
  { label: "Категории приходов", href: "/analytics/income-categories" },
  { label: "Категории расходов", href: "/analytics/expense-categories" },
]

const balance: MenuItem[] = [
  { label: "Баланс кассы", href: "/analytics/cash-balance", query: (today) => `fromDate=${today}&toDate=${today}` },
  { label: "Баланс клиентов", href: "/analytics/client-balance", query: (today, from) => `fromDate=${from}&pageSize=25&toDate=${today}` },
  { label: "Долги по счетам", href: "/analytics/account-debts", query: (today, from) => `fromDate=${from}&pageSize=25&toDate=${today}` },
  { label: "Баланс поставщиков", href: "/analytics/supplier-balance", query: () => "pageSize=25" },
  { label: "Баланс вансел", href: "/analytics/vansell-balance", query: () => "pageSize=25" },
  { label: "Баланс филиалов", href: "/analytics/branch-balance", query: () => "pageSize=25" },
  { label: "Баланс сотрудников", href: "/analytics/employee-balance", query: () => "pageSize=25&toggle=client&withProfit=True" },
  { label: "Управленческий баланс по филиалам", href: "/analytics/management-balance", query: (today, from) => `beginDate=${from}&endDate=${today}` },
  { label: "Движения денежных средств", href: "/analytics/cash-flow", query: (today, from) => `beginDate=${from}&endDate=${today}` },
]

const cashOperations: MenuItem[] = [
  { label: "Управления кассой", href: "/analytics/cash-management", query: () => "pageSize=25" },
  { label: "Оплаты от клиентов", href: "/analytics/customer-payments?pageSize=25&showCheckboxes=true" },
  { label: "Оплаты поставщикам", href: "/analytics/supplier-payments", query: () => "pageSize=25" },
  { label: "Ожидаемые расходы", href: "/analytics/expected-expenses", query: () => "pageSize=25&status=pending" },
  { label: "Ожидаемые оплаты", href: "/analytics/expected-payments", query: () => "pageSize=25" },
  { label: "Расходы по категориям", href: "/analytics/category-expenses" },
  { label: "Расходы на персонал", href: "/analytics/payroll-expenses" },
]

const additional: MenuItem[] = [
  // The page lists deliverer (доставщик) debts; supplier debts live on "Баланс поставщиков".
  { label: "Долги доставщиков", href: "/analytics/supplier-debts" },
  { label: "Долги с заказов", href: "/analytics/order-debts", query: () => "pageSize=25&toggle=client&withProfit=True" },
  { label: "Сверка магазина через бот", href: "/analytics/store-reconciliation-bot", query: () => "pageSize=25" },
  { label: "Сверка счетов", href: "/analytics/account-reconciliation", query: () => "pageSize=25" },
  { label: "Договоры", href: "/analytics/contracts", query: () => "pageSize=25" },
  { label: "Накопительная карта", href: "/analytics/loyalty-card", query: () => "pageSize=25" },
  { label: "Запросы на снятие кэшбэка", href: "/analytics/cashback-withdrawal-requests", query: () => "pageSize=25" },
  { label: "KPI план филиалов", href: "/analytics/branch-kpi-plans", query: (today) => `month=${Number(today.slice(5, 7))}&pageSize=25&year=${today.slice(0, 4)}` },
]

// Used by top-nav.tsx to decide when the "Финансы" tab should be
// highlighted — most of these pages live under the shared /analytics/[slug]
// route, which "Аналитика" would otherwise claim first.
export const financeHrefs: string[] = [...finances, ...balance, ...cashOperations, ...additional].map((item) => item.href).filter((href) => href !== "/")

export function FinanceMenu({ onSelect, onMouseEnter, onMouseLeave }: Props) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-max"
    >
      <div className={MENU_BOX}>
        <LinkColumn title="Финансы" items={finances} onSelect={onSelect} />
        <LinkColumn title="Баланс" items={balance} onSelect={onSelect} />
        <LinkColumn title="Работа с кассой" items={cashOperations} onSelect={onSelect} />
        <LinkColumn title="Дополнительно" items={additional} onSelect={onSelect} />
      </div>
    </div>
  )
}
