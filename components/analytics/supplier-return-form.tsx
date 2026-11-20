"use client"

import { X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { FormField, SearchSelect, type PickOption } from "@/components/analytics/cash-management-shared"
import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { currencyLabel } from "@/lib/finance/currency"
import { parseAnyDay, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"

import { num } from "./supplier-return-card"
import { SupplierReturnPicker, type PickedLine, type PickerProduct } from "./supplier-return-picker"
import { returnPaymentTypes, type SupplierReturn } from "./supplier-returns-data"
import { pushParams } from "./supplier-returns-url"

// The supplier return form, Linko's ReturnCreateForm of #/provider-return (module 4663, full screen):
// - title «Возврат Поставщика» (create, ?openCreateDialog=true) or «Возврат от <supplier>» (edit, ?openUpdateDialog=true);
// - left (30 %): Поставщик, Склад назначения, Организация, Филиал, Валюта, Прайс лист, Тип оплаты, Дата создания (all
//   marked *), «Оставить комментарий...» (grows to 6 rows);
// - right: «Список товаров» with «+ добавить товар» (the grey add bar: Наименование «name (balance unit)» of the chosen
//   warehouse, Серия for a product with «Учитывать срок годности», Кол-во + unit (Enter adds), Цена, «+» — the new line
//   goes to the top), «+ добавить из списка» («ДОБАВЛЕНИЕ ПРОДУКТОВ», &pdPageSize=25) and «+ импортировать c excel» (a
//   panel: 1. the template, 2. the filled file, 3. «Подтвердить» puts the found rows in the list, the others under «Не
//   найденные продукты» to be picked by hand). The lines are read-only: ✎ edits the row in place (Серия from the series
//   catalog, Кол-во and Цена with the current values as placeholders, ✓ applies), 🗑 removes it;
// - footer: «Общая стоимость», «Общее кол-во: N ед» and «Оформить».
// Lines that come from the stored return show no unit and no weights (Linko's return lines carry none); lines added
// here show the product's unit and its weight per unit.

export type ReturnFormOptions = {
  suppliers: string[]
  warehouses: string[]
  organizations: string[]
  branches: string[]
  priceLists: string[]
  currencies: string[]
  baseCurrency: string
}

type Draft = { supplier: string; warehouse: string; organization: string; branch: string; currency: string; priceList: string; paymentType: string; date: string; comment: string }

type Line = {
  uid: number
  /** The stored line's id (kept so the server keeps its number). */
  storedId?: number
  key?: string
  productId: number | null
  product: string
  unit: string
  qty: number
  price: number
  seriesId: number | null
  series: string
  /** Weight / net weight of one unit (kg); 0 for the stored lines, as Linko shows them. */
  weight: number
  netWeight: number
}

type ProductOption = PickerProduct & { barcode: string; useExpiration: boolean; weight: number; netWeight: number }
type SeriesOption = { id: number; displayName: string }
type NotFound = { uid: number; name: string; qty: number; price: number; productKey: string }

const PENCIL = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const TRASH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const PLUS = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
const CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
const CALENDAR = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const IMPORT_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "наименование товара": "product", "название": "product", "product": "product", "name": "product",
  "код": "code", "code": "code", "штрих код": "barcode", "штрихкод": "barcode", "barcode": "barcode",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty", "amount": "qty",
  "цена": "price", "стоимость": "price", "сумма за единицу": "price", "цена за единицу": "price", "cost": "price", "price": "price",
}

const parseNumber = (text: string) => Number(String(text).replace(/[\s  ]/g, "").replace(",", "."))
const productIdOf = (key: string | undefined) => {
  const match = /^product:(\d+)$/.exec(key ?? "")
  return match ? Number(match[1]) : null
}

/** «29 декабря 2025 г.» (Linko's form date) in Russian, the app's date format in the other languages. */
function formDate(day: string, language: LanguageCode) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  if (language === "ru") return `${Number(match[3])} ${RU_MONTHS[Number(match[2]) - 1]} ${match[1]} г.`
  return formatDateText(day, language)
}

