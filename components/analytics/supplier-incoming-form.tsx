"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { formatUnitTotals } from "@/components/analytics/internal-transfers-shared"
import { formatSupplyAmount } from "@/lib/amount-precision"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"

/**
 * The reference's full-screen "Добавление поставки" form (material-ui fields on a three-column grid). Every field is
 * positioned from its underline: an empty field shows its label 24px above the line (13px), a filled one floats the
 * label 49px above it (9.75px) and writes the value 22px above the line.
 */

export type SupplyDraft = {
  supplier: string
  branch: string
  warehouse: string
  organization: string
  currency: string
  paymentType: string
  date: string
  expectedFactoryExit: string
  expectedCustomsArrival: string
  contractNumber: string
  invoiceNumber: string
  invoiceDate: string
  comment: string
}

export type SupplyFormItem = { id: number; product: string; qty: number; cost: number; expiry?: string; series?: string; source?: { name: string; ikpu: string; unit: string } }

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** "23 октября 2026" (or "23 окт. 2026" / "23.10.2026") → "2026-10-23"; "" when unreadable. */
export function ruDateToIso(value: string) {
  const dotted = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`
  const words = value.match(/^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/i)
  const month = words ? MONTHS.findIndex((name) => name.startsWith(words[2].toLowerCase().slice(0, 3))) : -1
  return words && month >= 0 ? `${words[3]}-${String(month + 1).padStart(2, "0")}-${words[1].padStart(2, "0")}` : ""
}

export function isoToRuDate(iso: string) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : ""
}

/** A form date ("23 октября 2026" / ISO) as shown: ru keeps the reference's "23 октября 2026" (`suffix`
 * appends its " г."), the other languages get the app's date format (lib/i18n/format-date.ts). */
function shownDate(value: string, language: LanguageCode, suffix = "") {
  const iso = ruDateToIso(value) || (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "")
  if (!iso) return value
  return language === "ru" ? `${isoToRuDate(iso)}${suffix}` : formatDateText(iso, language)
}

/** While `active`, Escape closes only this layer (`close`): a capture listener runs before the page's
 * document-level Escape handler, which would otherwise close the whole form. `owns` narrows it further:
 * when it says the user is not in this layer (e.g. a dialog opened on top took the focus), the Escape
 * is left untouched for whoever is on top. */
function useEscapeLayer(active: boolean, close: () => void, owns?: () => boolean) {
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (owns && !owns()) return
      event.stopPropagation()
      close()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [active, close, owns])
}

const CALENDAR =
  "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
const PLUS = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"

const LINE = "absolute inset-x-0 h-px bg-[#e0e0e0]"
/** The supply form's fields fill their column (Linko's fullWidth), whatever the viewport. */
const FLUID = 4000
const DOTTED = "absolute inset-x-0 -mt-[2px] border-t-2 border-dotted border-black/30"

function Star() {
  return <span className="text-[#e57373]"> *</span>
}

function Label({ top, text, required, floating, regular }: { top: number; text: string; required?: boolean; floating: boolean; regular?: boolean }) {
  return (
    <span
      style={{ top: floating ? top - 49 : top - 24 }}
      className={`pointer-events-none absolute left-0 whitespace-nowrap text-black ${floating ? "text-[9.75px] font-semibold leading-[12px]" : `text-[13px] leading-[18px] ${regular ? "font-normal" : "font-semibold"}`}`}
    >
      {text}
      {required && <Star />}
    </span>
  )
}

/** A column slot: `left`/`width` position it, `top` is the underline's y inside the column. */
export function Slot({ top, left, width, children, offset = 1 }: { top: number; left: number; width: number | string; children: ReactNode; offset?: number }) {
  return <div style={{ left, width: typeof width === "number" ? colWidth(left, width) : width, top: offset, height: top + 1 }} className="pointer-events-none absolute">{children}</div>
}

/** The design width of a field, shrunk so that it keeps the column's right gutter on narrower viewports. */
function colWidth(left: number, width: number, reserve = 0) {
  const gutter = left === 20 ? 30 : left === 21 ? 21 : 20
  return `min(${width - reserve}px, calc(100% - ${left + gutter + reserve}px))`
}

export function SelectField({
  top,
  left,
  width,
  label,
  required,
  value,
  options,
  onChange,
  onClear,
  addLabel,
  onAdd,
  addWidth = 98,
  error,
  menu,
  searchable,
  disabled,
}: {
  top: number
  left: number
  width: number
  label: string
  required?: boolean
  /** Greyed and inert, no clear mark (the supply form's «Склад назначения» of an accepted supply). */
  disabled?: boolean
  /** Red 2px line and the message under it (the reference's transfer form shows it as soon as it opens). */
  error?: string
  /** Own dropdown list (32px rows, shadow) instead of the native select, like the reference's transfer form. */
  menu?: boolean
  /** With `menu`: typing in the open field filters the list (Linko's searchable select). */
  searchable?: boolean
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  onClear?: () => void
  addLabel?: string
  onAdd?: () => void
  addWidth?: number
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  useEscapeLayer(open, () => setOpen(false))
  const shown = value ? (options.find((option) => option.value === value)?.label ?? value) : ""
  const gutter = left === 20 ? 30 : left === 21 ? 21 : 20
  const term = searchable && open ? query.trim().toLowerCase() : ""
  const listed = term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options
  const toggle = () => {
    setQuery("")
    setOpen((current) => !current)
  }
  return (
    <>
      <Slot top={top} left={left} width={colWidth(left, width, onAdd ? addWidth : 0)} offset={0}>
        {disabled && <span style={{ top: top - 35, height: 35 }} className="absolute inset-x-0 bg-[#f7f7f7]" />}
        <Label top={top} text={label} required={required} floating={Boolean(shown)} />
        {shown && (
          <span style={{ top: top - 22 }} className="absolute left-0 right-[44px] truncate text-[13px] font-semibold leading-[18px] text-[#333]">
            {shown}
          </span>
        )}
        {shown && onClear && !disabled && (
          <span role="button" aria-label={t("Очистить")} onClick={onClear} style={{ top: top - 21 }} className="pointer-events-auto absolute right-[28px] z-[1] cursor-pointer text-[18px] leading-[18px] text-[#999]">
            ×
          </span>
        )}
        <svg viewBox="0 0 10 5" style={{ top: top - 15 }} className="pointer-events-none absolute right-[9px] h-[5px] w-[10px]" aria-hidden>
          <path d="M0 0h10L5 5z" fill="#999" fillOpacity={disabled ? 0.3 : 0.7} />
        </svg>
        {disabled ? null : menu ? (
          <>
            <button type="button" aria-label={label} onClick={toggle} style={{ top: top - 40, height: 40 }} className="pointer-events-auto absolute left-0 w-full cursor-pointer opacity-0" />
            {open && (
              <>
                <button type="button" aria-label={t("Закрыть")} className="pointer-events-auto fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
                {searchable && (
                  <input
                    autoFocus
                    value={query}
                    aria-label={label}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        if (listed[0]) {
                          onChange(listed[0].value)
                          setOpen(false)
                        }
                      }
                    }}
                    style={{ top: top - 24, height: 22 }}
                    className="pointer-events-auto absolute left-0 right-[44px] z-50 bg-white text-[13px] font-semibold leading-[18px] text-[#333] outline-none"
                  />
                )}
                <div style={{ top: top + 1.5 }} className="pointer-events-auto absolute inset-x-0 z-50 max-h-[240px] overflow-y-auto bg-white py-0 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
                  {searchable && !listed.length && <div className="h-8 px-[10px] text-[13px] leading-8 text-[#999]">{t("Не найдено")}</div>}
                  {listed.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                      className={`block h-8 w-full truncate px-[10px] text-left text-[13px] font-semibold leading-8 hover:bg-[#e9f0fb] ${option.value === value ? "bg-[#e9f0fb] text-[#333]" : "text-[#666]"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <select value={value} onChange={(event) => onChange(event.target.value)} style={{ top: top - 40, height: 40 }} className="pointer-events-auto absolute left-0 w-full cursor-pointer opacity-0">
            <option value="" />
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        {error ? (
          <>
            <span style={{ top: top - 1 }} className="absolute inset-x-0 h-[2px] bg-[#f44336]" />
            {/* t(): a caller may pass the Russian key; an already translated text comes back unchanged. */}
            <span style={{ top: top + 1 }} className="absolute left-0 text-[12px] leading-[15px] text-[#f44336]">{t(error)}</span>
          </>
        ) : (
          <span style={{ top }} className={LINE} />
        )}
      </Slot>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={{ right: gutter, top: top - 15, width: addWidth - 10 }}
          className="pointer-events-auto absolute whitespace-nowrap text-right text-[13px] leading-[18px] text-[#1E4A9A] hover:underline"
        >
          {addLabel}
        </button>
      )}
    </>
  )
}

