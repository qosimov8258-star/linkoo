"use client"

import { useEffect, useState } from "react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogHeader, HoverActions, LineField, LineSelect, Modal, SaveButton, ToggleRow, dottedRow } from "@/components/analytics/catalog-ui"
import { DictionaryDeleteDialog } from "@/components/analytics/dictionaries-shared"
import { useLanguage } from "@/lib/i18n/language-context"

type Attribute = { id: number; name: string; fieldType: string; required: boolean; cacheNumber: number | null }

const fieldTypeOptions = ["Цифровое поле", "Дата выборки", "Текстовое поле", "Выбор вариантов"]
const cacheOptions = Array.from({ length: 10 }, (_, index) => String(index + 1))
const emptyDraft = { name: "", fieldType: "", cacheNumber: "", required: false }

export function AttributesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [items, setItems] = useState<Attribute[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState<Attribute | null>(null)
  const [deleting, setDeleting] = useState<Attribute | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-attributes")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить атрибуты")
        return (await response.json()) as Attribute[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function open(attribute?: Attribute) {
    setError("")
    setEditing(attribute ?? { id: 0, name: "", fieldType: "", required: false, cacheNumber: null })
    setDraft(attribute ? { name: attribute.name, fieldType: attribute.fieldType, cacheNumber: attribute.cacheNumber === null ? "" : String(attribute.cacheNumber), required: attribute.required } : emptyDraft)
  }

  const valid = draft.name.trim() !== "" && draft.fieldType !== ""

  async function save() {
    if (!editing || !valid) return
    setSaving(true)
    setError("")
    try {
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/client-attributes/${editing.id}` : "/api/client-attributes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), fieldType: draft.fieldType, required: draft.required, cacheNumber: draft.cacheNumber ? Number(draft.cacheNumber) : null }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || t("Не удалось сохранить атрибут"))
        return
      }
      const saved = (await response.json()) as Attribute
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  void embedded
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white px-[30px] text-[13px] text-[#333]">
      <CatalogHeader tight addLabel={t("добавить атрибуты")} onAdd={() => open()} from={items.length ? 1 : 0} to={items.length} total={items.length} />
      {loadError && <p className="pt-3 text-red-500">{loadError}</p>}
      <div className={`grid grid-cols-[485px_364px_1fr] ${dottedRow} h-[50px] items-center pt-[3px] font-semibold`}>
        <span>{t("Название")}</span><span>{t("Тип поля")}</span><span>{t("Обязательный к заполнению")}</span>
      </div>
      {loading ? (
        <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className={`group relative grid h-[50px] grid-cols-[485px_364px_1fr] items-center pt-[4px] ${dottedRow} hover:bg-[#f2f5f8]`}>
            <span className="pr-4">{item.name}</span>
            <span>{t(item.fieldType)}</span>
            <span>{t(item.required ? "Обязательный" : "Не обязательный")}</span>
            <HoverActions offset={48} onEdit={() => open(item)} onDelete={() => setDeleting(item)} />
          </div>
        ))
      )}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить атрибут") : t("Добавление атрибута")}
          onClose={() => setEditing(null)}
          width={700}
          bodyClassName="px-[30px] pb-[21px] pt-[43px]"
          footer={<SaveButton disabled={saving || !valid} onClick={() => void save()}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveButton>}
        >
          <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <div className="mt-[26px]"><LineSelect tall label={t("Тип поля")} required value={draft.fieldType ? t(draft.fieldType) : ""} onChange={(value) => setDraft({ ...draft, fieldType: fieldTypeOptions.find((option) => t(option) === value) ?? value })} options={fieldTypeOptions.map((option) => t(option))} onClear={() => setDraft({ ...draft, fieldType: "" })} /></div>
          <div className="mt-[11px]"><LineSelect tall label={t("Кэш-атребут магазина")} value={draft.cacheNumber} onChange={(cacheNumber) => setDraft({ ...draft, cacheNumber })} options={cacheOptions} /></div>
          <div className="mt-[11px]"><ToggleRow checked={draft.required} onChange={(value) => setDraft({ ...draft, required: value })} label={t("Обязательно к заполнению")} /></div>
          <p className="mt-[16px] text-[13px] leading-[16px] text-[#e5484d]">{t("После создания/изменения атрибутов пожалуйста заново авторизуйтесь в системе чтобы данные кеша очистились. Пожалуйста скажите про это агентам тоже.")}</p>
          {error && <p className="mt-[8px] text-[12px] text-[#e5484d]">{error}</p>}
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api="/api/client-attributes"
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
