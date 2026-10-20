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
  { label: "Управление кассой", href: "/analytics/cash-management" },
  { label: "Оплаты от клиентов", href: "/analytics/customer-payments" },
  { label: "Оплаты поставщикам", href: "/analytics/supplier-payments" },
  { label: "Ожидаемые расходы", href: "/analytics/expected-expenses" },
  { label: "Ожидаемые оплаты", href: "/analytics/expected-payments" },
  { label: "Расходы по категориям", href: "/analytics/category-expenses" },
  { label: "Расходы на персонал", href: "/analytics/payroll-expenses" },
]

const additional: MenuItem[] = [
  // The page lists deliverer (доставщик) debts; supplier debts live on "Баланс поставщиков".
  { label: "Долги доставщиков", href: "/analytics/supplier-debts" },
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