function draftOf(row: SupplierReturn | null): Draft {
  // A new return starts with an empty «Дата создания» (Linko's): the server dates it today.
  if (!row) return { supplier: "", warehouse: "", organization: "", branch: "", currency: "", priceList: "", paymentType: "", date: "", comment: "" }
  return {
    supplier: row.fromWhom,
    warehouse: row.warehouse,
    organization: row.organization,
    branch: row.branch,
    currency: row.currency,
    priceList: row.priceList,
    paymentType: row.paymentType,
    date: parseAnyDay(row.date) ?? "",
    comment: row.reason,
  }
}

function linesOf(row: SupplierReturn | null): Line[] {
  return (row?.items ?? []).map((item, index) => ({
    uid: index + 1,
    storedId: item.id,
    key: item.key,
    productId: productIdOf(item.key),
    product: item.product,
    unit: "",
    qty: Number(item.qty) || 0,
    price: Number(item.price) || 0,
    seriesId: item.seriesId ?? null,
    series: item.series ?? "",
    weight: 0,
    netWeight: 0,
  }))
}

/** Linko's stock/series_balance order: the latest expiry first (none last), then the older series first. */
function seriesBalanceOrder(rows: Array<SeriesOption & { expirationDate?: string | null }>): SeriesOption[] {
  const expiry = (row: { expirationDate?: string | null }) => String(row.expirationDate ?? "").trim()
  return [...rows].sort((a, b) => {
    const left = expiry(a)
    const right = expiry(b)
    if (left !== right) return !left ? 1 : !right ? -1 : right.localeCompare(left)
    return a.id - b.id
  })
}

/** A product's series of the shared catalog (GET /api/stock/series, every series of the product as Linko's
 * series_balance without a warehouse), searched as typed. */
function useSeries(productId: number | null) {
  const [options, setOptions] = useState<SeriesOption[]>([])
  const [loading, setLoading] = useState(false)
  const load = useCallback(
    (search = "") => {
      if (!productId) {
        setOptions([])
        return
      }
      setLoading(true)
      fetch(`/api/stock/series?product=${productId}&search=${encodeURIComponent(search)}&pageSize=50`)
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((data: { results?: Array<SeriesOption & { expirationDate?: string | null }> }) => setOptions(seriesBalanceOrder(data.results ?? [])))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    },
    [productId],
  )
  useEffect(() => load(""), [load])
  return { options, loading, load }
}

function SeriesSelect({ productId, value, label, onChange, flat }: { productId: number | null; value: number | null; label?: string; onChange: (option: SeriesOption | null) => void; flat?: boolean }) {
  const { t } = useLanguage()
  const series = useSeries(productId)
  const options: PickOption[] = series.options.map((option) => ({ value: String(option.id), label: option.displayName }))
  const select = (
    <SearchSelect
      variant="underline"
      value={value ? String(value) : ""}
      selectedLabel={label}
      options={options}
      loading={series.loading}
      onSearch={series.load}
      onChange={(next) => onChange(next ? (series.options.find((option) => String(option.id) === next) ?? null) : null)}
    />
  )
  return (
    <FormField label={t("Серия")} className={flat ? "!min-h-[40px]" : ""}>
      {select}
    </FormField>
  )
}

/** The grey band's input (Кол-во / Цена): floating label, underline, Enter adds the line. */
function BandInput({ label, value, onChange, onEnter, unit, className = "" }: { label: string; value: string; onChange: (value: string) => void; onEnter: () => void; unit?: string; className?: string }) {
  return (
    <div className={`flex items-end gap-[6px] ${className}`}>
      <FormField label={label} className="min-w-0 flex-1">
        <input
          value={value}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,\s]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onEnter()
            }
          }}
          className="h-[34px] w-full min-w-0 border-0 border-b border-[#e0e0e0] bg-transparent px-0 text-[13px] font-semibold text-black outline-none"
        />
      </FormField>
      {unit !== undefined && <span className="mb-[9px] shrink-0 text-[13px] text-[#333]">{unit}</span>}
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <FormField label={label} required showRequired error={error}>
      {children}
    </FormField>
  )
}

