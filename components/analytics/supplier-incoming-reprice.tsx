"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"

import { MaterialCheckbox, MaterialRadio, MaterialTextArea } from "@/components/analytics/cash-material"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { DOTTED_LINE } from "@/components/orders/return-confirm-dialog"
import { RefTip } from "@/components/ref/ref-tip"
import { amountDigits } from "@/lib/amount-precision"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"
import type { SupplyCostRow } from "@/lib/supplier-incomings-costs"
import { currencyChoices, useCurrencyCodes } from "./supplier-incoming-dialogs"
import type { Incoming } from "./supplier-incomings-data"

// «НАЦЕНКА» of a supply card, drawn and calculated like Linko's (Склад → Приход от поставщиков → «Поставка № N» →
// «Наценка», #/supply/<id>?openRepriceDialog=true): a full-screen sheet with the settings on the left and the supply's
// lines on the right. «Сохранить» writes the new prices into the chosen price list as one Переоценка document and opens
// it, as Linko does.

/** The base price of a line (Linko's ?typeCost=): «Закупочная цена», «Себестоимость» or «Усред. Себ.». */
export type RepriceCostType = "internalPrice" | "realNetCost" | "avgNetCost"
const COST_TYPES: Array<{ id: RepriceCostType; label: string }> = [
  { id: "internalPrice", label: "Закупочная цена" },
  { id: "realNetCost", label: "Себестоимость" },
  { id: "avgNetCost", label: "Усред. Себ." },
]
type RoundType = "null" | "up" | "down"

/** Linko's roundToMultiple: to a multiple of `step` (a whole number when 0), nearest / up / down. */
export function roundToMultiple(value: number, step: number, type: RoundType) {
  if (step === 0) return type === "down" ? Math.floor(value) : type === "up" ? Math.ceil(value) : Math.round(value)
  return type === "down" ? step * Math.floor(value / step) : type === "up" ? step * Math.ceil(value / step) : step * Math.round(value / step)
}

/** lodash toNumber for a field's text: "" is 0, garbage is 0 too (it would be NaN in Linko). */
const num = (value: string) => {
  const parsed = Number(value.trim().replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Linko's price calculation: × «Умножать на (курс)» when it is set, then + the markup %, then the rounding. */
export function markupPrice(base: number, multipleBy: number, percent: number, roundUp: number, roundType: RoundType) {
  const multiplied = multipleBy === 0 ? base : base * multipleBy
  return roundToMultiple(multiplied + multiplied * (percent / 100), roundUp, roundType)
}

const costOf = (row: SupplyCostRow, type: RepriceCostType) => (type === "realNetCost" ? row.netCost : type === "avgNetCost" ? row.avgNetCost : row.purchasePrice)

/** Linko's numberFormat(value, null, 8): grouped thousands, Настройки → Округление сумм decimals (8 when unset). */
const formatCost = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(8) })

const TYPE_PARAM = "typeCost"
const parseCostType = (value: string | null): RepriceCostType => (COST_TYPES.some((item) => item.id === value) ? (value as RepriceCostType) : "internalPrice")
/** Linko's toggle pushes ?typeCost= (Back returns to the previous base); closing the sheet keeps it. */
function writeCostType(value: RepriceCostType) {
  const url = new URL(window.location.href)
  url.searchParams.set(TYPE_PARAM, value)
  // A null state, like the page's own setUrlParam: Next then updates useSearchParams.
  window.history.pushState(null, "", `${url.pathname}${url.search}`)
}

