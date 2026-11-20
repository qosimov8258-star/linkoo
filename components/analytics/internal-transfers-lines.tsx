"use client"

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react"

import { parseAmount } from "@/components/analytics/cash-management-shared"
import { SearchSelect, SeriesSelect } from "@/components/analytics/internal-transfers-series"
import { formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockPickRow, TransferItem, TransferSeriesPrev } from "@/lib/internal-transfers-types"

// «Список товаров» of the transfer form (Linko's module 4643): the add row on #f1f5f8 — «Наименование»
// (the source warehouse's goods, «name (available unit)»), «Серия» when the product keeps an expiry, the box
// field «<box unit> (<units per box> <unit>)» when it has a box, «Кол-во» + unit, «Цена» + currency, ✓ (Enter
// adds too; a new line is put first, never merged) — and the lines on a 12-column grid with dotted rows:
// Наименование | [Группа] | [Серия] | Кол-во | Цена | Всего | ✎ 🗑. ✎ turns a row into empty inputs (Группа, Серия,
// Кол-во, Цена; an input left empty keeps the value) applied by ✓; 🗑 removes the line at once. Prices are what the
// user types, with or without a price list (Linko's custom_price).
// Mezon keeps its «Брак» lines (defective units): marked in the name, switched in the row edit.

export type FormLine = {
  uid: number
  key: string
  name: string
  unit: string
  article: string
  weight: number
  quantity: string
  price: string
  defect: boolean
  seriesId: number | null
  series: string
  seriesAuto: boolean
  /** With seriesAuto: the series the distribution replaced (kept so that its cancel can put it back). */
  seriesPrev: TransferSeriesPrev | null
  trackExpiry: boolean
  boxAmount: number
  boxUnit: string
}

let nextUid = 1
export const newUid = () => nextUid++

export function lineFromItem(item: TransferItem): FormLine {
  return {
    uid: newUid(),
    key: item.key,
    name: item.product,
    unit: item.unit,
    article: item.article,
    weight: item.weight,
    quantity: String(item.quantity),
    price: String(item.price),
    defect: Boolean(item.defect),
    seriesId: item.seriesId ?? null,
    series: item.series ?? "",
    seriesAuto: Boolean(item.seriesAuto),
    seriesPrev: item.seriesPrev ?? null,
    trackExpiry: Boolean(item.trackExpiry),
    boxAmount: Number(item.boxAmount) || 0,
    boxUnit: item.boxUnit ?? "",
  }
}

export function lineFromRow(row: StockPickRow, quantity: string, price: string, series?: { id: number; name: string } | null): FormLine {
  return {
    uid: newUid(),
    key: row.key,
    name: row.name,
    unit: row.unit,
    article: row.article,
    weight: row.weight,
    quantity,
    price,
    defect: row.available <= 0 && row.defectsAvailable > 0,
    seriesId: series?.id ?? null,
    series: series?.name ?? "",
    seriesAuto: false,
    seriesPrev: null,
    trackExpiry: Boolean(row.trackExpiry),
    boxAmount: Number(row.boxAmount) || 0,
    boxUnit: row.boxUnit ?? "",
  }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000
const number = (value: number) => formatMoney(value, 3)
/** Boxes of a line, unrounded (amount / units per box): the footer totals them with the app's decimals. */
export const boxesOf = (line: Pick<FormLine, "quantity" | "boxAmount">) => (line.boxAmount > 0 ? parseAmount(line.quantity) / line.boxAmount : 0)
const productIdOf = (key: string) => {
  const match = /^product:(\d+)$/.exec(key)
  return match ? Number(match[1]) : null
}
const pct = (xs: number) => ({ width: `${(xs / 12) * 100}%` })
const DOTS = "bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] bg-[length:8px_2px] bg-[position:0_100%] bg-repeat-x"
const ICON_CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
const ICON_EDIT = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const ICON_DELETE_FOREVER =
  "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"

/** A Material text field of the lines: floating label, optional unit after it. */
function LineField({
  label,
  value,
  onChange,
  suffix,
  disabled,
  onEnter,
  ariaLabel,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  suffix?: ReactNode
  disabled?: boolean
  onEnter?: () => void
  ariaLabel?: string
}) {
  const [focused, setFocused] = useState(false)
  const floating = Boolean(value) || focused
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onEnter) {
      event.preventDefault()
      onEnter()
    }
  }
  return (
    <div className="flex min-w-0 items-end">
      <div className="relative mt-[7px] h-[45px] min-w-0 flex-1 text-[13px]">
        {label && (
          <span className={`pointer-events-none absolute left-0 whitespace-nowrap font-semibold text-black ${floating ? "top-[2px] text-[9.75px] leading-[12px]" : "bottom-[14px] text-[13px] leading-[18px]"} ${disabled ? "opacity-40" : ""}`}>{label}</span>
        )}
        <input
          value={value}
          disabled={disabled}
          inputMode="decimal"
          aria-label={ariaLabel ?? label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="absolute bottom-[9px] left-0 h-[24px] w-full bg-transparent font-semibold text-black outline-none disabled:cursor-not-allowed disabled:text-black/40"
        />
        <span className={`absolute inset-x-0 bottom-[8px] ${focused ? "h-[2px] bg-[rgb(79,113,220)]" : "h-px bg-[#e0e0e0]"}`} />
      </div>
      {suffix ? <span className="mb-[15px] ml-[15px] shrink-0 whitespace-nowrap text-[13px] text-[#333]">{suffix}</span> : null}
    </div>
  )
}

