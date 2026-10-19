"use client"

import { useEffect, useMemo, useState } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ConfirmDialog, FormField, PrimaryButton, SearchSelect, inputClass, useCashRates } from "@/components/analytics/cash-management-shared"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  PRICE_LISTS_API,
  PRICE_LIST_CALC_METHODS,
  PRICE_ROUND_STEPS,
  calcMethodById,
  mutateJson,
  mutationMessage,
  type PriceList,
  type PriceListErrorBody,
  type PriceListInputBody,
  type PriceListUsage,
} from "./price-lists-data"

// Dialogs of "Прайс-листы": the create / update form (demo PriceListSettingCreateForm, c94 module
// 4410: Наименование*, Валюта*, Порядок, "Связать прайс-лист" → Прайс лист + Метод расчета + one
// field per method key; plus Активный / По умолчанию для заказа) and the delete confirm (a refused
// delete shows "Удаление невозможно из-за связи с другими данными" and where the list is used).

type Draft = {
  name: string
  currency: string
  position: string
  isActive: boolean
  isDefaultForOrder: boolean
  isConnected: boolean
  connectedId: string
  methodId: string
  values: Record<string, string>
}

function draftOf(list: PriceList | null): Draft {
  return {
    name: list?.name ?? "",
    currency: list?.currency ?? "",
    position: list ? String(list.position) : "",
    isActive: list?.isActive ?? true,
    isDefaultForOrder: list?.isDefaultForOrder ?? false,
    isConnected: Boolean(list?.connectedPriceList),
    connectedId: list?.connectedPriceList ? String(list.connectedPriceList.id) : "",
    methodId: list?.calcMethodId ?? "",
    values: Object.fromEntries((list?.methodValues ?? []).map((item) => [item.methodKey, String(item.value)])),
  }
}

