"use client"

import { useEffect, useState } from "react"

import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CheckBox, EmptyState, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveLink, ToggleRow, grayHead, listRow } from "@/components/analytics/catalog-ui"
import { DictionaryDeleteDialog } from "@/components/analytics/dictionaries-shared"
import { ExcelImportLink, ExcelRowImportDialog, type ExcelImportSpec } from "@/components/analytics/excel-row-import"
import { importKey, postJson, repeatedInFile, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

type ClientType = { id: number; name: string; supplier: string; date: string; parentId: number | null; innRequired: boolean }

const emptyDraft = { name: "", supplier: "", parent: "", hasParent: false, innRequired: false }

/** One row of "Импорт с Excel" (ours, not in the demo): Наименование + Доставщик (an employee, or empty). */
type ClientTypeImport = { name: string; supplier?: string }

/** Employee display names ("Имя Фамилия", the Доставщик picker's options) by comparison key. */
async function delivererNames(): Promise<Map<string, string>> {
  const response = await fetch("/api/employees", { cache: "no-store" })
  if (!response.ok) throw new Error("load")
  const rows = (await response.json()) as Array<{ firstName?: string; lastName?: string }>
  const names = new Map<string, string>()
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()
    if (name && !names.has(importKey(name))) names.set(importKey(name), name)
  }
  return names
}

/** The server's message (409: duplicate name, or the usage list of a type in use). */
async function errorOf(response: Response, t: (key: string) => string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string; usage?: Array<{ label: string; count: number }> } | null
  const usage = body?.usage?.map((entry) => `${t(entry.label)}: ${entry.count}`).join(", ")
  return body?.error ? `${t(body.error)}${usage ? ` (${usage})` : ""}` : t("Не удалось сохранить")
}

