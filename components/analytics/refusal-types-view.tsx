"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"

import { LineField, Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { CashSnackbar, useCanManage, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { DictionaryDeleteDialog } from "@/components/analytics/dictionaries-shared"
import { ExcelImportLink, ExcelRowImportDialog, type ExcelImportSpec } from "@/components/analytics/excel-row-import"
import { AddLink, EmptyRows, PAGE_SIZES, RowActions, SettingsToolbar, SortHead, kitHead, kitRow, toggleOrdering } from "@/components/analytics/settings-list-kit"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { importKey, postJson, repeatedInFile, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { useLanguage } from "@/lib/i18n/language-context"

// "Тип отказа" (Linko #/type-failure, Settings → Тип отказа; API market/rejection_type/).
// "+ добавить", search, paginator and the grid № | Наименование | Решение (newest first) with
// hover ✎ / 🗑; the dialog has Название тип отказа ★ and Решение ★ (Linko's 4-row text area), delete asks for
// confirmation. As Linko: the dialogs open without focusing a field and ignore Escape (× closes them); the
// headers write ?ordering=id,name,… (click order, a second click makes a key descending, a third drops it) but
// Linko's API ignores it, so the rows keep their order; the list state and the dialogs live in the URL
// (?search ?ordering ?page ?pageSize ?openCreateDialog=true, ?refusalType=<id>&openUpdateDialog=true |
// openConfirmDialog=true — Linko's /type-failure/<id>?openUpdateDialog=true).
// "Импорт с Excel" (ours, not in Linko: kept by the 2026-10-30 decision that restored the Excel imports):
// Наименование + Решение per row through POST /api/refusal-types.

type RefusalType = { id: number; name: string; resolution: string }

const API = "/api/refusal-types"
const ORDER_FIELDS = ["id", "name", "solution"]
/** The add dialog is measured at its first height (15 px taller than it ends up), the edit dialog at its real one. */
const ADD_DIALOG_OPEN_HEIGHT = 372

// Reference grid: 12 xs columns inside the 30px gutters (№ 3 | Наименование 4 | Решение 5).
const COLUMNS = "3fr 4fr 5fr 0fr"

type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "confirm"; id: number } | null

export function RefusalTypesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const canEdit = useCanWrite()
  const [items, setItems] = useState<RefusalType[]>([])
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState("")
  const [ordering, setOrdering] = useState<string[]>([])
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 })
  const [dialog, setDialog] = useState<DialogState>(null)
  const [draft, setDraft] = useState({ name: "", resolution: "" })
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const canImport = useCanManage(["clients.manage"])
  const closeNotice = useCallback(() => setNotice(null), [])

  const load = useCallback(() => {
    fetch(API, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы отказов")
        setItems(((await response.json()) as RefusalType[]).sort((a, b) => b.id - a.id))
      })
      .catch(() => setNotice({ text: "Не удалось загрузить типы отказов с сервера", tone: "error" }))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // The URL state, read once on mount (the server render has no query).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setQuery(params.get("search") ?? "")
    setOrdering((params.get("ordering") ?? "").split(",").filter((key) => ORDER_FIELDS.includes(key.replace(/^-/, ""))))
    const size = Number(params.get("pageSize"))
    const page = Number(params.get("page"))
    setPaging({ page: Number.isInteger(page) && page > 1 ? page : 1, pageSize: PAGE_SIZES.includes(size) ? size : 25 })
    const id = Number(params.get("refusalType"))
    if (params.get("openCreateDialog") === "true") setDialog({ kind: "create" })
    else if (Number.isInteger(id) && id > 0 && params.get("openUpdateDialog") === "true") setDialog({ kind: "update", id })
    else if (Number.isInteger(id) && id > 0 && params.get("openConfirmDialog") === "true") setDialog({ kind: "confirm", id })
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams()
    if (query) params.set("search", query)
    if (ordering.length) params.set("ordering", ordering.join(","))
    if (paging.page > 1) params.set("page", String(paging.page))
    if (paging.pageSize !== 25) params.set("pageSize", String(paging.pageSize))
    if (dialog?.kind === "create") params.set("openCreateDialog", "true")
    if (dialog && dialog.kind !== "create") {
      params.set("refusalType", String(dialog.id))
      params.set(dialog.kind === "update" ? "openUpdateDialog" : "openConfirmDialog", "true")
    }
    const search = params.toString()
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
  }, [ready, query, ordering, paging, dialog])

  // A dialog opened from the URL takes the entry's values once the list has them (an unknown id opens nothing).
  const editing = useMemo<RefusalType | null>(() => {
    if (dialog?.kind === "create") return { id: 0, name: "", resolution: "" }
    if (dialog?.kind === "update") return items.find((item) => item.id === dialog.id) ?? null
    return null
  }, [dialog, items])
  const deleting = dialog?.kind === "confirm" ? (items.find((item) => item.id === dialog.id) ?? null) : null
  const editingId = editing?.id
  useEffect(() => {
    if (editingId === undefined) return
    setDraft({ name: editing?.name ?? "", resolution: editing?.resolution ?? "" })
    setTouched(false)
    // Only when another entry (or the add form) is opened, not on every list reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, dialog?.kind])
  useEffect(() => {
    if (loaded && dialog && dialog.kind !== "create" && !items.some((item) => item.id === dialog.id)) setDialog(null)
  }, [loaded, dialog, items])

  // Linko's confirm dialog ignores Escape too; the shared one closes on it from a window listener, so it is held back here.
  useEffect(() => {
    if (!deleting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [deleting])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle) || item.resolution.toLowerCase().includes(needle)) : items
  }, [items, query])
  const lastPage = Math.max(1, Math.ceil(rows.length / paging.pageSize))
  const page = Math.min(paging.page, lastPage)
  const pageRows = rows.slice((page - 1) * paging.pageSize, page * paging.pageSize)

  type ImportItem = { name: string; resolution: string }
  const importSpec: ExcelImportSpec<ImportItem> = {
    templateName: "refusal-types-template",
    columns: [
      { field: "name", header: "Наименование", aliases: ["Название", "Название тип отказа", "Тип отказа", "Name"] },
      { field: "resolution", header: "Решение", aliases: ["Resolution"] },
    ],
    keyField: "name",
    prepare: async (records) => {
      const rows: PreparedRow<ImportItem>[] = []
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        // Both fields are required, like the dialog (Название тип отказа ★, Решение ★).
        if (!values.name) errors.push({ line, label: t("Наименование"), message: "Обязательное поле" })
        else if (!values.resolution) errors.push({ line, label: `${values.name}, ${t("Решение")}`, message: "Обязательное поле" })
        else rows.push({ line, label: values.name, item: { name: values.name, resolution: values.resolution } })
      }
      return { rows, errors: [...errors, ...repeatedInFile(rows, (row) => importKey(row.item.name))] }
    },
    send: (item) => postJson(API, item),
    fallbackError: "Не удалось сохранить тип отказа",
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving || !editing) return
    setTouched(true)
    if (!draft.name.trim() || !draft.resolution.trim()) return
    setSaving(true)
    try {
      const response = await fetch(editing.id ? `${API}/${editing.id}` : API, {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), resolution: draft.resolution.trim() }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setNotice({ text: t(data.error || "Не удалось сохранить тип отказа"), tone: "error" })
        return
      }
      setDialog(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
      load()
    } catch {
      setNotice({ text: t("Сервер недоступен, попробуйте ещё раз"), tone: "error" })
    } finally {
      setSaving(false)
    }
  }

  const sort = (field: string) => setOrdering((current) => toggleOrdering(current, field))

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#1E4A9A]" />
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> {t("Тип отказа")}
          </h1>
        </header>
      )}

      <section className={embedded ? "bg-white text-[13px] text-[#333]" : "overflow-hidden rounded bg-white text-[13px] text-[#333] shadow"}>
        <SettingsToolbar
          left={
            canEdit || canImport ? (
              <>
                {canEdit && <AddLink onClick={() => setDialog({ kind: "create" })}>{t("добавить")}</AddLink>}
                {canImport && <ExcelImportLink className="h-[36px] pt-[3px] leading-[36px]" onClick={() => setImportOpen(true)} />}
              </>
            ) : undefined
          }
          // Linko: the search starts 360 px into the card and is 300 px wide.
          searchClassName="left-[360.3px] top-[20px]"
          searchWidth={300}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setPaging((current) => ({ ...current, page: 1 }))
          }}
          pager={{
            pageSize: paging.pageSize,
            onPageSize: (size) => setPaging({ page: 1, pageSize: size }),
            from: rows.length ? (page - 1) * paging.pageSize + 1 : 0,
            to: Math.min(rows.length, page * paging.pageSize),
            total: rows.length,
            onPrev: page > 1 ? () => setPaging((current) => ({ ...current, page: page - 1 })) : undefined,
            onNext: page * paging.pageSize < rows.length ? () => setPaging((current) => ({ ...current, page: page + 1 })) : undefined,
          }}
        />

        <div className={`${kitHead} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
          <span>
            <SortHead label="№" field="id" ordering={ordering} onSort={sort} className="!font-semibold" />
          </span>
          <span className="pl-[8px]">
            <SortHead label={t("Наименование")} field="name" ordering={ordering} onSort={sort} className="!font-semibold" />
          </span>
          <span className="pl-[8px]">
            <SortHead label={t("Решение")} field="solution" ordering={ordering} onSort={sort} className="!font-semibold" />
          </span>
          <span />
        </div>
        {pageRows.map((item) => (
          <div key={item.id} className={`${kitRow} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
            <span>{item.id}</span>
            {/* Linko's cells are padded 8 px, so the text sits under its header. */}
            <span className="px-[8px]">{item.name}</span>
            <span className="px-[8px]">{item.resolution}</span>
            <span />
            {canEdit && <RowActions right={74.6} onEdit={() => setDialog({ kind: "update", id: item.id })} onDelete={() => setDialog({ kind: "confirm", id: item.id })} />}
          </div>
        ))}
        {loaded && rows.length === 0 && <EmptyRows />}
      </section>

      {editing && (
        <Modal
          title={editing.id ? t("Изменить тип отказа") : t("Добавить тип отказа")}
          onClose={() => setDialog(null)}
          width={450}
          escapeCloses={false}
          // Linko centres the dialog by the height it has when it opens: the add dialog sits 7.5 px above the centre.
          anchorTop={editing.id ? false : Math.max(80, Math.round((window.innerHeight - ADD_DIALOG_OPEN_HEIGHT) / 2))}
          bodyClassName="min-h-[239px] px-[30px] pt-[42px]"
          footer={
            <SaveLink disabled={saving} onClick={() => void save({ preventDefault() {} } as FormEvent)}>
              {t("Сохранить")}
            </SaveLink>
          }
        >
          <LineField label={t("Название тип отказа")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          {touched && !draft.name.trim() && <p className="mt-1 text-[12px] text-[#e57373]">{t("Обязательное поле")}</p>}
          <AreaField label={t("Решение")} required value={draft.resolution} onChange={(value) => setDraft({ ...draft, resolution: value })} />
          {touched && !draft.resolution.trim() && <p className="mt-1 text-[12px] text-[#e57373]">{t("Обязательное поле")}</p>}
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api={API}
          id={deleting.id}
          name={deleting.name}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
            load()
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={load}
          onDone={(summary) => {
            setImportOpen(false)
            setNotice({ text: summary, tone: "success" })
          }}
        />
      )}

      <CashSnackbar message={notice} onClose={closeNotice} />
    </main>
  )
}

/** Linko's «Решение»: a 4-row text area (Enter starts a new line) under a label that rises once it has focus or text;
 * the underline sits 3 px under the 80 px area. */
function AreaField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative pt-[25.5px]">
      <span className={`pointer-events-none absolute left-0 font-semibold ${floating ? "top-[8px] text-[10px] leading-3" : "top-[31px] text-[13px] leading-4"}`}>
        {label}
        {required && <span className="font-semibold text-[#e57373]"> *</span>}
      </span>
      <textarea
        rows={4}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="block h-[80px] w-full resize-none bg-transparent text-[13px] font-semibold leading-[20px] text-[#333] outline-none"
      />
      <div className="mt-[3px] h-px bg-[#d5dae1]" />
    </div>
  )
}
