"use client"

import { useState } from "react"

import { useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { useJsonList, type CashCategory, type Named } from "@/components/analytics/cash-management-shared"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { formatRangeLabel, parseISODate } from "@/lib/dashboard-date-range"
import { CASH_OP_LABELS, type CashboxWithBalance } from "@/lib/cash/types"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter panel of the cash list (demo module 2185, TransactionFilterForm):
// Филиалы, Касса, Категории расходов, Категория прихода, Тип оплаты, Тип,
// Клиент, Сотрудник, Организация, Диапазон дат and three checkboxes. Values
// live in the URL with the demo parameter names and map onto /api/cash/operations.

export type CashFilters = {
  branch: string[]
  cashbox: string[]
  categoryExpense: string[]
  incomeCategory: string[]
  paymentType: "" | "cash" | "bank"
  type: string[]
  client: string[]
  staff: string[]
  division: string[]
  fromDate: string
  toDate: string
  withDeleted: boolean
  internalTransfer: boolean
  onlyNotInternal: boolean
  /** "Транзакция": a document number (the list search by №). */
  transaction: string
}

export const EMPTY_FILTERS: CashFilters = {
  branch: [],
  cashbox: [],
  categoryExpense: [],
  incomeCategory: [],
  paymentType: "",
  type: [],
  client: [],
  staff: [],
  division: [],
  fromDate: "",
  toDate: "",
  withDeleted: false,
  internalTransfer: false,
  onlyNotInternal: false,
  transaction: "",
}

const LIST_KEYS = ["branch", "cashbox", "categoryExpense", "incomeCategory", "type", "client", "staff", "division"] as const
const FLAG_KEYS = ["withDeleted", "internalTransfer", "onlyNotInternal"] as const

/** Repeated params; id lists also accept the demo "1-2-3" form (names are never split). */
function listParam(params: URLSearchParams, name: string, ids: boolean): string[] {
  const values = params.getAll(name).filter((value) => value.trim())
  return ids ? values.flatMap((value) => value.split("-")).filter((value) => /^\d+$/.test(value)) : values
}

export function readFilters(params: URLSearchParams): CashFilters {
  const paymentType = params.get("paymentType")
  return {
    branch: listParam(params, "branch", false),
    cashbox: listParam(params, "cashbox", true),
    categoryExpense: listParam(params, "categoryExpense", true),
    incomeCategory: listParam(params, "incomeCategory", true),
    paymentType: paymentType === "cash" || paymentType === "bank" ? paymentType : "",
    type: listParam(params, "type", true),
    client: listParam(params, "client", true),
    staff: listParam(params, "staff", true),
    division: listParam(params, "division", false),
    fromDate: isIsoDay(params.get("fromDate")) ? (params.get("fromDate") as string) : "",
    toDate: isIsoDay(params.get("toDate")) ? (params.get("toDate") as string) : "",
    withDeleted: ["1", "true"].includes(params.get("withDeleted") ?? ""),
    internalTransfer: ["1", "true"].includes(params.get("internalTransfer") ?? ""),
    onlyNotInternal: ["1", "true"].includes(params.get("onlyNotInternal") ?? ""),
    transaction: /^\d{1,15}$/.test(params.get("transaction") ?? "") ? (params.get("transaction") as string) : "",
  }
}

/** URL changes for the filters (null removes a key). */
export function filtersToUrl(filters: CashFilters): Record<string, string | string[] | null> {
  const out: Record<string, string | string[] | null> = {}
  for (const key of LIST_KEYS) out[key] = filters[key].length ? filters[key] : null
  for (const key of FLAG_KEYS) out[key] = filters[key] ? "1" : null
  out.paymentType = filters.paymentType || null
  out.fromDate = filters.fromDate || null
  out.toDate = filters.toDate || null
  out.transaction = filters.transaction || null
  return out
}

/** Demo counter: set filter fields, fromDate excluded. */
export function countFilters(filters: CashFilters): number {
  let count = 0
  for (const key of LIST_KEYS) if (filters[key].length) count += 1
  for (const key of FLAG_KEYS) if (filters[key]) count += 1
  if (filters.paymentType) count += 1
  if (filters.toDate) count += 1
  if (filters.transaction) count += 1
  return count
}

/** List / totals query of the core (CashListQuery params). */
export function filtersToQuery(filters: CashFilters): CashQuery {
  return {
    branch: filters.branch,
    cashbox: filters.cashbox,
    expenseCategory: filters.categoryExpense,
    incomeCategory: filters.incomeCategory,
    paymentType: filters.paymentType,
    type: filters.type,
    client: filters.client,
    staff: filters.staff,
    organization: filters.division,
    from: filters.fromDate,
    to: filters.toDate,
    withDeleted: filters.withDeleted,
    internalTransfer: filters.internalTransfer,
    onlyNotInternal: filters.onlyNotInternal,
  }
}

const TYPE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 22] as const
const CARD_SHADOW = "shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"

