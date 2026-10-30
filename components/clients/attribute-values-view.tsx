"use client"

import { useEffect, useState } from "react"

import { AttributeValuesModal } from "@/components/analytics/attribute-values-modal"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { CatalogHeader, HoverActions, dottedRow } from "@/components/analytics/catalog-ui"
import { ExcelImportLink, ExcelRowImportDialog, type ExcelImportSpec } from "@/components/analytics/excel-row-import"
import { importKey, postJson, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

type Row = { id: number; attribute: string; values: string[] }
type Attribute = { id: number; name: string; fieldType: string }

/** "Импорт с Excel" (ours, not in the demo): per attribute (Выбор вариантов) its values of the file are added to the
 * stored ones — one update per attribute (PUT, or POST for an attribute without values yet). */
type ValuesImport = { id: number; attribute: string; values: string[] }

async function listJson<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("load")
  const body = (await response.json()) as unknown
  return Array.isArray(body) ? (body as T[]) : []
}

export function AttributeValuesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Row[]>([])
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [editing, setEditing] = useState<Row | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const canImport = useCanManage(["clients.manage"])

  useEffect(() => {
    fetch("/api/client-attributes").then((response) => (response.ok ? response.json() : [])).then(setAttributes)
    fetch("/api/client-attribute-values").then((response) => (response.ok ? response.json() : [])).then(setRows).catch(() => setRows([]))
  }, [])

  function open(row?: Row, name = "") {
    setError("")
    setEditing(row ?? { id: 0, attribute: name, values: [] })
  }

  async function save(attribute: string, values: string[]) {
    if (!editing) return
    setSaving(true)
    setError("")
    try {
      const id = editing.id || rows.find((row) => row.attribute === attribute)?.id || 0
      const response = await fetch(id ? `/api/client-attribute-values/${id}` : "/api/client-attribute-values", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute, values }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(t(body.error || "Не удалось сохранить значение"))
        return
      }
      const saved = (await response.json()) as Row
      setRows((list) => (id ? list.map((row) => (row.id === saved.id ? saved : row)) : [...list, saved]))
      setEditing(null)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const importSpec: ExcelImportSpec<ValuesImport> = {
    templateName: "attribute-values-template",
    columns: [
      { field: "attribute", header: "Атрибут", aliases: ["Attribute"] },
      { field: "value", header: "Значение", aliases: ["Значения", "Value", "Values"] },
    ],
    keyField: "attribute",
    prepare: async (records) => {
      const [attributeList, stored] = await Promise.all([listJson<Attribute>("/api/client-attributes"), listJson<Row>("/api/client-attribute-values")])
      const byKey = new Map(attributeList.map((attr) => [importKey(attr.name), attr]))
      const groups = new Map<string, PreparedRow<ValuesImport>>()
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        const attr = byKey.get(importKey(values.attribute))
        // Several values in one cell are separated by commas (or semicolons).
        const added = values.value.split(/[,;]/).map((value) => value.trim()).filter(Boolean)
        if (!values.attribute) errors.push({ line, label: t("Атрибут"), message: "Обязательное поле" })
        else if (!attr) errors.push({ line, label: values.attribute, message: "Атрибут не найден" })
        else if (attr.fieldType !== "Выбор вариантов") errors.push({ line, label: attr.name, message: "Значения задаются только для атрибута с выбором вариантов" })
        else if (!added.length) errors.push({ line, label: `${attr.name}, ${t("Значение")}`, message: "Обязательное поле" })
        else if (added.some((value) => value.length > 255)) errors.push({ line, label: `${attr.name}, ${t("Значение")}`, message: "Не более 255 символов" })
        else {
          let group = groups.get(attr.name)
          if (!group) {
            const current = stored.find((row) => row.attribute === attr.name)
            group = { line, label: attr.name, item: { id: current?.id ?? 0, attribute: attr.name, values: [...(current?.values ?? [])] } }
            groups.set(attr.name, group)
          }
          // A value already stored (or repeated in the file) is kept once.
          for (const value of added) if (!group.item.values.some((known) => importKey(known) === importKey(value))) group.item.values.push(value)
        }
      }
      return { rows: [...groups.values()], errors }
    },
    send: (item) =>
      item.id
        ? fetch(`/api/client-attribute-values/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attribute: item.attribute, values: item.values }) })
        : postJson("/api/client-attribute-values", { attribute: item.attribute, values: item.values }),
    fallbackError: "Не удалось сохранить значение",
  }

  const listed = attributes.map((attr) => ({ attr, row: rows.find((row) => row.attribute === attr.name) }))
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white px-[30px] text-[13px] text-[#333]">
      {/* Inside the settings layout the page names itself, like the reference's settings pages. */}
      {embedded && <h1 className="pt-[22px] text-[18px] font-bold leading-[22px] text-[#5d6474]">{t("Значение атрибута")}</h1>}
      <CatalogHeader
        tight
        addLabel={t("Добавление значения")}
        onAdd={() => open()}
        extra={canImport ? <ExcelImportLink onClick={() => setImportOpen(true)} /> : undefined}
        from={listed.length ? 1 : 0}
        to={listed.length}
        total={listed.length}
      />
      <div className={`grid grid-cols-[364px_1fr] ${dottedRow} h-[50px] items-center pt-[3px] font-semibold`}>
        <span>{t("Атрибут")}</span><span>{t("Значение")}</span>
      </div>
      {listed.map(({ attr, row }) => (
        <div key={attr.id} className={`group relative grid min-h-[50px] grid-cols-[364px_1fr] items-center pt-[4px] ${dottedRow} hover:bg-[#f2f5f8]`}>
          <span>{attr.name}</span>
          <span className="flex flex-wrap gap-[10px] py-[7px]">
            {attr.fieldType === "Текстовое поле" ? t("Только ввод текста") : (row?.values ?? []).map((value, index) => <span key={`${value}-${index}`} className="rounded-[3px] bg-[#e9ecef] px-[10px] py-[4px] leading-[18px]">{value}</span>)}
          </span>
          {attr.fieldType === "Выбор вариантов" && <HoverActions offset={79} onEdit={() => open(row, attr.name)} />}
        </div>
      ))}

      {editing && (
        <AttributeValuesModal
          key={`${editing.id}-${editing.attribute}`}
          editing={editing.id > 0}
          attribute={editing.attribute}
          values={editing.values}
          attributes={attributes.map((attr) => attr.name)}
          saving={saving}
          error={error}
          inset={15}
          onSave={(attribute, values) => void save(attribute, values)}
          onClose={() => setEditing(null)}
        />
      )}

      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={() => {
            listJson<Row>("/api/client-attribute-values").then(setRows).catch(() => undefined)
          }}
          onDone={(summary) => {
            setImportOpen(false)
            notify(summary)
          }}
        />
      )}
    </div>
  )
}
