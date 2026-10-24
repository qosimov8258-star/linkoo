"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Loader2, Trash2, X } from "lucide-react"

import { actExcelRows, BalanceActTable, describeStatementRow, paymentTypeLabel, StatementComment, type ActColumn } from "@/components/analytics/balance/act-table"
import { BalanceAmount } from "@/components/analytics/balance/amount"
import { useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { formatStatementDate, nowLocalIso } from "@/lib/finance/dates"
import type { FinanceCurrency, OrganizationBalance } from "@/lib/finance/types"
import type { DelivererDebtsOptions } from "@/lib/finance-deliverer-debts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "Долги доставщиков":
// - DelivererCorrectionDialog — demo "КОРРЕКТИРОВКА" (module 5064): the
//   deliverer's balance strip per organization (нал. / переч.) and the form
//   Тип оплаты · Валюта · Сумма · Организация · Дата создания · Создал ·
//   Комментарий · "Прочие приходы" → POST /api/balances/deliverer-debts/corrections;
// - DelivererActDialog — demo "Информация по балансу доставщика" (module 5065):
//   per-organization cash / bank balances, own period, "Скачать отчет" /
//   "Скачать акт сверки" and the act (GET /api/balances/deliverer/statement).

const openModals: object[] = []

function Modal({ title, width, onClose, children, footer }: { title: ReactNode; width: number; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    // Escape closes only the topmost dialog (act → correction).
    const token = {}
    openModals.push(token)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openModals[openModals.length - 1] === token) closeRef.current()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      openModals.splice(openModals.indexOf(token), 1)
    }
  }, [])
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-10" onClick={onClose}>
      <div className="w-full rounded-md bg-white shadow-2xl" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-[#efefef] pl-7 pr-3">
          <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-[#f2f5f8]">
            <X className="h-5 w-5" />
          </button>
        </header>
        {children}
        {footer && <footer className="flex items-center justify-end gap-3 border-t border-[#efefef] px-7 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

/** Demo normalizeNumber: thousands separated by spaces, comma → dot, optional leading minus. */
function formatAmountInput(raw: string): string {
  let text = raw.replace(/\s/g, "").replace(/,/g, ".")
  const negative = text.startsWith("-")
  text = text.replace(/[^\d.]/g, "")
  const [integer, ...rest] = text.split(".")
  const fraction = rest.length ? `.${rest.join("").slice(0, 3)}` : ""
  return `${negative ? "-" : ""}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction}`
}

function parseAmountInput(text: string): number {
  const value = Number(text.replace(/\s/g, ""))
  return Number.isFinite(value) ? value : NaN
}

/** "<organization> нал.: 1 000 SUM" lines of the strip (demo: division × cash / bank). */
function OrganizationStrip({ organizations, compact = false }: { organizations: OrganizationBalance[]; compact?: boolean }) {
  const { t } = useLanguage()
  // Demo order: organizations with a balance first.
  const sorted = [...organizations].sort((a, b) => Number(!b.paymentTypes.some((part) => part.amount)) - Number(!a.paymentTypes.some((part) => part.amount)))
  if (compact) {
    const lines = sorted.flatMap((item) =>
      item.paymentTypes.filter((part) => part.amount).map((part) => ({ key: `${item.organization}-${part.paymentType}-${part.currency}`, organization: item.organization, ...part })),
    )
    if (!lines.length) return null
    return (
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 px-7 pb-2">
        {lines.map((line) => (
          <div key={line.key} className="flex items-center gap-2 text-[13px]">
            <span>
              {line.organization || t("Не указано")} {line.paymentType === "bank" ? t("Переч.") : line.paymentType === "cash" ? t("Нал.") : ""}
            </span>
            <BalanceAmount value={line.amount} currency={currencyLabel(line.currency)} variant="card" />
          </div>
        ))}
      </div>
    )
  }
  if (!sorted.length) return null
  return (
    <div className="flex gap-0 overflow-x-auto px-7 py-3">
      {sorted.map((item) => {
        const groups = [
          { label: "Наличными", parts: item.paymentTypes.filter((part) => part.paymentType === "cash" && part.amount) },
          { label: "Перечислением", parts: item.paymentTypes.filter((part) => part.paymentType === "bank" && part.amount) },
          { label: "Не указано", parts: item.paymentTypes.filter((part) => part.paymentType !== "cash" && part.paymentType !== "bank" && part.amount) },
        ].filter((group) => group.parts.length)
        return (
          <div key={item.organization || "-"} className="mr-5 border-r border-[#efefef] pr-5 text-[13px] last:border-r-0">
            <div className="mb-1 font-semibold">{item.organization || t("Не указано")}</div>
            {groups.map((group) => (
              <div key={group.label} className="whitespace-nowrap leading-6">
                <i>{t(group.label)}:</i>{" "}
                {group.parts.map((part, index) => (
                  <span key={part.currency}>
                    {index > 0 && ", "}
                    <BalanceAmount value={part.amount} currency={currencyLabel(part.currency)} variant="card" />
                  </span>
                ))}
              </div>
            ))}
            {!groups.length && <div className="leading-6 text-[#9aa3b6]">0</div>}
          </div>
        )
      })}
    </div>
  )
}

type FieldErrors = Partial<Record<"currency" | "amount" | "date" | "form", string>>

const fieldClass = "mt-1 block w-full border-b border-[#dbe0e8] bg-transparent pb-1.5 text-[15px] font-semibold text-[#17233b] outline-none focus:border-[#4f70e7]"

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <label className="relative mt-4 block text-[13px] font-medium text-[#586174]">
      {t(label)}
      {children}
      {error && <p className="mt-1 text-[12px] font-medium text-[#e57373]">{t(error)}</p>}
    </label>
  )
}

export function DelivererCorrectionDialog({
  employeeId,
  name,
  from,
  to,
  currencies,
  options,
  onClose,
  onSaved,
}: {
  employeeId: number
  name: string
  /** Page period (the balance strip). */
  from: string
  to: string
  currencies: FinanceCurrency[]
  options: DelivererDebtsOptions | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const statement = useBalanceStatement("deliverer", String(employeeId), { from, to, withOrganizations: true, pageSize: 1 })
  const [paymentType, setPaymentType] = useState<"" | "cash" | "bank">("")
  const [currency, setCurrency] = useState("")
  const [amount, setAmount] = useState("")
  const [organization, setOrganization] = useState("")
  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [createdBy, setCreatedBy] = useState("")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const user = createdBy || options?.currentUser || ""
  const users = options?.users ?? []

  const save = async () => {
    const value = parseAmountInput(amount)
    const next: FieldErrors = {}
    if (!currency) next.currency = "Обязательное поле"
    if (!amount.trim()) next.amount = "Обязательное поле"
    else if (!Number.isFinite(value) || value === 0) next.amount = "Введите сумму"
    if (!date) next.date = "Обязательное поле"
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const response = await fetch("/api/balances/deliverer-debts/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, currency, amount: value, paymentType, organization, date, createdBy: user, comment: comment.trim() }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; details?: { fieldErrors?: Record<string, string[] | undefined> } } | null
        const message = body?.error || `HTTP ${response.status}`
        const fields = body?.details?.fieldErrors ?? {}
        if (message === "Валюта не найдена" || fields.currency?.length) setErrors({ currency: message })
        else if (fields.amount?.length) setErrors({ amount: "Введите сумму" })
        else if (fields.date?.length) setErrors({ date: message })
        else setErrors({ form: message })
        return
      }
      onSaved()
    } catch {
      setErrors({ form: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("КОРРЕКТИРОВКА")}
      width={500}
      onClose={onClose}
      footer={
        <button type="button" onClick={save} disabled={saving} className="font-bold uppercase tracking-wide text-[#129fdd] disabled:opacity-50">
          {saving ? t("Сохранение...") : t("Сохранить")}
        </button>
      }
    >
      <div className="px-7 py-3 text-[13px]">
        {t("Доставщик")}: <strong>{name}</strong>
      </div>
      {statement.data?.organizations && <OrganizationStrip organizations={statement.data.organizations} compact />}
      <div className="px-7 pb-5">
        <Field label="Тип оплаты">
          <select value={paymentType} onChange={(event) => setPaymentType(event.target.value as "" | "cash" | "bank")} className={`${fieldClass} appearance-none pr-6`}>
            <option value="">—</option>
            <option value="cash">{t("Наличные")}</option>
            <option value="bank">{t("Перечисление")}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
        </Field>
        <Field label="Валюта" error={errors.currency}>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={`${fieldClass} appearance-none pr-6`}>
            <option value="">—</option>
            {currencies.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
        </Field>
        <Field label="Сумма" error={errors.amount}>
          <input value={amount} onChange={(event) => setAmount(formatAmountInput(event.target.value))} inputMode="decimal" placeholder="0" className={fieldClass} />
        </Field>
        <Field label="Организация">
          <select value={organization} onChange={(event) => setOrganization(event.target.value)} className={`${fieldClass} appearance-none pr-6`}>
            <option value="">—</option>
            {(options?.organizations ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
        </Field>
        <Field label="Дата создания" error={errors.date}>
          <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
        </Field>
        <Field label="Создал">
          <select value={user} onChange={(event) => setCreatedBy(event.target.value)} className={`${fieldClass} appearance-none pr-6`}>
            {!users.includes(user) && <option value={user}>{user || "—"}</option>}
            {users.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
        </Field>
        <label className="mt-4 block text-[13px] font-medium text-[#586174]">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={1}
            placeholder={`${t("Комментарий")}...`}
            className="block max-h-[80px] w-full resize-y border-b border-[#dbe0e8] bg-transparent pb-1.5 text-[14px] text-[#17233b] outline-none focus:border-[#4f70e7]"
          />
        </label>
        <label className="mt-4 flex items-center gap-2 text-[13px] text-[#17233b]">
          <input type="radio" checked readOnly className="h-4 w-4 accent-[#4f70e7]" />
          {t("Прочие приходы")}
        </label>
        {errors.form && <p className="mt-3 text-[13px] font-medium text-[#e57373]">{t(errors.form)}</p>}
      </div>
    </Modal>
  )
}

export function DelivererActDialog({
  entityKey,
  name,
  from: initialFrom,
  to: initialTo,
  canEdit,
  onClose,
  onChanged,
}: {
  /** BalanceRow.key of the deliverer (employee id, "name:…" or "none"). */
  entityKey: string
  name: string
  from: string
  to: string
  canEdit: boolean
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const { t, language } = useLanguage()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState("")
  const { data, loading, error: loadError, reload } = useBalanceStatement("deliverer", entityKey, { from, to, withOrganizations: true })
  const title = data?.entity.name || name || t("Не указано")

  const remove = async (id: number) => {
    if (!(await askDelete())) return
    setDeleting(id)
    setError("")
    try {
      const response = await fetch(`/api/balances/deliverer-debts/corrections/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error || `HTTP ${response.status}`)
        return
      }
      reload()
      onChanged("Успешно удалено")
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setDeleting(null)
    }
  }

  const columns: ActColumn[] = [
    { label: "Комментарий", render: (row) => <StatementComment row={row} />, excel: (row) => describeStatementRow(row, t) },
    { label: "Клиент", render: (row) => row.counterparty, excel: (row) => row.counterparty },
    { label: "Организация", render: (row) => row.organization, excel: (row) => row.organization },
    { label: "Тип оплаты", render: (row) => t(paymentTypeLabel(row.paymentType)), excel: (row) => t(paymentTypeLabel(row.paymentType)) },
  ]
  if (canEdit) {
    columns.push({
      label: "",
      render: (row) =>
        row.editable && row.source === "deliverer_manual" && row.sourceId ? (
          <button type="button" onClick={() => remove(row.sourceId!)} disabled={deleting !== null} aria-label={t("Удалить")} title={t("Удалить")} className="text-[#9aa3b6] hover:text-[#e57373] disabled:opacity-50">
            {deleting === row.sourceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        ) : null,
    })
  }
  const excelColumns = columns.filter((column) => column.label)
  const fileName = `${title} ${from} - ${to}`

  // "Скачать отчет" (demo DELIVERY_BALANCE_EXPORT): the deliverer's movements of the period as a flat list.
  const downloadReport = () => {
    if (!data) return
    const rows: Array<Array<string | number>> = [[t("Дата"), t("Тип"), t("Клиент"), t("Сумма"), t("Валюта"), t("Организация"), t("Тип оплаты"), t("Комментарий")]]
    for (const row of data.rows) {
      rows.push([
        formatStatementDate(row.date, language),
        `${t(row.title)}${row.docNumber ? ` № ${row.docNumber}` : ""}`,
        row.counterparty,
        row.amount,
        currencyLabel(row.currency),
        row.organization,
        t(paymentTypeLabel(row.paymentType)),
        [row.description, row.comment].filter(Boolean).join(", "),
      ])
    }
    downloadExcelTable(`${t("Доставки")} ${fileName}`, rows)
  }

  const buttonClass = "flex h-[34px] items-center gap-2 rounded-sm bg-[#71ce87] px-3 text-[13px] font-semibold text-white hover:bg-[#5fbf76] disabled:opacity-50"

  return (
    <Modal title={`${t("Информация по балансу доставщика")}: ${title}`} width={1000} onClose={onClose}>
      <div className="border-b border-[#efefef]">
        {loading && !data ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#4f70e7]" />
          </div>
        ) : (
          data?.organizations && <OrganizationStrip organizations={data.organizations} />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-7 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-bold text-[#4f70e7]">
          <input type="date" value={from} max={to} onChange={(event) => event.target.value && setFrom(event.target.value)} className="h-8 bg-transparent outline-none" />
          <span>—</span>
          <input type="date" value={to} min={from} onChange={(event) => event.target.value && setTo(event.target.value)} className="h-8 bg-transparent outline-none" />
        </span>
        <div className="flex gap-2.5">
          <button type="button" onClick={downloadReport} disabled={!data} className={buttonClass}>
            {t("Скачать отчет")}
          </button>
          <button type="button" onClick={() => data && downloadExcelTable(`${t("Акт сверки")} ${fileName}`, actExcelRows(data, excelColumns, t, language))} disabled={!data} className={buttonClass}>
            {t("Скачать акт сверки")}
          </button>
        </div>
      </div>
      <div className={`px-7 pb-6 pt-3 ${loading ? "opacity-60" : ""}`}>
        {(loadError || error) && <p className="py-3 text-center text-[#e57373]">{t(loadError || error)}</p>}
        {data && <BalanceActTable statement={data} columns={columns} />}
      </div>
    </Modal>
  )
}
