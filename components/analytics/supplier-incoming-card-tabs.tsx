"use client"

import { useEffect, useState, type ReactNode } from "react"

import { formatSupplyAmount } from "@/lib/amount-precision"
import { useLanguage } from "@/lib/i18n/language-context"
import type { SupplyCostRow } from "@/lib/supplier-incomings-costs"
import type { Incoming, IncomingExpense } from "./supplier-incomings-data"

// The supply card's «Себестоимость» and «Доп. расходы» tabs and the «Доп. расходы» lines of its БАЛАНС column, as Linko
// draws them (Склад → Приход от поставщиков → «Поставка № N»).

/** Linko's supplyNumberFormat: the supply decimals of Настройки → Округление сумм, then the currency. */
const amount = (value: number, currency = "") => `${formatSupplyAmount(value, 2)}${currency ? ` ${currency}` : ""}`

const SORT = "M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"
const REMOVE =
  "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
const LINK =
  "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"

type SortKey = "product" | "qty" | "purchasePrice" | "withExpense" | "netCost" | "balance" | "avgNetCost"

/** «Себестоимость»: Linko's columns «Товар | Кол-во | Закупочная цена | Доп. расход | Себестоимость | Остаток в складе |
 * Усред. Себ.» (money in the base currency), sortable, with the bold «Итого» row. */
export function SupplyCostTab({ row, baseCurrency, version }: { row: Incoming; baseCurrency: string; version: number }) {
  const { t } = useLanguage()
  const [lines, setLines] = useState<SupplyCostRow[] | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/supplier-incomings/${row.id}/cost-lines`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: SupplyCostRow[]) => alive && setLines(data))
      .catch(() => alive && setLines([]))
    return () => {
      alive = false
    }
  }, [row.id, version])
  const rows = [...(lines ?? [])]
  if (sort) {
    rows.sort((a, b) => {
      const left = a[sort.key]
      const right = b[sort.key]
      const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ru")
      return sort.desc ? -order : order
    })
  }
  const sum = (key: Exclude<SortKey, "product">) => (lines ?? []).reduce((total, line) => total + line[key], 0)
  const cols = "grid-cols-[minmax(0,454fr)_minmax(0,107fr)_minmax(0,180fr)_minmax(0,211fr)_minmax(0,211fr)_minmax(0,180fr)_minmax(0,171fr)]"
  const head = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort((current) => (current?.key === key ? (current.desc ? null : { key, desc: true }) : { key, desc: false }))}
      className="flex h-full items-center pl-[18px] text-left"
    >
      {t(label)}
      <svg viewBox="0 0 24 24" className="ml-[8px] h-4 w-4 fill-[#9e9e9e]" aria-hidden>
        <path d={SORT} />
      </svg>
    </button>
  )
  const cell = "flex items-center px-[18px] py-[8px]"
  return (
    <div className="-mt-px text-[13px] text-[#333]">
      <div className={`grid min-h-[36px] ${cols} items-center bg-[#f0f4f7]`}>
        {head("product", "Товар")}
        {head("qty", "Кол-во")}
        {head("purchasePrice", "Закупочная цена")}
        {head("withExpense", "Доп. расход")}
        {head("netCost", "Себестоимость")}
        {head("balance", "Остаток в складе")}
        {head("avgNetCost", "Усред. Себ.")}
      </div>
      <div className="border-b border-l border-[#e0e0e0]">
        {rows.map((line, index) => (
          <div key={`${line.product}-${index}`} className={`grid min-h-[36px] ${cols} items-stretch border-b border-[#e0e0e0] [&>*]:border-r [&>*]:border-[#e0e0e0]`}>
            <div className="flex flex-col justify-center px-[18px] py-[8px] leading-[19px]">
              <span>{line.product}</span>
              {line.code && <span data-no-translate className="text-[#1E4A9A]">{line.code}</span>}
            </div>
            <div className={cell}>{amount(line.qty)}</div>
            <div className={cell}>{amount(line.purchasePrice, baseCurrency)}</div>
            <div className={cell}>{amount(line.withExpense, baseCurrency)}</div>
            <div className={cell}>{amount(line.netCost, baseCurrency)}</div>
            <div className={cell}>{amount(line.balance)}</div>
            <div className={cell}>{amount(line.avgNetCost, baseCurrency)}</div>
          </div>
        ))}
        <div className={`grid min-h-[38px] ${cols} items-stretch text-[16px] font-semibold [&>*]:border-r [&>*]:border-[#e0e0e0]`}>
          <div className={cell}>{t("Итого")}:</div>
          <div className={cell}>{amount(sum("qty"))}</div>
          <div className={cell}>{amount(sum("purchasePrice"), baseCurrency)}</div>
          <div className={cell}>{amount(sum("withExpense"), baseCurrency)}</div>
          <div className={cell}>{amount(sum("netCost"), baseCurrency)}</div>
          <div className={cell}>{amount(sum("balance"))}</div>
          <div className={cell}>{amount(sum("avgNetCost"), baseCurrency)}</div>
        </div>
      </div>
    </div>
  )
}

/** Linko's SUPPLY_DISTRIBUTE_ITEMS. */
const DISTRIBUTE: Record<string, string> = { cost: "Авто от суммы", weight: "Авто от веса", capacity: "Авто от объема", manual: "Ручной" }