function IconButton({ path, color, label, onClick, disabled }: { path: string; color: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40">
      <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: color }} aria-hidden>
        <path d={path} />
      </svg>
    </button>
  )
}

type EditDraft = { box: string; quantity: string; price: string; series: { id: number; name: string } | null; defect: boolean }

export function TransferLinesEditor({
  ready,
  rows,
  rowMap,
  lines,
  onLines,
  currency,
  priceOf,
  over,
}: {
  /** Both warehouses chosen: the add row shows. */
  ready: boolean
  rows: StockPickRow[]
  rowMap: Map<string, StockPickRow>
  lines: FormLine[]
  onLines: (update: (lines: FormLine[]) => FormLine[]) => void
  /** The form currency's name once one is picked ('' = none shown, as the reference does for the stored one). */
  currency: string
  priceOf: (line: FormLine) => number
  over: (line: FormLine) => boolean
}) {
  const { t } = useLanguage()
  const [addKey, setAddKey] = useState("")
  const [addSeries, setAddSeries] = useState<{ id: number; name: string } | null>(null)
  const [addBox, setAddBox] = useState("")
  const [addQty, setAddQty] = useState("")
  const [addPrice, setAddPrice] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<EditDraft>({ box: "", quantity: "", price: "", series: null, defect: false })

  const product = addKey ? rowMap.get(addKey) : undefined
  const productTracks = Boolean(product?.trackExpiry)
  const productBox = Number(product?.boxAmount) || 0
  const productOptions = useMemo(
    () =>
      rows
        .filter((row) => row.available > 0 || row.defectsAvailable > 0)
        .map((row) => {
          const available = `${formatQty(Math.max(0, row.available), row.unit)}${row.defectsAvailable > 0 ? `; ${t("Брак")}: ${formatQty(row.defectsAvailable, row.unit)}` : ""}`
          return {
            value: row.key,
            text: `${row.name} (${available})`,
            node: (
              <span>
                {row.name} <strong>({available})</strong>
              </span>
            ),
          }
        }),
    [rows, t],
  )

  const add = () => {
    const row = addKey ? rowMap.get(addKey) : undefined
    const qty = parseAmount(addQty)
    const price = parseAmount(addPrice)
    if (!row || !qty || !(price >= 0)) return
    onLines((current) => [lineFromRow(row, String(round3(qty)), addPrice.trim() || "0", productTracks ? addSeries : null), ...current])
    setAddKey("")
    setAddSeries(null)
    setAddBox("")
    setAddQty("")
    setAddPrice("")
  }

  const hasBox = lines.some((line) => line.boxAmount > 0)
  const hasSeries = lines.some((line) => line.trackExpiry)
  const cols = { box: hasBox ? 1 : 0, series: hasSeries ? 2 : 0, qty: 2, price: hasSeries ? 1 : 2, total: 1, actions: 2 }
  const nameCols = 12 - (cols.actions + cols.box + cols.series + cols.qty + cols.price + cols.total)
  const money = currency ? `(${currency})` : ""

  const startEdit = (index: number) => {
    const line = lines[index]
    // As the reference, every input starts empty (its hint is invisible there); an empty one keeps the value.
    setDraft({ box: "", quantity: "", price: "", series: null, defect: line.defect })
    setEditing(index)
  }
  const applyEdit = (index: number) => {
    onLines((current) =>
      current.map((line, position) => {
        if (position !== index) return line
        const next = { ...line, defect: draft.defect }
        if (draft.quantity.trim()) next.quantity = String(round3(parseAmount(draft.quantity)))
        else if (draft.box.trim() && line.boxAmount > 0) next.quantity = String(round3(parseAmount(draft.box) * line.boxAmount))
        if (draft.price.trim()) next.price = String(parseAmount(draft.price))
        if (draft.series && draft.series.id !== line.seriesId) Object.assign(next, { seriesId: draft.series.id, series: draft.series.name, seriesAuto: false, seriesPrev: null })
        return next
      }),
    )
    setEditing(null)
  }

  return (
    <>
      {ready && (
        <div className="relative z-[2] flex h-[73px] shrink-0 items-end bg-[#f1f5f8] px-[30px] pb-[10px]">
          <div className="px-2" style={pct(productTracks ? 3 : 4)}>
            <SearchSelect
              label={t("Наименование")}
              value={addKey}
              valueText={product?.name}
              options={productOptions}
              onChange={(value) => {
                setAddKey(value)
                setAddSeries(null)
                setAddBox("")
                setAddPrice(String(rowMap.get(value)?.price || ""))
              }}
            />
          </div>
          {productTracks && (
            <div className="px-2" style={pct(2)}>
              <SeriesSelect key={addKey} productId={productIdOf(addKey)} value={addSeries?.id ?? null} valueText={addSeries?.name} onChange={(series) => setAddSeries(series ? { id: series.id, name: series.displayName } : null)} />
            </div>
          )}
          {product && productBox > 0 && (
            <div className="px-2" style={pct(2)}>
              <LineField
                label={`${product.boxUnit || t("Группа")} (${formatQty(productBox, product.unit)})`}
                value={addBox}
                onEnter={add}
                onChange={(value) => {
                  setAddBox(value)
                  setAddQty(value.trim() ? String(round3(parseAmount(value) * productBox)) : "")
                }}
              />
            </div>
          )}
          <div className="px-2" style={pct(product && productBox > 0 ? 2 : 3)}>
            <LineField
              label={t("Кол-во")}
              value={addQty}
              suffix={product?.unit ? t(product.unit) : null}
              onEnter={add}
              onChange={(value) => {
                setAddQty(value)
                if (productBox > 0) setAddBox(value.trim() ? String(round3(parseAmount(value) / productBox)) : "")
              }}
            />
          </div>
          <div className="px-2" style={pct(productTracks ? 1 : 2)}>
            <LineField label={t("Цена")} value={addPrice} suffix={currency || null} onEnter={add} onChange={setAddPrice} />
          </div>
          <div className="px-2" style={pct(1)}>
            <IconButton path={ICON_CHECK} color="rgb(79, 113, 220)" label={t("Применить")} onClick={add} />
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[30px]">
          <div className={`sticky top-0 z-[1] flex items-center bg-white py-[20px] text-[13px] font-semibold leading-[16.25px] text-[#333] ${DOTS}`}>
            <div className="px-2" style={pct(nameCols)}>{t("Наименование")}</div>
            {hasBox && <div className="px-2" style={pct(cols.box)}>{t("Группа")}</div>}
            {hasSeries && <div className="px-2" style={pct(cols.series)}>{t("Серия")}</div>}
            <div className="px-2" style={pct(cols.qty)}>{t("Кол-во")}</div>
            <div className="px-2" style={pct(cols.price)}>
              {t("Цена")}
              {money}
            </div>
            <div className="px-2" style={pct(cols.total)}>
              {t("Всего")}
              {money}
            </div>
            <div className="px-2" style={pct(cols.actions)} />
          </div>
          {lines.map((line, index) => {
            const qty = parseAmount(line.quantity)
            const boxes = boxesOf(line)
            const productId = productIdOf(line.key)
            const row = rowMap.get(line.key)
            const name = (
              <>
                {line.name}
                {line.defect && <span className="text-[#e57373]"> ({t("Брак")})</span>}
              </>
            )
            if (editing === index) {
              return (
                <div key={line.uid} className={`flex min-h-[53px] items-center text-[13px] leading-[16.25px] text-[#333] ${DOTS}`}>
                  <div className="px-2" style={pct(nameCols)}>
                    {name}
                    {(line.defect || (row?.defectsAvailable ?? 0) > 0) && (
                      <label className="mt-1 flex items-center gap-1.5 text-[12px] text-[#586174]">
                        <input type="checkbox" checked={draft.defect} onChange={(event) => setDraft((current) => ({ ...current, defect: event.target.checked }))} className="h-3.5 w-3.5 accent-[rgb(79,113,220)]" />
                        {t("Брак")}
                      </label>
                    )}
                  </div>
                  {hasBox && (
                    <div className="px-2" style={pct(cols.box)}>
                      {line.boxUnit ? (
                        <LineField
                          ariaLabel={t("Группа")}
                          value={draft.box}
                          onChange={(value) => setDraft((current) => ({ ...current, box: value, quantity: value.trim() ? String(round3(parseAmount(value) * line.boxAmount)) : "" }))}
                          onEnter={() => applyEdit(index)}
                        />
                      ) : null}
                    </div>
                  )}
                  {hasSeries && (
                    <div className="relative z-[3] -mt-[9px] px-2" style={pct(cols.series)}>
                      {/* As the reference, the picker is 200px wide, over the start of the Кол-во column. */}
                      {line.trackExpiry && productId ? (
                        <SeriesSelect className="w-[200px]" productId={productId} value={draft.series?.id ?? null} valueText={draft.series?.name} onChange={(series) => setDraft((current) => ({ ...current, series: series ? { id: series.id, name: series.displayName } : null }))} />
                      ) : null}
                    </div>
                  )}
                  <div className="px-2" style={pct(cols.qty)}>
                    <LineField
                      ariaLabel={`${t("Кол-во")}: ${line.name}`}
                      value={draft.quantity}
                      onChange={(value) => setDraft((current) => ({ ...current, quantity: value, box: line.boxAmount > 0 && value.trim() ? String(round3(parseAmount(value) / line.boxAmount)) : current.box }))}
                      onEnter={() => applyEdit(index)}
                    />
                  </div>
                  <div className="px-2" style={pct(cols.price)}>
                    <LineField ariaLabel={`${t("Цена")}: ${line.name}`} value={draft.price} onChange={(value) => setDraft((current) => ({ ...current, price: value }))} onEnter={() => applyEdit(index)} />
                  </div>
                  <div className="px-2" style={pct(cols.total)}>{formatSum(qty * priceOf(line))}</div>
                  <div className="px-2" style={pct(cols.actions)}>
                    <IconButton path={ICON_CHECK} color="rgb(79, 113, 220)" label={t("Применить")} onClick={() => applyEdit(index)} />
                  </div>
                </div>
              )
            }
            return (
              <div key={line.uid} className={`flex min-h-[48px] items-center text-[13px] leading-[16.25px] text-[#333] ${DOTS}`}>
                <div className="px-2" style={pct(nameCols)}>{name}</div>
                {hasBox && <div className="px-2" style={pct(cols.box)}>{boxes ? `${number(round3(boxes))} ${line.boxUnit} (${number(line.boxAmount)})` : null}</div>}
                {hasSeries && <div className="px-2" style={pct(cols.series)}>{line.series}</div>}
                <div className={`px-2 ${over(line) ? "text-[#e57373]" : ""}`} style={pct(cols.qty)}>
                  {formatQty(qty, line.unit ? t(line.unit) : "")}
                </div>
                <div className="px-2" style={pct(cols.price)}>{formatSum(priceOf(line))}</div>
                <div className="px-2" style={pct(cols.total)}>{formatSum(qty * priceOf(line))}</div>
                <div className="flex justify-end px-2" style={pct(cols.actions)}>
                  <IconButton path={ICON_EDIT} color="#666666" label={t("Изменить")} onClick={() => startEdit(index)} />
                  <IconButton
                    path={ICON_DELETE_FOREVER}
                    color="#666666"
                    label={t("Удалить")}
                    onClick={() => {
                      setEditing(null)
                      onLines((current) => current.filter((_, position) => position !== index))
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
