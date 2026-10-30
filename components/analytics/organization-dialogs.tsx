"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { everyLanguage, importKey, parseYesNo, postJson, repeatedInFile, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { Modal, SaveLink } from "./catalog-ui"
import { ExcelRowImportDialog, type ExcelImportSpec } from "./excel-row-import"
import {
  ORGANIZATIONS_API,
  type OrganizationDetail,
  type OrganizationErrorBody,
  type OrganizationUsage,
} from "./organization-data"

// Dialogs of the "Организация" page: the delete confirm (demo ConfirmDialog type
// "delete": "Подтверждение удаления" + the organization name), the snackbar and the
// Excel import (ours, not in the demo).

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
    <Modal
      title={t("Подтверждение удаления")}
      onClose={onClose}
      bodyClassName="px-[30px] pt-[20px]"
      footer={<SaveLink disabled={busy || Boolean(loadError)} onClick={() => void remove()}>{t("Удалить")}</SaveLink>}
    >
      <p className="pb-[20px]">{t("Вы уверены что хотите удалить эти данные?")}</p>
      {loadError ? (
        <p className="pb-5 text-[#f44336]">{t(loadError)}</p>
      ) : (
        <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-[20px] font-semibold">{shownName}</div>
      )}
      {blockedBy.length > 0 && (
        <p className="py-5 text-[#f44336]">
          {t("Удаление невозможно из-за связи с другими данными")}: {usageText(blockedBy, t)}
        </p>
      )}
    </Modal>
  )
}

// --- Excel import (ours, not in the demo) ----------------------------------------------

type OrganizationImport = { name: string; limitByDebt: boolean }

/** "Импорт с Excel": Наименование + Ограничение по долгу клиента (да / нет) per row, created through POST /api/organizations. */
export function OrganizationImportDialog({ onClose, onChanged, onDone }: { onClose: () => void; onChanged: () => void; onDone: (notice: OrganizationNotice) => void }) {
  const { t } = useLanguage()
  const spec: ExcelImportSpec<OrganizationImport> = {
    templateName: "organizations-template",
    columns: [
      { field: "name", header: "Наименование", aliases: ["Название", "Организация", "Name"] },
      { field: "limitByDebt", header: "Ограничение по долгу клиента", aliases: ["Ограничение по долгу", "Ограничить по долгу клиента", "Limit"] },
    ],
    keyField: "name",
    prepare: async (records) => {
      const rows: PreparedRow<OrganizationImport>[] = []
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        // "да / нет", or the grid's own words "С ограничением" / "Без ограничения" (in any UI language).
        const limitByDebt = parseYesNo(values.limitByDebt, false, { yes: everyLanguage("С ограничением"), no: everyLanguage("Без ограничения") })
        if (!values.name) errors.push({ line, label: t("Наименование"), message: "Обязательное поле" })
        else if (limitByDebt === null) errors.push({ line, label: `${values.name}, ${t("Ограничение по долгу клиента")}`, message: "Укажите да или нет" })
        else rows.push({ line, label: values.name, item: { name: values.name, limitByDebt } })
      }
      return { rows, errors: [...errors, ...repeatedInFile(rows, (row) => importKey(row.item.name))] }
    },
    send: (item) => postJson(ORGANIZATIONS_API, item),
    fallbackError: "Не удалось сохранить организацию",
  }
  return <ExcelRowImportDialog spec={spec} onClose={onClose} onChanged={onChanged} onDone={(summary) => onDone({ text: summary, tone: "success" })} />
}
