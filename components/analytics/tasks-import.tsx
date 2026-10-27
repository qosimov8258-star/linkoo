"use client"

import { useEffect, useState } from "react"

import { RefImportDialog } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { translate } from "@/lib/i18n/translate"
import { LANGUAGES, type LanguageCode } from "@/lib/i18n/types"
import { TASK_IMPORT_MAX_ROWS, TASK_STATUSES, TASK_STATUS_LABELS, textKey, type TaskListItem, type TaskListResponse } from "./tasks-data"

// "Импортировать" → "ИМПОРТ С EXCEL": "1. Скачать шаблон" downloads the current list (with its
// filters) as .xlsx, which is also the import template; the chosen file is sent to
// POST /api/tasks/import (every row or none; a refused row is named by its number).

type Feedback = { text: string; tone: "success" | "error" }

/** Russian keys of the columns, in the template's order. */
const COLUMNS = [
  { key: "№", field: "id" },
  { key: "Описание", field: "title" },
  { key: "Клиент", field: "client" },
  { key: "Ответственный", field: "responsible" },
  { key: "Дата задачи", field: "taskDate" },
  { key: "Статус", field: "status" },
  { key: "Создал", field: "createdBy" },
  { key: "Дата создания", field: "createdAt" },
] as const

/** More header spellings people use for the same columns. */
const EXTRA_HEADERS: Record<string, string> = {
  "Магазин": "client",
  "Ответственный пользователь": "responsible",
  "Дата": "taskDate",
  "Задача": "title",
}

/** Header text (every UI language) → field. */
function headerAliases(): Record<string, string> {
  const aliases: Record<string, string> = {}
  const add = (text: string, field: string) => {
    const key = normalizeHeader(text)
    if (key && !aliases[key]) aliases[key] = field
  }
  for (const language of LANGUAGES) {
    for (const column of COLUMNS) add(translate(language, column.key), column.field)
    for (const [text, field] of Object.entries(EXTRA_HEADERS)) add(translate(language, text), field)
  }
  for (const column of COLUMNS) add(column.field, column.field)
  return aliases
}

/** Status label in any UI language (or the key itself) → status. */
function statusOf(text: string): string {
  const key = textKey(text)
  if (!key) return ""
  for (const status of TASK_STATUSES) {
    if (key === status) return status
    for (const language of LANGUAGES as LanguageCode[]) {
      if (textKey(translate(language, TASK_STATUS_LABELS[status])) === key) return status
    }
  }
  if (key === textKey("Завершенный")) return "finished"
  return text.trim()
}

/** An Excel serial day (46238) → "YYYY-MM-DD"; anything else stays as typed. */
function excelDay(text: string): string {
  if (!/^\d{5}(\.\d+)?$/.test(text)) return text
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000)
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10)
}

/** Every task of the current filter (pages of 2000). */
async function fetchAll(query: URLSearchParams): Promise<TaskListItem[]> {
  const rows: TaskListItem[] = []
  for (let page = 1; page <= 100; page++) {
    const params = new URLSearchParams(query)
    params.set("page", String(page))
    params.set("pageSize", "2000")
    const response = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" })
    if (!response.ok) throw new Error("Не удалось загрузить задачи")
    const data = (await response.json()) as TaskListResponse
    rows.push(...data.results)
    if (rows.length >= data.count || data.results.length === 0) break
  }
  return rows
}

export function TasksImportDialog({
  query,
  onClose,
  onImported,
  onNotify,
}: {
  /** The list's current API filter (status, search, …). */
  query: URLSearchParams
  onClose: () => void
  onImported: () => void
  onNotify: (message: Feedback) => void
}) {
  const { t, language } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, saving])

  async function downloadTemplate() {
    if (exporting) return
    setExporting(true)
    try {
      const rows = await fetchAll(query)
      downloadExcelTable(t("Задачи"), [
        COLUMNS.map((column) => t(column.key)),
        ...rows.map((task) => [
          task.id,
          task.title,
          task.client,
          task.responsible,
          task.taskDate,
          t(TASK_STATUS_LABELS[task.status]),
          task.createdBy,
          task.createdAt ? formatDateText(task.createdAt, language, { withTime: true, utc: true }) : "",
        ]),
      ])
    } catch {
      onNotify({ text: "Не удалось загрузить задачи", tone: "error" })
    } finally {
      setExporting(false)
    }
  }

  async function save() {
    if (!file || saving) return
    setSaving(true)
    try {
      const sheet = await readExcelRows(file)
      const fieldByIndex = mapHeaderColumns(sheet[0] ?? [], headerAliases())
      const fields = new Set(fieldByIndex.values())
      const hasHeader = fields.has("title") || fields.has("client") || fields.has("responsible")
      // A sheet without a header: Описание | Клиент | Ответственный | Дата задачи | Статус.
      const order = ["title", "client", "responsible", "taskDate", "status"]
      const start = hasHeader ? 1 : 0
      const rows: { line: number; title: string; client: string; responsible: string; taskDate: string; status: string }[] = []
      sheet.slice(start).forEach((cells, index) => {
        const record: Record<string, string> = {}
        cells.forEach((cell, column) => {
          const field = hasHeader ? fieldByIndex.get(column) : order[column]
          if (field && !(field in record)) record[field] = cell
        })
        if (![record.title, record.client, record.responsible, record.taskDate].some((value) => (value ?? "").trim())) return
        rows.push({
          line: start + index + 1,
          title: (record.title ?? "").trim(),
          client: (record.client ?? "").trim(),
          responsible: (record.responsible ?? "").trim(),
          taskDate: excelDay((record.taskDate ?? "").trim()),
          status: statusOf(record.status ?? ""),
        })
      })
      if (!rows.length) {
        onNotify({ text: "Не удалось найти задачи для импорта в выбранном файле", tone: "error" })
        return
      }
      if (rows.length > TASK_IMPORT_MAX_ROWS) {
        onNotify({ text: "Слишком много строк", tone: "error" })
        return
      }
      const response = await fetch("/api/tasks/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) })
      const data = (await response.json().catch(() => ({}))) as { created?: number; error?: string; row?: number }
      if (!response.ok) {
        const message = response.status === 403 ? t("Недостаточно прав") : t(data.error || "Не удалось импортировать задачи")
        onNotify({ text: data.row ? `${t("Строка")} ${data.row}: ${message}` : message, tone: "error" })
        return
      }
      onNotify({ text: `${t("Импортировано задач")}: ${data.created ?? rows.length}`, tone: "success" })
      onImported()
    } catch {
      onNotify({ text: "Сервер недоступен, попробуйте ещё раз", tone: "error" })
    } finally {
      setSaving(false)
    }
  }

  return <RefImportDialog file={file} onFile={setFile} onTemplate={() => void downloadTemplate()} onSave={() => void save()} onClose={onClose} saving={saving || exporting} />
}

