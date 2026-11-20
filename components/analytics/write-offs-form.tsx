"use client"

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, mutationError } from "@/components/analytics/cash-management-shared"
import { StockProductPicker, type PickEntry } from "@/components/analytics/internal-transfers-picker"
import { AmountField, DateInput, Spinner } from "@/components/analytics/stock-inventory-edit"
import { InventorySelect, type InventoryOption } from "@/components/analytics/stock-inventory-select"
import { RefTip } from "@/components/ref/ref-tip"
import { formatMoney } from "@/lib/finance/currency"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockPickResult, StockPickRow } from "@/lib/internal-transfers-types"
import type { WriteOff, WriteOffOptions } from "@/lib/write-offs-types"

// Linko's «СПИСАНИЕ ТОВАРА» (chunk 143 modules 5212 / 5213, ?openCreateDialog=true): a full-screen white page.
// Left (25%): «С какого склада» *, «Выберите дату» * (calendar), «Оставить комментарий...». Right (75%): «Список
// товаров» with «добавить товары» (disabled with the hint «Выберите склад» until a warehouse is chosen; here it opens the
// warehouse's product list, Linko's button does nothing); once a warehouse is chosen the grey add row: «Наименование»
// (name / Доступно / Браковано), «Серия» for products that keep series, «<box unit> (n)» for products with a box,
// «Кол-во» + unit, ✓ (a product already on the list is not added again). Lines: Наименование | Серия | [Группа] | Кол-во
// | ✎ 🗑 (✎ edits the line in place). Footer: «Общее кол-во: N ед (k групп)» (Σ whole units) and СПИСАТЬ. Mezon keeps
// the products of the chosen warehouse (Linko lists every warehouse's) and the «Брак» mark of a line whose product has
// defects there.

type Line = { uid: number; row: StockPickRow; amount: string; box: string; series: InventoryOption | null; defect: boolean }

let uids = 0

const DOTS: CSSProperties = { backgroundImage: "linear-gradient(to right, #d9e0e5 2px, transparent 2px)", backgroundSize: "8px 2px", backgroundRepeat: "repeat-x" }
/** Linko's dotted line under a table row, drawn on each cell. */
const dotted = (on: boolean): CSSProperties | undefined => (on ? { ...DOTS, backgroundPosition: "0 100%" } : undefined)
const productIdOf = (key: string) => {
  const match = /^product:(\d+)$/.exec(key)
  return match ? Number(match[1]) : null
}
/** lodash toInteger: whole units, anything that is not a number counts 0. */
const wholeUnits = (value: string) => {
  const number = Number(value.trim())
  return Number.isFinite(number) ? Math.trunc(number) : 0
}
const amountOf = (value: string) => {
  const number = Number(value.trim())
  return Number.isFinite(number) ? number : 0
}
const round4 = (value: number) => String(Math.round(value * 10000) / 10000)

// One series loader per product: an open select reloads only when its loader changes.
const seriesLoaders = new Map<number, (search: string) => Promise<InventoryOption[]>>()
const NO_OPTIONS = async (): Promise<InventoryOption[]> => []
function seriesLoader(productId: number | null): (search: string) => Promise<InventoryOption[]> {
  if (!productId) return NO_OPTIONS
  let loader = seriesLoaders.get(productId)
  if (!loader) {
    loader = async (search: string) => {
      try {
        const response = await fetch(`/api/stock/series?${new URLSearchParams({ product: String(productId), search, pageSize: "50" })}`, { cache: "no-store" })
        const body = response.ok ? ((await response.json()) as { results: Array<{ id: number; displayName: string }> }) : null
        return (body?.results ?? []).map((row) => ({ id: row.id, text: row.displayName }))
      } catch {
        return []
      }
    }
    seriesLoaders.set(productId, loader)
  }
  return loader
}

