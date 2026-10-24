"use client"

import { useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { LineField, LineSelect, Modal, SaveButton } from "./catalog-ui"

function CircleIcon({ kind, onClick, label }: { kind: "plus" | "minus"; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="mb-[8px] ml-[19px] mr-[9px] shrink-0 text-[#555] hover:text-black">
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current">
        {kind === "plus" ? <path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /> : <path d="M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />}
      </svg>
    </button>
  )
}

/** "Добавление/Изменить значение" dialog of the attribute-value pages: an attribute select + a list of editable values. */
export function AttributeValuesModal({
  editing,
  attribute: initialAttribute,
  values: initialValues,
  attributes,
  saving,
  error,
  inset = 30,
  onSave,
  onClose,
}: {
  editing: boolean
  attribute: string
  values: string[]
  attributes: string[]
  saving: boolean
  error?: string
  /** Horizontal padding of the form: 15 (clients) or 30 (products). */
  inset?: 15 | 30
  onSave: (attribute: string, values: string[]) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [attribute, setAttribute] = useState(initialAttribute)
  const [values, setValues] = useState(initialValues)
  const [draft, setDraft] = useState("")

  function pushDraft() {
    const value = draft.trim()
    if (value) setValues((current) => [...current, value])
    setDraft("")
  }

  function submit() {
    const value = draft.trim()
    onSave(attribute, value ? [...values, value] : values)
  }

  return (
    <Modal
      title={editing ? t("Изменить значение") : t("Добавление значения")}
      onClose={onClose}
      bodyClassName={`${inset === 15 ? "px-[15px]" : "px-[30px]"} min-h-[240px] pb-[24px] pt-[24px]`}
      footer={<SaveButton disabled={saving || !attribute} onClick={submit}>{t("Сохранить")}</SaveButton>}
    >
      <div className="space-y-[12px]">
        <LineSelect label={t("Опции")} required value={attribute} onChange={setAttribute} options={attributes} onClear={() => setAttribute("")} />
        {values.map((value, index) => (
          <div key={index} className="flex items-end">
            <div className="min-w-0 flex-1">
              <LineField label={t("Добавить значение")} value={value} onChange={(next) => setValues((current) => current.map((item, position) => (position === index ? next : item)))} />
            </div>
            <CircleIcon kind="minus" label={t("Удалить")} onClick={() => setValues((current) => current.filter((_, position) => position !== index))} />
          </div>
        ))}
        <div className="flex items-end">
          <div className="min-w-0 flex-1" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); pushDraft() } }}>
            <LineField label={t("Добавить значение")} value={draft} onChange={setDraft} />
          </div>
          <CircleIcon kind="plus" label={t("Добавить значение")} onClick={pushDraft} />
        </div>
      </div>
      {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
    </Modal>
  )
}
