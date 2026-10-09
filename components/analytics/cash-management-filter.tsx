"use client"

import { useState } from "react"

import { useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { MultiPick, PrimaryButton, SecondaryButton, inputClass, useJsonList, type CashCategory, type Named } from "@/components/analytics/cash-management-shared"
import { CASH_OP_LABELS, type CashboxWithBalance } from "@/lib/cash/types"
import { isIsoDay } from "@/lib/finance/dates"
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
  return out
}

/** Demo counter: set filter fields, fromDate excluded. */
export function countFilters(filters: CashFilters): number {
  let count = 0
  for (const key of LIST_KEYS) if (filters[key].length) count += 1
  for (const key of FLAG_KEYS) if (filters[key]) count += 1
  if (filters.paymentType) count += 1
  if (filters.toDate) count += 1
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

export function CashFilterPanel({ value, cashboxes, onApply, onClose }: { value: CashFilters; cashboxes: CashboxWithBalance[]; onApply: (filters: CashFilters) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<CashFilters>(value)
  const set = <K extends keyof CashFilters>(name: K, next: CashFilters[K]) => setDraft((current) => ({ ...current, [name]: next }))
  const branches = useJsonList<Named>("/api/branches").items
  const organizations = useJsonList<Named>("/api/organizations").items
  const employees = useJsonList<Named>("/api/employees").items
  const clients = useJsonList<Named>("/api/clients").items
  const categories = useCashJson<{ categories: CashCategory[] }>("/api/cash/categories").data?.categories ?? []

  const named = (items: Named[]) => items.map((item) => ({ value: String(item.id), label: item.name }))
  return (
    <div className="border-b border-[#e1e5eb] bg-[#f7f9fc] px-4 py-4 md:px-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MultiPick label={t("Филиалы")} options={branches.map((item) => ({ value: item.name, label: item.name }))} value={draft.branch} onChange={(next) => set("branch", next)} />
        <MultiPick label={t("Касса")} options={cashboxes.map((item) => ({ value: String(item.id), label: item.name }))} value={draft.cashbox} onChange={(next) => set("cashbox", next)} />
        <MultiPick label={t("Категории расходов")} options={named(categories.filter((item) => item.kind === "expense"))} value={draft.categoryExpense} onChange={(next) => set("categoryExpense", next)} />
        <MultiPick label={t("Категория прихода")} options={named(categories.filter((item) => item.kind === "income"))} value={draft.incomeCategory} onChange={(next) => set("incomeCategory", next)} />
        <label className="flex min-w-0 flex-col gap-1 text-[13px] text-[#586174]">
          {t("Тип оплаты")}
          <select value={draft.paymentType} onChange={(event) => set("paymentType", event.target.value as CashFilters["paymentType"])} className={inputClass}>
            <option value="">{t("Все")}</option>
            <option value="bank">{t("Банковский счет")}</option>
            <option value="cash">{t("Наличный")}</option>
          </select>
        </label>
        <MultiPick label={t("Тип")} options={TYPE_OPTIONS.map((type) => ({ value: String(type), label: t(CASH_OP_LABELS[type]) }))} value={draft.type} onChange={(next) => set("type", next)} />
        <MultiPick label={t("Клиент")} options={named(clients)} value={draft.client} onChange={(next) => set("client", next)} />
        <MultiPick label={t("Сотрудник")} options={named(employees)} value={draft.staff} onChange={(next) => set("staff", next)} />
        <MultiPick label={t("Организация")} options={organizations.map((item) => ({ value: item.name, label: item.name }))} value={draft.division} onChange={(next) => set("division", next)} />
        <label className="flex min-w-0 flex-col gap-1 text-[13px] text-[#586174] sm:col-span-2 xl:col-span-1">
          {t("Диапазон дат")}
          <span className="flex items-center gap-2">
            <input type="date" value={draft.fromDate} onChange={(event) => set("fromDate", event.target.value)} className={`${inputClass} flex-1`} aria-label={t("Диапазон дат")} />
            <span>—</span>
            <input type="date" value={draft.toDate} onChange={(event) => set("toDate", event.target.value)} className={`${inputClass} flex-1`} aria-label={t("Диапазон дат")} />
          </span>
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-[14px] text-[#17233b]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.withDeleted} onChange={(event) => set("withDeleted", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
          {t("Показать удаленные транзакции")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.internalTransfer} onChange={(event) => set("internalTransfer", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
          {t("Внутренний расход")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.onlyNotInternal} onChange={(event) => set("onlyNotInternal", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
          {t("Показать только реальные расходы (отражение в генеральном отчете)")}
        </label>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
        <PrimaryButton
          onClick={() => {
            const ordered = draft.fromDate && draft.toDate && draft.fromDate > draft.toDate ? { ...draft, fromDate: draft.toDate, toDate: draft.fromDate } : draft
            onApply(ordered)
          }}
        >
          {t("Применить")}
        </PrimaryButton>
      </div>
    </div>
  )
}
