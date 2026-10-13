"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { CatalogHeader, LineSelect, Modal, SaveButton, dottedRow } from "./catalog-ui"

type Attribute = { id: number; name: string; fieldType: string }
type ValueRow = { id: number; attribute: string; values: string[] }

export function ProductAttributeValuesView() {
  const { t } = useLanguage()
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [rows, setRows] = useState<ValueRow[]>([])
  const [editing, setEditing] = useState<ValueRow | null>(null)
  const [attribute, setAttribute] = useState("")
  const [values, setValues] = useState<string[]>([])
  const [input, setInput] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/product-attributes").then((response) => (response.ok ? response.json() : [])).then(setAttributes)
    fetch("/api/product-attribute-values").then((response) => (response.ok ? response.json() : [])).then(setRows)
  }, [])

  // The list shows every attribute: select-type ones with their value chips, the others with their field type.
  const listed = attributes.map((attr) => ({ attr, row: rows.find((row) => row.attribute === attr.name) }))

  function open(row?: ValueRow, name = "") {
    setEditing(row ?? { id: 0, attribute: name, values: [] })
    setAttribute(row?.attribute ?? name)
    setValues(row?.values ?? [])
    setInput("")
  }

  function addValue() {
    const value = input.trim()
    if (value && !values.includes(value)) setValues((current) => [...current, value])
    setInput("")
  }

  async function save() {
    if (!attribute || !editing) return
    setSaving(true)
    try {
      const finalValues = input.trim() && !values.includes(input.trim()) ? [...values, input.trim()] : values
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/product-attribute-values/${editing.id}` : "/api/product-attribute-values", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute, values: finalValues }),
      })
      if (!response.ok) throw new Error("save failed")
      const saved = (await response.json()) as ValueRow
      setRows((list) => (isEdit ? list.map((row) => (row.id === saved.id ? saved : row)) : [...list, saved]))
      setEditing(null)
    } catch {
      window.alert(t("Не удалось сохранить значение"))
    } finally {
      setSaving(false)
    }
  }

  const selectAttributes = attributes.filter((attr) => attr.fieldType === "Выбор вариантов").map((attr) => attr.name)

  return (
    <div className="min-w-0 flex-1 px-[30px] text-[13px] text-[#333]">
      <CatalogHeader addLabel={t("Добавление значения")} onAdd={() => open()} from={listed.length ? 1 : 0} to={listed.length} total={listed.length} />
      <div className={`grid grid-cols-[332px_1fr] ${dottedRow} h-[49px] items-center pt-[3px] font-bold`}>
        <span>{t("Атрибут")}</span><span>{t("Значение")}</span>
      </div>
      {listed.map(({ attr, row }) => (
        <div key={attr.id} onClick={() => attr.fieldType === "Выбор вариантов" && open(row, attr.name)} className={`grid h-[50px] grid-cols-[332px_1fr] items-center ${dottedRow} ${attr.fieldType === "Выбор вариантов" ? "cursor-pointer hover:bg-[#f8f9fb]" : ""}`}>
          <span>{attr.name}</span>
          <span className="flex flex-wrap gap-[6px]">
            {attr.fieldType !== "Выбор вариантов" ? t(attr.fieldType) : (row?.values ?? []).map((value) => <span key={value} className="rounded-[3px] bg-[#e9ecef] px-[10px] py-[6px]">{value}</span>)}
          </span>
        </div>
      ))}

      {editing && (
        <Modal title={editing.id ? t("Изменение значения") : t("Добавление значения")} onClose={() => setEditing(null)} footer={<SaveButton disabled={saving || !attribute} onClick={save}>{t("Сохранить")}</SaveButton>}>
          <LineSelect label={t("Атрибут")} required value={attribute} onChange={setAttribute} options={selectAttributes} onClear={() => setAttribute("")} />
          <div className="mt-[27px] flex flex-wrap gap-[6px]">
            {values.map((value) => (
              <span key={value} className="flex items-center gap-[8px] rounded-[3px] bg-[#e9ecef] px-[10px] py-[6px]">
                {value}
                <button type="button" onClick={() => setValues((current) => current.filter((item) => item !== value))} aria-label={t("Удалить")} className="text-[#777]"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addValue() } }}
            placeholder={t("Значение")}
            className="mt-[20px] h-[34px] w-full border-b border-[#d5dae1] bg-transparent text-[13px] font-bold outline-none placeholder:text-[#333]"
          />
        </Modal>
      )}
    </div>
  )
}
