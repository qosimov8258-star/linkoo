"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useState } from "react"

import type { ExcelImportSpec } from "@/components/analytics/excel-row-import"
import { everyLanguage, importKey, parseYesNo, postJson, repeatedInFile, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { normCurrency } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  CASHBOXES_API,
  CASHBOX_TYPE_LABELS,
  cashboxTypeOf,
  type CashboxErrorBody,
  type CashboxOptions,
  type CashboxPayload,
  type CashboxType,
  type CashboxUsage,
} from "./cashboxes-data"

// Dialogs of the "Кассы" page: the delete confirm (demo ConfirmDialog type "delete":
// "Подтверждение удаления" + the cashbox name; a refused delete shows "Удаление
// невозможно из-за связи с другими данными") and the Excel import kept from our other
// settings pages (each row goes through POST /api/cashboxes and its validation).

/** "Управления кассой (3), Оплаты от клиентов (1)" in the UI language. */
export function cashboxUsageText(usage: CashboxUsage[], t: (text: string) => string): string {
  return usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")
}

// --- delete confirm ----------------------------------------------------------------

export function CashboxDeleteDialog({
  cashboxId,
  name,
  onClose,
  onDeleted,
  onFailed,
}: {
  cashboxId: number
  /** Known name (grid row); otherwise read from GET /api/cashboxes/[id]. */
  name?: string
  onClose: () => void
  onDeleted: () => void
  /** Already translated message for the snackbar. */
  onFailed: (message: string) => void
}) {
  const { t } = useLanguage()
  const [loadedName, setLoadedName] = useState("")
  const [loading, setLoading] = useState(!name)
  const [loadError, setLoadError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [blockedBy, setBlockedBy] = useState<CashboxUsage[] | null>(null)

  useEffect(() => {
    if (name) return
    const controller = new AbortController()
    fetch(`${CASHBOXES_API}/${cashboxId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { name?: string } & CashboxErrorBody
        if (!response.ok) throw new Error(data.error || "Касса не найдена")
        setLoadedName(data.name ?? "")
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [name, cashboxId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function remove() {
    if (deleting || loading || loadError) return
    setDeleting(true)
    try {
      const response = await fetch(`${CASHBOXES_API}/${cashboxId}`, { method: "DELETE" })
      if (response.ok) {
        onDeleted()
        return
      }
      const data = (await response.json().catch(() => ({}))) as CashboxErrorBody
      const usage = data.usage ?? []
      if (response.status === 409) setBlockedBy(usage)
      const base = t(data.error || "Удаление невозможно из-за связи с другими данными")
      onFailed(usage.length ? `${base}: ${cashboxUsageText(usage, t)}` : base)
    } catch {
      onFailed(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setDeleting(false)
    }
  }

  const busy = loading || deleting
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-[500px] rounded bg-white shadow-2xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[13px] uppercase text-[#333]">{t("Подтверждение удаления")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[210px] px-[30px] text-[13px] text-[#333]">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <p className="py-5">{t("Вы уверены что хотите удалить эти данные?")}</p>
          {loadError ? (
            <p className="pb-5 text-[#f44336]">{t(loadError)}</p>
          ) : (
            <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-5 font-semibold">{name || loadedName}</div>
          )}
          {blockedBy && (
            <p className="py-5 text-[#f44336]">
              {t("Удаление невозможно из-за связи с другими данными")}
              {blockedBy.length > 0 && `: ${cashboxUsageText(blockedBy, t)}`}
            </p>
          )}
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-[10px]">
          <button
            type="button"
            onClick={remove}
            disabled={busy || Boolean(loadError) || Boolean(blockedBy)}
            className="rounded px-5 py-2.5 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50"
          >
            {t("Удалить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

// --- Excel import (extra of our settings pages, not in the demo) ---------------------
// The shared "Импорт с Excel" dialog (components/analytics/excel-row-import.tsx): every row is checked first
// (references by the options of the form: Валюты, employees, branches), then saved through POST /api/cashboxes.

type CashboxImport = Required<Pick<CashboxPayload, "name" | "currency" | "paymentType" | "vansell" | "orderNumber">> & {
  cashierId: number
  branchId: number | null
}

const MAX_ORDER_NUMBER = 2_147_483_647

/** "наличный" / "банковский счет" in any UI language (or the cash core's spellings: cash, bank, перечисление …). */
function importPaymentType(value: string): CashboxType | null {
  const key = importKey(value)
  for (const type of ["cash", "bank"] as const) {
    if (everyLanguage(CASHBOX_TYPE_LABELS[type]).some((label) => importKey(label) === key)) return type
  }
  return cashboxTypeOf(value)
}

export function cashboxImportSpec(t: (text: string) => string): ExcelImportSpec<CashboxImport> {
  return {
    templateName: "cashboxes-template",
    columns: [
      { field: "name", header: "Наименование", aliases: ["Название", "Касса", "Name"] },
      { field: "currency", header: "Валюта", aliases: ["Currency"] },
      { field: "cashier", header: "Кассир", aliases: ["Cashier"] },
      { field: "branch", header: "Филиал", aliases: ["Branch"] },
      { field: "paymentType", header: "Тип оплаты", aliases: ["Тип", "Payment type"] },
      { field: "vansell", header: "Вэнсел", aliases: ["Вансел", "Van sell", "Vansell"] },
      { field: "orderNumber", header: "Порядковый номер", aliases: ["Position"] },
    ],
    keyField: "name",
    prepare: async (records) => {
      // The selects of the form, read fresh: references are sent by id, currencies by their code in Валюты.
      const response = await fetch(`${CASHBOXES_API}/options`, { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      const options = (await response.json()) as CashboxOptions
      const currencies = new Map<string, string>()
      for (const currency of options.currencies) {
        for (const text of [currency.code, currency.label, currency.name]) if (text) currencies.set(importKey(text), currency.code)
        currencies.set(importKey(normCurrency(currency.code)), currency.code)
      }
      const people = new Map<string, number[]>()
      for (const employee of options.employees) {
        if (employee.active === false) continue
        const key = importKey(employee.name)
        people.set(key, [...(people.get(key) ?? []), employee.id])
      }
      const branches = new Map(options.branches.map((branch) => [importKey(branch.name), branch.id]))
      const rows: PreparedRow<CashboxImport>[] = []
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        const label = (field: string) => `${values.name}, ${t(field)}`
        if (!values.name) {
          errors.push({ line, label: t("Наименование"), message: "Обязательное поле" })
          continue
        }
        const currency = values.currency ? (currencies.get(importKey(values.currency)) ?? currencies.get(importKey(normCurrency(values.currency)))) : undefined
        const cashiers = values.cashier ? (people.get(importKey(values.cashier)) ?? []) : []
        const branchId = values.branch ? branches.get(importKey(values.branch)) : null
        const paymentType = values.paymentType ? importPaymentType(values.paymentType) : null
        const vansell = parseYesNo(values.vansell, false)
        const order = values.orderNumber.replace(/\s/g, "")
        const orderNumber = !order ? 0 : /^\d{1,10}$/.test(order) && Number(order) <= MAX_ORDER_NUMBER ? Number(order) : null
        if (!values.currency) errors.push({ line, label: label("Валюта"), message: "Обязательное поле" })
        else if (!currency) errors.push({ line, label: `${values.name}, ${values.currency}`, message: "Валюта не найдена" })
        else if (!values.cashier) errors.push({ line, label: label("Кассир"), message: "Обязательное поле" })
        else if (!cashiers.length) errors.push({ line, label: `${values.name}, ${values.cashier}`, message: "Сотрудник не найден" })
        else if (cashiers.length > 1) errors.push({ line, label: `${values.name}, ${values.cashier}`, message: "Найдено несколько сотрудников с таким именем" })
        else if (branchId === undefined) errors.push({ line, label: `${values.name}, ${values.branch}`, message: "Филиал не найден" })
        else if (!values.paymentType) errors.push({ line, label: label("Тип оплаты"), message: "Обязательное поле" })
        else if (!paymentType) errors.push({ line, label: `${values.name}, ${values.paymentType}`, message: "Неизвестный тип оплаты" })
        else if (vansell === null) errors.push({ line, label: label("Вэнсел"), message: "Укажите да или нет" })
        else if (orderNumber === null) errors.push({ line, label: label("Порядковый номер"), message: "Введите целое число не меньше 0" })
        else rows.push({ line, label: values.name, item: { name: values.name, currency, cashierId: cashiers[0], branchId, paymentType, vansell, orderNumber } })
      }
      return { rows, errors: [...errors, ...repeatedInFile(rows, (row) => importKey(row.item.name))] }
    },
    send: (item) => postJson(CASHBOXES_API, item),
    fallbackError: "Не удалось сохранить кассу",
  }
}
