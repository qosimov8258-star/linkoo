"use client"

import { FormEvent, useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { CatalogHeader, CheckBox, LineField, LineSelect, Modal, SaveButton, dottedRow } from "./catalog-ui"

type Attribute = { id: number; name: string; fieldType: string; allTypes: boolean; types: string[] }
const FIELD_TYPES = ["Выбор вариантов", "Текстовое поле", "Цифровое поле"]

export function ProductAttributesView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<Attribute[]>([])
  const [typeNames, setTypeNames] = useState<string[]>([])
  const [editing, setEditing] = useState<Attribute | null>(null)
  const [draft, setDraft] = useState({ name: "", fieldType: "Выбор вариантов", allTypes: true, types: [] as string[] })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/product-attributes").then((response) => (response.ok ? response.json() : [])).then(setItems)
    fetch("/api/product-types").then((response) => (response.ok ? response.json() : [])).then((rows: { name: string }[]) => setTypeNames(rows.map((row) => row.name)))
  }, [])

  function open(attribute?: Attribute) {
    setEditing(attribute ?? { id: 0, name: "", fieldType: "Выбор вариантов", allTypes: true, types: [] })
    setDraft(attribute ? { name: attribute.name, fieldType: attribute.fieldType, allTypes: attribute.allTypes, types: attribute.types } : { name: "", fieldType: "Выбор вариантов", allTypes: true, types: [] })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !editing) return
    setSaving(true)
    try {
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/product-attributes/${editing.id}` : "/api/product-attributes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), fieldType: draft.fieldType, allTypes: draft.allTypes, types: draft.allTypes ? [] : draft.types }),
      })
      if (!response.ok) throw new Error("save failed")
      const saved = (await response.json()) as Attribute
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
    } catch {
      window.alert(t("Не удалось сохранить атрибут"))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    const response = await fetch(`/api/product-attributes/${id}`, { method: "DELETE" })
    if (response.ok) {
      setItems((list) => list.filter((item) => item.id !== id))
      setEditing(null)
    }
  }

  return (
    <div className="min-w-0 flex-1 px-[30px] text-[13px] text-[#333]">
      <CatalogHeader addLabel={t("добавить атрибуты")} onAdd={() => open()} from={items.length ? 1 : 0} to={items.length} total={items.length} />
      <div className={`grid grid-cols-[332px_444px_1fr] ${dottedRow} h-[49px] items-center pt-[3px] font-bold`}>
        <span>{t("Название атрибута")}</span><span>{t("Типы продуктов")}</span><span>{t("Тип поля")}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} onClick={() => open(item)} className={`grid h-[50px] cursor-pointer grid-cols-[332px_444px_1fr] items-center ${dottedRow} hover:bg-[#f8f9fb]`}>
          <span>{item.name}</span>
          <span>{item.allTypes ? t("Действует для всех типов") : item.types.join(", ")}</span>
          <span>{t(item.fieldType)}</span>
        </div>
      ))}

      {editing && (
        <Modal
          title={editing.id ? t("Изменение атрибута") : t("Добавление атрибута")}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id > 0 && <button type="button" onClick={() => remove(editing.id)} className="mr-auto pl-[30px] text-[12px] font-bold uppercase text-[#e57373] hover:underline">{t("Удалить")}</button>}
              <SaveButton disabled={saving || !draft.name.trim()} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{t("Сохранить")}</SaveButton>
            </>
          }
        >
          <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <div className="mt-[34px]"><LineSelect tall label={t("Тип поля")} required value={draft.fieldType} onChange={(value) => setDraft({ ...draft, fieldType: value })} options={FIELD_TYPES.map((value) => value)} onClear={() => setDraft({ ...draft, fieldType: "" })} /></div>
          <div className="mt-[35px]"><CheckBox checked={draft.allTypes} onChange={(value) => setDraft({ ...draft, allTypes: value })} label={t("Действует для всех типов")} /></div>
          {!draft.allTypes && (
            <div className="mt-[20px] max-h-[140px] space-y-[10px] overflow-y-auto">
              {typeNames.length === 0 && <p className="text-[#9aa3b0]">{t("Нет данных")}</p>}
              {typeNames.map((name) => (
                <CheckBox key={name} checked={draft.types.includes(name)} onChange={(value) => setDraft({ ...draft, types: value ? [...draft.types, name] : draft.types.filter((item) => item !== name) })} label={name} />
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