/** «Наличный» for cash, else «Банковский счет» (Linko's expense row). */
const paymentLabel = (value: string) => (/^нал|^cash/i.test(value) ? "Наличный" : "Банковский счет")

function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span role="tooltip" className="pointer-events-none absolute right-full top-1/2 z-[1000] mr-[10px] w-max -translate-y-1/2 rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] leading-[17px] text-white opacity-90">
          {text}
        </span>
      )}
    </span>
  )
}

/** «Доп. расходы»: «Тип распределения | Описание | Продукт | Тип оплаты | Сумма | Оплачено» and a ⊗ per expense; the
 * robot when the supply has none. */
export function SupplyExpensesTab({ expenses, busy, onDelete }: { expenses: IncomingExpense[]; busy: boolean; onDelete: (expense: IncomingExpense) => void }) {
  const { t } = useLanguage()
  if (!expenses.length) {
    return (
      <div className="bg-[url('/robot-empty.png')] bg-[length:200px] bg-center bg-no-repeat pb-[20px] pt-[200px] text-center text-[13px] text-[#999]">
        <div>{t("В данной поставке нет дополнительных раходов")}</div>
      </div>
    )
  }
  const cols = "grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]"
  const row = `grid h-[50px] ${cols} items-center border-b border-dotted border-[#bdbdbd] pl-[5px] text-[13px] text-[#333] [&>*]:px-[8px] [&>*]:text-right`
  return (
    <div className="max-h-[695px] overflow-y-auto overflow-x-hidden">
      <div className={`${row} font-semibold leading-[16px]`}>
        <div className="!text-left">{t("Тип распределения")}</div>
        <div>{t("Описание")}</div>
        <div>{t("Продукт")}</div>
        <div>{t("Тип оплаты")}</div>
        <div>{t("Сумма")}</div>
        <div>{t("Оплачено")}</div>
        <div />
      </div>
      {expenses.map((expense) => (
        <div key={expense.id} className={row}>
          <div className="!text-left">{t(DISTRIBUTE[expense.distributeType ?? "cost"] ?? "-")}</div>
          <div className="truncate">{expense.description}</div>
          <div>{t("Общий расход")}</div>
          <div>{t(paymentLabel(expense.paymentType))}</div>
          <div className="flex items-center justify-end">
            {amount(expense.amount, expense.currency)}
            {expense.bindToProvider && (
              <Tip text={t("Привязан к поставщику")}>
                <svg viewBox="0 0 24 24" className="ml-[5px] h-[22px] w-[22px] fill-[#666]" aria-hidden>
                  <path d={LINK} />
                </svg>
              </Tip>
            )}
          </div>
          <div>{amount(expense.paid ?? 0, expense.currency)}</div>
          <div className="flex items-center justify-end">
            <button type="button" disabled={busy} onClick={() => onDelete(expense)} aria-label={t("Удалить")} className="flex h-[44px] w-[44px] items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden>
                <path d={REMOVE} />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** БАЛАНС → «Доп. расходы»: per currency «Сумма: N CUR (Оплачено: P)»; hovering a line shows it per payment type. */
export function SupplyExpenseSummary({ expenses }: { expenses: IncomingExpense[] }) {
  const { t } = useLanguage()
  const [hover, setHover] = useState<string | null>(null)
  if (!expenses.length) return <p className="mt-[2px] leading-[25px]">{t("Нет дополнительных расходов")}</p>
  const byCurrency = new Map<string, IncomingExpense[]>()
  for (const expense of expenses) byCurrency.set(expense.currency, [...(byCurrency.get(expense.currency) ?? []), expense])
  return (
    <ul className="mt-[2px]">
      {[...byCurrency].map(([currency, list]) => {
        const total = list.reduce((sum, expense) => sum + expense.amount, 0)
        const paid = list.reduce((sum, expense) => sum + (expense.paid ?? 0), 0)
        const byType = new Map<string, { total: number; paid: number }>()
        for (const expense of list) {
          const type = paymentLabel(expense.paymentType)
          const current = byType.get(type) ?? { total: 0, paid: 0 }
          byType.set(type, { total: current.total + expense.amount, paid: current.paid + (expense.paid ?? 0) })
        }
        return (
          <li key={currency} className="relative block leading-[25px]" onMouseEnter={() => setHover(currency)} onMouseLeave={() => setHover(null)}>
            {hover === currency && (
              <div className="absolute bottom-full left-0 z-[60] mb-[4px] w-max rounded-[2px] bg-white px-[12px] py-[8px] text-[13px] leading-[20px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                {[...byType].map(([type, value]) => (
                  <div key={type}>
                    <div>
                      <strong>{t(type === "Наличный" ? "Наличные" : "Перечисление")}:</strong> {amount(value.total, currency)}
                    </div>
                    <div>
                      {t("Оплачено")}: {amount(value.paid)} {t("Остаток")}: {amount(value.total - value.paid)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <span className="font-normal">
              {t("Сумма")}: {amount(total, currency)} ({t("Оплачено")}: {amount(paid)})
            </span>
          </li>
        )
      })}
    </ul>
  )
}
