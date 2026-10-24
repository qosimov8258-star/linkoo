"use client"

import { FileText, Loader2, X } from "lucide-react"
import { ChangeEvent, useEffect, useRef, useState } from "react"

import type { SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { CASHBOXES_API, type CashboxErrorBody, type CashboxPayload, type CashboxUsage } from "./cashboxes-data"
import { cashboxRequestErrors } from "./cashboxes-form-modal"

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

// Keys are normalizeHeader() forms of the template titles in ru / uz / en / tk.
const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name", "nomi": "name", "ady": "name",
  "валюта": "currency", "currency": "currency", "valyuta": "currency", "waluta": "currency",
  "кассир": "cashier", "cashier": "cashier", "kassir": "cashier",
  "филиал": "branch", "branch": "branch", "filial": "branch", "ahama": "branch",
  "тип оплаты": "paymentType", "тип": "paymentType", "payment type": "paymentType", "tolov turi": "paymentType", "tleg grnui": "paymentType",
  "вэнсел": "vansell", "вансел": "vansell", "van sell": "vansell", "vansell": "vansell", "vansale": "vansell", "vensel": "vansell", "wensel": "vansell",
  "порядковый номер": "orderNumber", "position": "orderNumber", "sequence number": "orderNumber", "tartib raqami": "orderNumber", "tertip belgisi": "orderNumber",
}

const COLUMN_ORDER = ["name", "currency", "cashier", "branch", "paymentType", "vansell", "orderNumber"] as const
const TRUE_VALUES = /^(да|yes|true|1|\+|ha|hawa|есть)$/i

export function CashboxImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (notice: SnackbarMessage) => void }) {
  const { t } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function downloadTemplate() {
    downloadExcelTable("cashboxes-template", [
      [t("Наименование"), t("Валюта"), t("Кассир"), t("Филиал"), t("Тип оплаты"), t("Вэнсел"), t("Порядковый номер")],
      ["Naqd", "SUM", "", "", t("наличный"), t("Нет"), "1"],
    ])
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
  }

  async function save() {
    if (!file || saving) return
    setSaving(true)
    try {
      const rows = await readExcelRows(file)
      const fieldByIndex = rows.length ? mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES) : new Map<number, string>()
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const parsed: CashboxPayload[] = []
      for (const row of hasHeader ? rows.slice(1) : rows) {
        const record: Record<string, string> = {}
        row.forEach((cell, index) => {
          const field = hasHeader ? fieldByIndex.get(index) : COLUMN_ORDER[index]
          if (field) record[field] = String(cell ?? "").trim()
        })
        if (!record.name) continue
        parsed.push({
          name: record.name,
          currency: record.currency ?? "",
          cashier: record.cashier ?? "",
          branch: record.branch ?? "",
          paymentType: record.paymentType ?? "",
          vansell: TRUE_VALUES.test(record.vansell ?? ""),
          // Empty = "Не указано" (stored as 0, listed last).
          orderNumber: record.orderNumber || "0",
        })
      }
      if (!parsed.length) {
        onImported({ text: t("Не удалось найти данные для импорта в выбранном файле"), tone: "error" })
        return
      }
      let created = 0
      const failures: string[] = []
      for (const item of parsed) {
        try {
          const response = await fetch(CASHBOXES_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) })
          if (response.ok) {
            created += 1
            continue
          }
          const errors = cashboxRequestErrors((await response.json().catch(() => ({}))) as CashboxErrorBody, "Не удалось сохранить кассу")
          const [field, message] = Object.entries(errors.fields)[0] ?? []
          failures.push(`${item.name} — ${message ? `${t(FIELD_LABELS[field ?? ""] ?? "")}: ${t(message)}` : t(errors.general)}`)
        } catch {
          failures.push(`${item.name} — ${t("Сервер недоступен, попробуйте ещё раз")}`)
        }
      }
      const summary = `${t("Импортировано")} ${created} ${t("из")} ${parsed.length}`
      onImported(
        failures.length
          ? { text: `${summary}. ${t("Не удалось сохранить")}: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? "…" : ""}`, tone: "error" }
          : { text: summary, tone: "success" },
      )
    } catch {
      onImported({ text: t("Не удалось прочитать файл"), tone: "error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-md rounded bg-white">
        <header className="flex items-center justify-between border-b p-6">
          <b className="uppercase">{t("Импорт с Excel")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="p-8">
          <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
            1. {t("Скачать шаблон")}
          </button>
          <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickFile} className="hidden" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
          >
            <FileText className="h-8 w-8" />
            {file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}
          </button>
        </div>
        <footer className="flex justify-end border-t p-5">
          <button type="button" disabled={!file || saving} onClick={save} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
            {saving ? t("Импорт...") : t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Column titles of the import failures ("Кассир: Сотрудник не найден"). */
const FIELD_LABELS: Record<string, string> = {
  name: "Наименование",
  currency: "Валюта",
  cashier: "Кассир",
  branch: "Филиал",
  paymentType: "Тип оплаты",
  orderNumber: "Порядковый номер",
}
