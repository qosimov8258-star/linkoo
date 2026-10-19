"use client"

import { FileText, Loader2, X } from "lucide-react"
import { ChangeEvent, useEffect, useRef, useState } from "react"

import type { CategoryErrorBody, CategoryUsage } from "@/lib/categories-schema"
import type { CategoryKind } from "@/lib/category-options"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { categoriesApi, categoryRequestErrors, type SavedCategory } from "./category-form-modal"
import { EXPENSE_CATEGORIES_API, type ExpenseCategory } from "./expense-categories-data"

// Dialogs of the "Категории приходов / расходов" pages: the delete confirm (demo
// ConfirmDialog type "delete": "Подтверждение удаления" + the category name; a refused
// delete shows "Удаление невозможно из-за связи с другими данными"), the Excel import
// kept from our earlier pages, and the snackbar ("Успешно сохранено" / "Успешно удалено").

export type CategoryNotice = { text: string; tone: "success" | "error" }

export function CategorySnackbar({ notice, onClose }: { notice: CategoryNotice | null; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(onClose, notice.tone === "error" ? 6000 : 3500)
    return () => window.clearTimeout(timer)
  }, [notice, onClose])
  if (!notice) return null
  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-[300] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-md px-5 py-3 text-[14px] font-medium text-white shadow-lg ${
        notice.tone === "success" ? "bg-[#323232]" : "bg-[#c94b4b]"
      }`}
    >
      {notice.text}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** "Касса (3), Дочерние категории (1)" in the UI language. */
export function categoryUsageText(usage: CategoryUsage[], t: (text: string) => string): string {
  return usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")
}

// --- delete confirm ----------------------------------------------------------------

export function CategoryDeleteDialog({
  kind,
  categoryId,
  name,
  onClose,
  onDeleted,
  onFailed,
}: {
  kind: CategoryKind
  categoryId: number
  /** Known name (grid row); otherwise read from GET /api/{kind}-categories/[id]. */
  name?: string
  onClose: () => void
  onDeleted: () => void
  /** Already translated message for the snackbar. */
  onFailed: (message: string) => void
}) {
  const { t } = useLanguage()
  const api = categoriesApi(kind)
  const [loadedName, setLoadedName] = useState("")
  const [loading, setLoading] = useState(!name)
  const [loadError, setLoadError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [blockedBy, setBlockedBy] = useState<CategoryUsage[] | null>(null)

  useEffect(() => {
    if (name) return
    const controller = new AbortController()
    fetch(`${api}/${categoryId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as SavedCategory & CategoryErrorBody
        if (!response.ok) throw new Error(data.error || "Категория не найдена")
        setLoadedName(data.name)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, categoryId, name])

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
      const response = await fetch(`${api}/${categoryId}`, { method: "DELETE" })
      if (response.ok) {
        onDeleted()
        return
      }
      const data = (await response.json().catch(() => ({}))) as CategoryErrorBody
      const usage = data.usage ?? []
      if (response.status === 409) setBlockedBy(usage)
      const base = t(response.status === 403 ? "Недостаточно прав" : data.error || "Удаление невозможно из-за связи с другими данными")
      onFailed(usage.length ? `${base}: ${categoryUsageText(usage, t)}` : base)
    } catch {
      onFailed(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setDeleting(false)
    }
  }

  const busy = loading || deleting
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-[500px] rounded bg-white shadow-2xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[14px] uppercase text-[#333]">{t("Подтверждение удаления")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[150px] px-[30px] text-[14px] text-[#333]">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <p className="py-5">{t("Вы уверены что хотите удалить эти данные?")}</p>
          {loadError ? (
            <p className="pb-5 text-[#f44336]">{t(loadError)}</p>
          ) : (
            <div className="-mx-[30px] break-words bg-[#f1f5f8] px-[30px] py-5 font-semibold">{name || loadedName}</div>
          )}
          {blockedBy && (
            <p className="py-5 text-[#f44336]">
              {t("Удаление невозможно из-за связи с другими данными")}
              {blockedBy.length > 0 && `: ${categoryUsageText(blockedBy, t)}`}
            </p>
          )}
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-[10px]">
          <button
            type="button"
            onClick={remove}
            disabled={busy || Boolean(loadError)}
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

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name", "nomi": "name",
  "параметры": "parameter", "параметр": "parameter", "дополнительные параметры": "parameter", "parameter": "parameter", "parameters": "parameter", "parametrlar": "parameter",
  "прочий приход": "otherIncome", "other income": "otherIncome", "boshqa tushum": "otherIncome",
  "родительская категория": "parentName", "род категория": "parentName", "родитель": "parentName", "parent category": "parentName", "parent": "parentName",
  "прямой расход на товар": "direct", "прямой расход": "direct", "внутренний расход": "direct", "direct expense": "direct",
  "не учитывать в отчёте p l": "excludeFromPnl", "не учитывать в отчете p l": "excludeFromPnl", "не учитывать в pnl": "excludeFromPnl", "exclude from p l": "excludeFromPnl",
}

