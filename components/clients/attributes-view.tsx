"use client"

import { ToggleRow } from "@/components/analytics/catalog-ui"
import { ChangeEvent, FormEvent, useEffect, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { CatalogHeader, CheckBox, HoverActions, ImportDialog, LineField, LineSelect, Modal, SaveButton, dottedRow } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

type Attribute = { id: number; name: string; fieldType: string; required: boolean }

const fieldTypeOptions = ["Выбор вариантов", "Текстовое поле", "Цифровое поле"]

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "тип поля": "fieldType", "тип": "fieldType", "field type": "fieldType",
  "обязательный": "required", "обязательно": "required", "required": "required",
}

function parseRequired(value: string) {
  return /^(да|yes|true|1|обязательно|обязательный)$/i.test(value.trim())
}

export function AttributesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [items, setItems] = useState<Attribute[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [cacheAttr, setCacheAttr] = useState("")
  const [editing, setEditing] = useState<Attribute | null>(null)
  const [draft, setDraft] = useState({ name: "", fieldType: "Выбор вариантов", required: false })
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/client-attributes")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить атрибуты")
        return (await response.json()) as Attribute[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить атрибуты с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function open(attribute?: Attribute) { setEditing(attribute ?? { id: 0, name: "", fieldType: "Выбор вариантов", required: false }); setDraft(attribute ? { name: attribute.name, fieldType: attribute.fieldType, required: attribute.required } : { name: "", fieldType: "Выбор вариантов", required: false }) }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      const isEdit = !!editing?.id
      const response = await fetch(isEdit ? `/api/client-attributes/${editing!.id}` : "/api/client-attributes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), fieldType: draft.fieldType, required: draft.required }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить атрибут"))
        return
      }
      const saved = (await response.json()) as Attribute
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/client-attributes/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось удалить атрибут"))
        return
      }
      setItems((list) => list.filter((row) => row.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("attributes-template", [[t("Название"), t("Тип поля"), t("Обязательный")]])
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
      const parsed: { name: string; fieldType: string; required: boolean }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.fieldType = row[1] ?? ""
          record.required = row[2] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          fieldType: fieldTypeOptions.includes(record.fieldType) ? record.fieldType : fieldTypeOptions[0],
          required: parseRequired(record.required || ""),
        })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: Attribute[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-attributes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Attribute)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setItems((list) => [...list, ...created])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white px-[30px] text-[13px] text-[#333]">
      {/* Inside the settings layout the page names itself, like the reference's settings pages. */}
      {embedded && <h1 className="pt-[22px] text-[18px] font-bold leading-[22px] text-[#5d6474]">{t("Атрибуты")}</h1>}
      <CatalogHeader
        addLabel={t("добавить атрибуты")}
        onAdd={() => open()}
        from={items.length ? 1 : 0}
        to={items.length}
        total={items.length}
      />
      {loadError && <p className="pt-3 text-red-500">{loadError}</p>}
      <div className={`grid grid-cols-[485px_364px_1fr] ${dottedRow} h-[50px] items-center pt-[3px] font-bold`}>
        <span>{t("Название")}</span><span>{t("Тип поля")}</span><span>{t("Обязательный к заполнению")}</span>
      </div>
      {loading ? (
        <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className={`group relative grid h-[50px] grid-cols-[485px_364px_1fr] items-center ${dottedRow} hover:bg-[#f8f9fb]`}>
            <span className="pr-4">{item.name}</span>
            <span>{t(item.fieldType)}</span>
            <span>{t(item.required ? "Обязательный" : "Не обязательный")}</span>
            <HoverActions offset={70} onEdit={() => open(item)} onDelete={() => void remove(item.id)} />
          </div>
        ))
      )}

      {editing && (
        <Modal
          title={editing.id ? t("Изменение атрибута") : t("Добавление атрибута")}
          onClose={() => setEditing(null)}
          footer={<SaveButton disabled={saving || !draft.name.trim()} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveButton>}
        >
          <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <div className="mt-[34px]"><LineSelect tall label={t("Тип поля")} required value={draft.fieldType} onChange={(value) => setDraft({ ...draft, fieldType: value })} options={fieldTypeOptions} onClear={() => setDraft({ ...draft, fieldType: "" })} /></div>
          <div className="mt-[20px]"><LineSelect tall label={t("Кэш-атрибут магазина")} value={cacheAttr} onChange={setCacheAttr} options={[t("Не указано"), t("Тип магазина"), t("Канал продаж")]} /></div>
          <div className="mt-[18px]"><ToggleRow checked={draft.required} onChange={(value) => setDraft({ ...draft, required: value })} label={t("Обязательный к заполнению")} /></div>
          <p className="mt-[14px] text-[12px] leading-[16px] text-[#e5484d]">{t("После создания/изменения атрибутов пожалуйста заново авторизуйтесь в системе чтобы данные кеша очистились. Пожалуйста скажите про это агентам тоже.")}</p>
        </Modal>
      )}

      {importOpen && <ImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={saveImport} saving={importSaving} onClose={() => { setImportOpen(false); setImportFile(null) }} />}
    </div>
  )
}
