"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { FileSpreadsheet, X } from "lucide-react"

import { actExcelRows, type ActColumn } from "@/components/analytics/balance/act-table"
import { BalanceAmount } from "@/components/analytics/balance/amount"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildBalanceQuery, useBalanceStatement, useFinanceCurrencies } from "@/components/analytics/balance/use-balance"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { formatStatementDate, monthEndIso, monthStartIso, nowLocalIso } from "@/lib/finance/dates"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of the "Баланс филиалов" page (demo van-sell clones 3904 / 3905 / 3906):
// - BranchTransactionDialog: "Добавить" / "Добавить расход" (POST /api/branch-balance-transactions);
// - BranchDetailDialog: "Информация по балансу филиала <name>" — all-time movements,
//   newest first, "Итого", Валюта filter, paging and "Скачать акт сверки".

type Translate = (text: string) => string

export type BranchOption = { id: number; name: string }

/** The detail list shows every movement regardless of the page period (demo itemFilterSerializer has no dates). */
const ALL_TIME = { from: "1970-01-01", to: "2999-12-31" }

/** Plain text of the demo "Описание" cell: "Передача склада (Передача № 12)", "Нет типа (comment)". */
export function branchStatementText(row: StatementRow, t: Translate): string {
  if (row.docNumber) return `${t(row.title)} (${t("Передача")} № ${row.docNumber})`
  const details = [row.description, row.comment].filter(Boolean).join(", ")
  return details ? `${t(row.title)} (${details})` : t(row.title)
}

function BranchStatementDescription({ row }: { row: StatementRow }) {
  const { t } = useLanguage()
  if (!row.docNumber) return <span>{branchStatementText(row, t)}</span>
  const label = `${t("Передача")} № ${row.docNumber}`
  return (
    <span title={row.description || undefined}>
      {t(row.title)} (
      {row.href ? (
        <Link href={row.href} className="font-semibold text-[#129fdd] hover:underline">
          {label}
        </Link>
      ) : (
        <span className="font-semibold">{label}</span>
      )}
      )
    </span>
  )
}

