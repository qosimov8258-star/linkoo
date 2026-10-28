"use client"

import { useEffect, useState } from "react"

import { AttributeValuesModal } from "@/components/analytics/attribute-values-modal"
import { CatalogHeader, HoverActions, dottedRow } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

type Row = { id: number; attribute: string; values: string[] }
type Attribute = { id: number; name: string; fieldType: string }

export function AttributeValuesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Row[]>([])
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [editing, setEditing] = useState<Row | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

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
        setError(t("Не удалось сохранить значение"))
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

  const listed = attributes.map((attr) => ({ attr, row: rows.find((row) => row.attribute === attr.name) }))
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white px-[30px] text-[13px] text-[#333]">
      {/* Inside the settings layout the page names itself, like the reference's settings pages. */}
      {embedded && <h1 className="pt-[22px] text-[18px] font-bold leading-[22px] text-[#5d6474]">{t("Значение атрибута")}</h1>}
      <CatalogHeader tight addLabel={t("Добавление значения")} onAdd={() => open()} from={listed.length ? 1 : 0} to={listed.length} total={listed.length} />
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
    </div>
  )
}
