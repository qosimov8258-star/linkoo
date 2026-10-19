"use client"

import type { ReactNode } from "react"
import { Info, Plus, Trash2 } from "lucide-react"

import { FormField, inputClass } from "@/components/analytics/cash-management-shared"
import { Switch } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"

// Field arrays of the product form: barcodes (demo module 3938), prices (2356) and box
// sizes (3939), plus the small inputs they share.

export type PriceDraft = { name: string; cash: string; currency: string; nonCash: string; nonCashCurrency: string; minMax: boolean; min: string; max: string }
export type BoxSizeDraft = { unit: string; height: string; width: string; length: string }

/** Free text with suggestions (the demo search fields + "create" links). */
export function ComboInput({
  id,
  value,
  onChange,
  options,
  invalid,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: string[]
  invalid?: boolean
  placeholder?: string
}) {
  return (
    <>
      <input
        list={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${inputClass} ${invalid ? "border-[#e57373]" : ""}`}
      />
      <datalist id={id}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  )
}

/** "?" tooltip of the demo form. */
export function Hint({ text }: { text: string }) {
  const { t } = useLanguage()
  return (
    <span title={t(text)} className="inline-flex cursor-help text-[#4f71dc]">
      <Info className="h-4 w-4" />
    </span>
  )
}

export function LabelWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label} <Hint text={hint} />
    </span>
  )
}

export function NumberInput({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/[^\d.,\s-]/g, ""))}
      className={`${inputClass} ${invalid ? "border-[#e57373]" : ""}`}
    />
  )
}

/** EAN-13 starting with "2" (in-store numbering), check digit included. */
export function generateBarcode(): string {
  const digits = `2${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${digits}${(10 - (sum % 10)) % 10}`
}

export function BarcodesEditor({ value, onChange, error }: { value: string[]; onChange: (value: string[]) => void; error?: string }) {
  const { t } = useLanguage()
  const rows = value.length ? value : [""]
  return (
    <div className="flex flex-col gap-2">
      {rows.map((code, index) => (
        <div key={index} className="flex items-end gap-2">
          <FormField label={t("Штрих-код")} className="flex-1">
            <input
              value={code}
              onChange={(event) => onChange(rows.map((item, i) => (i === index ? event.target.value : item)))}
              className={`${inputClass} ${error ? "border-[#e57373]" : ""}`}
            />
          </FormField>
          <button
            type="button"
            onClick={() => onChange(rows.map((item, i) => (i === index ? generateBarcode() : item)))}
            className="h-10 whitespace-nowrap px-1 text-[13px] text-[#4f71dc] hover:underline"
          >
            {t("Сгенерировать")}
          </button>
          <button
            type="button"
            onClick={() => onChange(index === rows.length - 1 ? [...rows, ""] : rows.filter((_, i) => i !== index))}
            className="h-10 whitespace-nowrap px-1 text-[13px] text-[#4f71dc] hover:underline"
          >
            {index === rows.length - 1 ? t("Добавить еще") : t("Убрать")}
          </button>
        </div>
      ))}
      {error && <span className="text-[12px] text-[#e57373]">{t(error)}</span>}
    </div>
  )
}

export function emptyPrice(name = "", currency = "SUM"): PriceDraft {
  return { name, cash: "", currency, nonCash: "", nonCashCurrency: currency, minMax: false, min: "", max: "" }
}

export function PricesEditor({
  value,
  onChange,
  priceLists,
  currencies,
  error,
}: {
  value: PriceDraft[]
  onChange: (value: PriceDraft[]) => void
  priceLists: Array<{ name: string; currency: string }>
  currencies: string[]
  error?: string
}) {
  const { t } = useLanguage()
  const names = [...new Set([...priceLists.map((entry) => entry.name), ...value.map((entry) => entry.name).filter(Boolean)])]
  const update = (index: number, patch: Partial<PriceDraft>) => onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  const currencySelect = (current: string, onPick: (currency: string) => void) => (
    <select value={current} onChange={(event) => onPick(event.target.value)} className={inputClass}>
      {[...new Set([current, ...currencies].filter(Boolean))].map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  )
  if (!names.length)
    return (
      <p className="rounded-md bg-[#f2f5f8] px-3 py-2 text-[13px] text-[#586174]">
        {t("Прайс листы отсутствуют")}.{" "}
        <a href="/analytics/price-lists" target="_blank" rel="noreferrer" className="text-[#4f71dc] hover:underline">
          {t("Добавить прайс-лист")}
        </a>
      </p>
    )
  return (
    <div className="flex flex-col gap-3">
      {value.map((entry, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border border-[#e1e5eb] p-3">
          <FormField label={t("Прайс лист")}>
            <select
              value={entry.name}
              onChange={(event) => {
                const currency = priceLists.find((item) => item.name === event.target.value)?.currency
                update(index, { name: event.target.value, ...(currency && !entry.cash && !entry.nonCash ? { currency, nonCashCurrency: currency } : {}) })
              }}
              className={inputClass}
            >
              <option value="">{t("Не выбрано")}</option>
              {names.map((name) => (
                <option key={name} value={name} disabled={name !== entry.name && value.some((other) => other.name === name)}>
                  {name}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <FormField label={t("Цена наличные")}>
              <NumberInput value={entry.cash} onChange={(cash) => update(index, { cash })} />
            </FormField>
            <FormField label={t("Валюта")}>{currencySelect(entry.currency, (currency) => update(index, { currency }))}</FormField>
            <FormField label={t("Цена безналичные")}>
              <NumberInput value={entry.nonCash} onChange={(nonCash) => update(index, { nonCash })} />
            </FormField>
            <FormField label={t("Валюта")}>{currencySelect(entry.nonCashCurrency, (nonCashCurrency) => update(index, { nonCashCurrency }))}</FormField>
          </div>
          <Switch checked={entry.minMax} onChange={(minMax) => update(index, { minMax })} title={t("Установить минимальную и максимальную цену для продажи")} />
          {entry.minMax && (
            <div className="grid grid-cols-2 gap-2">
              <FormField label={t("Минимальная цена продажи")}>
                <NumberInput value={entry.min} onChange={(min) => update(index, { min })} />
              </FormField>
              <FormField label={t("Максимальная цена продажи")}>
                <NumberInput value={entry.max} onChange={(max) => update(index, { max })} />
              </FormField>
            </div>
          )}
          {value.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="inline-flex items-center gap-1 self-start text-[13px] text-[#e57373] hover:underline"
            >
              <Trash2 className="h-4 w-4" /> {t("Удалить новую цену")}
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, emptyPrice("", currencies[0] ?? "SUM")])}
        disabled={value.length >= names.length}
        className="inline-flex items-center gap-1 self-start rounded-sm bg-[#4f71dc] px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> {t("Добавить новую цену")}
      </button>
      {error && <span className="text-[12px] text-[#e57373]">{t(error)}</span>}
    </div>
  )
}

export function BoxSizesEditor({ value, onChange, units }: { value: BoxSizeDraft[]; onChange: (value: BoxSizeDraft[]) => void; units: string[] }) {
  const { t } = useLanguage()
  const rows = value.length ? value : [{ unit: "", height: "", width: "", length: "" }]
  const update = (index: number, patch: Partial<BoxSizeDraft>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const field = (label: string, node: ReactNode) => <FormField label={label}>{node}</FormField>
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-2 gap-2 rounded-md border border-dashed border-[#dbe0e8] p-2">
          {field(`${t("Группа №")}${index + 1}`, <ComboInput id={`box-unit-${index}`} value={row.unit} onChange={(unit) => update(index, { unit })} options={units} />)}
          {field(`${t("Высота №")}${index + 1}`, <NumberInput value={row.height} onChange={(height) => update(index, { height })} />)}
          {field(`${t("Ширина №")}${index + 1}`, <NumberInput value={row.width} onChange={(width) => update(index, { width })} />)}
          {field(`${t("Длина №")}${index + 1}`, <NumberInput value={row.length} onChange={(length) => update(index, { length })} />)}
          <div className="col-span-2 flex gap-3 text-[13px]">
            <button type="button" onClick={() => onChange([...rows, { unit: "", height: "", width: "", length: "" }])} className="text-[#4f71dc] hover:underline">
              {t("Добавить")}
            </button>
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== index))} className="text-[#e57373] hover:underline">
                {t("Удалить")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