/** Linko's multi-line text field: the bold label on the line floats up with focus or text; 1 to 6 rows. */
function CommentField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false)
  const floated = focused || value !== ""
  const rows = Math.min(6, Math.max(1, value.split("\n").length))
  return (
    <label className="group relative mt-[6px] block pb-[5px] pt-[24px]">
      <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${floated ? "top-[4px] text-[10px] leading-[12px]" : "top-[24px] text-[13px] leading-[18px]"}`}>{label}</span>
      <textarea
        value={value}
        rows={rows}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="block w-full resize-none bg-transparent text-[13px] leading-[18px] text-black outline-none"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e0e0e0]">
        <span className="absolute inset-x-0 -top-px h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-[scale] duration-[450ms] group-focus-within:scale-x-100" />
      </span>
    </label>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-black/5">
      {children}
    </button>
  )
}

const CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"

export function WriteOffFormDialog({ options, onClose, onSaved }: { options: WriteOffOptions | null; onClose: () => void; onSaved: (writeOff: WriteOff) => void }) {
  const { t } = useLanguage()
  const [warehouse, setWarehouse] = useState<InventoryOption | null>(null)
  const [date, setDate] = useState("")
  const [comment, setComment] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [addProduct, setAddProduct] = useState<InventoryOption<StockPickRow> | null>(null)
  const [addSeries, setAddSeries] = useState<InventoryOption | null>(null)
  const [addAmount, setAddAmount] = useState("")
  const [addBox, setAddBox] = useState("")
  const [editing, setEditing] = useState<{ uid: number; amount: string; box: string; series: InventoryOption | null } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ warehouse?: string; date?: string; list?: string }>({})
  // Linko's 300ms spinner over «Серия» after a product change.
  const [seriesBusy, setSeriesBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const name = String(warehouse?.id ?? "")
  const products = useCashJson<StockPickResult>(name ? `/api/write-offs/products?${buildCashQuery({ warehouse: name, date: date || todayIso() })}` : null)
  const rows = useMemo(() => products.data?.rows ?? [], [products.data])

  const warehouses = useMemo(() => options?.warehouses ?? [], [options])
  const loadWarehouses = useCallback(
    async (search: string) => {
      const needle = search.trim().toLowerCase()
      return warehouses.filter((value) => !needle || value.toLowerCase().includes(needle)).map((value) => ({ id: value, text: value }))
    },
    [warehouses],
  )
  // «Наименование»: the warehouse's products with a balance (Linko: exclude_zero_balances, 100 a page).
  const loadProducts = useCallback(
    async (search: string) => {
      const needle = search.trim().toLowerCase()
      return rows
        .filter((row) => row.qty > 0 && (!needle || row.name.toLowerCase().includes(needle) || row.article.toLowerCase().includes(needle)))
        .slice(0, 100)
        .map((row) => ({ id: row.key, text: row.name, data: row }))
    },
    [rows],
  )

  const picked = addProduct?.data ?? null
  const pickedBox = picked?.boxAmount && picked.boxAmount > 0 ? picked.boxAmount : 0
  const unitText = (value: number, unit: string) => `${formatMoney(value)}${unit ? ` ${unit}` : ""}`

  const clearAdd = () => {
    setAddProduct(null)
    setAddSeries(null)
    setAddAmount("")
    setAddBox("")
  }
  const addLine = () => {
    if (!picked || !addAmount.trim() || !(amountOf(addAmount) > 0)) return
    // Like Linko: a product already on the list is not added again, the add row is cleared all the same.
    if (!lines.some((line) => line.row.key === picked.key)) {
      setLines((current) => [
        { uid: ++uids, row: picked, amount: addAmount.trim(), box: addBox.trim(), series: picked.trackExpiry ? addSeries : null, defect: picked.available <= 0 && picked.defectsAvailable > 0 },
        ...current,
      ])
    }
    clearAdd()
    setErrors((current) => ({ ...current, list: undefined }))
  }
  const fromPicker = (entries: PickEntry[]) => {
    setLines((current) => {
      const next = [...current]
      const added: Line[] = []
      for (const { row, quantity } of entries) {
        const index = next.findIndex((line) => line.row.key === row.key)
        if (index >= 0) next[index] = { ...next[index], amount: quantity }
        else added.push({ uid: ++uids, row, amount: quantity, box: "", series: null, defect: row.available <= 0 && row.defectsAvailable > 0 })
      }
      return [...added, ...next]
    })
    setErrors((current) => ({ ...current, list: undefined }))
  }
  const applyEdit = () => {
    if (!editing) return
    setLines((current) =>
      current.map((line) =>
        line.uid === editing.uid
          ? { ...line, amount: editing.amount.trim() ? editing.amount.trim() : line.amount, box: editing.box.trim() ? editing.box.trim() : line.box, series: editing.series ?? line.series }
          : line,
      ),
    )
    setEditing(null)
  }

  const total = lines.reduce((sum, line) => sum + wholeUnits(line.amount), 0)
  const groups = lines.reduce((sum, line) => sum + (Number(line.box) || 0), 0)
  const withBoxes = lines.some((line) => (line.row.boxAmount ?? 0) > 0)

  const submit = async () => {
    const required = t("Это поле обязательно к заполнению")
    const header = { warehouse: warehouse ? undefined : required, date: date ? undefined : required }
    if (header.warehouse || header.date) return setErrors(header)
    if (!lines.length) return setErrors({ list: t("Вы еще не выбрали ни одного товара.") })
    setBusy(true)
    setErrors({})
    const now = nowLocalIso()
    const result = await cashMutate<WriteOff>("POST", "/api/write-offs", {
      warehouse: name,
      // The chosen day at the current time (Linko sends the picker's moment).
      date: `${date}T${now.slice(11, 16)}`,
      comment,
      items: lines.map((line) => ({ key: line.row.key, product: line.row.name, qty: amountOf(line.amount), series: line.series?.text ?? "", ...(line.defect ? { defect: true } : {}) })),
    })
    setBusy(false)
    if (result.ok) return onSaved(result.data)
    const message = mutationError(result, t)
    if (result.field === "warehouse") return setErrors({ warehouse: message })
    if (result.field === "date") return setErrors({ date: message })
    const index = /^items\.(\d+)/.exec(result.field ?? "")?.[1]
    const line = index === undefined ? null : lines[Number(index)]
    setErrors({ list: `${message}${line ? `: ${line.row.name}` : ""}` })
  }

  // Linko's add-row columns: Наименование 5 (4 with Серия, 3 with a box), Серия 3, box 2, Кол-во 4 (2 with Серия, 3 with a box), ✓ 1.
  const nameSpan = pickedBox ? "col-span-3" : picked?.trackExpiry ? "col-span-4" : "col-span-5"
  const amountSpan = picked?.trackExpiry ? "col-span-2" : pickedBox ? "col-span-3" : "col-span-4"
  return (
    <>
      <CashModal
        title={t("Списание товара")}
        size="screen"
        onClose={() => {
          if (!pickerOpen) onClose()
        }}
        footer={
          <>
            <span className="ml-[20px] text-[14px] text-black">
              {t("Общее кол-во")}: <b className="text-[16px] font-semibold text-[#129fdd]">{formatMoney(total, 0)} {t("ед")}</b>
              {groups ? <span className="ml-1 text-[16px] font-semibold text-[#129fdd]">({formatMoney(groups)} {t("групп")})</span> : null}
            </span>
            <button type="button" disabled={busy} onClick={() => void submit()} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50">
              {t("Списать")}
            </button>
          </>
        }
      >
        <div className="w-1/4 min-w-[260px] shrink-0 overflow-y-auto border-r border-[#efefef] px-[30px] py-[20px]">
          <InventorySelect
            className="mt-[5px]"
            label={t("С какого склада")}
            required
            value={warehouse}
            load={loadWarehouses}
            error={errors.warehouse}
            onChange={(next) => {
              setWarehouse(next)
              clearAdd()
              setErrors((current) => ({ ...current, warehouse: undefined, list: undefined }))
            }}
          />
          <DateInput
            className="mt-[8px]"
            label={t("Выберите дату")}
            value={date}
            error={errors.date}
            onChange={(value) => {
              setDate(value)
              setErrors((current) => ({ ...current, date: undefined }))
            }}
          />
          <CommentField label={`${t("Оставить комментарий")}...`} value={comment} onChange={setComment} />
        </div>

        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-[30px] py-[10px]">
            <strong className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</strong>
            <RefTip text={warehouse ? "" : t("Выберите склад")} side="bottom" bold className="group/tip">
              <button
                type="button"
                disabled={!warehouse || !rows.length}
                onClick={() => setPickerOpen(true)}
                className="h-[36px] rounded-[2px] px-[16px] text-[13px] text-black enabled:hover:bg-[rgba(153,153,153,0.2)] disabled:cursor-default"
              >
                {t("добавить товары")}
              </button>
            </RefTip>
          </div>

          {warehouse && (
            <div className="grid min-h-[74px] grid-cols-12 items-end bg-[#f1f5f8] px-[30px] pb-[10px]">
              <div className={`${nameSpan} px-[8px]`}>
                <InventorySelect<StockPickRow>
                  label={t("Наименование")}
                  value={addProduct}
                  load={loadProducts}
                  renderOption={(option) => (
                    <>
                      <span className="block">{option.text}</span>
                      <span className="block font-semibold">
                        {t("Доступно")}: {unitText(Math.max(0, option.data?.available ?? 0), option.data?.unit ?? "")}
                      </span>
                      <span className="block font-semibold">
                        {t("Браковано")}: {unitText(option.data?.defects ?? 0, option.data?.unit ?? "")}
                      </span>
                    </>
                  )}
                  onChange={(next) => {
                    setAddProduct(next)
                    setAddSeries(null)
                    setAddBox("")
                    setSeriesBusy(true)
                    window.clearTimeout(timer.current)
                    timer.current = window.setTimeout(() => setSeriesBusy(false), 300)
                  }}
                />
              </div>
              {picked?.trackExpiry && (
                <div className="col-span-3 px-[8px]">
                  {seriesBusy ? (
                    <div className="flex h-[54px] items-end pb-[8px]">
                      <Spinner size={20} />
                    </div>
                  ) : (
                    <InventorySelect label={t("Серия")} value={addSeries} load={seriesLoader(productIdOf(picked.key))} onChange={setAddSeries} />
                  )}
                </div>
              )}
              {pickedBox > 0 && picked && (
                <div className="col-span-2 px-[8px]">
                  <AmountField
                    label={`${picked.boxUnit || t("Группа")} (${unitText(pickedBox, picked.unit)})`}
                    value={addBox}
                    onChange={(value) => {
                      setAddBox(value)
                      setAddAmount(value ? round4(amountOf(value) * pickedBox) : "")
                    }}
                    onEnter={addLine}
                  />
                </div>
              )}
              <div className={`${amountSpan} flex items-end px-[8px]`}>
                <div className="min-w-0 flex-1">
                  <AmountField
                    label={t("Кол-во")}
                    value={addAmount}
                    onChange={(value) => {
                      setAddAmount(value)
                      if (pickedBox) setAddBox(value ? round4(amountOf(value) / pickedBox) : "")
                    }}
                    onEnter={addLine}
                  />
                </div>
                {picked?.unit && <span className="mb-[15px] ml-[15px] text-[13px]">{picked.unit}</span>}
              </div>
              <div className="col-span-1 px-[8px]">
                <RefTip text={t("Применить")} side="bottom" className="group/tip">
                  <IconButton label={t("Применить")} onClick={addLine}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[rgb(79,113,220)]" aria-hidden>
                      <path d={CHECK} />
                    </svg>
                  </IconButton>
                </RefTip>
              </div>
            </div>
          )}

          {errors.list && <div className="mx-[30px] mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">{errors.list}</div>}
          {name && products.error && <div className="mx-[30px] mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">{t(products.error)}</div>}

          {lines.length > 0 && (
            <div className="px-[30px] py-[10px]">
              <table className="w-full table-fixed border-collapse text-[13px] text-[#333]">
                <thead>
                  <tr className="h-[50px] text-left">
                    <th style={dotted(true)} className="w-[30%] p-0 font-semibold">{t("Наименование")}</th>
                    <th style={dotted(true)} className="w-[20%] px-[10px] font-semibold">{t("Серия")}</th>
                    {withBoxes && <th style={dotted(true)} className="w-[15%] px-[10px] font-semibold">{t("Группа")}</th>}
                    <th style={dotted(true)} className="w-[12%] px-[10px] font-semibold">{t("Кол-во")}</th>
                    <th style={dotted(true)} className="w-[15%] px-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const box = line.row.boxAmount ?? 0
                    const edit = editing?.uid === line.uid ? editing : null
                    const dots = dotted(index < lines.length - 1)
                    return (
                      <tr key={line.uid} className="h-[50px]">
                        <td style={dots} className="whitespace-pre-wrap break-words p-0">
                          {line.row.name}
                          {(line.defect || line.row.defectsAvailable > 0) && (
                            <label className="ml-2 inline-flex items-center gap-1 text-[12px] text-[#586174]">
                              <input
                                type="checkbox"
                                checked={line.defect}
                                onChange={(event) => setLines((current) => current.map((item) => (item.uid === line.uid ? { ...item, defect: event.target.checked } : item)))}
                                className="h-3.5 w-3.5 accent-[rgb(79,113,220)]"
                              />
                              {t("Брак")}
                            </label>
                          )}
                        </td>
                        <td style={dots} className="px-[10px]">
                          {edit && line.row.trackExpiry ? (
                            <InventorySelect
                              ariaLabel={`${t("Серия")}: ${line.row.name}`}
                              value={edit.series ?? line.series}
                              load={seriesLoader(productIdOf(line.row.key))}
                              onChange={(next) => setEditing((current) => (current ? { ...current, series: next } : current))}
                            />
                          ) : (
                            line.series?.text ?? ""
                          )}
                        </td>
                        {withBoxes && (
                          <td style={dots} className="px-[10px]">
                            {edit && box > 0 ? (
                              <input
                                value={edit.box}
                                placeholder={line.box}
                                aria-label={`${line.row.boxUnit || t("Группа")}: ${line.row.name}`}
                                onChange={(event) => {
                                  const value = event.target.value.replace(",", ".").replace(/[^\d.]/g, "")
                                  setEditing((current) => (current ? { ...current, box: value, amount: value ? round4(amountOf(value) * box) : "" } : current))
                                }}
                                className="h-[40px] w-full border-b border-[#e0e0e0] bg-transparent outline-none"
                              />
                            ) : Number(line.box) ? (
                              `${formatMoney(Number(line.box))} ${line.row.boxUnit} (${formatMoney(box)})`
                            ) : null}
                          </td>
                        )}
                        <td style={dots} className="px-[10px]">
                          {edit ? (
                            <input
                              value={edit.amount}
                              placeholder={line.amount}
                              aria-label={`${t("Кол-во")}: ${line.row.name}`}
                              onChange={(event) => {
                                const value = event.target.value.replace(",", ".").replace(/[^\d.]/g, "")
                                setEditing((current) => (current ? { ...current, amount: value, box: box > 0 && value ? round4(amountOf(value) / box) : current.box } : current))
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault()
                                  applyEdit()
                                }
                              }}
                              className="h-[40px] w-full border-b border-[#e0e0e0] bg-transparent outline-none"
                            />
                          ) : (
                            unitText(amountOf(line.amount), line.row.unit)
                          )}
                        </td>
                        <td style={dots} className="px-[10px]">
                          <div className="flex justify-end">
                            {edit ? (
                              <IconButton label={t("Применить")} onClick={applyEdit}>
                                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[rgb(79,113,220)]" aria-hidden>
                                  <path d={CHECK} />
                                </svg>
                              </IconButton>
                            ) : (
                              <>
                                <IconButton label={t("Изменить")} onClick={() => setEditing({ uid: line.uid, amount: "", box: "", series: null })}>
                                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                                  </svg>
                                </IconButton>
                                <IconButton label={t("Удалить")} onClick={() => setLines((current) => current.filter((item) => item.uid !== line.uid))}>
                                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                  </svg>
                                </IconButton>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {name && products.loading && !products.data && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70">
              <Spinner />
            </div>
          )}
        </div>
      </CashModal>

      {pickerOpen && warehouse && (
        <StockProductPicker
          rows={rows}
          warehouse={name}
          mode="writeoff"
          currency=""
          initial={new Map(lines.map((line) => [line.row.key, { quantity: line.amount, price: "" }]))}
          onClose={() => setPickerOpen(false)}
          onSubmit={(entries) => {
            fromPicker(entries)
            setPickerOpen(false)
          }}
        />
      )}
      {busy && (
        <div className="fixed inset-0 z-[1302] flex items-center justify-center bg-white/40">
          <Spinner />
        </div>
      )}
    </>
  )
}
