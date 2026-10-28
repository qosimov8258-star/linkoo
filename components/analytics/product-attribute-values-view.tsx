"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { AttributeValuesModal } from "./attribute-values-modal"
import { CatalogHeader, HoverActions, dottedRow } from "./catalog-ui"

type Attribute = { id: number; name: string; fieldType: string }
type ValueRow = { id: number; attribute: string; values: string[] }

export function ProductAttributeValuesView() {
  const { t } = useLanguage()
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [rows, setRows] = useState<ValueRow[]>([])
  const [editing, setEditing] = useState<ValueRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/product-attributes").then((response) => (response.ok ? response.json() : [])).then(setAttributes)
    fetch("/api/product-attribute-values").then((response) => (response.ok ? response.json() : [])).then(setRows)
  }, [])

  // The list shows every attribute: select-type ones with their value chips, the others with their field type.
  const listed = attributes.map((attr) => ({ attr, row: rows.find((row) => row.attribute === attr.name) }))
  const selectAttributes = attributes.filter((attr) => attr.fieldType === "Выбор вариантов").map((attr) => attr.name)

  function open(row?: ValueRow, name = "") {
    setError("")
    setEditing(row ?? { id: 0, attribute: name, values: [] })
  }

  async function save(attribute: string, values: string[]) {
    if (!editing) return
    setSaving(true)
    setError("")
    try {
      const id = editing.id || rows.find((row) => row.attribute === attribute)?.id || 0
      const response = await fetch(id ? `/api/product-attribute-values/${id}` : "/api/product-attribute-values", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute, values }),
      })
      if (!response.ok) throw new Error("save failed")
      const saved = (await response.json()) as ValueRow
      setRows((list) => (id ? list.map((row) => (row.id === saved.id ? saved : row)) : [...list, saved]))
      setEditing(null)
    } catch {
      setError(t("Не удалось сохранить значение"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 flex-1 px-[30px] text-[13px] text-[#333]">
      <CatalogHeader addLabel={t("Добавление значения")} onAdd={() => open()} from={listed.length ? 1 : 0} to={listed.length} total={listed.length} />
      <div className={`grid grid-cols-[308px_1fr] ${dottedRow} h-[49px] items-center pt-[3px] font-bold`}>
        <span>{t("Атрибут")}</span><span>{t("Значение")}</span>
      </div>
      {listed.map(({ attr, row }) => (
        <div key={attr.id} className={`group relative grid min-h-[50px] grid-cols-[308px_1fr] items-center ${dottedRow}`}>
          <span>{attr.name}</span>
          <span className="flex flex-wrap gap-[10px] py-[7px]">
            {attr.fieldType !== "Выбор вариантов" ? t(attr.fieldType) : (row?.values ?? []).map((value, index) => <span key={`${value}-${index}`} className="rounded-[3px] bg-[#e9ecef] px-[10px] py-[4px] leading-[18px]">{value}</span>)}
          </span>
          {attr.fieldType === "Выбор вариантов" && <HoverActions offset={60} onEdit={() => open(row, attr.name)} />}
        </div>
      ))}

      {editing && (
        <AttributeValuesModal
          key={`${editing.id}-${editing.attribute}`}
          editing={editing.id > 0}
          attribute={editing.attribute}
          values={editing.values}
          attributes={selectAttributes}
          saving={saving}
          error={error}
          onSave={(attribute, values) => void save(attribute, values)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