export function PriceListFormDialog({ priceListId, onClose, onSaved }: { priceListId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { codes } = useCashRates()
  const detail = useCashJson<PriceList>(priceListId ? `${PRICE_LISTS_API}/${priceListId}` : null)
  const lists = useCashJson<PriceList[]>(`${PRICE_LISTS_API}?active=all`)
  const [draft, setDraft] = useState<Draft>(() => draftOf(null))
  const [loaded, setLoaded] = useState(priceListId === null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!detail.data || loaded) return
    setDraft(draftOf(detail.data))
    setLoaded(true)
  }, [detail.data, loaded])

  const method = calcMethodById(draft.methodId)
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const currencyOptions = useMemo(() => [...new Set([...codes, ...(draft.currency ? [draft.currency] : [])])].map((code) => ({ value: code, label: currencyLabel(code) })), [codes, draft.currency])
  const listOptions = (lists.data ?? []).filter((list) => list.id !== priceListId).map((list) => ({ value: String(list.id), label: list.name }))

  async function submit() {
    const nextErrors: Record<string, string> = {}
    if (!draft.name.trim()) nextErrors.name = t("Обязательное поле")
    if (!draft.currency) nextErrors.currency = t("Обязательное поле")
    if (draft.isConnected && !draft.connectedId) nextErrors.connectedPriceList = t("Обязательное поле")
    if (draft.position.trim() && !Number.isFinite(Number(draft.position.replace(",", ".")))) nextErrors.position = t("Введите число")
    for (const key of method?.keys ?? []) {
      const raw = (draft.values[key.id] ?? "").replace(/\s/g, "").replace(",", ".")
      if (raw && !Number.isFinite(Number(raw))) nextErrors[key.id] = t("Введите число")
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const body: PriceListInputBody = {
      name: draft.name.trim(),
      currency: draft.currency,
      position: draft.position.trim() ? Math.trunc(Number(draft.position.replace(",", "."))) : 0,
      isActive: draft.isActive,
      isDefaultForOrder: draft.isDefaultForOrder,
      connectedPriceListId: draft.isConnected ? Number(draft.connectedId) : null,
      calcMethodId: draft.isConnected && draft.methodId ? draft.methodId : null,
      methodValues: draft.isConnected && method ? method.keys.map((key) => ({ methodKey: key.id, value: Number((draft.values[key.id] ?? "").replace(/\s/g, "").replace(",", ".")) || 0 })) : [],
    }
    setBusy(true)
    setError("")
    const result = await mutateJson<PriceList>(priceListId ? "PUT" : "POST", priceListId ? `${PRICE_LISTS_API}/${priceListId}` : PRICE_LISTS_API, body)
    setBusy(false)
    if (result.ok) return onSaved()
    const fields = (result.body as PriceListErrorBody | null)?.fields
    if (fields) setErrors(Object.fromEntries(Object.entries(fields).map(([name, message]) => [name, t(message)])))
    setError(t(mutationMessage(result)))
  }

  const check = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className="flex items-center gap-3 text-[14px] text-[#17233b]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#4f71dc]" />
      {label}
    </label>
  )

  return (
    <CashModal
      title={priceListId ? t("Изменить прайс-лист") : t("Добавить прайс-лист")}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} disabled={!loaded} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      {!loaded ? (
        <p className="py-10 text-center text-[#586174]">{detail.error ? t(detail.error) : t("Загрузка...")}</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FormField label={t("Наименование")} required error={errors.name}>
            <input value={draft.name} maxLength={200} autoFocus onChange={(event) => set({ name: event.target.value })} className={inputClass} />
          </FormField>
          <FormField label={t("Валюта")} required error={errors.currency}>
            <SearchSelect value={draft.currency} options={currencyOptions} invalid={Boolean(errors.currency)} allowClear={false} onChange={(currency) => set({ currency })} />
          </FormField>
          <FormField label={t("Порядок")} error={errors.position}>
            <input value={draft.position} inputMode="numeric" onChange={(event) => set({ position: event.target.value.replace(/[^\d-]/g, "") })} className={inputClass} />
          </FormField>
          {check(t("Активный"), draft.isActive, (isActive) => set({ isActive }))}
          {check(t("По умолчанию для заказа"), draft.isDefaultForOrder, (isDefaultForOrder) => set({ isDefaultForOrder }))}
          {check(t("Связать прайс-лист"), draft.isConnected, (isConnected) => set({ isConnected }))}
          {draft.isConnected && (
            <div className="flex flex-col gap-4 border-l-2 border-[#4f71dc]/30 pl-4">
              <FormField label={t("Прайс лист")} required error={errors.connectedPriceList}>
                <SearchSelect value={draft.connectedId} options={listOptions} loading={lists.loading} invalid={Boolean(errors.connectedPriceList)} onChange={(connectedId) => set({ connectedId })} />
              </FormField>
              <FormField label={t("Метод расчета")} error={errors.calcMethod}>
                <SearchSelect
                  value={draft.methodId}
                  options={PRICE_LIST_CALC_METHODS.map((item) => ({ value: item.id, label: t(item.name) }))}
                  onChange={(methodId) => set({ methodId })}
                />
              </FormField>
              {method?.keys.map((key) =>
                key.id === "round" ? (
                  <FormField key={key.id} label={t(key.name)} error={errors[key.id]}>
                    <SearchSelect
                      value={draft.values.round ?? ""}
                      options={PRICE_ROUND_STEPS.map((step) => ({ value: String(step), label: String(step) }))}
                      onChange={(value) => set({ values: { ...draft.values, round: value } })}
                    />
                  </FormField>
                ) : (
                  <FormField key={key.id} label={t(key.name)} error={errors[key.id]}>
                    <input
                      value={draft.values[key.id] ?? ""}
                      inputMode="decimal"
                      onChange={(event) => set({ values: { ...draft.values, [key.id]: event.target.value } })}
                      className={inputClass}
                    />
                  </FormField>
                ),
              )}
            </div>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </CashModal>
  )
}

/** "Продукты (3), Филиалы (1)" in the UI language. */
export function priceListUsageText(usage: PriceListUsage[], t: (text: string) => string): string {
  return usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")
}

export function PriceListDeleteDialog({
  priceList,
  onClose,
  onDeleted,
  onFailed,
}: {
  priceList: { id: number; name: string }
  onClose: () => void
  onDeleted: () => void
  onFailed: (message: string) => void
}) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<PriceListUsage[]>([])

  async function remove() {
    setBusy(true)
    const result = await mutateJson("DELETE", `${PRICE_LISTS_API}/${priceList.id}`)
    setBusy(false)
    if (result.ok) return onDeleted()
    const blockedBy = (result.body as PriceListErrorBody | null)?.usage ?? []
    setUsage(blockedBy)
    const base = t(mutationMessage(result) || "Удаление невозможно из-за связи с другими данными")
    onFailed(blockedBy.length ? `${base}: ${priceListUsageText(blockedBy, t)}` : base)
  }

  return (
    <ConfirmDialog title={t("Подтверждение удаления")} text={t("Вы уверены что хотите удалить эти данные?")} busy={busy} onConfirm={() => (usage.length ? onClose() : void remove())} onClose={onClose} confirmLabel={usage.length ? "Закрыть" : "Удалить"}>
      <div className="-mx-4 mt-4 bg-[#f1f5f8] px-4 py-4 font-semibold text-[#17233b] sm:-mx-6 sm:px-6">{priceList.name}</div>
      {usage.length > 0 && (
        <div className="pt-4 text-[14px] text-[#f44336]">
          <p>{t("Удаление невозможно из-за связи с другими данными")}:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {usage.map((item) => (
              <li key={item.table}>
                {t(item.label)} — {item.count}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-[#586174]">{t("Прайс-лист можно сделать неактивным: он пропадёт из списков выбора, цены сохранятся.")}</p>
        </div>
      )}
    </ConfirmDialog>
  )
}