/** Column order of the template (and of a file without a header row). */
const TEMPLATE_FIELDS: Record<CategoryKind, string[]> = {
  income: ["name", "parameter", "otherIncome"],
  expense: ["name", "parentName", "parameter", "direct", "excludeFromPnl"],
}

const TEMPLATE_HEADERS: Record<string, string> = {
  name: "Наименование",
  parameter: "Параметры",
  otherIncome: "Прочий приход (да/нет)",
  parentName: "Родительская категория",
  direct: "Прямой расход на товар (да/нет)",
  excludeFromPnl: "Не учитывать в отчёте P&L (да/нет)",
}

const TRUE_VALUES = /^(да|yes|true|1|\+|✓|ha|bor|прямой расход на товар)$/i

const nameKey = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()

export function CategoryImportDialog({ kind, onClose, onImported }: { kind: CategoryKind; onClose: () => void; onImported: (notice: CategoryNotice) => void }) {
  const { t } = useLanguage()
  const api = categoriesApi(kind)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function downloadTemplate() {
    downloadExcelTable(`${kind}-categories-template`, [TEMPLATE_FIELDS[kind].map((field) => t(TEMPLATE_HEADERS[field]))])
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
  }

  /** Parent names of the file are looked up among the existing expense categories and the rows created before. */
  async function parentIds(): Promise<Map<string, number>> {
    if (kind !== "expense") return new Map()
    const response = await fetch(EXPENSE_CATEGORIES_API, { cache: "no-store" })
    const list = response.ok ? ((await response.json()) as ExpenseCategory[]) : []
    return new Map(list.map((item) => [nameKey(item.name), item.id]))
  }

  async function save() {
    if (!file || saving) return
    setSaving(true)
    try {
      const rows = await readExcelRows(file)
      const fieldByIndex = rows.length ? mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES) : new Map<number, string>()
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      // Header cells we do not recognise (a template downloaded in another language) keep the template position.
      if (hasHeader) {
        const used = new Set(fieldByIndex.values())
        TEMPLATE_FIELDS[kind].forEach((field, index) => {
          if (!fieldByIndex.has(index) && !used.has(field)) fieldByIndex.set(index, field)
        })
      }
      const records: Array<Record<string, string>> = []
      for (const row of hasHeader ? rows.slice(1) : rows) {
        const record: Record<string, string> = {}
        row.forEach((cell, index) => {
          const field = hasHeader ? fieldByIndex.get(index) : TEMPLATE_FIELDS[kind][index]
          if (field) record[field] = String(cell ?? "").trim()
        })
        if (record.name) records.push(record)
      }
      if (!records.length) {
        onImported({ text: t("Не удалось найти данные для импорта в выбранном файле"), tone: "error" })
        return
      }
      const parents = await parentIds()
      let created = 0
      const failures: string[] = []
      for (const record of records) {
        let body: Record<string, unknown> = { name: record.name, parameter: record.parameter ?? "" }
        if (kind === "income") {
          body = { ...body, otherIncome: TRUE_VALUES.test(record.otherIncome ?? "") }
        } else {
          const parentName = record.parentName ?? ""
          const parentId = parentName ? parents.get(nameKey(parentName)) : null
          if (parentId === undefined) {
            failures.push(`${record.name} — ${t("Родительская категория не найдена")}`)
            continue
          }
          const direct = TRUE_VALUES.test(record.direct ?? "")
          body = { ...body, parentId, direct, excludeFromPnl: !direct && TRUE_VALUES.test(record.excludeFromPnl ?? "") }
        }
        try {
          const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          const data = (await response.json().catch(() => ({}))) as SavedCategory & CategoryErrorBody
          if (response.ok) {
            created += 1
            parents.set(nameKey(data.name), data.id)
          } else {
            const errors = categoryRequestErrors(data, "Не удалось сохранить категорию")
            failures.push(`${record.name} — ${t(errors.name || errors.options || errors.parentId || errors.general)}`)
          }
        } catch {
          failures.push(`${record.name} — ${t("Сервер недоступен, попробуйте ещё раз")}`)
        }
      }
      const summary = `${t("Импортировано")} ${created} ${t("из")} ${records.length}`
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
