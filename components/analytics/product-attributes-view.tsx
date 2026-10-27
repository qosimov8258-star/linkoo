"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { CashSnackbar, type SnackbarMessage } from "./cash-management-shared"
import { CatalogHeader, CheckBox, HoverActions, LineField, LineSelect, Modal, SaveButton, dottedRow } from "./catalog-ui"
import { DictionaryDeleteDialog } from "./dictionaries-shared"
import { LineMultiSelect } from "./line-multi-select"

type Attribute = { id: number; name: string; fieldType: string; allTypes: boolean; types: string[] }
const FIELD_TYPES = ["Выбор вариантов", "Текстовое поле", "Цифровое поле"]
const emptyDraft = { name: "", fieldType: "Выбор вариантов", allTypes: true, types: [] as string[] }

export function ProductAttributesView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<Attribute[]>([])
  const [typeNames, setTypeNames] = useState<string[]>([])
  const [typesLoading, setTypesLoading] = useState(true)
  const [editing, setEditing] = useState<Attribute | null>(null)
  const [deleting, setDeleting] = useState<Attribute | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)

  useEffect(() => {
    fetch("/api/product-attributes").then((response) => (response.ok ? response.json() : [])).then(setItems)
    fetch("/api/product-types")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name: string }[]) => setTypeNames(rows.map((row) => row.name)))
      .finally(() => setTypesLoading(false))
  }, [])

  function open(attribute?: Attribute) {
    setError("")
    setEditing(attribute ?? { id: 0, name: "", fieldType: "Выбор вариантов", allTypes: true, types: [] })
    setDraft(attribute ? { name: attribute.name, fieldType: attribute.fieldType, allTypes: attribute.allTypes, types: attribute.types } : emptyDraft)
  }

  const valid = draft.name.trim() !== "" && draft.fieldType !== "" && (draft.allTypes || draft.types.length > 0)

  async function save() {
    if (!valid || !editing) return
    setSaving(true)
    setError("")
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
      setNotice({ text: "Успешно сохранено", tone: "success" })
    } catch {
      setError(t("Не удалось сохранить атрибут"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 flex-1 px-[30px] text-[13px] text-[#333]">
      <CatalogHeader addLabel={t("добавить атрибуты")} onAdd={() => open()} from={items.length ? 1 : 0} to={items.length} total={items.length} />
      <div className={`grid grid-cols-[307px_410px_1fr] ${dottedRow} h-[52px] items-center pt-[2px] font-bold`}>
        <span>{t("Название атрибута")}</span><span>{t("Типы продуктов")}</span><span>{t("Тип поля")}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className={`group relative grid h-[50px] grid-cols-[307px_410px_1fr] items-center ${dottedRow} hover:bg-[#f2f5f8]`}>
          <span>{item.name}</span>
          <span>{item.allTypes ? t("Действует для всех типов") : item.types.join(", ")}</span>
          <span>{t(item.fieldType)}</span>
          <HoverActions offset={29} onEdit={() => open(item)} onDelete={() => setDeleting(item)} />
        </div>
      ))}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить атрибут") : t("Добавление атрибута")}
          onClose={() => setEditing(null)}
          width={700}
          bodyClassName="px-[30px] pb-[24px] pt-[38px]"
          footer={<SaveButton disabled={saving || !valid} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
        >
          <div className="min-h-[238px]">
            <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
            {!draft.allTypes && (
              <div className="mt-[26px]"><LineMultiSelect label={t("Категории")} required value={draft.types} onChange={(types) => setDraft({ ...draft, types })} options={typeNames} loading={typesLoading} /></div>
            )}
            <div className="mt-[26px]"><LineSelect tall label={t("Тип поля")} required value={draft.fieldType} onChange={(value) => setDraft({ ...draft, fieldType: value })} options={FIELD_TYPES} onClear={() => setDraft({ ...draft, fieldType: "" })} /></div>
            <div className="mt-[35px]"><CheckBox checked={draft.allTypes} onChange={(value) => setDraft({ ...draft, allTypes: value })} label={t("Действует для всех типов")} /></div>
            {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
          </div>
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api="/api/product-attributes"
          id={deleting.id}
          name={`${t("Атрибут")}: ${deleting.name}`}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setItems((list) => list.filter((item) => item.id !== deleting.id))
            setDeleting(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      <CashSnackbar message={notice} onClose={() => setNotice(null)} />
    </div>
  )
}
