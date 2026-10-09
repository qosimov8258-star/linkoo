"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Check, ChevronDown, Pencil, Trash2, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

// Shared pieces of the production pages (Партии / Этапы производства).

export type ItemKind = "product" | "raw_material"
export type CatalogItem = { key: string; kind: ItemKind; id: number; name: string; unit: string; type: string }
export type StockItem = CatalogItem & { available: number; defects: number; cost: number }
export type Stage = { id: number; name: string; warehouse: string; responsible: string; createdAt: string }
export type PartyStatus = "pending" | "finished" | "cancelled"

export const STATUS_LABELS: Record<PartyStatus, string> = { pending: "В процессе", finished: "Завершен", cancelled: "Отменен" }
export const STATUS_DOT: Record<PartyStatus, string> = { pending: "bg-amber-400", finished: "bg-sky-500", cancelled: "bg-red-400" }
export const STATUS_TEXT: Record<PartyStatus, string> = { pending: "text-amber-500", finished: "text-sky-500", cancelled: "text-red-400" }

export class ApiError extends Error {}

/** fetch + JSON with the API's `{ error }` message surfaced as ApiError. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError("Сервер недоступен, попробуйте ещё раз")
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError((data as { error?: string }).error || "Не удалось выполнить запрос")
  return data as T
}

export function useApiData<T>(url: string | null, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setLoading(true)
    api<T>(url)
      .then((value) => !cancelled && setData(value))
      .catch((error: Error) => !cancelled && window.alert(error.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [url, version])
  return { data, setData, loading, reload: () => setVersion((value) => value + 1) }
}

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 })
export const formatNumber = (value: number) => numberFormat.format(Number.isFinite(value) ? value : 0)
export const formatAmount = (value: number, unit: string) => `${formatNumber(value)} ${unit}`.trim()

export function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** "14 апр. 2026" from YYYY-MM-DD. */
export function formatDate(value: string) {
  if (!value) return ""
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(" г.", "")
}

/** "14 апр. 2026, 18:30" from an ISO timestamp. */
export function formatDateTime(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const day = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(" г.", "")
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date)
  return `${day}, ${time}`
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  onSubmit,
  width = "max-w-xl",
  tall,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  onSubmit?: (event: FormEvent) => void
  width?: string
  /** Room for item pickers' dropdowns inside the scrolling body. */
  tall?: boolean
}) {
  const { t } = useLanguage()
  const body = (
    <>
      <div className="flex items-center justify-between border-b px-7 py-5">
        <h2 className="text-lg font-bold uppercase">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6 text-slate-500" /></button>
      </div>
      <div className={`max-h-[70vh] overflow-y-auto px-7 py-6 ${tall ? "min-h-[440px]" : ""}`}>{children}</div>
      {footer && <div className="flex items-center justify-end gap-3 border-t px-7 py-4">{footer}</div>}
    </>
  )
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
      {onSubmit ? (
        <form onSubmit={onSubmit} className={`w-full ${width} bg-white shadow-2xl`}>{body}</form>
      ) : (
        <div className={`w-full ${width} bg-white shadow-2xl`}>{body}</div>
      )}
    </div>
  )
}

export function SaveButton({ saving, label = "Сохранить", type = "submit", onClick, disabled }: { saving?: boolean; label?: string; type?: "submit" | "button"; onClick?: () => void; disabled?: boolean }) {
  const { t } = useLanguage()
  return (
    <button type={type} onClick={onClick} disabled={saving || disabled} className="rounded-md bg-emerald-400 px-7 py-2.5 font-semibold uppercase text-white hover:brightness-95 disabled:opacity-40">
      {saving ? "..." : t(label)}
    </button>
  )
}

export function Field({ label, required, children, className = "" }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  const { t } = useLanguage()
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-semibold text-slate-700">
        {t(label)} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}

export const inputClass = "w-full border-b border-slate-300 bg-transparent py-2 outline-none focus:border-blue-600"

/** Searchable dropdown over catalog / stock items; stock items show the
 * demo's "Доступно / Брак" lines under the name. */
