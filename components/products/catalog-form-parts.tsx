"use client"

import { Info } from "lucide-react"

import { inputClass } from "@/components/analytics/cash-management-shared"
import { BlueButton, CircleButton, CreateLink, SelectField, TextField, Toggle } from "@/components/products/catalog-form-ui"
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

export function emptyPrice(name = "", currency = "SUM"): PriceDraft {
  return { name, cash: "", currency, nonCash: "", nonCashCurrency: currency, minMax: false, min: "", max: "" }
}

/** Barcode rows: a 399px field + a round "+" ("−" on all but the last row) and the "Сгенерировать" link. */
export function BarcodesEditor({ value, onChange, error }: { value: string[]; onChange: (value: string[]) => void; error?: string }) {
  const { t } = useLanguage()
  const rows = value.length ? value : [""]
  return (
    <div>
      {rows.map((code, index) => (
        <div key={index} className={`relative ${index === 0 && error ? "h-[87px]" : "h-[68px]"}`}>
          <div className="flex items-start">
            <TextField
              label={t("Штрих-код")}
              value={code}
              onChange={(next) => onChange(rows.map((item, i) => (i === index ? next : item)))}
              className="w-[399px]"
              errorShift={false}
            />
            <div className="mt-[23px]">
              <CircleButton
                minus={index < rows.length - 1}
                label={t(index < rows.length - 1 ? "Убрать" : "Добавить еще")}
                onClick={() => onChange(index === rows.length - 1 ? [...rows, ""] : rows.filter((_, i) => i !== index))}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(rows.map((item, i) => (i === index ? generateBarcode() : item)))}
            className="absolute left-0 top-[61px] text-[13px] leading-4 text-[#4f71dc]"
          >
            {t("Сгенерировать")}
          </button>
          {index === 0 && error && <span className="absolute left-0 top-[81px] whitespace-nowrap text-[13px] leading-4 text-[#f44336]">{t(error)}</span>}
        </div>
      ))}
    </div>
  )
}

/** Price blocks: "Продажная цена" + "Добавить новую цену" ("Удалить новую цену" on all but the last block). */
export function PricesEditor({
  value,
  onChange,
  priceLists,
  currencies,
  savedNames = [],
  error,
}: {
  value: PriceDraft[]
  onChange: (value: PriceDraft[]) => void
  priceLists: Array<{ name: string; currency: string }>
  currencies: string[]
  /** Price lists the item already has a stored price in ("Удалить цену" instead of "Удалить новую цену"). */
  savedNames?: string[]
  error?: string
}) {
  const { t } = useLanguage()
  const names = [...new Set([...priceLists.map((entry) => entry.name), ...value.map((entry) => entry.name).filter(Boolean)])]
  const update = (index: number, patch: Partial<PriceDraft>) => onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  const currencyOptions = (current: string) => [...new Set([current, ...currencies].filter(Boolean))]
  return (
    <div className="mt-[14px]">
      {value.map((entry, index) => {
        const last = index === value.length - 1
        return (
          <div key={index} className={index === 0 ? "" : "mt-[2px]"}>
            <div className="relative flex h-[30px] items-center">
              {index === 0 && <span className="text-[13px] leading-4 text-[#333]">{t("Продажная цена")}</span>}
              <span className="ml-auto mr-2">
                {last ? (
                  <BlueButton onClick={() => onChange([...value, emptyPrice("", "")])}>{t("Добавить новую цену")}</BlueButton>
                ) : (
                  <BlueButton minus onClick={() => onChange(value.filter((_, i) => i !== index))}>
                    {t(entry.name && savedNames.includes(entry.name) ? "Удалить цену" : "Удалить новую цену")}
                  </BlueButton>
                )}
              </span>
            </div>
            <div className="mt-4 flex items-start">
              <SelectField
                label={t("Прайс лист")}
                value={entry.name}
                options={names.filter((name) => name === entry.name || !value.some((other) => other.name === name))}
                onChange={(name) => {
                  const currency = priceLists.find((item) => item.name === name)?.currency
                  update(index, { name, ...(currency && !entry.cash && !entry.nonCash ? { currency, nonCashCurrency: currency } : {}) })
                }}
                className="w-[406px]"
              />
              <span className="ml-[10px] mt-4">
                <CreateLink href="/analytics/price-lists?openCreateDialog=true" label={t("Добавить прайс-лист")} />
              </span>
            </div>
            <div className="mt-1 flex items-start">
              <TextField label={t("Цена наличные")} numeric value={entry.cash} onChange={(cash) => update(index, { cash })} className="w-[215px]" />
              <SelectField
                label={t("Валюта")}
                value={entry.currency}
                options={currencyOptions(entry.currency)}
                onChange={(currency) => update(index, { currency })}
                className="ml-[10px] mt-4 w-[215px]"
              />
            </div>
            <div className="mt-[15px] flex items-start">
              <TextField label={t("Цена безналичные")} numeric value={entry.nonCash} onChange={(nonCash) => update(index, { nonCash })} className="w-[215px]" />
              <SelectField
                label={t("Валюта")}
                value={entry.nonCashCurrency}
                options={currencyOptions(entry.nonCashCurrency)}
                onChange={(nonCashCurrency) => update(index, { nonCashCurrency })}
                className="ml-[10px] mt-4 w-[215px]"
              />
            </div>
            <Toggle className="mt-[9px]" checked={entry.minMax} onChange={(minMax) => update(index, { minMax })} title={t("Установить минимальную и максимальную цену для продажи")} />
            {entry.minMax && (
              <div className="mt-[5px] flex gap-5">
                <TextField label={t("Минимальная цена продажи")} numeric value={entry.min} onChange={(min) => update(index, { min })} className="w-[210px]" />
                <TextField label={t("Максимальная цена продажи")} numeric value={entry.max} onChange={(max) => update(index, { max })} className="w-[210px]" />
              </div>
            )}
            <div className={entry.minMax ? "h-[15px]" : "h-[20.5px]"} />
          </div>
        )
      })}
      {error && <span className="text-[12px] text-[#f44336]">{t(error)}</span>}
    </div>
  )
}