export function DateField({ top, left, width, label, required, value, onChange, primary, disabled }: { top: number; left: number; width: number; label: string; required?: boolean; value: string; onChange: (value: string) => void; primary?: boolean; /** Inert, with the dotted line of a disabled Material field. */ disabled?: boolean }) {
  const { language } = useLanguage()
  const iso = ruDateToIso(value)
  const shown = iso ? shownDate(iso, language, " г.") : value
  const [open, setOpen] = useState(false)
  // Escape closes the calendar, not the form under it.
  useEscapeLayer(open, () => setOpen(false))
  return (
    <Slot top={top} left={left} width={width}>
      {primary ? (
        <>
          <span style={{ top: top - 43 }} className="pointer-events-none absolute left-0 text-[9.75px] font-normal leading-[12px] text-black">
            {label}
            {required && <Star />}
          </span>
          <span data-no-translate style={{ top: top - 19 }} className="absolute left-0 right-[30px] truncate text-[13px] leading-[18px] text-black">{shown}</span>
        </>
      ) : (
        <>
          {shown ? (
            <span style={{ top: top - 43 }} className="pointer-events-none absolute left-0 text-[9.75px] leading-[12px] text-black">{label}</span>
          ) : (
            <Label top={top} text={label} floating={false} regular />
          )}
          {shown && <span data-no-translate style={{ top: top - 19 }} className="absolute left-0 right-[30px] truncate text-[13px] leading-[18px] text-black">{shown}</span>}
        </>
      )}
      <svg viewBox="0 0 24 24" style={{ top: top - 25 }} className="pointer-events-none absolute right-0 h-5 w-5" aria-hidden>
        <path d={CALENDAR} fill="#ccc" />
      </svg>
      {!disabled && (
        <button
          type="button"
          aria-label={label}
          onClick={() => setOpen(true)}
          style={{ top: top - 40, height: 40 }}
          className="pointer-events-auto absolute left-0 w-full cursor-pointer opacity-0"
        />
      )}
      <span style={{ top }} className={disabled ? DOTTED : LINE} />
      {open && <DatePickerDialog value={iso} onCancel={() => setOpen(false)} onPick={(next) => { onChange(isoToRuDate(next)); setOpen(false) }} />}
    </Slot>
  )
}