export function ItemPicker<T extends CatalogItem>({
  items,
  value,
  onChange,
  placeholder = "Наименование товара",
  showStock,
}: {
  items: T[]
  value: string
  onChange: (key: string) => void
  placeholder?: string
  showStock?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const selected = items.find((item) => item.key === value)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru")
    return items.filter((item) => !normalized || item.name.toLocaleLowerCase("ru").includes(normalized)).slice(0, 200)
  }, [items, query])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          setQuery("")
        }}
        className={`flex w-full items-center justify-between border-b border-slate-300 py-2 text-left ${selected ? "text-slate-800" : "text-slate-400"}`}
      >
        <span className="truncate">{selected ? selected.name : t(placeholder)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded border border-slate-200 bg-white shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false)
              if (event.key !== "Enter") return
              // Inside a dialog form, Enter must pick, not submit the dialog.
              event.preventDefault()
              if (filtered[0]) {
                onChange(filtered[0].key)
                setOpen(false)
              }
            }}
            placeholder={t("Поиск")}
            className="sticky top-0 w-full border-b border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
          {filtered.map((item) => {
            const stock = showStock ? (item as unknown as StockItem) : null
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onChange(item.key)
                  setOpen(false)
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${item.key === value ? "bg-blue-50" : ""}`}
              >
                <span className="block font-semibold text-slate-800">{item.name}</span>
                {stock && (
                  <span className="block text-xs text-slate-500">
                    {t("Доступно")}: <span className={stock.available > 0 ? "" : "text-red-400"}>{formatAmount(stock.available, item.unit)}</span>
                    <br />
                    {t("Брак")}: {formatAmount(stock.defects, item.unit)}
                  </span>
                )}
              </button>
            )
          })}
          {!filtered.length && <p className="px-3 py-4 text-center text-sm text-slate-400">{t("Ничего не найдено")}</p>}
        </div>
      )}
    </div>
  )
}

export function RobotEmpty({ text, size = 150 }: { text: string; size?: number }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Image src="/robot-mascot.png" alt="" width={size} height={size} />
      <p className="mt-3 text-slate-500">{t(text)}</p>
    </div>
  )
}

export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) {
      reject(new ApiError("Файл слишком большой (макс. 2 МБ)"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ApiError("Не удалось прочитать файл"))
    reader.readAsDataURL(file)
  })
}

/** Rows of "item + amount" collected before saving (Добавить продукт /
 * сырье dialogs): pick, type the amount, press ✓ to add it to the list. */
export type DraftLine = { key: string; amount: number }

export function ItemLinesEditor<T extends CatalogItem>({
  items,
  lines,
  onChange,
  showStock,
  emptyText = "Вы еще не выбрали ни одного товара",
}: {
  items: T[]
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  showStock?: boolean
  emptyText?: string
}) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])

  function add() {
    const value = Number(amount.replace(",", "."))
    if (!key || !(value > 0)) return
    const existing = lines.findIndex((line) => line.key === key)
    if (existing >= 0) onChange(lines.map((line, index) => (index === existing ? { ...line, amount: line.amount + value } : line)))
    else onChange([{ key, amount: value }, ...lines])
    setKey("")
    setAmount("")
  }

  function saveEdit(index: number) {
    const value = Number(editAmount.replace(",", "."))
    if (value > 0) onChange(lines.map((line, position) => (position === index ? { ...line, amount: value } : line)))
    setEditing(null)
  }

  return (
    <div>
      <div className="-mx-7 flex items-end gap-4 bg-slate-100 px-7 py-3">
        <div className="min-w-0 flex-1">
          <ItemPicker items={items} value={key} onChange={setKey} showStock={showStock} />
        </div>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
          inputMode="decimal"
          placeholder={t("Кол-во")}
          className="w-28 border-b border-slate-300 bg-transparent py-2 outline-none focus:border-blue-600"
        />
        <span className="w-10 pb-2 text-sm text-slate-500">{byKey.get(key)?.unit}</span>
        <button type="button" onClick={add} aria-label={t("Добавить")} className="pb-2 text-blue-600"><Check className="h-6 w-6" /></button>
      </div>
      {lines.length ? (
        <ul className="mt-2">
          {lines.map((line, index) => {
            const item = byKey.get(line.key)
            const stock = showStock ? (item as unknown as StockItem | undefined) : undefined
            const over = stock ? line.amount > stock.available : false
            return (
              <li key={line.key} className="flex items-center gap-3 border-b border-dashed border-slate-200 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{index + 1}. {item?.name ?? line.key}</span>
                {editing === index ? (
                  <>
                    <input autoFocus value={editAmount} onChange={(event) => setEditAmount(event.target.value)} inputMode="decimal" className="w-24 border-b border-blue-500 py-1 outline-none" />
                    <button type="button" onClick={() => saveEdit(index)} className="text-blue-600" aria-label={t("Сохранить")}><Check className="h-5 w-5" /></button>
                  </>
                ) : (
                  <>
                    <span className={`w-32 text-right ${over ? "text-red-500" : ""}`}>{formatAmount(line.amount, item?.unit ?? "")}</span>
                    <button type="button" onClick={() => { setEditing(index); setEditAmount(String(line.amount)) }} className="text-slate-500 hover:text-blue-600" aria-label={t("Изменить")}><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => onChange(lines.filter((_, position) => position !== index))} className="text-slate-500 hover:text-red-500" aria-label={t("Удалить")}><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-10 text-center text-sm text-slate-400">{t(emptyText)}</p>
      )}
    </div>
  )
}
