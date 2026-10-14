"use client"

import { Loader2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react"

import { SearchSelect, inputClass, type PickOption } from "@/components/analytics/cash-management-shared"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  CASHBOXES_API,
  CASHBOX_TYPE_LABELS,
  cashboxNameKey,
  type Cashbox,
  type CashboxDetail,
  type CashboxErrorBody,
  type CashboxField,
  type CashboxOptions,
  type CashboxPayload,
  type CashboxType,
} from "./cashboxes-data"

// "Добавить кассу" / "Изменить кассу" (demo module 4335, form CashboxCreateForm):
// Наименование ★, Валюта ★, Кассир ★, Филиал, Тип оплаты ★, Вэнсел, Порядковый номер ★,
// "Сохранить". The selects come from GET /api/cashboxes/options (currencies, employees,
// branches); values of an edited row that are not in those lists (older data) stay
// selectable as they are and are kept unchanged by the server.

/** Select value of a stored cashier / branch that is not in the option list. */
const LEGACY = "legacy"

type Draft = { name: string; currency: string; cashier: string; branch: string; type: CashboxType | ""; vansell: boolean; orderNumber: string }
type Errors = Partial<Record<CashboxField, string>>

const EMPTY_DRAFT: Draft = { name: "", currency: "", cashier: "", branch: "", type: "", vansell: false, orderNumber: "" }

/** Maps a server field name to the dialog field. */
const FIELD_ALIASES: Record<string, CashboxField> = {
  name: "name",
  currency: "currency",
  cashier: "cashier",
  cashierId: "cashier",
  branch: "branch",
  branchId: "branch",
  paymentType: "paymentType",
  type: "paymentType",
  orderNumber: "orderNumber",
}

/** Inline field errors + general error of a failed cashbox request. */
export function cashboxRequestErrors(body: CashboxErrorBody, fallback: string): { fields: Errors; general: string } {
  const fields: Errors = {}
  for (const [key, message] of Object.entries(body.fields ?? {})) if (message && FIELD_ALIASES[key]) fields[FIELD_ALIASES[key]] ??= message
  for (const [key, messages] of Object.entries(body.details?.fieldErrors ?? {})) if (messages?.[0] && FIELD_ALIASES[key]) fields[FIELD_ALIASES[key]] ??= messages[0]
  return { fields, general: Object.keys(fields).length ? "" : body.error || fallback }
}

function draftFromCashbox(cashbox: Cashbox, options: CashboxOptions): Draft {
  const employee =
    options.employees.find((item) => cashbox.cashierId !== null && item.id === cashbox.cashierId) ??
    options.employees.find((item) => cashboxNameKey(item.name) === cashboxNameKey(cashbox.cashier))
  const branch = options.branches.find((item) => cashboxNameKey(item.name) === cashboxNameKey(cashbox.branch))
  return {
    name: cashbox.name,
    currency: cashbox.currency ? normCurrency(cashbox.currency) : "",
    cashier: employee ? String(employee.id) : cashbox.cashier ? LEGACY : "",
    branch: branch ? String(branch.id) : cashbox.branch ? LEGACY : "",
    type: cashbox.type,
    vansell: cashbox.vansell,
    orderNumber: cashbox.orderNumber === null ? "" : String(cashbox.orderNumber),
  }
}

function validate(draft: Draft): Errors {
  const errors: Errors = {}
  if (!draft.name.trim()) errors.name = "Обязательное поле"
  if (!draft.currency) errors.currency = "Обязательное поле"
  if (!draft.cashier) errors.cashier = "Обязательное поле"
  if (!draft.type) errors.paymentType = "Обязательное поле"
  const position = draft.orderNumber.trim()
  if (!position) errors.orderNumber = "Обязательное поле"
  else if (!/^\d+$/.test(position)) errors.orderNumber = "Введите целое число"
  return errors
}

