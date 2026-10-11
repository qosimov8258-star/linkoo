"use client"

import { useMemo, useState } from "react"
import { Download, FileSpreadsheet, X } from "lucide-react"

import { balanceColor } from "@/components/analytics/balance/amount"
import { buildBalanceQuery, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { postJson } from "@/components/analytics/store-reconciliation-dialogs"
import { Field, fieldClass } from "@/components/analytics/store-reconciliation-filters"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import type { BalanceDateMode } from "@/lib/finance/types"
import {
  TEMPLATE_HEADERS,
  type DebtImportLine,
  type DebtImportResult,
  type DebtTemplateResult,
  type StoreReconciliationOptions,
} from "@/lib/finance-store-reconciliation-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Установить долг с Excel" (demo 2315 "Импорт с Excel" + 373): Долг на дату,
// Валюта, Организация, "Разделить по типу оплаты", "1. Скачать шаблон" (the
// filtered clients with their balance on that day) and the file. The upload is
// previewed (current / new balance / difference per line) before "Сохранить"
// writes the corrections that make each balance equal the uploaded amount.

type TemplateField = keyof typeof TEMPLATE_HEADERS

const STATE_LABELS: Record<string, string> = {
  change: "Будет изменен",
  same: "Без изменений",
  skip: "Пропущено",
  error: "Ошибка",
}

export function DebtImportDialog({
  open,
  options,
  listQuery,
  initialDate,
  mode,
  onClose,
  onImported,
}: {
  open: boolean
  options: StoreReconciliationOptions | null
  /** Current list filters: the template lists the same clients. */
  listQuery: BalanceQuery
  initialDate: string
  mode: BalanceDateMode
  onClose: () => void
  onImported: (corrections: number) => void
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({ debtDate: initialDate || todayIso(), currency: "", organizations: [] as string[], byPaymentType: false })
  const [touched, setTouched] = useState(false)
  const [file, setFile] = useState<{ name: string; lines: DebtImportLine[] } | null>(null)
  const [preview, setPreview] = useState<DebtImportResult | null>(null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm({ debtDate: initialDate || todayIso(), currency: options?.baseCurrency ?? "", organizations: [], byPaymentType: false })
      setTouched(false)
      setFile(null)
      setPreview(null)
      setError("")
    }
  }
  const currency = form.currency || options?.baseCurrency || ""

  // Header aliases in Russian, the UI language and English.
  const aliases = useMemo(() => {
    const out: Record<string, TemplateField> = {}
    const english: Record<TemplateField, string[]> = {
      id: ["id", "client id"],
      name: ["client", "name", "mijoz"],
      organization: ["organization", "tashkilot"],
      amount: ["amount", "sum", "debt", "miqdori"],
      cash: ["cash", "naqd"],
      bank: ["bank", "transfer", "o tkazma", "otkazma"],
    }
    for (const [field, label] of Object.entries(TEMPLATE_HEADERS) as Array<[TemplateField, string]>) {
      for (const text of [label, t(label), ...english[field]]) {
        const key = normalizeHeader(text)
        if (key && !out[key]) out[key] = field
      }
    }
    return out
  }, [t])

  if (!open) return null

  const missingDate = !form.debtDate
  const missingCurrency = !currency
  const reset = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }))
    setPreview(null)
  }

  const downloadTemplate = async () => {
    setTouched(true)
    if (missingDate || missingCurrency) return
    setBusy("template")
    setError("")
    try {
      const query = buildBalanceQuery({
        ...listQuery,
        page: undefined,
        pageSize: undefined,
        templateDate: form.debtDate,
        currency,
        templateOrganization: form.organizations,
        byPaymentType: form.byPaymentType,
      })
      const response = await fetch(`/api/store-reconciliation/template?${query}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (DebtTemplateResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(`${t("Установить долг с Excel")} ${body.debtDate} ${currencyLabel(body.currency)}`, [body.header.map((label) => t(label)), ...body.rows])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy("")
    }
  }

  const send = async (lines: DebtImportLine[], name: string, commit: boolean) => {
    setBusy(commit ? "commit" : "preview")
    setError("")
    try {
      const result = await postJson<DebtImportResult>("/api/store-reconciliation/import", {
        debtDate: form.debtDate,
        currency,
        organizations: form.organizations,
        byPaymentType: form.byPaymentType,
        mode,
        fileName: name,
        rows: lines,
        commit,
      })
      if (commit) {
        onImported(result.corrections)
        onClose()
      } else setPreview(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy("")
    }
  }

  const readFile = async (selected: File | undefined) => {
    setPreview(null)
    setFile(null)
    setError("")
    if (!selected) return
    setTouched(true)
    let rows = await readExcelRows(selected)
    let headerIndex = rows.findIndex((row) => mapHeaderColumns(row, aliases).size >= 2)
    if (headerIndex < 0 && /\.csv$/i.test(selected.name)) {
      // A UTF-8 .csv without BOM is decoded as Latin-1 by the sheet reader: read it as text.
      const text = (await selected.text()).replace(/^﻿/, "")
      const delimiter = (text.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ";" : ","
      rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) => line.split(delimiter).map((value) => value.trim().replace(/^"(.*)"$/, "$1")))
      headerIndex = rows.findIndex((row) => mapHeaderColumns(row, aliases).size >= 2)
    }
    if (headerIndex < 0) {
      setError(t("Не найдены столбцы шаблона"))
      return
    }
    const columns = mapHeaderColumns(rows[headerIndex], aliases)
    const cell = (row: string[], field: TemplateField) => {
      for (const [index, name] of columns) if (name === field) return row[index] ?? ""
      return ""
    }
    const lines: DebtImportLine[] = rows
      .map((row, index) => ({ row, line: index + 1 }))
      .filter(({ row, line }) => line > headerIndex + 1 && row.some((value) => value !== ""))
      .map(({ row, line }) => ({
        line,
        id: cell(row, "id"),
        name: cell(row, "name"),
        organization: cell(row, "organization"),
        amount: cell(row, "amount"),
        cash: cell(row, "cash"),
        bank: cell(row, "bank"),
      }))
    if (!lines.length) {
      setError(t("Файл пустой"))
      return
    }
    setFile({ name: selected.name, lines })
    if (!missingDate && !missingCurrency) await send(lines, selected.name, false)
  }

  const canSave = Boolean(file && preview && !preview.errors && preview.changed > 0 && !busy)
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? (
      "—"
    ) : (
      <span className="font-semibold" style={{ color: balanceColor(value, "card") }}>
        {formatMoney(value)}
      </span>
    )

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={onClose}>
      <div className={`w-full rounded-lg bg-white shadow-xl ${preview ? "max-w-[1100px]" : "max-w-[440px]"}`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#efefef] px-6 py-4">
          <h2 className="text-[15px] font-bold text-[#333]">{t("Импорт с Excel")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={`grid gap-6 px-6 py-5 ${preview ? "lg:grid-cols-[380px_1fr]" : ""}`}>
          <div className="flex flex-col gap-4">
            <Field label="Долг на дату">
              <input type="date" value={form.debtDate} onChange={(event) => reset({ debtDate: event.target.value })} className={fieldClass} />
              {touched && missingDate && <span className="text-[12px] text-[#e57373]">{t("Долг на дату не выбран")}</span>}
            </Field>
            <Field label="Валюта">
              <select value={currency} onChange={(event) => reset({ currency: event.target.value })} className={fieldClass}>
                <option value="">{t("Выберите")}</option>
                {(options?.currencies ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
              {touched && missingCurrency && <span className="text-[12px] text-[#e57373]">{t("Валюта не выбран")}</span>}
            </Field>
            <Field label="Организация">
              <MultiSelect value={form.organizations} options={(options?.organizations ?? []).map((name) => ({ value: name, label: name }))} onChange={(value) => reset({ organizations: value })} />
              <span className="text-[12px] text-[#9aa3b6]">{t("Без организации долг устанавливается по всем организациям")}</span>
            </Field>
            <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
              <input type="checkbox" checked={form.byPaymentType} onChange={(event) => reset({ byPaymentType: event.target.checked })} className="h-4 w-4 accent-[#4f70e7]" />
              {t("Разделить по типу оплаты")}
            </label>
            <p className="text-[12px] text-[#586174]">{t("Сумма как на странице: долг клиента — отрицательное число")}</p>
            <div className="flex flex-col gap-2 border border-[#efefef] p-2">
              <button type="button" disabled={busy === "template"} onClick={() => void downloadTemplate()} className="flex h-9 items-center justify-center gap-2 font-semibold text-[rgb(129,199,132)] disabled:opacity-60">
                <Download className="h-4 w-4" /> 1. {t("Скачать шаблон")}
              </button>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#dbe0e8] px-3 py-2 text-[13px] text-[#586174]">
                <FileSpreadsheet className="h-4 w-4" />
                <span className="truncate">{file ? file.name : `2. ${t("Выберите файл")}`}</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void readFile(event.target.files?.[0])} />
              </label>
              {file && !preview && !busy && (
                <button type="button" onClick={() => void send(file.lines, file.name, false)} className="h-9 rounded-md border border-[#4f70e7] font-semibold text-[#4f70e7]">
                  {t("Проверить")}
                </button>
              )}
            </div>
            {busy === "preview" && <p className="text-[#586174]">{t("Загрузка...")}</p>}
            {error && <p className="text-[#e57373]">{t(error)}</p>}
          </div>

          {preview && (
            <div className="min-w-0">
              <p className="mb-3 text-[14px] text-[#17233b]">
                {t("Будет изменен")}: <strong>{preview.changed}</strong> · {t("Без изменений")}: <strong>{preview.unchanged}</strong> · {t("Пропущено")}:{" "}
                <strong>{preview.skipped}</strong> · {t("Ошибка")}: <strong className={preview.errors ? "text-[#e57373]" : ""}>{preview.errors}</strong>
              </p>
              <div className="max-h-[460px] overflow-auto border border-[#efefef]">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 bg-[#4f71dc] text-white">
                    <tr>
                      <th className="px-3 py-2 text-left">№</th>
                      <th className="px-3 py-2 text-left">{t("Клиент")}</th>
                      {form.organizations.length > 0 && <th className="px-3 py-2 text-left">{t("Организация")}</th>}
                      <th className="px-3 py-2 text-left">{t("Текущий баланс")}</th>
                      <th className="px-3 py-2 text-left">{t("Новый баланс")}</th>
                      <th className="px-3 py-2 text-left">{t("Разница")}</th>
                      <th className="px-3 py-2 text-left">{t("Статус")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={row.line} style={{ background: index % 2 ? "#F4F8FB" : "#fff" }}>
                        <td className="border-b border-[#efefef] px-3 py-2">{row.line}</td>
                        <td className="border-b border-[#efefef] px-3 py-2">{row.name || "—"}</td>
                        {form.organizations.length > 0 && <td className="border-b border-[#efefef] px-3 py-2">{row.organization}</td>}
                        <td className="border-b border-[#efefef] px-3 py-2 whitespace-nowrap">
                          {row.current ? (
                            form.byPaymentType ? (
                              <>
                                {money(row.current.cash)} / {money(row.current.bank)}
                              </>
                            ) : (
                              money(row.current.total)
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="border-b border-[#efefef] px-3 py-2 whitespace-nowrap">
                          {row.current ? (
                            form.byPaymentType ? (
                              <>
                                {money(row.target.cash)} / {money(row.target.bank)}
                              </>
                            ) : (
                              money(row.target.total)
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="border-b border-[#efefef] px-3 py-2 whitespace-nowrap">{row.state === "change" ? money(row.delta.total) : "—"}</td>
                        <td className={`border-b border-[#efefef] px-3 py-2 ${row.state === "error" ? "text-[#e57373]" : row.state === "change" ? "font-semibold text-[#48a34b]" : "text-[#586174]"}`}>
                          {row.error ? t(row.error) : t(STATE_LABELS[row.state])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {form.byPaymentType && <p className="mt-2 text-[12px] text-[#586174]">{t("Наличные")} / {t("Перечисление")}</p>}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-[#efefef] px-6 py-4">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => file && void send(file.lines, file.name, true)}
            className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-50"
          >
            {busy === "commit" ? t("Загрузка...") : t("Сохранить")}
          </button>
        </div>
      </div>
    </div>
  )
}
