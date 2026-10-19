"use client"

import { FileText, Loader2, X } from "lucide-react"
import { ChangeEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  ORGANIZATIONS_API,
  type OrganizationDetail,
  type OrganizationErrorBody,
  type OrganizationUsage,
} from "./organization-data"

// Dialogs of the "Организация" page: the delete confirm (demo ConfirmDialog type
// "delete": "Подтверждение удаления" + the organization name), the Excel import
// kept from our other settings pages, and the snackbar.

export type OrganizationNotice = { text: string; tone: "success" | "error" }

export function OrganizationSnackbar({ notice, onClose }: { notice: OrganizationNotice | null; onClose: () => void }) {
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

/** "Заказы (3), Касса (1)" in the UI language. */
export function usageText(usage: OrganizationUsage[], t: (text: string) => string): string {
  return usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")
}

// --- delete confirm ----------------------------------------------------------------

export function OrganizationDeleteDialog({
  organizationId,
  name,
  onClose,
  onDeleted,
  onFailed,
}: {
  organizationId: number
  /** Known name (grid row); otherwise read from GET /api/organizations/[id]. */
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
  const [blockedBy, setBlockedBy] = useState<OrganizationUsage[]>([])

  useEffect(() => {
    if (name) return
    const controller = new AbortController()
    fetch(`${ORGANIZATIONS_API}/${organizationId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as OrganizationDetail & OrganizationErrorBody
        if (!response.ok) throw new Error(data.error || "Организация не найдена")
        setLoadedName(data.name)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [name, organizationId])

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
      const response = await fetch(`${ORGANIZATIONS_API}/${organizationId}`, { method: "DELETE" })
      if (response.ok) {
        onDeleted()
        return
      }
      const data = (await response.json().catch(() => ({}))) as OrganizationErrorBody
      const usage = data.usage ?? []
      setBlockedBy(usage)
      const base = t(data.error || "Удаление невозможно из-за связи с другими данными")
      onFailed(usage.length ? `${base}: ${usageText(usage, t)}` : base)
    } catch {
      onFailed(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setDeleting(false)
    }
  }

  const shownName = name || loadedName
  const busy = loading || deleting
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-[500px] rounded bg-white shadow-2xl">
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
            <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-5 font-semibold">{shownName}</div>
          )}
          {blockedBy.length > 0 && (
            <p className="py-5 text-[#f44336]">
              {t("Удаление невозможно из-за связи с другими данными")}: {usageText(blockedBy, t)}
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
  "ограничение по долгу": "limitByDebt", "ограничение по долгу клиента": "limitByDebt",
  "ограничить по долгу клиента": "limitByDebt", "limit": "limitByDebt",
}

const TRUE_VALUES = /^(да|yes|true|1|\+|есть|с ограничением|ha|cheklov bilan)$/i

export function OrganizationImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (notice: OrganizationNotice) => void }) {
  const { t } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function downloadTemplate() {
    downloadExcelTable("organizations-template", [[t("Наименование"), t("Ограничение по долгу клиента")]])
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
      const parsed: Array<{ name: string; limitByDebt: boolean }> = []
      for (const row of hasHeader ? rows.slice(1) : rows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.limitByDebt = row[1] ?? ""
        }
        const name = (record.name ?? "").trim()
        if (name) parsed.push({ name, limitByDebt: TRUE_VALUES.test((record.limitByDebt ?? "").trim()) })
      }
      if (!parsed.length) {
        onImported({ text: t("Не удалось найти данные для импорта в выбранном файле"), tone: "error" })
        return
      }
      let created = 0
      const failures: string[] = []
      for (const item of parsed) {
        try {
          const response = await fetch(ORGANIZATIONS_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) {
            created += 1
          } else {
            const data = (await response.json().catch(() => ({}))) as OrganizationErrorBody
            failures.push(`${item.name} — ${t(data.fields?.name || data.error || "Не удалось сохранить организацию")}`)
          }
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