export function CashboxFormModal({
  cashboxId = null,
  onClose,
  onSaved,
}: {
  /** null = create; otherwise loads GET /api/cashboxes/[id] (demo update dialog). */
  cashboxId?: number | null
  onClose: () => void
  onSaved: (cashbox: Cashbox) => void
}) {
  const { t } = useLanguage()
  const isEdit = cashboxId !== null
  const [options, setOptions] = useState<CashboxOptions | null>(null)
  const [cashbox, setCashbox] = useState<CashboxDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState("")
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const json = async <T,>(url: string, fallback: string): Promise<T> => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" })
      const body = (await response.json().catch(() => ({}))) as T & CashboxErrorBody
      if (!response.ok) throw new Error(body.error || fallback)
      return body
    }
    Promise.all([
      json<CashboxOptions>(`${CASHBOXES_API}/options`, "Не удалось загрузить данные"),
      cashboxId === null ? Promise.resolve(null) : json<CashboxDetail>(`${CASHBOXES_API}/${cashboxId}`, "Касса не найдена"),
    ])
      .then(([loadedOptions, loadedCashbox]) => {
        setOptions(loadedOptions)
        setCashbox(loadedCashbox)
        setDraft(loadedCashbox ? draftFromCashbox(loadedCashbox, loadedOptions) : { ...EMPTY_DRAFT, currency: loadedOptions.currencies[0]?.code ?? "" })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [cashboxId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const currencyOptions = useMemo<PickOption[]>(() => {
    const list = (options?.currencies ?? []).map((item) => ({
      value: item.code,
      label: item.label,
      hint: item.name && item.name !== item.code && item.name !== item.label ? item.name : undefined,
    }))
    const stored = cashbox?.currency ? normCurrency(cashbox.currency) : ""
    if (stored && !list.some((item) => item.value === stored)) list.push({ value: stored, label: currencyLabel(stored), hint: undefined })
    return list
  }, [options, cashbox])

  const cashierOptions = useMemo<PickOption[]>(() => {
    const list = (options?.employees ?? [])
      .filter((item) => item.active || String(item.id) === draft?.cashier)
      .map((item) => ({ value: String(item.id), label: item.name, hint: [t(item.position), item.active ? "" : t("Неактивный")].filter(Boolean).join(" · ") || undefined }))
    if (cashbox && options && draftFromCashbox(cashbox, options).cashier === LEGACY) list.unshift({ value: LEGACY, label: cashbox.cashier, hint: t("Нет в списке сотрудников") })
    return list
  }, [options, cashbox, draft?.cashier, t])

  const branchOptions = useMemo<PickOption[]>(() => {
    const list = (options?.branches ?? []).map((item) => ({ value: String(item.id), label: item.name }))
    if (cashbox && options && draftFromCashbox(cashbox, options).branch === LEGACY) list.unshift({ value: LEGACY, label: cashbox.branch })
    return list
  }, [options, cashbox])

  const typeOptions = useMemo<PickOption[]>(
    () => (["cash", "bank"] as const).map((type) => ({ value: type, label: t(CASHBOX_TYPE_LABELS[type]) })),
    [t],
  )

  function change(patch: Partial<Draft>, field: CashboxField | null) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    if (field) setServerErrors((current) => ({ ...current, [field]: undefined }))
    setError("")
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    setTouched(true)
    if (Object.keys(validate(draft)).length) return
    const payload: CashboxPayload = {
      name: draft.name.trim(),
      currency: draft.currency,
      paymentType: draft.type,
      vansell: draft.vansell,
      orderNumber: Number(draft.orderNumber.trim()),
      ...(draft.cashier === LEGACY ? { cashier: cashbox?.cashier ?? "" } : { cashierId: Number(draft.cashier) }),
      ...(draft.branch === LEGACY ? { branch: cashbox?.branch ?? "" } : draft.branch ? { branchId: Number(draft.branch) } : { branchId: null, branch: "" }),
    }
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${CASHBOXES_API}/${cashboxId}` : CASHBOXES_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as Cashbox & CashboxErrorBody
      if (!response.ok) {
        const errors = cashboxRequestErrors(body, "Не удалось сохранить кассу")
        setServerErrors(errors.fields)
        setError(errors.general)
        return
      }
      onSaved(body)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const clientErrors = touched && draft ? validate(draft) : {}
  const fieldError = (field: CashboxField) => {
    const message = clientErrors[field] || serverErrors[field]
    return message ? t(message) : ""
  }
  const busy = saving || (!draft && !loadError)

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:py-10" onMouseDown={onClose}>
      <form onSubmit={save} onMouseDown={(event) => event.stopPropagation()} className="relative w-full max-w-[500px] rounded bg-white shadow-2xl" aria-busy={busy} noValidate>
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[14px] uppercase text-[#333]">{isEdit ? t("Изменить кассу") : t("Добавить кассу")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[450px] space-y-4 px-[30px] pb-6 pt-5">
          {busy && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          {loadError ? (
            <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p>
          ) : (
            draft && (
              <>
                <Field label={t("Наименование")} required error={fieldError("name")}>
                  <input
                    autoFocus
                    aria-label={t("Наименование")}
                    value={draft.name}
                    maxLength={255}
                    onChange={(event) => change({ name: event.target.value }, "name")}
                    className={`${inputClass} ${fieldError("name") ? "border-[#e57373]" : ""}`}
                  />
                </Field>
                <Field label={t("Валюта")} required error={fieldError("currency")}>
                  <SearchSelect value={draft.currency} onChange={(value) => change({ currency: value }, "currency")} options={currencyOptions} invalid={Boolean(fieldError("currency"))} />
                </Field>
                <Field label={t("Кассир")} required error={fieldError("cashier")}>
                  <SearchSelect value={draft.cashier} onChange={(value) => change({ cashier: value }, "cashier")} options={cashierOptions} invalid={Boolean(fieldError("cashier"))} />
                </Field>
                <Field label={t("Филиал")} error={fieldError("branch")}>
                  <SearchSelect
                    value={draft.branch}
                    onChange={(value) => change({ branch: value }, "branch")}
                    options={branchOptions}
                    placeholder={t("Не указано")}
                    invalid={Boolean(fieldError("branch"))}
                  />
                </Field>
                <Field label={t("Тип оплаты")} required error={fieldError("paymentType")}>
                  <SearchSelect
                    value={draft.type}
                    onChange={(value) => change({ type: value === "cash" || value === "bank" ? value : "" }, "paymentType")}
                    options={typeOptions}
                    invalid={Boolean(fieldError("paymentType"))}
                  />
                </Field>
                <label className="flex cursor-pointer items-center gap-3 py-1 text-[14px] text-[#333]">
                  <input
                    type="checkbox"
                    checked={draft.vansell}
                    onChange={(event) => change({ vansell: event.target.checked }, null)}
                    className="h-[18px] w-[18px] accent-[#4f70e7]"
                  />
                  {t("Вэнсел")}
                </label>
                <Field label={t("Порядковый номер")} required error={fieldError("orderNumber")}>
                  <input
                    value={draft.orderNumber}
                    aria-label={t("Порядковый номер")}
                    inputMode="numeric"
                    onChange={(event) => change({ orderNumber: event.target.value }, "orderNumber")}
                    className={`${inputClass} ${fieldError("orderNumber") ? "border-[#e57373]" : ""}`}
                  />
                </Field>
                {error && <p className="text-sm font-medium text-rose-600">{t(error)}</p>}
              </>
            )
          )}
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-4">
          <button type="submit" disabled={busy || Boolean(loadError)} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[13px] text-[#586174]">
      <span>
        {label}
        {required && <span className="text-[#e57373]"> *</span>}
      </span>
      {children}
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
    </div>
  )
}