const INFO = "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** Linko's number field of the sheet: the bold label is the placeholder and floats above once there is a value. */
function NumberField({ label, value, onChange, blockMinus, width, className = "" }: { label: string; value: string; onChange: (value: string) => void; blockMinus?: boolean; width?: number; className?: string }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <label className={`relative mt-[7px] block h-[45px] border-b border-[#e0e0e0] ${className}`} style={width ? { width } : undefined}>
      <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${floating ? "top-[4px] text-[10px] leading-3" : "top-[20px] text-[13px] leading-[18px]"}`}>{label}</span>
      <input
        type="number"
        min={blockMinus ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (blockMinus && (event.key === "-" || event.key === "e")) event.preventDefault()
        }}
        className="absolute inset-x-0 bottom-[3px] h-[24px] bg-transparent text-[13px] font-semibold text-black outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  )
}

/** The text field of a line («Наценка %» per product, «Новая цена»): 256 px wide, bold value on an underline. */
function LineField({ value, onChange, label, type = "text" }: { value: string; onChange: (value: string) => void; label: string; type?: "text" | "number" }) {
  return (
    <input
      type={type}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-[28px] w-[256px] max-w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold leading-[18px] text-black outline-none focus:border-[#1E4A9A]"
    />
  )
}

export function IncomingRepriceDialog({ incoming, onClose, onSaved }: { incoming: Incoming; onClose: () => void; onSaved: (repricingId: number | null) => void }) {
  const { t } = useLanguage()
  const currencies = useCurrencyCodes()
  const [priceLists, setPriceLists] = useState<RefSelectItem[] | null>(null)
  const [lines, setLines] = useState<SupplyCostRow[] | null>(null)
  const costType = parseCostType(useSearchParams().get(TYPE_PARAM))
  // Linko's form starts empty (no price list, no currency), «Округлить до» 0 and the default rounding.
  const [priceList, setPriceList] = useState<RefSelectItem[]>([])
  const [currency, setCurrency] = useState("")
  const [multipleBy, setMultipleBy] = useState("")
  const [roundUp, setRoundUp] = useState("0")
  const [percent, setPercent] = useState("")
  const [singly, setSingly] = useState(false)
  const [roundType, setRoundType] = useState<RoundType>("null")
  const [comment, setComment] = useState("")
  const [prices, setPrices] = useState<string[]>([])
  const [percents, setPercents] = useState<string[]>([])
  const [errors, setErrors] = useState<{ priceList?: string; currency?: string }>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    let alive = true
    fetch("/api/price-lists", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ id: number; name: string }>) => {
        if (!alive) return
        // Linko's for_select of price lists: by name, case ignored.
        const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base", numeric: false }))
        setPriceLists(sorted.map((row) => ({ value: String(row.id), label: row.name })))
      })
      .catch(() => alive && setPriceLists([]))
    // Linko's stock/supply_product/with_net_cost/: one row per line of the supply (the same product twice stays twice).
    fetch(`/api/supplier-incomings/${incoming.id}/cost-lines`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: SupplyCostRow[]) => alive && setLines(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setLines([]))
    return () => {
      alive = false
    }
  }, [incoming.id])

  // The sheet covers the page: the page itself does not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const rows = lines ?? []
  const steps = [
    `${t("Этапы расчета")}:`,
    "",
    t("1.Сначала рассчитывается умножение на число:"),
    t("Если умножение не указано, возвращается само значение цены."),
    t("цена = цена * X (если X указано)"),
    `${t("2.Затем рассчитывается наценка:")} ${t("цена = цена * (100 + наценка) / 100")}`,
    t("3.После выполняется округление."),
  ].join("\n")

  /** Switching the base price resets the whole form, as Linko's toggle does (reset("SupplyRepriceForm")). */
  function chooseCostType(next: RepriceCostType) {
    writeCostType(next)
    setPriceList([])
    setCurrency("")
    setMultipleBy("")
    setRoundUp("0")
    setPercent("")
    setSingly(false)
    setRoundType("null")
    setComment("")
    setPrices([])
    setPercents([])
    setErrors({})
  }

  /** «Расчитать»: every line gets the price from its base, the common markup and the rounding. */
  function calculate() {
    setPrices(rows.map((row) => String(markupPrice(costOf(row, costType), num(multipleBy), num(percent), num(roundUp), roundType))))
    setPercents(rows.map(() => ""))
  }

  /** A line's own «Наценка %» recalculates its price right away. */
  function changeLinePercent(index: number, value: string) {
    setPercents((current) => {
      const next = [...current]
      next[index] = value
      return next
    })
    const row = rows[index]
    if (!row) return
    setPrices((current) => {
      const next = [...current]
      next[index] = String(markupPrice(costOf(row, costType), num(multipleBy), num(value), num(roundUp), roundType))
      return next
    })
  }

  function changeLinePrice(index: number, value: string) {
    setPrices((current) => {
      const next = [...current]
      next[index] = value
      return next
    })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    const required = t("Обязательное поле.")
    const nextErrors = { priceList: priceList.length ? undefined : required, currency: currency ? undefined : required }
    setErrors(nextErrors)
    if (nextErrors.priceList || nextErrors.currency) return
    // Linko sends only the lines with a price above zero.
    const products = rows
      .map((row, index) => ({ product: row.product, ...(row.key ? { key: row.key } : {}), price: num(prices[index] ?? "") }))
      .filter((line) => line.price > 0)
    savingRef.current = true
    setSaving(true)
    try {
      const response = await fetch(`/api/supplier-incomings/${incoming.id}/reprice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceListId: Number(priceList[0].value), currency, comment, prices: products }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось сохранить наценку"))
        return
      }
      const repricingId = typeof data.repricingId === "number" ? data.repricingId : null
      const missing: string[] = Array.isArray(data.missing) ? data.missing : []
      // Linko just opens the new Переоценка. Lines that match no live product or raw material are named, not dropped
      // silently; without a document the count is the only answer.
      if (missing.length) notify(`${t("Не найденные продукты")}: ${missing.join(", ")}`)
      else if (repricingId === null) notify(`${t("Цены обновлены")}: ${data.updated}`)
      onSaved(repricingId)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const currencyItems = currencyChoices(currencies.codes, currencies.base, currency).map((code) => ({ value: code, label: currencyLabel(code) }))
  const col = "flex min-h-[55px] items-center px-[8px] leading-[18px]"

  return createPortal(
    <div className="fixed inset-0 z-[1300] overflow-y-auto bg-white font-sans text-[13px] text-[#333]" role="dialog" aria-modal="true" aria-label={t("Наценка")}>
      <form onSubmit={(event) => void save(event)} className="flex min-h-full flex-col">
        <header className="relative flex h-[57px] shrink-0 items-center border-b border-[#efefef] px-[30px]">
          <h2 className="text-[13px] font-bold uppercase leading-4 text-[#333]">{t("Наценка")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-[13px] top-[8px] flex h-10 w-10 items-center justify-center rounded-[5px]">
            <svg viewBox="0 0 24 24" className="h-[25px] w-[25px] fill-[#666]" aria-hidden>
              <path d={CLOSE} />
            </svg>
          </button>
        </header>

        <div className="flex flex-1">
          <aside className="w-[20%] min-w-[260px] shrink-0 border-r border-[#efefef] px-[30px] py-[20px]">
            {/* Enter in a select's search box must not submit the sheet (it would save to the price list chosen before). */}
            <div
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") event.preventDefault()
              }}
            >
              <RefSearchSelect
                label={t("Прайс лист")}
                items={priceLists ?? []}
                loading={priceLists === null}
                selected={priceList}
                onChange={(next) => {
                  setPriceList(next)
                  setErrors((current) => ({ ...current, priceList: undefined }))
                }}
                error={errors.priceList}
                rowHeight={32}
                dense
              />
              <RefSearchSelect
                label={t("Валюта")}
                items={currencyItems}
                selected={currency ? [{ value: currency, label: currencyLabel(currency) }] : []}
                onChange={(next) => {
                  setCurrency(next[0]?.value ?? "")
                  setErrors((current) => ({ ...current, currency: undefined }))
                }}
                error={errors.currency}
                rowHeight={32}
                dense
                searchable={false}
              />
            </div>
            <div className="flex items-center gap-[10px]">
              <NumberField label={t("Умножать на (курс)")} value={multipleBy} onChange={setMultipleBy} blockMinus className="flex-1" />
              <RefTip text={steps} side="right">
                <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#4f71dc]" aria-hidden>
                  <path d={INFO} />
                </svg>
              </RefTip>
            </div>
            <div className="flex items-center gap-[10px]">
              <NumberField label={t("Округлить до")} value={roundUp} onChange={setRoundUp} className="flex-1" />
              <RefTip text={steps} side="right">
                <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#4f71dc]" aria-hidden>
                  <path d={INFO} />
                </svg>
              </RefTip>
            </div>
            {!singly && <NumberField label={t("Наценка %")} value={percent} onChange={setPercent} />}
            <div className="mt-[18px] [&_label]:h-auto [&_label]:items-start [&_label_span]:leading-5">
              <MaterialCheckbox checked={singly} onChange={setSingly} label={<span className="block max-w-[200px]">{t("Поставить наценку на каждый товар отдельно")}</span>} />
            </div>
            <div className="mt-[10px] flex flex-col">
              <span className="mb-[5px] text-[15px] font-semibold leading-[19px] text-[#333]">{t("Условия округлений")}</span>
              <MaterialRadio checked={roundType === "null"} onChange={() => setRoundType("null")} label={t("По умолчанию")} />
              <MaterialRadio checked={roundType === "up"} onChange={() => setRoundType("up")} label={t("Округление вверх")} />
              <MaterialRadio checked={roundType === "down"} onChange={() => setRoundType("down")} label={t("Округление вниз")} />
            </div>
            {!singly && (
              <button type="button" onClick={calculate} className="mt-[10px] flex h-[30px] w-full items-center justify-center gap-[6px] rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden>
                  <path d={CHECK_CIRCLE} />
                </svg>
                {t("Расчитать")}
              </button>
            )}
            <MaterialTextArea label={`${t("Оставить комментарий")}...`} value={comment} onChange={setComment} maxRows={6} className="mt-[12px]" />
            <div className="mt-[30px] flex flex-col gap-[10px] rounded-[10px] bg-[#f2f5f8] p-[15px] text-[#333]">
              <p className="text-[16px] font-bold leading-5">{t("Этапы расчета")}:</p>
              <span className="flex flex-col gap-[3px] text-[15px] font-semibold leading-[19px]">
                <span>
                  {t("1.Сначала рассчитывается умножение на число:")}
                  <br />
                  {t("Если умножение не указано, возвращается само значение цены.")}
                </span>
                <span className="text-[#4f71dc]">{t("цена = цена * X (если X указано)")}</span>
              </span>
              <span className="flex flex-col gap-[3px] text-[15px] font-semibold leading-[19px]">
                {t("2.Затем рассчитывается наценка:")}
                <span className="text-[#4f71dc]">{t("цена = цена * (100 + наценка) / 100")}</span>
              </span>
              <span className="text-[15px] font-semibold leading-[19px]">{t("3.После выполняется округление.")}</span>
            </div>
          </aside>

          <section className="min-w-0 flex-1">
            <div className="flex items-center justify-between px-[30px] py-[10px]">
              <strong className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</strong>
              <div className="flex">
                {COST_TYPES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseCostType(item.id)}
                    className={`h-8 rounded-[5px] px-4 text-[13px] uppercase ${
                      costType === item.id
                        ? "bg-[#4f71dc] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
                        : "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12),inset_0_0_2px_rgba(0,0,0,0.12)]"
                    }`}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-[30px]">
              <div className={`-mx-[8px] flex py-[20px] font-semibold ${DOTTED_LINE}`}>
                <div className={`${col} w-1/4`}>{t("Наименование")}</div>
                <div className={`${col} w-1/6`}>{t("Себестоимость")}</div>
                {singly && <div className={`${col} w-1/4`}>{t("Наценка %")}</div>}
                <div className={`${col} w-1/4`}>{t("Новая цена")}</div>
              </div>
              {lines === null ? (
                <div className="flex h-[120px] items-center justify-center text-[#999]">{t("Загрузка...")}</div>
              ) : (
                rows.map((row, index) => (
                  <div key={`${row.product}-${index}`} className="-mx-[8px] flex">
                    <div className={`${col} w-1/4`}>
                      <strong className="mr-[5px] font-semibold">{index + 1}.</strong>
                      <span>{row.product}</span>
                    </div>
                    <div className={`${col} w-1/6`}>{formatCost(costOf(row, costType))}</div>
                    {singly && (
                      <div className={`${col} w-1/4`}>
                        <LineField type="number" label={t("Наценка %")} value={percents[index] ?? ""} onChange={(value) => changeLinePercent(index, value)} />
                      </div>
                    )}
                    <div className={`${col} w-1/4`}>
                      <LineField label={t("Новая цена")} value={prices[index] ?? ""} onChange={(value) => changeLinePrice(index, value)} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <footer className="border-t border-[#efefef] p-[10px] text-right">
          <button type="submit" disabled={saving} className="h-9 min-w-[88px] px-4 text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
