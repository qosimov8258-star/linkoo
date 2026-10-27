"use client"

import { ChangeEvent, FormEvent, useEffect, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { CheckBox, EmptyState, HoverActions, ImportDialog, LineField, LineSelect, ListToolbar, Modal, SaveLink, ToggleRow, grayHead, listRow } from "@/components/analytics/catalog-ui"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

type ClientType = { id: number; name: string; supplier: string; date: string }

const initialTypes: ClientType[] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "доставщик": "supplier", "supplier": "supplier",
}

/** The server's message (409: duplicate name, or the usage list of a type in use). */
async function errorOf(response: Response, t: (key: string) => string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string; usage?: Array<{ label: string; count: number }> } | null
  const usage = body?.usage?.map((entry) => `${t(entry.label)}: ${entry.count}`).join(", ")
  return body?.error ? `${t(body.error)}${usage ? ` (${usage})` : ""}` : t("Не удалось сохранить")
}

export function ClientTypesView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [items, setItems] = useState(initialTypes)
  const [query, setQuery] = useState("")
  const [parentCategory, setParentCategory] = useState(false)
  const [needInn, setNeedInn] = useState(false)
  const [editing, setEditing] = useState<ClientType | null>(null)
  const [draft, setDraft] = useState({ name: "", supplier: "" })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/clients")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { deliverer?: string }[]) => {
        if (Array.isArray(rows)) setSuppliers([...new Set(rows.map((row) => row.deliverer ?? "").filter((name) => name && name !== "Не указано"))].sort((a, b) => a.localeCompare(b, "ru")))
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

  const visible = items.filter((item) => `${item.name} ${item.supplier}`.toLowerCase().includes(query.toLowerCase()))
  function openAdd() { setEditing({ id: 0, name: "", supplier: "", date: "" }); setDraft({ name: "", supplier: "" }) }
  function openEdit(item: ClientType) { setEditing(item); setDraft({ name: item.name, supplier: item.supplier }) }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    try {
      if (editing?.id) {
        const response = await fetch(`/api/client-types/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name.trim(), supplier: draft.supplier.trim() }),
        })
        if (!response.ok) return window.alert(await errorOf(response, t))
        const saved = (await response.json()) as ClientType
        setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      } else {
        const response = await fetch("/api/client-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name.trim(), supplier: draft.supplier.trim() }),
        })
        if (!response.ok) return window.alert(await errorOf(response, t))
        const saved = (await response.json()) as ClientType
        setItems((current) => [saved, ...current])
      }
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/client-types/${id}`, { method: "DELETE" })
      if (!response.ok) return window.alert(await errorOf(response, t))
      setItems((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("client-types-template", [[t("Наименование"), t("Доставщик")]])
  }
  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }
  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows
      const parsed: { name: string; supplier: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.supplier = row[1] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          supplier: record.supplier.trim() || t("Не указано"),
        })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: ClientType[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ClientType)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setItems((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  void embedded
  const gridCols = "grid-cols-[422px_312px_1fr]"
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        slim
        addLabel={t("добавить тип клиента")}
        onAdd={openAdd}
      />
      <div className={`${grayHead} ${gridCols}`}>
        <span>{t("Наименование")}</span><span>{t("Доставщик")}</span><span>{t("Дата создания")}</span>
      </div>
      {visible.map((item) => (
        <div key={item.id} className={`${listRow} ${gridCols}`}>
          <span className="pr-4 font-bold">{item.name}</span>
          <span>{item.supplier}</span>
          <span>{formatDateText(refDate(item.date) || item.date, language)}</span>
          <HoverActions offset={70} onEdit={() => openEdit(item)} onDelete={() => void remove(item.id)} />
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить тип клиента") : t("Добавить тип клиента")}
          onClose={() => setEditing(null)}
          footer={<SaveLink onClick={() => void save({ preventDefault() {} } as FormEvent)}>{t("Сохранить")}</SaveLink>}
        >
          <ToggleRow checked={parentCategory} onChange={setParentCategory} label={t("Добавить родительскую категорию")} />
          <div className="mt-[27px]"><LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} /></div>
          <div className="mt-[27px]"><LineSelect label={t("Доставщик")} required value={draft.supplier} onChange={(value) => setDraft({ ...draft, supplier: value })} onClear={() => setDraft({ ...draft, supplier: "" })} options={[...new Set([...(draft.supplier ? [draft.supplier] : []), ...suppliers])]} /></div>
          <div className="mt-[16px]"><CheckBox checked={needInn} onChange={setNeedInn} label={t("Требуется ИНН")} /></div>
        </Modal>
      )}

      {importOpen && <ImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={saveImport} saving={importSaving} onClose={() => { setImportOpen(false); setImportFile(null) }} />}
    </div>
  )
}