export function CashFilterPanel({ value, cashboxes, onApply, onClose }: { value: CashFilters; cashboxes: CashboxWithBalance[]; onApply: (filters: CashFilters) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<CashFilters>(value)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [transactions, setTransactions] = useState<RefSelectItem[]>([])
  const set = <K extends keyof CashFilters>(name: K, next: CashFilters[K]) => setDraft((current) => ({ ...current, [name]: next }))
  const branches = useJsonList<Named>("/api/branches").items
  const organizations = useJsonList<Named>("/api/organizations").items
  const employees = useJsonList<Named>("/api/employees").items
  const clients = useJsonList<Named>("/api/clients").items
  const categories = useCashJson<{ categories: CashCategory[] }>("/api/cash/categories").data?.categories ?? []

  const named = (items: Named[]): RefSelectItem[] => items.map((item) => ({ value: String(item.id), label: item.name }))
  const multi = (label: string, items: RefSelectItem[], selected: string[], onChange: (next: string[]) => void, single = false) => {
    const known = new Map(items.map((item) => [item.value, item.label]))
    return (
      <RefSearchSelect
        label={label}
        items={items}
        selected={selected.map((item) => ({ value: item, label: known.get(item) ?? item }))}
        onChange={(next) => onChange(next.map((item) => item.value))}
        multi={!single}
      />
    )
  }
  const searchTransactions = (query: string) => {
    if (!/^\d{1,15}$/.test(query.trim())) return setTransactions([])
    fetch(`/api/cash/operations?search=${encodeURIComponent(query.trim())}&pageSize=10`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setTransactions(((data?.rows ?? data?.results ?? []) as Array<{ docNo?: number | string }>).map((row) => ({ value: String(row.docNo), label: String(row.docNo) }))))
      .catch(() => setTransactions([]))
  }
  const checkbox = (checked: boolean, onChange: (next: boolean) => void, label: string) => (
    <label className="flex cursor-pointer items-center gap-[10px] text-[13px] font-semibold leading-[20px] text-[#333]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-[18px] w-[18px] shrink-0 accent-[#5d6474]" />
      {label}
    </label>
  )
  const dateLabel = draft.fromDate && draft.toDate ? formatRangeLabel(parseISODate(draft.fromDate), parseISODate(draft.toDate)).toLowerCase() : t("Укажите дату")
  return (
    <div className={`absolute inset-x-0 top-0 z-30 bg-white px-[20px] pb-[14px] pt-[18px] ${CARD_SHADOW}`}>
      <div className="mb-[8px] flex h-[40px] items-center justify-between">
        <span className="text-[16px] font-normal text-[#999]">{t("Фильтр")}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#999] hover:text-[#666]">
          <svg viewBox="0 0 24 24" className="h-[26px] w-[26px] fill-current" aria-hidden>
            <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-4 gap-x-[30px] gap-y-[5px]">
        {multi(t("Филиалы"), branches.map((item) => ({ value: item.name, label: item.name })), draft.branch, (next) => set("branch", next))}
        {multi(t("Касса"), cashboxes.map((item) => ({ value: String(item.id), label: item.name })), draft.cashbox, (next) => set("cashbox", next))}
        {multi(t("Категории расходов"), named(categories.filter((item) => item.kind === "expense")), draft.categoryExpense, (next) => set("categoryExpense", next))}
        {multi(t("Категория прихода"), named(categories.filter((item) => item.kind === "income")), draft.incomeCategory, (next) => set("incomeCategory", next))}
        {multi(
          t("Тип оплаты"),
          [
            { value: "bank", label: t("Банковский счет") },
            { value: "cash", label: t("Наличный") },
          ],
          draft.paymentType ? [draft.paymentType] : [],
          (next) => set("paymentType", (next[0] as CashFilters["paymentType"] | undefined) ?? ""),
          true,
        )}
        {multi(t("Тип"), TYPE_OPTIONS.map((type) => ({ value: String(type), label: t(CASH_OP_LABELS[type]) })), draft.type, (next) => set("type", next))}
        {multi(t("Клиент"), named(clients), draft.client, (next) => set("client", next))}
        {multi(t("Сотрудник"), named(employees), draft.staff, (next) => set("staff", next))}
        {multi(t("Организация"), organizations.map((item) => ({ value: item.name, label: item.name })), draft.division, (next) => set("division", next))}
        <RefSearchSelect
          label={t("Транзакция")}
          items={transactions}
          selected={draft.transaction ? [{ value: draft.transaction, label: draft.transaction }] : []}
          onChange={(next) => set("transaction", next[0]?.value ?? "")}
          onQuery={searchTransactions}
        />
        <div className="relative h-[62px]">
          <span className="absolute left-0 top-[8px] text-[10px] font-bold leading-3 text-black">{t("Диапазон дат")}</span>
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute inset-x-0 top-[22px] h-[36px] border-b border-[#e8e8e8] text-left text-[13px] text-black">
            {dateLabel}
          </button>
          {pickerOpen && (
            <DateRangePicker
              positionClassName="left-0 top-[58px]"
              begin={draft.fromDate || todayIso()}
              end={draft.toDate || todayIso()}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setDraft((current) => ({ ...current, fromDate: from, toDate: to }))
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <div className="flex h-[62px] items-center">{checkbox(draft.withDeleted, (next) => set("withDeleted", next), t("Показать удаленные транзакции"))}</div>
        <div className="col-span-1 flex h-[62px] items-center">{checkbox(draft.internalTransfer, (next) => set("internalTransfer", next), t("Внутренний расход"))}</div>
        <div className="col-span-2 flex h-[62px] items-center">{checkbox(draft.onlyNotInternal, (next) => set("onlyNotInternal", next), t("Показать только реальные расходы (отражение в генеральном отчете)"))}</div>
      </div>
      <button
        type="button"
        onClick={() => {
          const ordered = draft.fromDate && draft.toDate && draft.fromDate > draft.toDate ? { ...draft, fromDate: draft.toDate, toDate: draft.fromDate } : draft
          onApply(ordered)
        }}
        className="mt-[10px] h-[36px] rounded-[4px] bg-[#5d6474] px-[16px] text-[13px] font-semibold uppercase text-white hover:brightness-110"
      >
        {t("Применить")}
      </button>
    </div>
  )
}
