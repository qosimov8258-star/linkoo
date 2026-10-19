"use client"

import { ChangeEvent, FormEvent, useEffect, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { CatalogHeader, HoverActions, ImportDialog, LineField, LineSelect, Modal, SaveButton, dottedRow } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

type Row = { id: number; attribute: string; values: string[]; textOnly?: boolean }
const initial: Row[] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "атрибут": "attribute", "attribute": "attribute",
  "значение": "value", "значения": "value", "value": "value",
}

export function AttributeValuesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState(initial)
  const [editing, setEditing] = useState<Row | null>(null)
  const [attributes, setAttributes] = useState<{ id: number; name: string; fieldType: string }[]>([])
  const [draft, setDraft] = useState({ attribute: "", value: "" })
  const selectNames = attributes.filter((attr) => attr.fieldType === "Выбор вариантов").map((attr) => attr.name)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)

  useEffect(() => {
    fetch("/api/client-attributes").then((response) => (response.ok ? response.json() : [])).then(setAttributes)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-attribute-values")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить значения атрибутов")
        return (await response.json()) as Row[]
      })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  function open(row?: Row, name = "") { setEditing(row ?? { id: 0, attribute: name, values: [] }); setDraft({ attribute: row?.attribute ?? name, value: row?.values.join(", ") ?? "" }) }
  async function save(e: FormEvent) {
    e.preventDefault()
    const values = draft.value.split(",").map((value) => value.trim()).filter(Boolean)
    try {
      if (editing?.id) {
        const response = await fetch(`/api/client-attribute-values/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attribute: draft.attribute, values }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as Row
        setRows((list) => list.map((row) => (row.id === editing.id ? saved : row)))
      } else {
        const response = await fetch("/api/client-attribute-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attribute: draft.attribute, values }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as Row
        setRows((list) => [...list, saved])
      }
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  async function remove(id: number) {
    try {
      const response = await fetch(`/api/client-attribute-values/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setRows((list) => list.filter((item) => item.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  function downloadTemplate() {
    downloadExcelTable("attribute-values-template", [[t("Атрибут"), t("Значение")]])
  }
  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }
  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(importFile)
      if (!excelRows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(excelRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("attribute")
      const dataRows = hasHeader ? excelRows.slice(1) : excelRows
      const parsed: { attribute: string; values: string[] }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.attribute = row[0] ?? ""
          record.value = row[1] ?? ""
        }
        if (!record.attribute) continue
        parsed.push({
          attribute: record.attribute.trim(),
          values: (record.value || "").split(",").map((value) => value.trim()).filter(Boolean),
        })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: Row[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-attribute-values", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Row)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((list) => [...list, ...created])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }
  void embedded
  const listed = attributes.map((attr) => ({ attr, row: rows.find((row) => row.attribute === attr.name) }))
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white px-[30px] text-[13px] text-[#333]">
      <CatalogHeader
        addLabel={t("Добавление значения")}
        onAdd={() => open()}
        from={listed.length ? 1 : 0}
        to={listed.length}
        total={listed.length}
      />
      <div className={`grid grid-cols-[364px_1fr] ${dottedRow} h-[50px] items-center pt-[3px] font-bold`}>
        <span>{t("Атрибут")}</span><span>{t("Значение")}</span>
      </div>
      {listed.map(({ attr, row }) => (
        <div key={attr.id} className={`group relative grid min-h-[50px] grid-cols-[364px_1fr] items-center ${dottedRow}`}>
          <span>{attr.name}</span>
          <span className="flex flex-wrap gap-[10px] py-[7px]">
            {(row?.values ?? []).map((value) => <span key={value} className="rounded-[3px] bg-[#e9ecef] px-[10px] py-[4px] leading-[18px]">{value}</span>)}
          </span>
          {attr.fieldType === "Выбор вариантов" && <HoverActions offset={70} onEdit={() => open(row, attr.name)} />}
        </div>
      ))}

      {editing && (
        <Modal
          title={editing.id ? t("Изменение значения") : t("Добавление значения")}
          onClose={() => setEditing(null)}
          footer={<SaveButton disabled={!draft.attribute} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{t("Сохранить")}</SaveButton>}
        >
          <LineSelect label={t("Атрибут")} required value={draft.attribute} onChange={(value) => setDraft({ ...draft, attribute: value })} options={selectNames} onClear={() => setDraft({ ...draft, attribute: "" })} />
          <div className="mt-[27px]"><LineField label={t("Значения через запятую")} value={draft.value} onChange={(value) => setDraft({ ...draft, value })} /></div>
        </Modal>
      )}

      {importOpen && <ImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={saveImport} saving={importSaving} onClose={() => { setImportOpen(false); setImportFile(null) }} />}
    </div>
  )
}
