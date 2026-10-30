"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { RefImportDialog } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { IMPORT_MAX_ROWS, readImportSheet, saveImportRows, type ImportColumn, type ImportRecord, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { useLanguage } from "@/lib/i18n/language-context"

// "Импорт с Excel" of the settings lists (rules: lib/excel-row-import.ts) in the reference's import dialog
// (1. Скачать шаблон + the file drop area + СОХРАНИТЬ). Row errors stay listed in the dialog with their line.

export type ExcelImportSpec<T> = {
  /** File name of the downloaded template. */
  templateName: string
  /** Template columns in order. */
  columns: readonly ImportColumn[]
  /** Column that marks the header row and must be filled in every data row. */
  keyField: string
  /** Checks every row (required fields, references, repeats) and builds the request bodies. */
  prepare: (records: ImportRecord[]) => Promise<{ rows: PreparedRow<T>[]; errors: ImportRowError[] }>
  /** The page's own create request for one row. */
  send: (item: T) => Promise<Response>
  /** Message for a refused row whose answer has no text. */
  fallbackError: string
  /** After each saved row (e.g. a created category becomes a parent for the next rows). */
  onRowSaved?: (row: PreparedRow<T>, body: unknown) => void
}

type Report = { error?: string; summary?: string; errors: ImportRowError[] }

const SHOWN_ERRORS = 50
const FILE_ICON = "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"

/**
 * The "Импорт с Excel" link next to a list's add link; `className` sets its height / padding to line up with that
 * link. `iconOnly` keeps just the file icon (hint = the label) where a long add label leaves no room before the search.
 */
export function ExcelImportLink({ onClick, className = "h-[36px] leading-[36px]", iconOnly = false }: { onClick: () => void; className?: string; iconOnly?: boolean }) {
  const { t } = useLanguage()
  const label = t("Импорт с Excel")
  return (
    <button
      type="button"
      onClick={onClick}
      title={iconOnly ? label : undefined}
      aria-label={iconOnly ? label : undefined}
      className={`flex shrink-0 items-center whitespace-nowrap text-[13px] text-[#4f71dc] hover:underline ${iconOnly ? "px-[8px]" : "px-[12px]"} ${className}`}
    >
      <svg viewBox="0 0 24 24" className={`h-[16px] w-[16px] shrink-0 fill-[#4f71dc] ${iconOnly ? "" : "mr-[4px]"}`} aria-hidden>
        <path d={FILE_ICON} />
      </svg>
      {!iconOnly && label}
    </button>
  )
}

export function ExcelRowImportDialog<T>({
  spec,
  onClose,
  onChanged,
  onDone,
}: {
  spec: ExcelImportSpec<T>
  onClose: () => void
  /** Some rows were saved: the page reloads its list. */
  onChanged: () => void
  /** Every row was saved: the page closes the dialog and shows the (translated) summary. */
  onDone: (summary: string) => void
}) {
  const { t } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  // Remounts the file input after each attempt, so the same (corrected) file can be picked again.
  const [attempt, setAttempt] = useState(0)
  const savingRef = useRef(false)

  // An import that is running finishes first: closing mid-way would hide which rows were saved.
  const close = useCallback(() => {
    if (!savingRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close])

  async function save() {
    if (!file || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setReport(null)
    try {
      const sheet = await readImportSheet(file, { columns: spec.columns, keyField: spec.keyField })
      if ("error" in sheet) {
        setReport({ error: sheet.error, errors: [] })
        return
      }
      // Rows refused while reading (above the header, unreadable text) and by the page's checks are listed together.
      const checked = await spec.prepare(sheet.records)
      const errors = [...sheet.errors, ...checked.errors]
      if (errors.length) {
        setReport({ error: "Ничего не сохранено: исправьте ошибки в файле", errors: errors.sort((a, b) => a.line - b.line) })
        return
      }
      const result = await saveImportRows(checked.rows, spec.send, spec.fallbackError, spec.onRowSaved)
      const summary = t("Импортировано {n} из {total}").replace("{n}", String(result.saved)).replace("{total}", String(checked.rows.length))
      if (result.saved) onChanged()
      if (!result.errors.length && !result.fatal) {
        onDone(summary)
        return
      }
      setReport({ error: result.fatal, summary, errors: result.errors })
    } catch {
      // The file itself is read without throwing (readImportSheet): this is a failed load of the reference lists.
      setReport({ error: "Не удалось загрузить данные", errors: [] })
    } finally {
      savingRef.current = false
      setSaving(false)
      setAttempt((value) => value + 1)
    }
  }

  const reportNode = report ? (
    <div role="alert" className="max-h-[160px] overflow-y-auto pr-[4px] leading-[18px]">
      {report.error && <p className="font-semibold">{t(report.error).replace("{n}", String(IMPORT_MAX_ROWS))}</p>}
      {report.summary && <p className="font-semibold">{report.summary}</p>}
      {report.errors.slice(0, SHOWN_ERRORS).map((item, index) => (
        <p key={`${item.line}-${index}`}>
          {t("Строка")} {item.line}: {item.label ? `${item.label.length > 80 ? `${item.label.slice(0, 80)}…` : item.label} — ` : ""}
          {t(item.message)}
        </p>
      ))}
      {report.errors.length > SHOWN_ERRORS && <p>… +{report.errors.length - SHOWN_ERRORS}</p>}
    </div>
  ) : undefined

  // On document.body, so no stacking context of the page's layout can cover it.
  return createPortal(
    <RefImportDialog
      key={attempt}
      file={file}
      onFile={(next) => {
        setFile(next)
        setReport(null)
      }}
      onTemplate={() => downloadExcelTable(spec.templateName, [spec.columns.map((column) => t(column.header))])}
      onSave={() => void save()}
      onClose={close}
      saving={saving}
      error={reportNode}
    />,
    document.body,
  )
}