/** "ДОП. параметры": Группа №N + Высота / Ширина / Длина, then "Добавить" / "Удалить" (grey until usable). */
export function BoxSizesEditor({ value, onChange, units }: { value: BoxSizeDraft[]; onChange: (value: BoxSizeDraft[]) => void; units: string[] }) {
  const { t } = useLanguage()
  const rows = value.length ? value : [{ unit: "", height: "", width: "", length: "" }]
  const update = (index: number, patch: Partial<BoxSizeDraft>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const last = rows[rows.length - 1]
  const canAdd = Boolean(last.unit.trim() || last.height || last.width || last.length)
  const button = "h-[34px] w-[215px] rounded-[2px] text-[13px] leading-[34px] text-white"
  return (
    <div className="mt-[33px]">
      {rows.map((row, index) => (
        <div key={index}>
          <SelectField label={`${t("Группа №")}${index + 1}`} value={row.unit} options={units} onChange={(unit) => update(index, { unit })} />
          <TextField label={`${t("Высота №")}${index + 1}`} numeric value={row.height} onChange={(height) => update(index, { height })} />
          <TextField label={`${t("Ширина №")}${index + 1}`} numeric value={row.width} onChange={(width) => update(index, { width })} />
          <TextField label={`${t("Длина №")}${index + 1}`} numeric value={row.length} onChange={(length) => update(index, { length })} />
        </div>
      ))}
      <div className="mt-[34px] flex gap-[9px]">
        <button type="button" disabled={!canAdd} onClick={() => onChange([...rows, { unit: "", height: "", width: "", length: "" }])} className={`${button} ${canAdd ? "bg-[#4f71dc]" : "bg-[#bdbdbd]"}`}>
          {t("Добавить")}
        </button>
        <button type="button" disabled={rows.length < 2} onClick={() => onChange(rows.slice(0, -1))} className={`${button} ${rows.length > 1 ? "bg-[#4f71dc]" : "bg-[#bdbdbd]"}`}>
          {t("Удалить")}
        </button>
      </div>
    </div>
  )
}