function DialogFrame({ title, width, onClose, children, z = "z-[100]" }: { title: ReactNode; width: string; onClose: () => void; children: ReactNode; z?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`fixed inset-0 ${z} flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-8`} onClick={onClose}>
      <div className={`w-full ${width} rounded-lg bg-white shadow-xl`} onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-6 pr-3">
          <h2 className="font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="p-2 text-[#666]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const fieldLabel = "flex flex-col gap-1 text-sm text-[#586174]"
const fieldInput = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b] outline-none focus:border-[#4f70e7]"

/** Demo number normalizer: digits with one decimal separator, grouped by spaces. */
function normalizeAmount(value: string): string {
  const cleaned = value.replace(/,/g, ".").replace(/[^\d.]/g, "")
  const [whole, ...rest] = cleaned.split(".")
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return rest.length ? `${grouped}.${rest.join("").slice(0, 3)}` : grouped
}

function parseAmount(value: string): number {
  const parsed = Number(value.replace(/\s/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

export function BranchTransactionDialog({
  kind,
  branchId,
  branches,
  onClose,
  onSaved,
}: {
  /** "add" = "Добавить" (green +), "expense" = "Добавить расход" (red −). */
  kind: "add" | "expense"
  branchId: number
  branches: BranchOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const { data: currencyInfo } = useFinanceCurrencies()
  const currencies = currencyInfo?.currencies ?? []
  const [branch, setBranch] = useState(String(branchId))
  const [currency, setCurrency] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const selectedCurrency = currency || currencyInfo?.base || "SUM"

  const submit = async () => {
    const value = parseAmount(amount)
    const nextErrors: Record<string, string> = {}
    if (!branch) nextErrors.branch = t("Выберите филиал")
    if (!(value > 0)) nextErrors.amount = t("Введите сумму")
    if (!date) nextErrors.date = t("Обязательное поле")
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSaving(true)
    try {
      const response = await fetch("/api/branch-balance-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: Number(branch), kind, currency: selectedCurrency, amount: value, date, comment }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } } | null
        const fieldErrors = body?.details?.fieldErrors ?? {}
        const mapped: Record<string, string> = {}
        for (const field of ["branchId", "currency", "amount", "date", "comment"]) {
          if (fieldErrors[field]?.length) mapped[field === "branchId" ? "branch" : field] = t(fieldErrors[field][0])
        }
        mapped.form = body?.error ? t(body.error) : t("Не удалось сохранить транзакцию")
        setErrors(mapped)
        return
      }
      onSaved()
    } catch {
      setErrors({ form: t("Сервер недоступен, попробуйте ещё раз") })
    } finally {
      setSaving(false)
    }
  }

  const error = (field: string) => (errors[field] ? <span className="text-xs text-[#e57373]">{errors[field]}</span> : null)

  return (
    <DialogFrame title={kind === "add" ? t("Добавить") : t("Добавить расход")} width="max-w-[500px]" onClose={onClose} z="z-[110]">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex min-h-[400px] flex-col gap-4 px-6 py-5">
          <label className={fieldLabel}>
            {t("Филиал")}
            <select value={branch} onChange={(event) => setBranch(event.target.value)} className={fieldInput}>
              <option value="">{t("Выберите филиал")}</option>
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {error("branch")}
          </label>
          <label className={fieldLabel}>
            {t("Валюта")}
            <select value={selectedCurrency} onChange={(event) => setCurrency(event.target.value)} className={fieldInput}>
              {(currencies.length ? currencies : [{ code: "SUM", label: "SUM" }]).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            {error("currency")}
          </label>
          <label className={fieldLabel}>
            {t("Сумма")}
            <input value={amount} inputMode="decimal" autoFocus onChange={(event) => setAmount(normalizeAmount(event.target.value))} className={fieldInput} />
            {error("amount")}
          </label>
          <label className={fieldLabel}>
            {t("Дата создания")}
            <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={fieldInput} />
            {error("date")}
          </label>
          <label className={fieldLabel}>
            <textarea
              value={comment}
              rows={Math.min(6, Math.max(1, comment.split("\n").length))}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t("Оставить комментарий...")}
              className="w-full resize-none rounded-md border border-[#dbe0e8] px-3 py-2 text-[#17233b] outline-none focus:border-[#4f70e7]"
            />
            {error("comment")}
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-[#efefef] px-6 py-3">
          {errors.form && <span className="mr-auto text-sm text-[#e57373]">{errors.form}</span>}
          <button type="submit" disabled={saving} className="h-10 rounded-md px-5 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </div>
      </form>
    </DialogFrame>
  )
}

/** Acts columns for the reconciliation act download. */
function actColumns(t: Translate): ActColumn[] {
  return [{ label: "Описание", render: (row) => <BranchStatementDescription row={row} />, excel: (row) => branchStatementText(row, t) }]
}

function ActDownloadDialog({ entityKey, name, currency, onClose }: { entityKey: string; name: string; currency: string; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [from, setFrom] = useState(() => monthStartIso())
  const [to, setTo] = useState(() => monthEndIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const download = async () => {
    if (!from || !to) return
    const period = from <= to ? { from, to } : { from: to, to: from }
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/balances/branch/statement?${buildBalanceQuery({ key: entityKey, ...period, currency })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (StatementResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const codes = currency ? [currency] : body.visibleCurrencies
      downloadExcelTable(`${t("Акт сверки")} ${body.entity.name || name} ${period.from} - ${period.to}`, actExcelRows(body, actColumns(t), t, language, codes))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame title={t("Скачать акт сверки")} width="max-w-[400px]" onClose={onClose} z="z-[110]">
      <div className="flex flex-col gap-3 px-6 py-5">
        <label className={fieldLabel}>
          {t("Выберите период")}
          <span className="flex items-center gap-2">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={fieldInput} />
            <span>—</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={fieldInput} />
          </span>
        </label>
        {error && <span className="text-sm text-[#e57373]">{error}</span>}
      </div>
      <div className="flex justify-end border-t border-[#efefef] px-6 py-3">
        <button type="button" disabled={busy || !from || !to} onClick={() => void download()} className="h-10 rounded-md px-5 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-50">
          {busy ? t("Загрузка...") : t("Скачать")}
        </button>
      </div>
    </DialogFrame>
  )
}

export function BranchDetailDialog({ entityKey, name, onClose }: { entityKey: string; name: string; onClose: () => void }) {
  const { t, language } = useLanguage()
  const { data: currencyInfo } = useFinanceCurrencies()
  const [currency, setCurrency] = useState("")
  const [paging, setPaging] = useState({ page: 1, pageSize: 10 })
  const [actOpen, setActOpen] = useState(false)
  const { data, loading, error, reload } = useBalanceStatement("branch", entityKey, { ...ALL_TIME, currency, order: "desc", ...paging })
  const title = data?.entity.name ?? name
  const totalCodes = data ? (currency ? [currency] : data.visibleCurrencies) : []

  return (
    <DialogFrame title={`${t("Информация по балансу филиала")} ${title}`} width="max-w-[900px]" onClose={onClose}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-6 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="font-semibold">{t("Итого")}:</span>
          {totalCodes.map((code, index) => (
            <span key={code}>
              <BalanceAmount value={data?.summary[code]?.end_balance ?? 0} currency={currencyLabel(code)} variant="card" />
              {index < totalCodes.length - 1 ? "," : ""}
            </span>
          ))}
        </div>
        <button type="button" onClick={() => setActOpen(true)} className="flex h-[34px] items-center gap-2 rounded px-4 font-semibold text-white" style={{ background: "#71ce87" }}>
          <FileSpreadsheet className="h-[18px] w-[18px]" /> {t("Скачать акт сверки")}
        </button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 px-6 py-3">
        <label className={`${fieldLabel} min-w-[200px]`}>
          {t("Валюта")}
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value)
              setPaging((value) => ({ ...value, page: 1 }))
            }}
            className={fieldInput}
          >
            <option value="">{t("Все")}</option>
            {(currencyInfo?.currencies ?? data?.currencies ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <BalancePagination page={paging.page} pageSize={paging.pageSize} count={data?.count ?? 0} onChange={setPaging} />
      </div>

      <div className={`max-h-[445px] overflow-y-auto px-6 pb-6 ${loading && data ? "opacity-60" : ""}`}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[#efefef] text-left font-semibold text-[#333]">
              <th className="w-1/3 px-2 py-3">{t("Дата")}</th>
              <th className="w-1/3 px-2 py-3">{t("Описание")}</th>
              <th className="px-2 py-3">{t("Сумма")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.id} className="border-b border-dotted border-[#dbe0e8]">
                <td className="px-2 py-3.5 whitespace-nowrap">{formatStatementDate(row.date, language)}</td>
                <td className="px-2 py-3.5">
                  <BranchStatementDescription row={row} />
                </td>
                <td className="px-2 py-3.5">
                  <BalanceAmount value={row.amount} currency={currencyLabel(row.currency)} variant="card" />
                </td>
              </tr>
            ))}
            {!data?.rows.length && (
              <tr>
                <td colSpan={3} className="px-2 py-16 text-center font-semibold text-[#666]">
                  {error ? (
                    <span className="flex flex-col items-center gap-2 text-[#e57373]">
                      {t(error)}
                      <button type="button" onClick={reload} className="text-[#4f70e7] hover:underline">
                        {t("Повторить")}
                      </button>
                    </span>
                  ) : loading ? (
                    t("Загрузка...")
                  ) : (
                    t("Пока транзакции нет")
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {actOpen && <ActDownloadDialog entityKey={entityKey} name={title} currency={currency} onClose={() => setActOpen(false)} />}
    </DialogFrame>
  )
}