export function TextField({ top, left, width, label, value, onChange, dotted, disabled }: { top: number; left: number; width: number; label: string; value: string; onChange: (value: string) => void; dotted?: boolean; disabled?: boolean }) {
  return (
    <Slot top={top} left={left} width={width}>
      <Label top={top} text={label} floating={Boolean(value)} />
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{ top: top - 26, height: 26 }}
        className="pointer-events-auto absolute inset-x-0 bg-transparent text-[13px] font-semibold leading-[18px] text-black outline-none"
      />
      <span style={{ top }} className={dotted ? DOTTED : LINE} />
    </Slot>
  )
}

export function SupplierIncomingForm({
  title,
  banner,
  draft,
  setDraft,
  supplierOptions,
  branchOptions,
  warehouseOptions,
  organizationOptions,
  currencyOptions,
  paymentTypeOptions,
  items,
  productOptions,
  currency,
  productUnits,
  productBoxes,
  productInfo,
  productExpiry,
  onClose,
  onSubmit,
  onQuickAddSupplier,
  onQuickAddOrganization,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  onOpenPicker,
  onImportClick,
  importInput,
  onImportTemplate,
  onImportConfirm,
  importStaged,
  update = false,
  acceptedByStock = false,
  editOnlyPrice = false,
  productSeries = {},
}: {
  title: string
  banner?: ReactNode
  draft: SupplyDraft
  setDraft: (update: (current: SupplyDraft) => SupplyDraft) => void
  supplierOptions: string[]
  branchOptions: string[]
  warehouseOptions: string[]
  organizationOptions: string[]
  currencyOptions: string[]
  paymentTypeOptions: { value: string; label: string }[]
  items: SupplyFormItem[]
  productOptions: string[]
  currency: string
  productUnits: Record<string, string>
  productBoxes: Record<string, { unit: string; amount: number }>
  productInfo: Record<string, { stock: number; barcode: string }>
  /** Products that track an expiry date: only they get the strip's "Срок годности" field. */
  productExpiry: Record<string, boolean>
  onClose: () => void
  /** The page's save (may be async: the form waits for it before checking whether a notice covers it). */
  onSubmit: (event: FormEvent) => void | Promise<void>
  onQuickAddSupplier: () => void
  /** «+добавить» next to «Организация»: the shared organization dialog of the Организация page (kept at the user's request,
   * although Linko's form has none). */
  onQuickAddOrganization: () => void
  onAddItem: (item: { product: string; qty: number; cost: number; expiry: string; series: string }) => void
  onUpdateItem: (id: number, patch: { product: string; qty: number; cost: number; expiry: string; series: string }) => void
  onRemoveItem: (id: number) => void
  onOpenPicker: () => void
  onImportClick: () => void
  importInput: ReactNode
  onImportTemplate: () => void
  onImportConfirm: () => void
  /** Rows of the uploaded file waiting for "Подтвердить". */
  importStaged: number
  /** «Изменение поставки» (Linko's isUpdate): the invoice fields are inert and empty — the invoice changes through
   * «Изменить детали счет фактуры». */
  update?: boolean
  /** The supply is on the warehouse (Linko's acceptedByStock): «Склад назначения» is fixed and no lines are added. */
  acceptedByStock?: boolean
  /** Linko's editOnlyPrice (an accepted supply): a line's ✎ changes only its series, expiry and «Сумма (ед.)». */
  editOnlyPrice?: boolean
  /** Products that keep series (Linko's useSeries): the strip and the ✎ row get «Серия». */
  productSeries?: Record<string, boolean>
}) {
  const { t, language } = useLanguage()
  const uz = language === "uz"
  // The form covers the page at the reference's dialog level (z 1400). The layers the page opens over
  // it sit lower — the quick-add forms (Поставщик / Организация, z 70–100) and the save notices (z 300)
  // — so the form steps back under them (z 60, still above the top bar) and comes forward again as soon
  // as nothing covers it any more (the layer was closed, or the save opened none).
  const rootRef = useRef<HTMLDivElement>(null)
  const [onTop, setOnTop] = useState(true)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (onTop || saving) return
    const timer = window.setInterval(() => {
      const root = rootRef.current
      const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      if (root && hit && root.contains(hit)) setOnTop(true)
    }, 200)
    return () => window.clearInterval(timer)
  }, [onTop, saving])
  const [stripOpen, setStripOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [stripProduct, setStripProduct] = useState("")
  const [stripQty, setStripQty] = useState("")
  const [stripCost, setStripCost] = useState("")
  const [stripExpiry, setStripExpiry] = useState("")
  const [stripSeries, setStripSeries] = useState("")
  const [stripBox, setStripBox] = useState("")
  /** The line its ✎ turned into an inline edit row (Linko's ✓ applies it): text of each input. */
  const [rowEdit, setRowEdit] = useState<{ id: number; qty: string; cost: string; box: string; series: string; expiry: string } | null>(null)
  // Linko's selects list the options by name.
  const plain = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b, "ru")).map((value) => ({ value, label: value }))
  const set = (patch: Partial<SupplyDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const box = stripProduct ? productBoxes[stripProduct] : undefined
  const unit = stripProduct ? (productUnits[stripProduct] ?? "") : ""
  const parseNumber = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."))
  const resetStrip = () => {
    setStripProduct("")
    setStripQty("")
    setStripCost("")
    setStripExpiry("")
    setStripSeries("")
    setStripBox("")
  }
  const addFromStrip = () => {
    const qty = parseNumber(stripQty)
    const cost = parseNumber(stripCost) || 0
    if (!stripProduct || !(qty > 0)) return
    onAddItem({ product: stripProduct, qty, cost, expiry: stripExpiry, series: productSeries[stripProduct] ? stripSeries.trim() : "" })
    resetStrip()
  }
  // Linko's ✎ row: the price unformatted («7700»), Группа and Кол-во empty (an empty Кол-во keeps the quantity).
  const editItem = (item: SupplyFormItem) => setRowEdit({ id: item.id, qty: "", cost: String(item.cost), box: "", series: item.series ?? "", expiry: item.expiry ?? "" })
  /** ✓ of the inline row: an empty «Кол-во» keeps the line's quantity (its hint), the price is the field's. */
  const applyRowEdit = (item: SupplyFormItem) => {
    if (!rowEdit) return
    const typedQty = parseNumber(rowEdit.qty)
    const qty = editOnlyPrice || !rowEdit.qty.trim() || !(typedQty > 0) ? item.qty : typedQty
    const typedCost = parseNumber(rowEdit.cost)
    const cost = rowEdit.cost.trim() && typedCost >= 0 ? typedCost : item.cost
    onUpdateItem(item.id, { product: item.product, qty, cost, expiry: rowEdit.expiry, series: rowEdit.series.trim() })
    setRowEdit(null)
  }
  const optionLabel = (name: string) => {
    const info = productInfo[name]
    const unitName = productUnits[name] ?? ""
    const barcode = info?.barcode && info.barcode !== "не установлен" ? ` (${t("Штрих")}: ${info.barcode})` : ""
    return info ? `${name} (${info.stock.toLocaleString("ru-RU")} ${unitName})${barcode}` : name
  }
  // Money as everywhere in the app: ru grouping, 2 decimals.
  const money = (value: number) => `${formatSupplyAmount(value, 2)} ${currency}`
  const totalCost = money(items.reduce((sum, item) => sum + item.qty * item.cost, 0))
  // "Общее кол-во": one total per unit (kg and pieces are never added up), and the groups per group
  // unit ("2 коробка, 1 блок") in brackets.
  const unitLines = items.map((item) => ({ qty: item.qty, unit: productUnits[item.product] ?? "" }))
  const groupLines = items.flatMap((item) => {
    const itemBox = productBoxes[item.product]
    return itemBox && itemBox.amount > 0 ? [{ qty: item.qty / itemBox.amount, unit: itemBox.unit }] : []
  })
  // An empty list reads «0 ед», as Linko's.
  const qtyLabel = items.length ? `${formatUnitTotals(unitLines, t)}${groupLines.length ? ` (${formatUnitTotals(groupLines, t)})` : ""}` : `0 ${t("ед")}`
  const stepBack = () => setOnTop(false)

  return (
    <div ref={rootRef} className={`fixed inset-0 ${onTop ? "z-[1400]" : "z-[60]"} bg-white`}>
      <form
        onSubmit={(event) => {
          // A refused save is reported in the page's notice: the form steps back under it until the save has answered.
          stepBack()
          setSaving(true)
          void Promise.resolve(onSubmit(event))
            .catch(() => undefined)
            .finally(() => setSaving(false))
        }}
        className="flex h-full w-full flex-col bg-white text-[13px] text-[#333]"
      >
        <header className="flex h-[60px] shrink-0 items-start justify-between border-b border-[#e0e0e0]">
          <span className="pl-[30px] pt-[21px] text-[13px] font-bold uppercase leading-[16px] text-[#333]">{title}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="mr-[27px] mt-[18px] flex h-6 w-6 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
              <path d={CLOSE} />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {banner}
          <div className="grid grid-cols-[442fr_412fr_442fr] border-b border-[#e0e0e0]">
            <div className="relative h-[330px] border-r border-[#e0e0e0]">
              <SelectField menu searchable top={58} left={30} width={FLUID} label={t("Поставщик")} required value={draft.supplier} options={plain(supplierOptions)} onChange={(value) => set({ supplier: value })} onClear={() => set({ supplier: "" })} addLabel={t("+добавить")} onAdd={() => { stepBack(); onQuickAddSupplier() }} addWidth={78} />
              <SelectField menu searchable top={125} left={30} width={FLUID} label={t("Филиал")} required value={draft.branch} options={plain(branchOptions)} onChange={(value) => set({ branch: value })} onClear={() => set({ branch: "" })} />
              <SelectField menu searchable top={187} left={30} width={FLUID} label={t("Склад назначения")} required value={draft.warehouse} options={plain(warehouseOptions)} onChange={(value) => set({ warehouse: value })} onClear={() => set({ warehouse: "" })} disabled={acceptedByStock} />
              <TextField top={259} left={30} width={FLUID} label={t("Оставить комментарий...")} value={draft.comment} onChange={(value) => set({ comment: value })} />
            </div>
            <div className="relative h-[330px] border-r border-[#e0e0e0]">
              <SelectField menu searchable top={58} left={21} width={FLUID} label={t("Организация")} required value={draft.organization} options={plain(organizationOptions)} onChange={(value) => set({ organization: value })} onClear={() => set({ organization: "" })} addLabel={t("+добавить")} onAdd={() => { stepBack(); onQuickAddOrganization() }} addWidth={78} />
              <SelectField menu searchable top={120} left={21} width={FLUID} label={t("Валюта оплаты")} required value={draft.currency} options={plain(currencyOptions)} onChange={(value) => set({ currency: value })} onClear={() => set({ currency: "" })} />
              <SelectField menu searchable top={182} left={21} width={FLUID} label={t("Тип оплаты")} required value={draft.paymentType} options={paymentTypeOptions} onChange={(value) => set({ paymentType: value })} onClear={() => set({ paymentType: "" })} />
            </div>
            <div className="relative h-[330px]">
              <DateField primary top={56} left={20} width={FLUID} label={t("Дата поставки")} required value={draft.date} onChange={(value) => set({ date: value })} />
              <DateField top={115} left={20} width={FLUID} label={t("Ожидаемый выход с завода")} value={draft.expectedFactoryExit} onChange={(value) => set({ expectedFactoryExit: value })} />
              <DateField top={167} left={20} width={FLUID} label={t("Ожидаемое прибытие в таможню")} value={draft.expectedCustomsArrival} onChange={(value) => set({ expectedCustomsArrival: value })} />
              <TextField top={212} left={20} width={FLUID} label={t("Номер договора")} value={draft.contractNumber} onChange={(value) => set({ contractNumber: value })} />
              <TextField dotted disabled={update} top={257} left={20} width={FLUID} label={t("Номер счет фактура")} value={update ? "" : draft.invoiceNumber} onChange={(value) => set({ invoiceNumber: value })} />
              <DateField disabled={update} top={309} left={20} width={FLUID} label={t("Дата счет фактуры")} value={update ? "" : draft.invoiceDate} onChange={(value) => set({ invoiceDate: value })} />
            </div>
          </div>

          <div className="relative min-h-[calc(100vh-448px)]">
            <div className="flex h-[55px] items-start justify-between">
              <span className="pl-[30px] pt-[22px] text-[13px] font-semibold leading-[16px] text-[#333]">{t("Список товаров")}</span>
              <div className={`flex items-start pr-[30px] pt-[12px] ${acceptedByStock ? "hidden" : ""}`}>
                <button type="button" onClick={() => { setStripOpen((open) => !open); setImportOpen(false) }} className={`h-9 rounded-[2px] px-[16px] pt-[3px] text-[13px] text-black hover:bg-[#eee] ${stripOpen ? "bg-[#eee]" : ""}`}>
                  {t("добавить товар")}
                </button>
                <button type="button" onClick={onOpenPicker} className="h-9 rounded-[2px] px-[16px] pt-[3px] text-[13px] text-black hover:bg-[#eee]">
                  {t("добавить из списка")}
                </button>
                <button type="button" onClick={() => { setImportOpen((open) => !open); setStripOpen(false) }} className={`h-9 rounded-[2px] px-[16px] pt-[3px] text-[13px] text-black hover:bg-[#eee] ${importOpen ? "bg-[#eee]" : ""}`}>
                  {uz ? "excel’dan import qilish" : t("импортировать с excel")}
                </button>
                {importInput}
              </div>
            </div>

            {stripOpen && !acceptedByStock && (
              <div className="relative flex h-[87px] bg-[#f0f4f7] pl-[18px]">
                <StripProductSelect label={t("Наименование")} notFound={t("Не найдено")} clearLabel={t("Очистить")} value={stripProduct} options={productOptions} labelOf={optionLabel} onChange={(value) => { setStripProduct(value); setStripBox("") }} onClear={resetStrip} />
                {stripProduct && productExpiry[stripProduct] && (
                  <StripCell pitch="calc(8.333% + 11.5px)" gap={16}>
                    <span className="pointer-events-none absolute left-0 top-[46px] whitespace-nowrap text-[13px] leading-[18px] text-[#333]">
                      {stripExpiry ? shownDate(stripExpiry, language) : t("Выбрать дату")}
                    </span>
                    <input type="date" value={ruDateToIso(stripExpiry)} onChange={(event) => setStripExpiry(event.target.value ? isoToRuDate(event.target.value) : "")} className="absolute inset-x-0 top-[36px] h-[34px] cursor-pointer opacity-0" />
                    <span style={{ top: 69 }} className={LINE} />
                  </StripCell>
                )}
                {stripProduct && productSeries[stripProduct] && <StripInput label={t("Серия")} value={stripSeries} onChange={setStripSeries} text />}
                {stripProduct && box && (
                  <StripInput
                    label={`${box.unit} (${box.amount} ${unit})`}
                    value={stripBox}
                    onChange={(value) => {
                      const grouped = groupDigits(value)
                      setStripBox(grouped)
                      const boxes = parseNumber(grouped)
                      setStripQty(boxes > 0 ? groupDigits(String(Math.round(boxes * box.amount * 1000) / 1000).replace(".", ",")) : "")
                    }}
                  />
                )}
                <StripInput
                  label={t("Кол-во")}
                  value={stripQty}
                  unit={stripProduct ? unit : undefined}
                  onChange={(value) => {
                    const grouped = groupDigits(value)
                    setStripQty(grouped)
                    if (box) {
                      const qty = parseNumber(grouped)
                      setStripBox(qty > 0 ? String(Math.round((qty / box.amount) * 1000) / 1000).replace(".", ",") : "")
                    }
                  }}
                />
                <StripInput label={t("Сумма за ед")} value={stripCost} onChange={(value) => setStripCost(groupDigits(value))} />
                <button type="button" onClick={addFromStrip} aria-label={t("добавить товар")} className="-ml-px mt-[29px] flex h-12 w-12 shrink-0 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]">
                    <path d={PLUS} />
                  </svg>
                </button>
              </div>
            )}

            {importOpen && (
              <div className="mx-[30px] mt-[5px] flex h-[47px] items-center justify-between border border-[#e0e0e0] px-[16px] text-[13px] uppercase leading-[16px] text-[#333]">
                <button type="button" onClick={onImportTemplate} className="uppercase">1. {t("Загрузить шаблон")}</button>
                <button type="button" onClick={onImportClick} className="-translate-x-[7px] uppercase">2. {t("Заполните excel и загрузите")}</button>
                <button type="button" onClick={onImportConfirm} disabled={importStaged === 0} className={`uppercase ${importStaged ? "font-semibold text-[#129fdd]" : ""}`}>3. {t("Подтвердить")}</button>
              </div>
            )}

            {items.length === 0 ? (importOpen ? null : (
              <div className={`pointer-events-none absolute inset-x-0 bottom-0 top-[55px] flex flex-col items-center justify-center pb-[46px] text-center text-[13px] leading-[16px] text-[#adadad] ${stripOpen ? "pt-[132px]" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/empty-basket.svg" alt="" className="h-[72px] w-[72px]" />
                <div className="mt-[22px]">
                  {t("Вы еще не выбрали ни одного товара")}.
                  <br />
                  <button type="button" onClick={() => setStripOpen(true)} className="pointer-events-auto text-[#129fdd]">
                    {t("Добавить")}
                  </button>{" "}
                  {t("товар")}?
                </div>
              </div>
            )) : (
              <div className="px-[22px] text-[13px] text-[#333]">
                <div className={`grid h-[55px] grid-cols-[25%_16.667%_8.333%_8.333%_8.333%_16.667%_1fr] items-center border-b border-dotted border-[#bdbdbd] ${stripOpen ? "" : ""}`}>
                  <div className="pl-[8px]">{t("Наименование")}</div>
                  <div className="pl-[8px]">{t("Серия")}</div>
                  <div className="pl-[8px]">{t("Группа")}</div>
                  <div className="pl-[8px]">{t("Кол-во")}</div>
                  <div className="pl-[8px]">{t("Сумма (ед.)")}</div>
                  <div className="pl-[8px]">{t("Всего")}</div>
                  <div />
                </div>
                {items.map((item, index) => {
                  const itemBox = productBoxes[item.product]
                  return (
                    <div key={item.id} className={`grid ${rowEdit?.id === item.id ? "min-h-[80px] py-[6px]" : "min-h-[64px]"} grid-cols-[25%_16.667%_8.333%_8.333%_8.333%_16.667%_1fr] items-center border-b border-dotted border-[#bdbdbd]`}>
                      <div className="pl-[8px] pr-[8px]">
                        {index + 1}. {item.product || <span className="text-rose-500">—</span>}
                        {item.source && (
                          <span className={`block text-xs ${item.product ? "text-slate-400" : "text-rose-500"}`}>
                            {t("По счет-фактуре")}: {item.source.name}
                            {item.source.ikpu ? ` · ${t("ИКПУ")} ${item.source.ikpu}` : ""}
                            {item.source.unit ? ` · ${item.source.unit}` : ""}
                          </span>
                        )}
                      </div>
                      {rowEdit?.id === item.id ? (
                        <>
                          <div className="flex flex-col gap-[4px] pl-[8px] pr-[16px]">
                            {productSeries[item.product] && (
                              <RowInput label={t("Серия")} value={rowEdit.series} onChange={(value) => setRowEdit({ ...rowEdit, series: value })} />
                            )}
                            {productExpiry[item.product] && (
                              <label className="relative block h-[26px] border-b border-[#e0e0e0] text-[13px]">
                                <span className="absolute left-0 top-[4px] text-[#333]">{rowEdit.expiry ? shownDate(rowEdit.expiry, language) : t("Срок годности")}</span>
                                <input type="date" value={ruDateToIso(rowEdit.expiry) || rowEdit.expiry} onChange={(event) => setRowEdit({ ...rowEdit, expiry: event.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
                              </label>
                            )}
                          </div>
                          <div className="pl-[8px] pr-[12px]">
                            {itemBox && !editOnlyPrice ? (
                              <RowInput
                                value={rowEdit.box}
                                onChange={(value) => {
                                  const grouped = groupDigits(value)
                                  const boxes = parseNumber(grouped)
                                  setRowEdit({ ...rowEdit, box: grouped, qty: boxes > 0 ? groupDigits(String(Math.round(boxes * itemBox.amount * 1000) / 1000).replace(".", ",")) : "" })
                                }}
                              />
                            ) : (
                              groupLabel(item.qty, itemBox, false)
                            )}
                          </div>
                          <div className="pl-[8px] pr-[12px]">
                            {editOnlyPrice ? (
                              `${item.qty.toLocaleString("ru-RU")} ${productUnits[item.product] ?? ""}`
                            ) : (
                              <RowInput
                                value={rowEdit.qty}
                                onChange={(value) => {
                                  const grouped = groupDigits(value)
                                  const qty = parseNumber(grouped)
                                  setRowEdit({ ...rowEdit, qty: grouped, box: itemBox && qty > 0 ? String(Math.round((qty / itemBox.amount) * 1000) / 1000).replace(".", ",") : "" })
                                }}
                              />
                            )}
                          </div>
                          <div className="pl-[8px] pr-[12px]">
                            <RowInput value={rowEdit.cost} onChange={(value) => setRowEdit({ ...rowEdit, cost: value.replace(/[^\d.,]/g, "") })} onEnter={() => applyRowEdit(item)} />
                          </div>
                          <div className="pl-[8px]">{money((editOnlyPrice || !rowEdit.qty.trim() ? item.qty : parseNumber(rowEdit.qty) || item.qty) * (rowEdit.cost.trim() ? parseNumber(rowEdit.cost) || 0 : item.cost))}</div>
                          <div className="flex items-center pl-[8px]">
                            <button type="button" onClick={() => applyRowEdit(item)} aria-label={t("Применить")} className="flex h-6 w-6 items-center justify-center">
                              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
                                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                              </svg>
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="pl-[8px] pr-[8px] leading-[19px]">
                            {productSeries[item.product] && item.series && (
                              <span className="block">
                                <b className="font-semibold">{t("Серия")}:</b> {item.series}
                              </span>
                            )}
                            {productExpiry[item.product] && item.expiry && (
                              <span className="block">
                                <b className="font-semibold">{t("Дата")}:</b> <span data-no-translate>{dottedDate(item.expiry)}</span>
                              </span>
                            )}
                          </div>
                          <div className="pl-[8px] pr-[4px]">{groupLabel(item.qty, itemBox)}</div>
                          <div className="pl-[8px]">
                            {item.qty.toLocaleString("ru-RU")} {productUnits[item.product] ?? ""}
                          </div>
                          <div className="pl-[8px]">{money(item.cost)}</div>
                          <div className="pl-[8px]">{money(item.qty * item.cost)}</div>
                          <div className="flex items-center gap-[14px] pl-[8px]">
                            <button type="button" onClick={() => editItem(item)} aria-label={t("Изменить")} className="flex h-6 w-6 items-center justify-center">
                              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                              </svg>
                            </button>
                            <button type="button" onClick={() => { if (rowEdit?.id === item.id) setRowEdit(null); onRemoveItem(item.id) }} aria-label={t("Удалить")} className="flex h-6 w-6 items-center justify-center">
                              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]">
                                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="flex h-[57px] shrink-0 items-center justify-between gap-[12px] border-t border-[#e0e0e0]">
          {/* One line, like Linko's: a long «Общее кол-во» is cut with … (its full text in the hint), the save button stays whole. */}
          <div className="flex min-w-0 flex-1 items-center whitespace-nowrap pl-[10px] text-[14px] leading-[19px] text-black">
            <span className="shrink-0">{t("Общая стоимость")}:&nbsp;</span>
            <span className="shrink-0 text-[16px] font-semibold leading-[22px] text-[#129fdd]">{totalCost}</span>
            <span className="ml-[26px] shrink-0">{t("Общее кол-во")}:&nbsp;</span>
            <span title={qtyLabel} className="min-w-0 truncate text-[16px] font-semibold leading-[22px] text-[#129fdd]">{qtyLabel}</span>
          </div>
          <button type="submit" className="relative top-[2px] -mr-[3px] h-9 w-[111px] shrink-0 text-[13px] font-semibold uppercase text-[#129fdd]">
            {t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}

/** A strip column: `pitch` is its CSS width in the row (the reference's strip is fluid), `gap` is the space after the field. */
function StripCell({ pitch, gap, children }: { pitch: string; gap: number; children: ReactNode }) {
  return (
    <div style={{ width: pitch }} className="relative h-[87px] shrink-0">
      <div style={{ width: `calc(100% - ${gap}px)` }} className="absolute left-0 top-0 h-full">{children}</div>
    </div>
  )
}

const STRIP_STD = "16.667%"
const STRIP_QTY_UNIT = "calc(16.667% + 9px)"

function StripInput({ label, value, onChange, unit, text }: { label: string; value: string; onChange: (value: string) => void; unit?: string; /** Free text (Серия), not a number. */ text?: boolean }) {
  const floating = Boolean(value)
  return (
    <StripCell pitch={unit ? STRIP_QTY_UNIT : STRIP_STD} gap={unit ? 67 : 16}>
      <span style={{ top: floating ? 26 : 45 }} className={`pointer-events-none absolute left-0 whitespace-nowrap font-semibold text-black ${floating ? "text-[9.75px] leading-[12px]" : "text-[13px] leading-[18px]"}`}>
        {label}
      </span>
      <input value={value} onChange={(event) => onChange(event.target.value)} inputMode={text ? "text" : "decimal"} style={{ top: 43, height: 26 }} className="absolute inset-x-0 bg-transparent text-[13px] font-semibold leading-[18px] text-black outline-none" />
      {unit && <span className="pointer-events-none absolute left-full top-[31px] w-[45px] text-[13px] leading-[16px] text-[#333]">{unit}</span>}
      <span style={{ top: 69 }} className={LINE} />
    </StripCell>
  )
}


/** «Группа» of a line: «0,16667 новый шт (6)» (the groups to five decimals, then the units of one group), else «-»;
 * the ✎ row shows it without the units of a group. */
function groupLabel(qty: number, box: { unit: string; amount: number } | undefined, withSize = true) {
  if (!box || !(box.amount > 0)) return "-"
  const groups = `${(qty / box.amount).toLocaleString("ru-RU", { maximumFractionDigits: 5 })} ${box.unit}`
  return withSize ? `${groups} (${box.amount.toLocaleString("ru-RU")})` : groups
}

/** "2026-04-24" → "24.04.2026" (Linko's «Дата:» of a line's series). */
function dottedDate(value: string) {
  const iso = ruDateToIso(value) || (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "")
  return iso ? iso.split("-").reverse().join(".") : value
}

/** An input of the inline edit row: a Material line; `label` / `hint` float above it or sit in it while empty. */
function RowInput({ label, hint, value, onChange, onEnter }: { label?: string; hint?: string; value: string; onChange: (value: string) => void; onEnter?: () => void }) {
  return (
    <label className="relative block pt-[14px]">
      {label && <span className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-[10px] leading-3 text-black">{label}</span>}
      <input
        value={value}
        placeholder={hint}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onEnter) {
            event.preventDefault()
            onEnter()
          }
        }}
        className="block h-[26px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold text-black outline-none placeholder:font-normal placeholder:text-[#999] focus:border-[#1E4A9A]"
      />
    </label>
  )
}

/** "1000000,5" → "1 000 000,5" (digits and one decimal separator only). */
function groupDigits(value: string) {
  const clean = value.replace(/[^\d.,]/g, "")
  const [integer, ...rest] = clean.split(/[.,]/)
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return rest.length ? `${grouped},${rest.join("")}` : clean.match(/[.,]$/) ? `${grouped},` : grouped
}

/** The strip's "Наименование": a search-as-you-type select (the reference lists nothing until something is typed). */
function StripProductSelect({ label, notFound, clearLabel, value, options, labelOf, onChange, onClear }: { label: string; notFound: string; clearLabel: string; value: string; options: string[]; labelOf: (name: string) => string; onChange: (value: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const term = query.trim().toLowerCase()
  const [active, setActive] = useState(0)
  // Names that start with the term come first, then the ones that merely contain it (name or barcode).
  const matches = term
    ? [...options.filter((option) => option.toLowerCase().startsWith(term)), ...options.filter((option) => !option.toLowerCase().startsWith(term) && labelOf(option).toLowerCase().includes(term))].slice(0, 50)
    : []
  const choose = (option: string) => {
    onChange(option)
    setQuery("")
    setOpen(false)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, matches.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter" && open && matches[active]) {
      event.preventDefault()
      choose(matches[active])
    }
  }
  const inputRef = useRef<HTMLInputElement>(null)
  // Escape closes the search list only (the page's Escape handler would close the whole supply form),
  // and only while the user is in it (list open, input focused): an Escape meant for a dialog opened on
  // top of the form (quick-add, «добавить из списка») goes to that dialog. With the list closed, the
  // next Escape reaches the page as usual.
  useEscapeLayer(open, () => {
    setOpen(false)
    setQuery("")
  }, () => document.activeElement === inputRef.current)
  return (
    <StripCell pitch="calc(25% - 0.5px)" gap={17}>
      <span className={`pointer-events-none absolute left-0 whitespace-nowrap font-semibold text-black ${value || query ? "top-[26px] text-[9.75px] leading-[12px]" : "top-[45px] text-[13px] leading-[18px]"}`}>{label}</span>
      {value && !open && <span data-no-translate className="pointer-events-none absolute left-0 right-[24px] top-[47px] truncate text-[13px] font-semibold leading-[18px] text-[#333]">{labelOf(value)}</span>}
      <input
        ref={inputRef}
        value={query}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        // Leaving the field drops the list and the unchosen search text (it is not a selection, and it
        // would sit on top of the chosen product's name) — unless the focus came straight back.
        onBlur={() =>
          window.setTimeout(() => {
            if (document.activeElement === inputRef.current) return
            setOpen(false)
            setQuery("")
          }, 150)
        }
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        style={{ top: 43, height: 26 }}
        className="absolute inset-x-0 bg-transparent pr-[24px] text-[13px] font-semibold leading-[18px] text-[#333] outline-none"
      />
      {value && (
        <span role="button" aria-label={clearLabel} onClick={onClear} className="absolute right-[28px] top-[47px] z-[1] cursor-pointer text-[18px] leading-[18px] text-[#999]">
          ×
        </span>
      )}
      <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[55px] h-[5px] w-[10px]" aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }}>
        <path d="M0 0h10L5 5z" fill="#999" fillOpacity={0.7} />
      </svg>
      <span style={{ top: 69 }} className={LINE} />
      {open && (
        <div style={{ top: 68 }} className="absolute left-0 z-20 max-h-[200px] w-full overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {matches.length === 0 ? (
            <div className="px-[10px] py-[9px] text-[13px] leading-[14px] text-[#999]">{notFound}</div>
          ) : (
            matches.map((option, index) => (
              <div key={option} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)} data-no-translate className={`cursor-pointer px-[10px] py-[9px] text-[13px] font-semibold leading-[14px] ${index === active ? "bg-[#e6f2ff] text-[#333]" : "text-[#757575]"}`}>
                {labelOf(option)}
              </div>
            ))
          )}
        </div>
      )}
    </StripCell>
  )
}
