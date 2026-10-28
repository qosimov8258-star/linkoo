"use client"

import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

import { ORDER_STATUS_REF_OPTIONS, type Order } from "./orders-data"

const CHECKBOX_OFF = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECKBOX_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** Material check box used in the list's checkbox column. */
export function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      className="flex h-6 w-6 items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]">
        <path d={checked ? CHECKBOX_ON : CHECKBOX_OFF} />
      </svg>
    </button>
  )
}

/** "Выберите хотя бы один заказ !" popover shown under a toolbar action while nothing is ticked. */
export function NoSelectionPopover({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-[49px] z-50 flex h-[206px] w-[336px] items-center justify-center rounded-[2px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[4px] top-[5px] flex h-12 w-12 items-center justify-center">
          <X className="h-6 w-6 text-[#333]" />
        </button>
        <p className="px-4 text-center text-[18px] font-semibold text-[#333]">{t("Выберите хотя бы один заказ !")}</p>
      </div>
    </>
  )
}

function Dialog({ title, width, closeRight, onClose, children }: { title: string; width: number; closeRight: number; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div data-order-overlay className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/[0.54]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{ width }}
        className="max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] overflow-y-auto bg-white shadow-[0_10px_30px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]"
      >
        <div className="flex h-[60px] items-center justify-between border-b border-[#e0e0e0] pl-[30px]" style={{ paddingRight: closeRight }}>
          <h3 className="text-[13px] font-bold uppercase text-[#333]">{title}</h3>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="flex h-12 w-12 items-center justify-center">
            <X className="h-6 w-6 text-[#333]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// "Итоги выбранных заказов"
// ---------------------------------------------------------------------------

type TotalsRow = { type: string; blocks: number; orders: number; returns: number; volume: number; sum: number }
type TotalsData = { rows: TotalsRow[]; bonus: TotalsRow[] }

const TOTALS_HEADS = ["№", "Тип продукта", "Блок", "Кол-во Заказов", "Кол-во Возвратов", "Объём", "Сумма"]
/** Column widths (px) of the reference's two tables; the second one is auto-sized by its content there. */
const TOTALS_COLS = [
  [60, 233.5, 92.2, 166, 183, 107, 117.3],
  [60, 228.5, 90.2, 162.4, 179, 104, 134.2],
]

function SortMark() {
  return (
    <svg viewBox="0 0 24 24" className="ml-[6px] inline-block h-[15px] w-[15px] shrink-0 align-middle" style={{ fill: "#888" }} aria-hidden>
      <path d="M7 11l5-5 5 5z" />
      <path d="M7 13l5 5 5-5z" />
    </svg>
  )
}

export function SelectedTotalsDialog({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const { t } = useLanguage()
  const [data, setData] = useState<TotalsData | null>(null)
  const [sort, setSort] = useState<{ head: number; desc: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/orders/summary?ids=${orders.map((order) => order.id).join("-")}`)
      .then((response) => (response.ok ? (response.json() as Promise<TotalsData>) : { rows: [], bonus: [] }))
      .catch(() => ({ rows: [], bonus: [] }))
      .then((result) => {
        if (!cancelled) setData(result)
      })
    return () => {
      cancelled = true
    }
  }, [orders])

  const format = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
  const sum = (rows: TotalsRow[], key: keyof Omit<TotalsRow, "type">) => rows.reduce((total, row) => total + row[key], 0)
  const valueOf = (row: TotalsRow, head: number) => [0, row.type, row.blocks, row.orders, row.returns, row.volume, row.sum][head]
  const sorted = (rows: TotalsRow[]) => {
    if (!sort) return rows
    return [...rows].sort((a, b) => {
      const x = valueOf(a, sort.head)
      const y = valueOf(b, sort.head)
      const result = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru")
      return sort.desc ? -result : result
    })
  }
  const label = (row: TotalsRow) => row.type || t("Не указано")
  const cell = "border-b border-[#efefef] px-[17.5px] py-[7.8px]"

  const heads = (widths: number[]) => (
    <>
      <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead>
        <tr>
          {TOTALS_HEADS.map((head, index) => (
            <th key={head} className="bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left align-middle font-semibold leading-[20px] text-[#374557]">
              {index === 0 ? (
                t(head)
              ) : (
                <button type="button" onClick={() => setSort((current) => (current?.head === index ? { head: index, desc: !current.desc } : { head: index, desc: false }))} className="inline-flex items-center font-semibold">
                  {t(head)}
                  <SortMark />
                </button>
              )}
            </th>
          ))}
        </tr>
      </thead>
    </>
  )

  const numberCells = (row: TotalsRow) => (
    <>
      <td className={`${cell} text-right`}>{format(row.blocks)}</td>
      <td className={`${cell} text-right`}>{format(row.orders)}</td>
      <td className={`${cell} text-right ${row.returns < 0 ? "text-[#e57373]" : ""}`}>{format(row.returns)}</td>
      <td className={`${cell} text-right`}>{format(row.volume)}</td>
      <td className={`${cell} text-right`}>{format(row.sum)}</td>
    </>
  )
  const totalRow = (title: string, rows: TotalsRow[]) => (
    <tr>
      <td colSpan={2} className={cell}>{title}</td>
      <td className={`${cell} text-right`}>{format(sum(rows, "blocks"))}</td>
      <td className={`${cell} text-right`}>{format(sum(rows, "orders"))}</td>
      <td className={`${cell} text-right ${sum(rows, "returns") < 0 ? "text-[#e57373]" : ""}`}>{format(sum(rows, "returns"))}</td>
      <td className={`${cell} text-right`}>{format(sum(rows, "volume"))}</td>
      <td className={`${cell} text-right`}>{format(sum(rows, "sum"))}</td>
    </tr>
  )

  return (
    <Dialog title={t("Итоги выбранных заказов")} width={1000} closeRight={15} onClose={onClose}>
      <div className="px-[21px] pb-[34.8px] pt-[20px] text-[13px] font-semibold text-[#333]">
        {data === null ? (
          <div className="px-4 py-6 text-center font-normal text-[#999]">{t("Загрузка...")}</div>
        ) : (
          <>
            <table className="w-full table-fixed border-collapse">
              {heads(TOTALS_COLS[0])}
              <tbody>
                {sorted(data.rows).map((row, index) => (
                  <tr key={row.type} className="bg-[#f5f5f5]">
                    <td className={cell}>{index + 1}</td>
                    <td className={cell}>{label(row)}</td>
                    {numberCells(row)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-[15px] text-[16px] font-normal leading-5">{t("Бонусные товары")}</div>
            <table className="mt-[10px] w-full table-fixed border-collapse">
              {heads(TOTALS_COLS[1])}
              <tbody>
                {sorted(data.bonus).map((row, index) => (
                  <tr key={row.type} className="bg-[#f5f5f5]">
                    <td className={cell}>{index + 1}</td>
                    <td className={cell}>{label(row)}</td>
                    {numberCells(row)}
                  </tr>
                ))}
                {totalRow(t("Итого"), data.rows)}
                {totalRow(t("Итого с бонусом"), [...data.rows, ...data.bonus])}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// "Изменение выбранных заказов"
// ---------------------------------------------------------------------------

export type BulkEditValues = Partial<Record<BulkField, string>>
type BulkField =
  | "created" | "delivery" | "paid" | "transfer" | "realization"
  | "deliverer" | "expeditor" | "warehouse" | "picker" | "transport" | "status" | "dealType" | "agent" | "payStatus"

type FieldDef = { key: BulkField; label: string; input?: { kind: "date" | "select"; label: string; options?: string[] } }

const LEFT_FIELDS: FieldDef[] = [
  { key: "created", label: "Изменить дату создания", input: { kind: "date", label: "Дата создания" } },
  { key: "delivery", label: "Изменить дату доставки", input: { kind: "date", label: "Дата доставки" } },
  { key: "paid", label: "Изменить дату оплаты", input: { kind: "date", label: "Дата оплаты" } },
  { key: "transfer", label: "Изменить дату передачи", input: { kind: "date", label: "Дата передачи" } },
  { key: "realization", label: "Сделать дату реализации равной к дате доставке" },
]

const BULK_STATUS_OPTIONS = ORDER_STATUS_REF_OPTIONS.map((option) => (option === "Не подтвержден" ? "Не подтвержденный" : option))

export function BulkEditDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (values: BulkEditValues, showAfter: boolean) => void }) {
  const { t } = useLanguage()
  const [checked, setChecked] = useState<Partial<Record<BulkField, boolean>>>({})
  const [values, setValues] = useState<BulkEditValues>({})
  const [people, setPeople] = useState<string[]>([])
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [transports, setTransports] = useState<string[]>([])

  useEffect(() => {
    const names = (items: Array<{ name?: string; fullName?: string }>) => Array.from(new Set(items.map((item) => item.name ?? item.fullName ?? "").filter(Boolean)))
    const load = (endpoint: string) => fetch(`/api/${endpoint}`).then((response) => (response.ok ? response.json() : [])).catch(() => [])
    void load("employees").then((items) => setPeople(names(items)))
    void load("warehouses").then((items) => setWarehouses(names(items)))
    void load("transport").then((items: Array<{ number?: string }>) => setTransports(items.map((item) => item.number ?? "").filter(Boolean)))
  }, [])

  const rightFields: FieldDef[] = useMemo(
    () => [
      { key: "deliverer", label: "Изменить доставщика", input: { kind: "select", label: "Доставщик", options: people } },
      { key: "expeditor", label: "Изменить экспедитор", input: { kind: "select", label: "Экспедитор", options: people } },
      { key: "warehouse", label: "Изменить склад", input: { kind: "select", label: "Склад", options: warehouses } },
      { key: "picker", label: "Изменить сборщика", input: { kind: "select", label: "Сборщик", options: people } },
      { key: "transport", label: "Изменить транспорт", input: { kind: "select", label: "Транспорт", options: transports } },
      { key: "status", label: "Изменить статус", input: { kind: "select", label: "Статус", options: BULK_STATUS_OPTIONS } },
      { key: "dealType", label: "Изменить тип сделки", input: { kind: "select", label: "Тип сделки", options: ["Стандарт", "Консигнация"] } },
      { key: "agent", label: "Изменить агента", input: { kind: "select", label: "Агент", options: people } },
      { key: "payStatus", label: "Изменить статус оплаты", input: { kind: "select", label: "Статус оплаты", options: ["Не оплачен", "Оплачен"] } },
    ],
    [people, warehouses, transports],
  )

  const toggle = (key: BulkField) => setChecked((current) => ({ ...current, [key]: !current[key] }))
  const setValue = (key: BulkField, value: string) => setValues((current) => ({ ...current, [key]: value }))

  const apply = (showAfter: boolean) => {
    const picked: BulkEditValues = {}
    for (const field of [...LEFT_FIELDS, ...rightFields]) {
      if (checked[field.key]) picked[field.key] = values[field.key] ?? (field.input?.kind === "select" && field.key === "status" ? BULK_STATUS_OPTIONS[0] : "")
    }
    onApply(picked, showAfter)
  }

  const renderField = (field: FieldDef, spaced: boolean) => (
    <div key={field.key} className={spaced ? "mb-[10px]" : ""}>
      <label className="flex min-h-[30px] cursor-pointer items-start gap-[9px] py-[5px] text-[13px] font-semibold leading-[20px] text-[#333]">
        <input type="checkbox" checked={!!checked[field.key]} onChange={() => toggle(field.key)} className="mt-[3px] h-[14px] w-[14px] shrink-0 accent-[#5d6474]" />
        {t(field.label)}
      </label>
      {checked[field.key] && field.input && (
        <div className="my-[6px] pr-[15px]">
          {field.input.kind === "date" ? (
            <label className="relative block h-[44px] border-b border-[#e0e0e0]">
              <span className="absolute left-0 top-[14px] text-[13px] text-[#666]">{values[field.key] ? "" : t(field.input.label)}</span>
              <input
                type="date"
                value={values[field.key] ?? ""}
                onChange={(event) => setValue(field.key, event.target.value)}
                aria-label={t(field.input.label)}
                className={`absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] outline-none ${values[field.key] ? "" : "text-transparent"}`}
              />
            </label>
          ) : (
            <label className="relative block min-h-[44px] border-b border-[#e0e0e0]">
              <span className="absolute left-0 top-0 text-[10px] font-semibold text-[#333]">{values[field.key] ? t(field.input.label) : ""}</span>
              <select
                value={values[field.key] ?? (field.key === "status" ? BULK_STATUS_OPTIONS[0] : "")}
                onChange={(event) => setValue(field.key, event.target.value)}
                aria-label={t(field.input.label)}
                className="absolute inset-x-0 bottom-0 h-[30px] appearance-none bg-transparent pr-6 text-[13px] font-semibold outline-none"
              >
                {field.key !== "status" && <option value="">{t(field.input.label)}</option>}
                {(field.input.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-0 right-0 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
            </label>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Dialog title={t("Изменение выбранных заказов")} width={680} closeRight={10} onClose={onClose}>
      <div className="grid grid-cols-[340px_1fr] pb-[25px] pt-[15px]">
        <div className="border-r border-[#e0e0e0] pl-[18px] pr-[90px]">{LEFT_FIELDS.map((field) => renderField(field, false))}</div>
        <div className="pl-[17px] pr-[15px]">{rightFields.map((field, index) => renderField(field, index >= 4 && index < rightFields.length - 1))}</div>
      </div>
      <div className="flex h-[57px] items-center justify-between border-t border-[#e0e0e0] px-[26px] text-[13px] font-semibold uppercase text-[#039be5]">
        <button type="button" onClick={() => apply(true)} disabled={count === 0} className="uppercase">{t("Изменить и показать выбранные заказы")}</button>
        <button type="button" onClick={() => apply(false)} disabled={count === 0} className="uppercase">{t("Изменить заказы")}</button>
      </div>
    </Dialog>
  )
}
