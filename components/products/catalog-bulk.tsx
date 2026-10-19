"use client"

import { useState, type ReactNode } from "react"

import { CashModal, FormField, MultiPick, PrimaryButton, inputClass } from "@/components/analytics/cash-management-shared"
import { ComboInput, NumberInput } from "@/components/products/catalog-form-parts"
import { KIND_TEXT, Switch, catalogMutate, errorText } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, leadingNumber, type CatalogBulkChanges, type CatalogKind, type CatalogOptions } from "@/lib/products-types"

// Checkbox actions of the list: "Изменить выбранные продукты" (demo ProductMultiUpdate,
// module 2225 — every block is "Изменить …" + its value) and "Добавить лимит"
// ("Добавление лимита", module 2224: Кол-во, Агенты).

type TextKey = "type" | "unit" | "brand" | "organization" | "supplier" | "color"
type FlagKey = "canSell" | "showInBot" | "isMml" | "manualDiscount" | "hideFromAgent"

export function BulkEditDialog({
  kind,
  ids,
  options,
  onClose,
  onSaved,
}: {
  kind: CatalogKind
  ids: number[]
  options: CatalogOptions | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [text, setText] = useState<Record<TextKey, string>>({ type: "", unit: "", brand: "", organization: "", supplier: "", color: "" })
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>({ canSell: true, showInBot: true, isMml: false, manualDiscount: false, hideFromAgent: false })
  const [deleted, setDeleted] = useState("true")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const toggle = (key: string) => setEnabled((current) => ({ ...current, [key]: !current[key] }))

  const block = (key: string, label: string, body: ReactNode) => (
    <div key={key} className="border-b border-[#eef1f5] py-2">
      <label className="flex items-center gap-2 text-[14px] font-semibold text-[#17233b]">
        <input type="checkbox" checked={Boolean(enabled[key])} onChange={() => toggle(key)} className="h-4 w-4 accent-[rgb(79,113,220)]" />
        {t(label)}
      </label>
      {enabled[key] && <div className="mt-2 pl-6">{body}</div>}
    </div>
  )
  const textBlock = (key: TextKey, label: string, field: string, list: string[]) =>
    block(
      key,
      label,
      <FormField label={t(field)}>
        <ComboInput id={`bulk-${key}`} value={text[key]} onChange={(value) => setText((current) => ({ ...current, [key]: value }))} options={list} />
      </FormField>,
    )
  const flagBlock = (key: FlagKey, label: string, title: string, subTitle?: string) =>
    block(
      key,
      label,
      <Switch checked={flags[key]} onChange={(value) => setFlags((current) => ({ ...current, [key]: value }))} title={t(title)} subTitle={subTitle ? t(subTitle) : undefined} />,
    )

  const save = async () => {
    const changes: CatalogBulkChanges = {}
    for (const key of Object.keys(text) as TextKey[]) if (enabled[key]) changes[key] = text[key].trim()
    for (const key of Object.keys(flags) as FlagKey[]) if (enabled[key]) changes[key] = flags[key]
    if (enabled.deleted) changes.deleted = deleted === "true"
    if (enabled.unit && !changes.unit) return setError(t("Обязательное поле"))
    if (!Object.keys(changes).length) return setError(t("Ничего не выбрано"))
    setBusy(true)
    setError("")
    const result = await catalogMutate("POST", `${CATALOG_API[kind]}/bulk`, { ids, changes })
    setBusy(false)
    if (!result.ok) return setError(errorText(result, t))
    onSaved()
  }

  return (
    <CashModal
      title={`${t(KIND_TEXT[kind].multiTitle)} (${ids.length})`}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void save()}>
            {t(kind === "product" ? "Изменить продукты" : "Изменить сырье")}
          </PrimaryButton>
        </>
      }
    >
      {textBlock(
        "type",
        "Изменить тип продукта",
        "Тип продукта",
        (options?.types ?? []).map((type) => type.name),
      )}
      {textBlock("unit", "Изменить мера", "Мера", options?.units ?? [])}
      {textBlock("brand", "Изменить бренд", "Бренд", options?.brands ?? [])}
      {flagBlock("showInBot", "Изменить показать в боте", "Показывать в боте", "Показывать в телеграм боте")}
      {flagBlock("canSell", "Изменить можно продавать", "Можно продавать", "Агенты могут продать этот товар")}
      {textBlock("organization", "Изменить организацию", "Организация", options?.organizations ?? [])}
      {textBlock("color", "Изменить цвет", "Цвет", options?.colors ?? [])}
      {textBlock("supplier", "Изменить поставщик", "Поставщик", options?.suppliers ?? [])}
      {flagBlock("isMml", "Изменить ММЛ продукт", "ММЛ продукт")}
      {block(
        "deleted",
        "Изменить удалённые",
        <select value={deleted} onChange={(event) => setDeleted(event.target.value)} className={inputClass}>
          <option value="true">{t("Удалить")}</option>
          <option value="false">{t("Восстановить")}</option>
        </select>,
      )}
      {flagBlock("manualDiscount", "Изменить статус ручной скидки", "Можно дать ручную скидку")}
      {flagBlock("hideFromAgent", "Изменить скрытие из списка заказов для агента", "Скрыть из списка заказов для агента")}
    </CashModal>
  )
}

export function AddLimitDialog({
  kind,
  ids,
  options,
  onClose,
  onSaved,
}: {
  kind: CatalogKind
  ids: number[]
  options: CatalogOptions | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState("")
  const [agents, setAgents] = useState<string[]>([])
  const [extra, setExtra] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    const chosen = [
      ...agents,
      ...extra
        .split(",")
        .map((agent) => agent.trim())
        .filter(Boolean),
    ]
    if (!amount.trim()) return setError(t("Укажите количество"))
    if (!chosen.length) return setError(t("Выберите агентов"))
    setBusy(true)
    setError("")
    const result = await catalogMutate("POST", `${CATALOG_API[kind]}/limits`, { ids, agents: chosen, amount: leadingNumber(amount) })
    setBusy(false)
    if (!result.ok) return setError(errorText(result, t))
    onSaved()
  }

  return (
    <CashModal
      title={t("Добавление лимита")}
      onClose={onClose}
      size="sm"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void save()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label={t("Кол-во")} required>
          <NumberInput value={amount} onChange={setAmount} />
        </FormField>
        <MultiPick label={t("Агенты")} options={(options?.agents ?? []).map((agent) => ({ value: agent, label: agent }))} value={agents} onChange={setAgents} />
        <FormField label={t("Другой агент")}>
          <input value={extra} onChange={(event) => setExtra(event.target.value)} placeholder={t("Имя агента")} className={inputClass} />
        </FormField>
      </div>
    </CashModal>
  )
}