export function ClientTypesView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [items, setItems] = useState<ClientType[]>([])
  const [editing, setEditing] = useState<ClientType | null>(null)
  const [deleting, setDeleting] = useState<ClientType | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const [deliverers, setDeliverers] = useState<string[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const canImport = useCanManage(["clients.manage"])

  useEffect(() => {
    fetch("/api/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { firstName?: string; lastName?: string }[]) => {
        if (Array.isArray(rows)) setDeliverers([...new Set(rows.map((row) => `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-types")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы клиентов")
        return (await response.json()) as ClientType[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const parentOptions = items.filter((item) => item.parentId === null && item.id !== editing?.id).map((item) => item.name)
  const valid = draft.name.trim() !== "" && draft.supplier !== "" && (!draft.hasParent || draft.parent !== "")

  function openAdd() {
    setError("")
    setEditing({ id: 0, name: "", supplier: "", date: "", parentId: null, innRequired: false })
    setDraft(emptyDraft)
  }
  function openEdit(item: ClientType) {
    setError("")
    setEditing(item)
    const parent = items.find((row) => row.id === item.parentId)
    setDraft({ name: item.name, supplier: item.supplier === "Не указано" ? "" : item.supplier, parent: parent?.name ?? "", hasParent: item.parentId !== null, innRequired: item.innRequired })
  }

  async function save() {
    if (!editing) return
    // The reference keeps "Сохранить" enabled and answers an incomplete form with the API field error.
    if (!valid) {
      setError(t("Это поле обязательно к заполнению"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const isEdit = editing.id > 0
      const parentId = draft.hasParent ? items.find((row) => row.name === draft.parent)?.id ?? null : null
      const response = await fetch(isEdit ? `/api/client-types/${editing.id}` : "/api/client-types", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), supplier: draft.supplier, parentId, innRequired: draft.innRequired }),
      })
      if (!response.ok) {
        setError(await errorOf(response, t))
        return
      }
      const list = await fetch("/api/client-types").then((res) => (res.ok ? res.json() : null)).catch(() => null)
      if (Array.isArray(list)) setItems(list as ClientType[])
      setEditing(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function reloadTypes() {
    const list = await fetch("/api/client-types", { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)).catch(() => null)
    if (Array.isArray(list)) setItems(list as ClientType[])
  }

  const importSpec: ExcelImportSpec<ClientTypeImport> = {
    templateName: "client-types-template",
    columns: [
      { field: "name", header: "Наименование", aliases: ["Название", "Тип клиента", "Name"] },
      { field: "supplier", header: "Доставщик", aliases: ["Deliverer"] },
    ],
    keyField: "name",
    prepare: async (records) => {
      const names = records.some((record) => record.values.supplier) ? await delivererNames() : new Map<string, string>()
      const rows: PreparedRow<ClientTypeImport>[] = []
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        const supplier = values.supplier ? names.get(importKey(values.supplier)) : undefined
        if (!values.name) errors.push({ line, label: t("Наименование"), message: "Обязательное поле" })
        else if (values.supplier && !supplier) errors.push({ line, label: `${values.name}, ${values.supplier}`, message: "Доставщик не найден" })
        else rows.push({ line, label: values.name, item: supplier ? { name: values.name, supplier } : { name: values.name } })
      }
      return { rows, errors: [...errors, ...repeatedInFile(rows, (row) => importKey(row.item.name))] }
    },
    send: (item) => postJson("/api/client-types", item),
    fallbackError: "Не удалось сохранить",
  }

  void embedded
  const gridCols = "grid-cols-[422px_312px_1fr]"
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        slim
        addLabel={t("добавить тип клиента")}
        onAdd={openAdd}
        extra={canImport ? <ExcelImportLink className="pt-[4px]" onClick={() => setImportOpen(true)} /> : undefined}
      />
      <div className={`${grayHead} ${gridCols} pt-[2px]`}>
        <span>{t("Наименование")}</span><span>{t("Доставщик")}</span><span>{t("Дата создания")}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className={`${listRow} ${gridCols}`}>
          <span className="pr-4 font-semibold">{item.name}</span>
          <span>{item.supplier}</span>
          <span>{formatDateText(refDate(item.date) || item.date, language)}</span>
          <HoverActions offset={35} onEdit={() => openEdit(item)} onDelete={() => setDeleting(item)} />
        </div>
      ))}
      {items.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить тип клиента") : t("Добавить тип клиента")}
          onClose={() => setEditing(null)}
          bodyClassName="px-[30px] pb-[24px] pt-[17px]"
          footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="min-h-[259px]">
            <ToggleRow checked={draft.hasParent} onChange={(hasParent) => setDraft({ ...draft, hasParent })} label={t("Добавить родительскую категорию")} />
            {draft.hasParent && <div className="mt-[31px]"><LineSelect label={t("Родительская категория")} value={draft.parent} onChange={(parent) => setDraft({ ...draft, parent })} options={parentOptions} onClear={() => setDraft({ ...draft, parent: "" })} /></div>}
            <div className={draft.hasParent ? "mt-[12px]" : "mt-[20px]"}><LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} /></div>
            <div className="mt-[27px]"><LineSelect label={t("Доставщик")} required value={draft.supplier} onChange={(value) => setDraft({ ...draft, supplier: value })} onClear={() => setDraft({ ...draft, supplier: "" })} options={deliverers} /></div>
            <div className="mt-[12px]"><CheckBox checked={draft.innRequired} onChange={(innRequired) => setDraft({ ...draft, innRequired })} label={t("Требуется ИНН")} /></div>
            {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
          </div>
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api="/api/client-types"
          id={deleting.id}
          name={`${t("Тип клиента")}: ${deleting.name}`}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setItems((list) => list.filter((item) => item.id !== deleting.id))
            setDeleting(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={() => void reloadTypes()}
          onDone={(summary) => {
            setImportOpen(false)
            setNotice({ text: summary, tone: "success" })
          }}
        />
      )}

      <CashSnackbar message={notice} onClose={() => setNotice(null)} />
    </div>
  )
}
