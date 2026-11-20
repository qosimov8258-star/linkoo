"use client"

import { useState } from "react"

import { LineSelect, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  ORDER_TIME_STATUSES,
  ORDER_TIME_STATUS_LABELS,
  clockText,
  orderTimeDraftErrors,
  statusNeedsTimes,
  type OrderTimeDraft,
  type OrderTimeRestriction,
} from "@/lib/order-time-restrictions-rules"

type FieldErrors = Partial<Record<"status" | "fromTime" | "toTime" | "isAll", string>>
type Draft = OrderTimeDraft & { isAll: boolean }

const FIELDS = ["status", "fromTime", "toTime", "isAll"] as const

/** "Время работы" dialog of Ограничение времени, as Linko's: Тип, Начало / Конец (types 3 and 4) and for whom the
 * restriction applies. Which agents a "only for selected agents" row covers is each employee's own setting
 * («Ограничения времени» of Сотрудники), as in Linko, so the dialog has no agent picker. */
export function TimeRestrictionDialog({
  row,
  onClose,
  onSaved,
}: {
  row: OrderTimeRestriction
  onClose: () => void
  onSaved: (row: OrderTimeRestriction) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<Draft>(() => ({
    status: row.status,
    fromTime: clockText(row.fromTime),
    toTime: clockText(row.toTime),
    isAll: row.isAll,
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [checked, setChecked] = useState(false)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const statusLabels = ORDER_TIME_STATUSES.map((status) => t(ORDER_TIME_STATUS_LABELS[status]))
  const needsTimes = draft.status !== null && statusNeedsTimes(draft.status)

  function update(patch: Partial<Draft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    setFormError("")
    // Once the form was checked, a message disappears as soon as its field is right.
    if (checked) setErrors(orderTimeDraftErrors(next))
    else if (Object.keys(patch).some((key) => key in errors)) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))))
  }

  async function save() {
    if (saving) return
    const found = orderTimeDraftErrors(draft)
    setChecked(true)
    setErrors(found)
    setFormError("")
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const response = await fetch(`/api/order-time-restrictions/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: draft.status,
          fromTime: needsTimes ? draft.fromTime : null,
          toTime: needsTimes ? draft.toTime : null,
          isAll: draft.isAll,
        }),
      })
      const body = (await response.json().catch(() => null)) as unknown
      if (!response.ok || !body || typeof body !== "object" || "error" in body) {
        const failure = (body ?? {}) as { error?: string; field?: string | null; details?: { fieldErrors?: Record<string, string[]> } }
        const fieldErrors: FieldErrors = {}
        for (const field of FIELDS) {
          const message = failure.details?.fieldErrors?.[field]?.[0] ?? (failure.field === field ? failure.error : undefined)
          if (message) fieldErrors[field] = message
        }
        setErrors(fieldErrors)
        if (!Object.keys(fieldErrors).length) setFormError(failure.error || "Не удалось сохранить ограничение")
        return
      }
      onSaved(body as OrderTimeRestriction)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Время работы"
      onClose={onClose}
      footer={
        <>
          {formError && <span className="mr-auto pl-[30px] text-[12px] text-[#e57373]">{t(formError)}</span>}
          <SaveButton disabled={saving} onClick={() => void save()}>{t("Применить")}</SaveButton>
        </>
      }
    >
      <div className="flex flex-col gap-[22px]">
        <div>
          <LineSelect
            label="Тип"
            value={draft.status !== null ? t(ORDER_TIME_STATUS_LABELS[draft.status as 1 | 2 | 3 | 4] ?? "") : ""}
            options={statusLabels}
            onClear={() => update({ status: null })}
            onChange={(label) => {
              const index = statusLabels.indexOf(label)
              if (index >= 0) update({ status: ORDER_TIME_STATUSES[index] })
            }}
          />
          <FieldError text={errors.status} />
        </div>

        <div className="flex justify-between gap-[4%]" style={{ visibility: needsTimes ? "visible" : "hidden" }} aria-hidden={!needsTimes}>
          <TimeField label="Начало" value={draft.fromTime} error={errors.fromTime} onChange={(value) => update({ fromTime: value })} />
          <TimeField label="Конец" value={draft.toTime} error={errors.toTime} onChange={(value) => update({ toTime: value })} />
        </div>

        <div role="radiogroup" className="flex flex-col gap-[10px]">
          <Radio checked={draft.isAll} label="Действует для всех" onChange={() => update({ isAll: true })} />
          <Radio checked={!draft.isAll} label="Действует только для выбранных агентов" onChange={() => update({ isAll: false })} />
          <FieldError text={errors.isAll} />
        </div>

      </div>
    </Modal>
  )
}

function FieldError({ text }: { text?: string }) {
  const { t } = useLanguage()
  if (!text) return null
  return <p role="alert" className="mt-[5px] text-[12px] text-[#e57373]">{t(text)}</p>
}

/** Underlined 24-hour time field (minutes precision) with its label above, like the reference's clock fields. */
function TimeField({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  return (
    <label className="block w-[48%] min-w-0">
      <span className="block text-[10px] font-semibold leading-3">
        {t(label)}
        <span className="text-red-500"> *</span>
      </span>
      <input
        type="time"
        step={60}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className={`mt-[4px] h-[28px] w-full border-b bg-transparent text-[13px] outline-none focus:border-[#1E4A9A] ${error ? "border-[#e57373]" : "border-[#d5dae1]"}`}
      />
      <FieldError text={error} />
    </label>
  )
}

function Radio({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  const { t } = useLanguage()
  return (
    <label className="flex cursor-pointer items-center gap-[16px] text-[13px] text-[#333]">
      <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center">
        <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 ${checked ? "border-[#5d6474]" : "border-[#333]"}`}>
          {checked && <span className="h-[10px] w-[10px] rounded-full bg-[#5d6474]" />}
        </span>
      </span>
      <input type="radio" name="time-restriction-scope" checked={checked} onChange={onChange} className="sr-only" />
      {t(label)}
    </label>
  )
}
