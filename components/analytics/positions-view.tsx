"use client"

import { useCallback, useEffect, useState } from "react"

import { LineField, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { ExcelImportLink, ExcelRowImportDialog, type ExcelImportSpec } from "@/components/analytics/excel-row-import"
import {
  AddLink,
  ConfirmDeleteDialog,
  EmptyRows,
  RowActions,
  SettingsToolbar,
  SortHead,
  kitHead,
  kitRow,
  sortRows,
  toggleOrdering,
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { queryInt, useLinkoUrlState } from "@/components/orders/linko-url-state"
import { importKey, postJson, repeatedInFile, type PreparedRow } from "@/lib/excel-row-import"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Должности" (demo #/post, Settings → Персонал; API main/jobs/): Id | Наименование | Дата создания,
// newest first, Id and Дата создания sortable (multi-key like the demo's ?ordering=id,created_date),
// ✎ / 🗑 appear on row hover. Dialog = one required field "Наименование". "Импорт с Excel" (ours, not in the
// demo) creates the positions of a file through POST /api/job-positions (lib/excel-row-import.ts).
// Like Linko the address keeps the list (ordering, page, pageSize, search) and the dialogs: #/post?openCreateDialog=true,
// #/post/49?openUpdateDialog=true / openDeleteDialog=true → /analytics/positions[/49]?…; a closed dialog stays "=false".

type Position = { id: number; name: string; date: string; createdAt: string }

/** Linko's 12-column row (30px side padding): Id 2 / Наименование 6 / Дата создания 4, text 8px into its column. */
const COLUMNS = "calc(30px + (100% - 60px) / 6) calc((100% - 60px) / 2) minmax(0, 1fr)"
/** The row pencil / bin sit 12px into the 12th column. */
const ACTIONS_LEFT = "calc(41px + (100% - 60px) * 11 / 12)"
/** Linko's search: a quarter into the toolbar (17px side padding, 8px column padding), at most 300px wide. */
const SEARCH = "left-[calc(25px_+_(100%_-_34px)_/_4)] top-[20px] !w-[min(300px,calc((100%_-_34px)_/_4_-_16px))]"
const BASE = "/analytics/positions"
const ORDERINGS = new Set(["id", "-id", "created_date", "-created_date"])

function PositionDialog({ position, onClose, onSaved }: { position: Position | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(position?.name ?? "")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    // The reference keeps "Сохранить" enabled and answers an empty name with the API field error.
    if (!name.trim()) {
      notify(`name: ${t("Это поле обязательно к заполнению")}`)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(position ? `/api/job-positions/${position.id}` : "/api/job-positions", {
        method: position ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || "Не удалось сохранить должность"))
        return
      }
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={position ? t("Изменить должность") : t("Добавить должность")}
      titleClassName="text-[15px]"
      closeInset="pr-[10px]"
      onClose={onClose}
      bodyClassName="px-[30px] pb-[42px] pt-[18px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <LineField label={t("Наименование")} required value={name} onChange={setName} />
    </Modal>
  )
}

export function PositionsView({ embedded = false, initialId = null }: { embedded?: boolean; initialId?: number | null }) {
  const { t, language } = useLanguage()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const canImport = useCanManage(["settings.manage"])
  const { state: url, update: updateUrl } = useLinkoUrlState(BASE, { id: initialId ? String(initialId) : null, query: {} })
  const ordering = (url.query.ordering ?? "").split(",").filter((key, index, all) => ORDERINGS.has(key) && all.findIndex((other) => other.replace(/^-/, "") === key.replace(/^-/, "")) === index)
  const setOrdering = (next: string[]) => updateUrl({ query: { ordering: next.join(",") } })
  const controls = {
    query: url.query.search ?? "",
    setQuery: (value: string) => updateUrl({ query: { search: value, page: null } }),
    page: queryInt(url.query.page, 1, 1_000_000),
    setPage: (value: number) => updateUrl({ query: { page: value > 1 ? value : null } }),
    pageSize: queryInt(url.query.pageSize, 25),
    setPageSize: (value: number) => updateUrl({ query: { pageSize: value, page: null } }),
  }
  const current = url.id ? positions?.find((position) => String(position.id) === url.id) : undefined
  const dialog = url.query.openCreateDialog === "true" ? { position: null } : url.query.openUpdateDialog === "true" && current ? { position: current } : null
  const deleting = url.query.openDeleteDialog === "true" ? current ?? null : null

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-positions", { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setPositions((await response.json()) as Position[])
    } catch {
      setPositions([])
      notify(t("Не удалось загрузить должности с сервера"))
    }
  }, [t])
  useEffect(() => { void load() }, [load])

  const needle = controls.query.trim().toLowerCase()
  const filtered = sortRows((positions ?? []).filter((position) => position.name.toLowerCase().includes(needle)), ordering, {
    id: (position) => position.id,
    created_date: (position) => position.createdAt,
  })
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  const importSpec: ExcelImportSpec<{ name: string }> = {
    templateName: "positions-template",
    columns: [{ field: "name", header: "Наименование", aliases: ["Название", "Должность", "Position", "Name"] }],
    keyField: "name",
    prepare: async (records) => {
      const rows: PreparedRow<{ name: string }>[] = records.map((record) => ({ line: record.line, label: record.values.name, item: { name: record.values.name } }))
      return { rows, errors: repeatedInFile(rows, (row) => importKey(row.item.name)) }
    },
    send: (item) => postJson("/api/job-positions", item),
    fallbackError: "Не удалось создать должность",
  }

  async function remove(position: Position) {
    let response: Response
    try {
      response = await fetch(`/api/job-positions/${position.id}`, { method: "DELETE" })
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
      return
    }
    if (!response.ok) {
      // 409 while other records use it: the usage list says where (its labels are i18n keys).
      const data = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
      const usage = data.usage?.map((item) => `${t(item.label)}: ${item.count}`).join(", ")
      notify(`${t(data.error || "Не удалось удалить должность")}${usage ? ` (${usage})` : ""}`)
      return
    }
    updateUrl({ id: null, query: { openDeleteDialog: "false" } })
    await load()
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={
          <>
            <AddLink onClick={() => updateUrl({ query: { openCreateDialog: "true" } })}>{t("добавить должность")}</AddLink>
            {canImport && <ExcelImportLink className="h-[36px] pt-[3px] leading-[36px]" onClick={() => setImportOpen(true)} />}
          </>
        }
        query={controls.query}
        onQuery={controls.setQuery}
        searchClassName={SEARCH}
        pager={{
          pageSize: controls.pageSize,
          onPageSize: controls.setPageSize,
          from: paged.from,
          to: paged.to,
          total: paged.total,
          onPrev: paged.page > 1 ? () => controls.setPage(paged.page - 1) : undefined,
          onNext: paged.page < paged.pageCount ? () => controls.setPage(paged.page + 1) : undefined,
        }}
      />
      <div className={kitHead} style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px]"><SortHead className="!font-semibold" label="Id" field="id" ordering={ordering} onSort={(field) => setOrdering(toggleOrdering(ordering, field))} /></span>
        <span className="pl-[8px]">{t("Наименование")}</span>
        <SortHead className="!font-semibold pl-[8px]" label={t("Дата создания")} field="created_date" ordering={ordering} onSort={(field) => setOrdering(toggleOrdering(ordering, field))} />
      </div>
      {paged.rows.map((position) => (
        <div key={position.id} className={kitRow} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px]">{position.id}</span>
          <span className="pl-[8px] pr-4">{position.name}</span>
          <span className="pl-[8px]">{formatDateText(position.date, language)}</span>
          <RowActions left={ACTIONS_LEFT} onEdit={() => updateUrl({ id: String(position.id), query: { openUpdateDialog: "true" } })} onDelete={() => updateUrl({ id: String(position.id), query: { openDeleteDialog: "true" } })} />
        </div>
      ))}
      {positions && paged.rows.length === 0 && <EmptyRows />}

      {dialog && (
        <PositionDialog
          key={dialog.position?.id ?? "new"}
          position={dialog.position}
          onClose={() => updateUrl({ query: dialog.position ? { openUpdateDialog: "false" } : { openCreateDialog: "false" } })}
          onSaved={() => { updateUrl({ query: dialog.position ? { openUpdateDialog: "false" } : { openCreateDialog: "false" } }); void load() }}
        />
      )}
      {deleting && <ConfirmDeleteDialog name={deleting.name} onConfirm={() => void remove(deleting)} onClose={() => updateUrl({ query: { openDeleteDialog: "false" } })} />}
      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={() => void load()}
          onDone={(summary) => {
            setImportOpen(false)
            notify(summary)
          }}
        />
      )}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}
