"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { type PickOption } from "@/components/analytics/cash-management-shared"
import { CheckBox, LineField, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { LinePick } from "@/components/analytics/settings-list-kit"
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

/** The dialog lists the payment types capitalized ("Банковский счет" / "Наличный"); the grid keeps them lower case. */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

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
        setDraft(loadedCashbox ? draftFromCashbox(loadedCashbox, loadedOptions) : EMPTY_DRAFT)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [cashboxId])

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
    () => (["bank", "cash"] as const).map((type) => ({ value: type, label: t(capitalize(CASHBOX_TYPE_LABELS[type])) })),
    [t],
  )

  function change(patch: Partial<Draft>, field: CashboxField | null) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    if (field) setServerErrors((current) => ({ ...current, [field]: undefined }))
    setError("")
  }

  async function save() {
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

  const currencyItems = currencyOptions.map(({ value, label }) => ({ value, label }))
  const cashierItems = cashierOptions.map(({ value, label }) => ({ value, label }))
  const branchItems = branchOptions.map(({ value, label }) => ({ value, label }))
  const typeItems = typeOptions.map(({ value, label }) => ({ value, label }))
  const textField = (label: string, field: CashboxField, value: string, onChange: (value: string) => void, required = true) => (
    <div className={fieldError(field) ? "[&>div]:border-[#e57373]" : ""}>
      <LineField label={label} required={required} value={value} onChange={onChange} />
      {fieldError(field) && <span className="mt-[2px] block text-[12px] text-[#e57373]">{fieldError(field)}</span>}
    </div>
  )

  return (
    <Modal
      title={isEdit ? t("Изменить кассу") : t("Добавить кассу")}
      onClose={onClose}
      bodyClassName="relative min-h-[390px] pl-[30px] pr-[52px] pb-[60px] pt-[13px]"
      footer={<SaveButton disabled={busy || Boolean(loadError)} onClick={() => void save()}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveButton>}
    >
      {busy && !saving && <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80"><Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" /></div>}
      {loadError ? (
        <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p>
      ) : (
        draft && (
          <>
            {textField(t("Наименование"), "name", draft.name, (name) => change({ name }, "name"))}
            <div className="mt-[27px]"><LinePick label={t("Валюта")} required value={draft.currency} options={currencyItems} onChange={(value) => change({ currency: value }, "currency")} error={fieldError("currency")} /></div>
            <div className="mt-[22px]"><LinePick label={t("Кассир")} required value={draft.cashier} options={cashierItems} onChange={(value) => change({ cashier: value }, "cashier")} error={fieldError("cashier")} /></div>
            <div className="mt-[22px]"><LinePick label={t("Филиал")} value={draft.branch} options={branchItems} onChange={(value) => change({ branch: value }, "branch")} error={fieldError("branch")} /></div>
            <div className="mt-[22px]">
              <LinePick
                label={t("Тип оплаты")}
                required
                value={draft.type}
                options={typeItems}
                onChange={(value) => change({ type: value === "cash" || value === "bank" ? value : "" }, "paymentType")}
                error={fieldError("paymentType")}
              />
            </div>
            <div className="mb-[11px] mt-[9px] flex h-[24px] items-center"><CheckBox label={t("Вэнсел")} checked={draft.vansell} onChange={(vansell) => change({ vansell }, null)} /></div>
            {textField(t("Порядковый номер"), "orderNumber", draft.orderNumber, (orderNumber) => change({ orderNumber }, "orderNumber"))}
            {error && <p className="mt-3 text-sm font-medium text-rose-600">{t(error)}</p>}
          </>
        )
      )}
    </Modal>
  )
}
