"use client"

import { Check, ChevronDown, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

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

type FieldErrors = Partial<Record<"status" | "fromTime" | "toTime" | "isAll" | "employeeIds", string>>
type Draft = OrderTimeDraft & { isAll: boolean; employeeIds: string[] }
type EmployeeRow = { id: number; name: string; position?: string; active?: boolean }
type Option = { value: string; label: string; hint: string }

const FIELDS = ["status", "fromTime", "toTime", "isAll", "employeeIds"] as const

/** "Время работы" dialog of Ограничение времени: Тип, Начало / Конец (types 3 and 4), for
 * whom the restriction applies and, when only for selected agents, which ones. */
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
    employeeIds: row.employees.map((employee) => String(employee.id)),
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [checked, setChecked] = useState(false)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)
  const [employeesError, setEmployeesError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/employees", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as EmployeeRow[] | { error?: string } | null
        if (!response.ok || !Array.isArray(body)) throw new Error((body && !Array.isArray(body) && body.error) || "Не удалось загрузить сотрудников")
        return body
      })
      .then((list) => {
        if (!cancelled) setEmployees(list)
      })
      .catch((error: Error) => {
        if (!cancelled) setEmployeesError(error.message || "Не удалось загрузить сотрудников")
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Active employees, plus the ones already assigned (even if deactivated since), by name.
  const employeeOptions = useMemo<Option[]>(() => {
    const assigned = new Map(row.employees.map((employee) => [employee.id, employee]))
    const byId = new Map<number, Option>()
    const option = (employee: { id: number; name: string; position?: string; active?: boolean }): Option => ({
      value: String(employee.id),
      label: employee.active === false ? `${employee.name} (${t("Неактивный")})` : employee.name,
      hint: employee.position ?? "",
    })
    for (const employee of employees ?? []) {
      if (employee.active === false && !assigned.has(employee.id)) continue
      byId.set(employee.id, option(employee))
    }
    for (const employee of row.employees) if (!byId.has(employee.id)) byId.set(employee.id, option(employee))
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
    return [...byId.values()].sort((a, b) => collator.compare(a.label, b.label))
  }, [employees, row.employees, t])

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
          employeeIds: draft.employeeIds.map(Number),
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
        // The agents picker is hidden while the restriction applies to everyone: its message goes below.
        const hiddenError = draft.isAll ? fieldErrors.employeeIds : undefined
        if (hiddenError) delete fieldErrors.employeeIds
        setErrors(fieldErrors)
        if (hiddenError) setFormError(hiddenError)
        else if (!Object.keys(fieldErrors).length) setFormError(failure.error || "Не удалось сохранить ограничение")
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
            required
            value={draft.status !== null ? t(ORDER_TIME_STATUS_LABELS[draft.status as 1 | 2 | 3 | 4] ?? "") : ""}
            options={statusLabels}
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

        <div role="radiogroup" className="flex flex-col gap-[12px]">
          <Radio checked={draft.isAll} label="Действует для всех" onChange={() => update({ isAll: true })} />
          <Radio checked={!draft.isAll} label="Действует только для выбранных агентов" onChange={() => update({ isAll: false })} />
          <FieldError text={errors.isAll} />
        </div>

        {!draft.isAll && (
          <div>
            <EmployeesPick options={employeeOptions} loading={employees === null && !employeesError} value={draft.employeeIds} onChange={(next) => update({ employeeIds: next })} />
            <FieldError text={errors.employeeIds || employeesError} />
          </div>
        )}
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
        className={`mt-[4px] h-[28px] w-full border-b bg-transparent text-[13px] outline-none focus:border-[#4f71dc] ${error ? "border-[#e57373]" : "border-[#d5dae1]"}`}
      />
      <FieldError text={error} />
    </label>
  )
}

function Radio({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  const { t } = useLanguage()
  return (
    <label className="flex cursor-pointer items-center gap-[10px] text-[13px]">
      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-[#4f71dc]" : "border-[#757575]"}`}>
        {checked && <span className="h-[8px] w-[8px] rounded-full bg-[#4f71dc]" />}
      </span>
      <input type="radio" name="time-restriction-scope" checked={checked} onChange={onChange} className="sr-only" />
      {t(label)}
    </label>
  )
}

/** "Агенты": underlined multi select with search (an empty choice means nobody, never "all"). */
function EmployeesPick({ options, loading, value, onChange }: { options: Option[]; loading: boolean; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const labels = new Map(options.map((option) => [option.value, option.label]))
  const chosen = value.map((id) => labels.get(id) ?? `#${id}`)
  const needle = query.trim().toLocaleLowerCase()
  const visible = (needle ? options.filter((option) => `${option.label} ${option.hint}`.toLocaleLowerCase().includes(needle)) : options).slice(0, 300)
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        // Escape closes the list first, not the whole dialog.
        if (event.key === "Escape" && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="relative block min-h-[40px] w-full border-b border-[#d5dae1] pb-[6px] pr-12 pt-[16px] text-left">
        <span className={`absolute left-0 ${chosen.length ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{t("Агенты")}</span>
        {chosen.length > 0 && <span className="block text-[13px] leading-5">{chosen.join(", ")}</span>}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-slate-500">
          {chosen.length > 0 && (
            <span role="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onChange([]) }}>
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-0.5 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          <label className="flex items-center gap-2 border-b border-[#eef1f5] px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} aria-label={t("Поиск")} className="h-9 w-full min-w-0 text-[13px] outline-none" />
          </label>
          <div className="max-h-60 overflow-y-auto py-1">
            {loading && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{t("Загрузка...")}</p>}
            {!loading && !visible.length && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
            {visible.map((option) => {
              const on = value.includes(option.value)
              return (
                <button key={option.value} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(option.value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#f2f5f8]">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border-2 ${on ? "border-[#5d6474] bg-[#5d6474] text-white" : "border-[#757575]"}`}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{option.label}</span>
                  {option.hint && <span className="shrink-0 truncate text-[12px] text-[#9aa3b6]">{option.hint}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