export function SupplierReturnForm({
  row,
  options,
  pickerOpen,
  onPicker,
  onClose,
  onSaved,
}: {
  /** The edited return; null = a new one. */
  row: SupplierReturn | null
  options: ReturnFormOptions
  pickerOpen: boolean
  onPicker: (open: boolean) => void
  onClose: () => void
  onSaved: (saved: SupplierReturn) => void
}) {
  const { t, language } = useLanguage()
  const editing = row !== null
  const [draft, setDraft] = useState<Draft>(() => draftOf(row))
  const [lines, setLines] = useState<Line[]>(() => linesOf(row))
  const nextUid = useRef(lines.length + 1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [addKey, setAddKey] = useState("")
  const [addSeries, setAddSeries] = useState<SeriesOption | null>(null)
  const [addQty, setAddQty] = useState("")
  const [addPrice, setAddPrice] = useState("")
  const [editUid, setEditUid] = useState<number | null>(null)
  const [editQty, setEditQty] = useState("")
  const [editPrice, setEditPrice] = useState("")
  const [editSeries, setEditSeries] = useState<SeriesOption | null>(null)
  const [calendar, setCalendar] = useState<{ left: number; top: number } | null>(null)
  const dateBox = useRef<HTMLButtonElement>(null)
  const commentBox = useRef<HTMLTextAreaElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [notFound, setNotFound] = useState<NotFound[]>([])
  const [importing, setImporting] = useState(false)
  const [branchSearch, setBranchSearch] = useState("")
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const uid = () => nextUid.current++

  // The add bar's products: every product with its balance in the chosen warehouse and its price in the price list.
  useEffect(() => {
    let alive = true
    const query = new URLSearchParams({ warehouse: draft.warehouse, priceList: draft.priceList })
    fetch(`/api/supplier-returns/products?${query}`)
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((data: { rows?: ProductOption[] }) => alive && setProducts(data.rows ?? []))
      .catch(() => alive && setProducts([]))
    return () => {
      alive = false
    }
  }, [draft.warehouse, draft.priceList])

  // Escape does not close the form (Linko's full-screen dialog ignores it): only its X does, so typed lines are kept.

  // «Оставить комментарий...» grows with its text, wrapped lines included, up to 6 rows (Linko's rows 1, rowsMax 6).
  useLayoutEffect(() => {
    const box = commentBox.current
    if (!box) return
    box.style.height = "auto"
    const style = window.getComputedStyle(box)
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)
    const max = 6 * (parseFloat(style.lineHeight) || 20) + chrome
    box.style.height = `${Math.min(box.scrollHeight + parseFloat(style.borderBottomWidth), max)}px`
  }, [draft.comment])

  const byKey = useMemo(() => new Map(products.map((item) => [item.key, item])), [products])
  const productOptions: PickOption[] = useMemo(
    () => products.map((item) => ({ value: item.key, label: `${item.name} (${num(item.balance)} ${item.unit ? t(item.unit) : ""})`.replace(" )", ")") })),
    [products, t],
  )
  const addProduct = addKey ? byKey.get(addKey) : undefined

  function lineOf(product: ProductOption | PickerProduct, qty: number, price: number, series: SeriesOption | null = null): Line {
    const extra = product as ProductOption
    return {
      uid: uid(),
      key: product.key,
      productId: product.productId,
      product: product.name,
      unit: product.unit,
      qty,
      price,
      seriesId: series?.id ?? null,
      series: series?.displayName ?? "",
      weight: Number(extra.weight) || 0,
      netWeight: Number(extra.netWeight) || 0,
    }
  }

  function addFromBar() {
    const qty = parseNumber(addQty)
    if (!addProduct || !(qty > 0)) return
    const price = addPrice.trim() ? parseNumber(addPrice) : addProduct.price
    setLines((current) => [lineOf(addProduct, qty, Number.isFinite(price) && price >= 0 ? price : 0, addSeries), ...current])
    setAddKey("")
    setAddSeries(null)
    setAddQty("")
    setAddPrice("")
  }

  function startEdit(line: Line) {
    setEditUid(line.uid)
    setEditQty("")
    setEditPrice("")
    setEditSeries(null)
  }

  function applyEdit(line: Line) {
    const qty = parseNumber(editQty)
    const price = parseNumber(editPrice)
    setLines((current) =>
      current.map((item) =>
        item.uid !== line.uid
          ? item
          : {
              ...item,
              qty: editQty.trim() && qty > 0 ? qty : item.qty,
              price: editPrice.trim() && price >= 0 ? price : item.price,
              ...(editSeries ? { seriesId: editSeries.id, series: editSeries.displayName } : {}),
            },
      ),
    )
    setEditUid(null)
  }

  /** Picked lines go to the top, replacing the lines of the same products. */
  function mergePicked(picked: PickedLine[]) {
    const keys = new Set(picked.map((line) => line.product.key))
    setLines((current) => [...picked.map((line) => lineOf(line.product, line.qty, line.price)), ...current.filter((line) => !line.key || !keys.has(line.key))])
  }

  function addPicked(picked: PickedLine[]) {
    mergePicked(picked)
    onPicker(false)
  }

  function downloadTemplate() {
    downloadExcelTable("Provider_Return_Import_Example.xlsx", [[t("Наименование"), t("Код"), t("Количество"), t("Цена")], ...products.map((item) => [item.name, item.code || null, null, item.price])])
  }

  async function confirmImport() {
    if (!file || importing) return
    setImporting(true)
    try {
      const rows = await readExcelRows(file)
      const columns = mapHeaderColumns(rows[0] ?? [], IMPORT_ALIASES)
      const hasHeader = [...columns.values()].includes("product")
      const body = hasHeader ? rows.slice(1) : rows
      const found: Line[] = []
      const missing: NotFound[] = []
      const byName = new Map(products.map((item) => [item.name.trim().toLowerCase(), item]))
      for (const cells of body) {
        const record: Record<string, string> = {}
        if (hasHeader) cells.forEach((cell, index) => columns.get(index) && (record[columns.get(index)!] = cell))
        else Object.assign(record, { product: cells[0] ?? "", qty: cells[1] ?? "", price: cells[2] ?? "" })
        const qty = parseNumber(record.qty ?? "")
        if (!(qty > 0)) continue
        const price = parseNumber(record.price ?? "")
        const name = String(record.product ?? "").trim()
        const code = String(record.code ?? "").trim()
        const barcode = String(record.barcode ?? "").trim()
        const product = (name && byName.get(name.toLowerCase())) || (code && products.find((item) => item.code === code)) || (barcode && products.find((item) => item.barcode === barcode)) || undefined
        if (product) found.push(lineOf(product, qty, Number.isFinite(price) && price >= 0 ? price : product.price))
        else missing.push({ uid: uid(), name: name || code || barcode, qty, price: Number.isFinite(price) && price >= 0 ? price : 0, productKey: "" })
      }
      // Linko puts the found rows in place of the list; the others wait under «Не найденные продукты».
      setLines(found)
      setNotFound(missing)
      setExcelOpen(false)
      setFile(null)
    } finally {
      setImporting(false)
    }
  }

  function addNotFound(entry: NotFound) {
    const product = byKey.get(entry.productKey)
    if (!product) return
    setLines((current) => [lineOf(product, entry.qty, entry.price), ...current])
    setNotFound((current) => current.filter((item) => item.uid !== entry.uid))
  }

  const totalCost = lines.reduce((sum, line) => sum + line.qty * line.price, 0)
  // «Общее кол-во»: Linko's Σ toInteger(amount) + « ед», whatever the lines' units («2 ед»).
  const totalQty = `${num(lines.reduce((sum, line) => sum + Math.trunc(line.qty), 0))} ${t("ед")}`
  // No currency is named until one is picked (a new return: «Общая стоимость: 0»).
  const currency = draft.currency

  async function save() {
    if (saving) return
    setSaving(true)
    setErrors({})
    try {
      const body = {
        fromWhom: draft.supplier,
        warehouse: draft.warehouse,
        organization: draft.organization,
        branch: draft.branch,
        currency: draft.currency,
        priceList: draft.priceList,
        paymentType: draft.paymentType,
        date: draft.date,
        comment: draft.comment,
        items: lines.map((line, index) => ({
          id: line.storedId ?? index + 1,
          ...(line.key ? { key: line.key } : {}),
          product: line.product,
          qty: line.qty,
          series: line.series,
          seriesId: line.seriesId,
          price: line.price,
        })),
      }
      const response = await fetch(editing ? `/api/supplier-returns/${row.id}` : "/api/supplier-returns", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const fields = (data.fields ?? {}) as Record<string, string>
        setErrors({ ...fields, _: data.error ?? "Не удалось сохранить возврат" })
        return
      }
      onSaved(data as SupplierReturn)
    } catch {
      setErrors({ _: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (name: string) => (errors[name] ? t(errors[name]) : undefined)
  const lineErrors = Object.entries(errors).filter(([name]) => name === "items" || name.startsWith("items."))
  const generalError = errors._ && !Object.keys(errors).some((name) => name !== "_") ? t(errors._) : ""
  // «Филиал»: Linko's saas/for_select?m=Branch&page_size=100 — the first 100 by name, the others found by a search.
  const branchTerm = branchSearch.trim().toLowerCase()
  const branchOptions = (branchTerm ? options.branches.filter((name) => name.toLowerCase().includes(branchTerm)) : options.branches).slice(0, 100)
  const pick = (values: string[], current: string): PickOption[] => (current && !values.includes(current) ? [current, ...values] : values).map((value) => ({ value, label: value }))
  const currencyOptions = (options.currencies.length ? options.currencies : [options.baseCurrency]).concat(draft.currency && !options.currencies.includes(draft.currency) ? [draft.currency] : []).map((code) => ({ value: code, label: currencyLabel(code) }))
  const tableHead = "px-[5px] text-left font-semibold"
  const tableCell = "px-[5px]"

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[1400] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
        <h2 className="text-[13px] font-bold uppercase text-[#333]">{editing ? `${t("Возврат")} ${t("от")} ${row.fromWhom}` : t("Возврат поставщика")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]">
          <X className="h-6 w-6" strokeWidth={1.6} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="w-[30%] min-w-[300px] shrink-0 overflow-y-auto border-r border-[#efefef] px-[30px] pb-[20px] pt-[8px]">
          <div className="grid content-start gap-[12px]">
            <Field label={t("Поставщик")} error={fieldError("fromWhom")}>
              <SearchSelect variant="underline" value={draft.supplier} options={pick(options.suppliers, draft.supplier)} invalid={Boolean(errors.fromWhom)} onChange={(supplier) => set({ supplier })} />
            </Field>
            <Field label={t("Склад назначения")} error={fieldError("warehouse")}>
              <SearchSelect variant="underline" value={draft.warehouse} options={pick(options.warehouses, draft.warehouse)} invalid={Boolean(errors.warehouse)} onChange={(warehouse) => set({ warehouse })} />
            </Field>
            <Field label={t("Организация")} error={fieldError("organization")}>
              <SearchSelect variant="underline" value={draft.organization} options={pick(options.organizations, draft.organization)} invalid={Boolean(errors.organization)} onChange={(organization) => set({ organization })} />
            </Field>
            <Field label={t("Филиал")} error={fieldError("branch")}>
              <SearchSelect
                variant="underline"
                value={draft.branch}
                options={pick(branchOptions, draft.branch)}
                invalid={Boolean(errors.branch)}
                onSearch={setBranchSearch}
                onChange={(branch) => {
                  set({ branch })
                  setBranchSearch("")
                }}
              />
            </Field>
            <Field label={t("Валюта")} error={fieldError("currency")}>
              <SearchSelect variant="underline" value={draft.currency} options={currencyOptions} invalid={Boolean(errors.currency)} onChange={(currency) => set({ currency })} />
            </Field>
            <Field label={t("Прайс лист")} error={fieldError("priceList")}>
              <SearchSelect variant="underline" value={draft.priceList} options={pick(options.priceLists, draft.priceList)} onChange={(priceList) => set({ priceList })} />
            </Field>
            <Field label={t("Тип оплаты")} error={fieldError("paymentType")}>
              <SearchSelect
                variant="underline"
                value={draft.paymentType}
                options={returnPaymentTypes.map((value) => ({ value, label: t(value === "наличный" ? "Наличный" : "Банковский счет") }))}
                onChange={(paymentType) => set({ paymentType })}
              />
            </Field>
            <div className="relative min-h-[50px]">
              <span className="block text-[10px] font-bold leading-3 text-black">
                {t("Дата создания")}
                <span className="font-semibold text-[#e57373]"> *</span>
              </span>
              <button
                ref={dateBox}
                type="button"
                aria-label={t("Дата создания")}
                onClick={() => {
                  const box = dateBox.current?.getBoundingClientRect()
                  if (!box) return
                  const below = box.bottom + 8
                  setCalendar({ left: box.left, top: below + 434 > window.innerHeight ? Math.max(8, box.top - 442) : below })
                }}
                className={`relative mt-[8px] block h-[30px] w-full cursor-pointer border-b text-left ${errors.date ? "border-[#f44336]" : "border-[#e0e0e0]"}`}
              >
                <span className="absolute left-0 top-[4px] text-[13px] leading-5 text-black" data-no-translate>
                  {draft.date ? formDate(draft.date, language) : ""}
                </span>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[2px] h-5 w-5 fill-[#ccc]" aria-hidden>
                  <path d={CALENDAR} />
                </svg>
              </button>
              {errors.date && <span className="text-[11px] text-[#f44336]">{t(errors.date)}</span>}
            </div>
            <FormField label={t("Оставить комментарий...")} className="mt-[8px]" error={fieldError("comment")}>
              <textarea
                ref={commentBox}
                value={draft.comment}
                rows={1}
                onChange={(event) => set({ comment: event.target.value })}
                className="block w-full min-w-0 resize-none overflow-y-auto border-0 border-b border-[#e0e0e0] bg-transparent px-0 py-[6px] text-[13px] leading-5 text-black outline-none focus:border-[#129fdd]"
              />
            </FormField>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-[30px] py-[20px]">
          <div className="-mt-[10px] flex h-[40px] shrink-0 items-center justify-between">
            <span className="font-semibold">{t("Список товаров")}</span>
            <div className="flex items-center text-[13px] text-[#333]">
              <button type="button" onClick={() => { setAddOpen((open) => !open); setExcelOpen(false) }} className={`h-9 rounded-[2px] px-[16px] lowercase hover:bg-[#eee] ${addOpen ? "bg-[#eee]" : ""}`}>
                + {t("добавить товар")}
              </button>
              <button type="button" onClick={() => onPicker(true)} className="h-9 rounded-[2px] px-[16px] lowercase hover:bg-[#eee]">
                + {t("добавить из списка")}
              </button>
              <button type="button" onClick={() => { setExcelOpen((open) => !open); setAddOpen(false) }} className={`h-9 rounded-[2px] px-[16px] lowercase hover:bg-[#eee] ${excelOpen ? "bg-[#eee]" : ""}`}>
                + {t("импортировать c excel")}
              </button>
            </div>
          </div>

          {excelOpen && !addOpen && (
            <div className="mt-[10px] flex h-[47px] shrink-0 items-center justify-between border border-[#efefef] px-[5px] text-[13px] uppercase text-[#333]">
              <button type="button" onClick={downloadTemplate} className="h-9 px-[11px] uppercase hover:bg-black/[0.04]">
                1. {t("Загрузить шаблон")}
              </button>
              <label className="flex h-9 cursor-pointer items-center px-[11px] uppercase hover:bg-black/[0.04]">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const picked = event.target.files?.[0] ?? null
                    event.target.value = ""
                    if (picked) setFile(picked)
                  }}
                />
                {file ? `2. ${t("Сменить файл")}` : `2. ${t("Заполните excel и загрузите")}`}
                {file && <span className="ml-[8px] normal-case text-[#999]">{file.name}</span>}
              </label>
              <button type="button" disabled={!file || importing} onClick={() => void confirmImport()} className="h-9 px-[11px] uppercase hover:bg-black/[0.04] disabled:cursor-default disabled:hover:bg-transparent">
                3. {importing ? t("Загрузка...") : t("Подтвердить")}
              </button>
            </div>
          )}

          {addOpen && (
            // Linko's bar: a 12-column row — Наименование 4, Серия 3 (a product with an expiry), Кол-во 1, Цена 2, «+» 1.
            <div className="relative z-[2] -mx-[30px] mt-[5px] grid shrink-0 grid-cols-12 items-end gap-x-[16px] bg-[#f1f5f8] px-[18px] pb-[14px] pt-[10px]">
              <div className="col-span-4 min-w-0">
                <FormField label={t("Наименование")}>
                  <SearchSelect
                    variant="underline"
                    value={addKey}
                    options={productOptions}
                    onChange={(key) => {
                      const product = byKey.get(key)
                      setAddKey(key)
                      setAddSeries(null)
                      setAddPrice(product ? String(product.price) : "")
                    }}
                  />
                </FormField>
              </div>
              {addProduct?.useExpiration && (
                <div className="col-span-3 min-w-0">
                  <SeriesSelect productId={addProduct.productId} value={addSeries?.id ?? null} label={addSeries?.displayName} onChange={setAddSeries} />
                </div>
              )}
              <BandInput label={t("Кол-во")} value={addQty} onChange={setAddQty} onEnter={addFromBar} unit={addProduct?.unit ? t(addProduct.unit) : ""} className="col-span-1 min-w-0" />
              <BandInput label={t("Цена")} value={addPrice} onChange={setAddPrice} onEnter={addFromBar} className="col-span-2 min-w-0" />
              <div className="col-span-1">
                <button type="button" onClick={addFromBar} aria-label={t("Применить")} title={t("Применить")} className="mb-[2px] flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
                    <path d={PLUS} />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {(lineErrors.length > 0 || generalError) && (
            <div className="mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">
              {generalError && <p>{generalError}</p>}
              {lineErrors.map(([name, message]) => {
                const index = /^items\.(\d+)\./.exec(name)?.[1]
                const line = index !== undefined ? lines[Number(index)] : undefined
                return (
                  <p key={name}>
                    {line ? `${line.product}: ` : ""}
                    {t(message)}
                  </p>
                )
              })}
            </div>
          )}

          {notFound.length > 0 && (
            <div className="mt-[10px] border border-[#efefef] px-[15px] py-[10px]">
              <p className="mb-[6px] font-semibold text-[#e57373]">{t("Не найденные продукты")}</p>
              {notFound.map((entry) => (
                <div key={entry.uid} className="flex items-end gap-[16px] py-[4px]">
                  <span className="mb-[9px] w-[200px] shrink-0 truncate" data-no-translate>
                    {entry.name}
                  </span>
                  <div className="min-w-0 flex-1">
                    <SearchSelect variant="underline" value={entry.productKey} options={productOptions} onChange={(productKey) => setNotFound((current) => current.map((item) => (item.uid === entry.uid ? { ...item, productKey } : item)))} />
                  </div>
                  <span className="mb-[9px] w-[80px] shrink-0 text-right">{num(entry.qty)}</span>
                  <span className="mb-[9px] w-[100px] shrink-0 text-right">{num(entry.price)}</span>
                  <button type="button" disabled={!entry.productKey} onClick={() => addNotFound(entry)} aria-label={t("Применить")} className="flex h-9 w-9 shrink-0 items-center justify-center disabled:opacity-40">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
                      <path d={PLUS} />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center pb-[40px] text-center text-[#adadad]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/empty-basket.svg" alt="" className="mb-[20px] mt-[25px] w-[70px]" />
              <div>{editing ? `${t("Список возвращаемого товара пуст")}.` : t("Для добавления товаров выберите клиента.")}</div>
            </div>
          ) : (
            <table className="mt-[20px] w-full table-fixed border-collapse text-[13px]">
              <thead>
                <tr className="h-[40px]">
                  <th className={`${tableHead} w-[250px]`}>{t("Наименование")}</th>
                  <th className={`${tableHead} w-[200px]`}>{t("Серия")}</th>
                  <th className={tableHead}>{t("Кол-во")}</th>
                  <th className={tableHead}>{t("Вес")}</th>
                  <th className={tableHead}>{t("Вес нетто")}</th>
                  <th className={tableHead}>{t("Цена")}</th>
                  <th className="w-[100px]" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) =>
                  editUid === line.uid ? (
                    <tr key={line.uid} className="h-[40px]">
                      <td className={tableCell}>{line.product}</td>
                      <td className={tableCell}>
                        {/* Linko's ✎ starts with an empty «Серия» (the line keeps its series unless one is picked). */}
                        <SeriesSelect flat productId={line.productId} value={editSeries?.id ?? null} label={editSeries?.displayName} onChange={setEditSeries} />
                      </td>
                      <td className={tableCell}>
                        <input value={editQty} placeholder={num(line.qty)} inputMode="decimal" onChange={(event) => setEditQty(event.target.value.replace(/[^\d.,\s]/g, ""))} className="h-[34px] w-full border-0 border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:text-[#333]" />
                      </td>
                      <td className={tableCell}>{num(line.weight * line.qty)}</td>
                      <td className={tableCell}>{num(line.netWeight * line.qty)}</td>
                      <td className={tableCell}>
                        <input value={editPrice} placeholder={num(line.price)} inputMode="decimal" onChange={(event) => setEditPrice(event.target.value.replace(/[^\d.,\s]/g, ""))} className="h-[34px] w-full border-0 border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:text-[#333]" />
                      </td>
                      <td className={`${tableCell} text-right`}>
                        <button type="button" onClick={() => applyEdit(line)} aria-label={t("Применить")} className="inline-flex h-12 w-12 items-center justify-center">
                          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
                            <path d={CHECK} />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={line.uid} className="h-[40px]">
                      <td className={tableCell}>{line.product}</td>
                      <td className={tableCell} data-no-translate>
                        {line.series || "-"}
                      </td>
                      <td className={tableCell}>
                        {num(line.qty)} {line.unit ? t(line.unit) : ""}
                      </td>
                      <td className={tableCell}>{num(line.weight * line.qty)}</td>
                      <td className={tableCell}>{num(line.netWeight * line.qty)}</td>
                      <td className={tableCell}>{num(line.price)}</td>
                      <td className={`${tableCell} whitespace-nowrap text-right`}>
                        <button type="button" onClick={() => startEdit(line)} aria-label={t("Изменить")} className="inline-flex h-10 w-10 items-center justify-center">
                          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                            <path d={PENCIL} />
                          </svg>
                        </button>
                        <button type="button" onClick={() => setLines((current) => current.filter((item) => item.uid !== line.uid))} aria-label={t("Удалить")} className="inline-flex h-10 w-10 items-center justify-center">
                          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                            <path d={TRASH} />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[30px] pr-[30px]">
        <ul className="flex items-center gap-[26px] text-[14px] text-black">
          <li>
            {t("Общая стоимость:")}{" "}
            <span className="text-[16px] font-semibold text-[#129fdd]">
              {num(totalCost)}
              {currency ? ` ${currencyLabel(currency)}` : ""}
            </span>
          </li>
          <li>
            {t("Общее кол-во:")} <span className="text-[16px] font-semibold text-[#129fdd]">{totalQty}</span>
          </li>
        </ul>
        <button type="button" disabled={saving} onClick={() => void save()} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:opacity-50">
          {t("Оформить")}
        </button>
      </footer>

      {calendar && (
        <DatePickerDialog
          anchor={calendar}
          value={draft.date || todayIso()}
          onCancel={() => setCalendar(null)}
          onPick={(date) => {
            set({ date })
            setCalendar(null)
          }}
        />
      )}
      {pickerOpen && <SupplierReturnPicker priceList={draft.priceList} onClose={() => onPicker(false)} onSave={addPicked} onKeep={mergePicked} />}
    </div>
  )
}

/** Empties the picker's address parameters: Linko leaves them as bare keys (&pdPage&pdPageSize&pdSearch) once its
 * dialog closes. */
export function closePickerParams() {
  pushParams({ pdPageSize: "", pdPage: "", pdSearch: "" })
}
