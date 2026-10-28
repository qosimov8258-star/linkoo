"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Check, X } from "lucide-react"

import { formatMoney } from "@/lib/finance/currency"
import { CATALOG_API, type CatalogItem, type CatalogKind, type CatalogUsage } from "@/lib/products-types"

// Small shared pieces of the catalog pages (Продукты / Сырье).

/** Demo texts that differ between the product and the raw-material page. */
export const KIND_TEXT: Record<
  CatalogKind,
  { title: string; add: string; addTitle: string; editTitle: string; excel: string; selected: string; selectedExcel: string; multiTitle: string; restore: string }
> = {
  product: {
    title: "Продукты",
    add: "Добавить продукт",
    addTitle: "Добавить продукт",
    editTitle: "Изменить продукт",
    excel: "Продукты",
    selected: "Выбранные продукты",
    selectedExcel: "Выбранные продукты Excel",
    multiTitle: "Изменение выбранных продуктов",
    restore: "Вы уверены, что хотите восстановить этот продукт, {name}?",
  },
  raw_material: {
    title: "Сырье",
    add: "Добавить сырье",
    addTitle: "Добавить сырье",
    editTitle: "Изменить сырье",
    excel: "Сырье",
    selected: "Выбранное сырье",
    selectedExcel: "Выбранное сырье Excel",
    multiTitle: "Изменение выбранного сырья",
    restore: "Вы уверены, что хотите восстановить это сырье, {name}?",
  },
}

/** "1 234,5" (ru grouping, up to 3 decimals). */
export function formatNumber(value: number, digits = 3): string {
  return formatMoney(value, digits)
}

export function imageUrl(kind: CatalogKind, id: number, imageId: number): string {
  return `${CATALOG_API[kind]}/${id}/images/${imageId}`
}

/** Unit cell of the list: the group unit (strong) and "6 dona" when the item has a group. */
export function unitParts(item: Pick<CatalogItem, "unit" | "boxUnit" | "boxAmount">): { main: string; sub: string } {
  if (item.boxAmount > 0) return { main: item.boxUnit || item.unit, sub: `${formatNumber(item.boxAmount)} ${item.unit}`.trim() }
  return { main: item.unit, sub: "" }
}

export type MutateResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      status: number
      error: string
      fields?: Record<string, string>
      usage?: CatalogUsage[]
      errors?: Array<{ row: number; error: string }>
      /** 409 of a delete while the item is in stock: quantity per warehouse. */
      stock?: Array<{ warehouse: string; qty: number }>
    }

/** JSON write; an error result keeps the server's fields / usage / row errors. */
export async function catalogMutate<T = unknown>(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<MutateResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof json?.error === "string" ? json.error : `HTTP ${response.status}`,
        fields: json?.fields as Record<string, string> | undefined,
        usage: json?.usage as CatalogUsage[] | undefined,
        errors: json?.errors as Array<{ row: number; error: string }> | undefined,
        stock: json?.stock as Array<{ warehouse: string; qty: number }> | undefined,
      }
    }
    return { ok: true, data: json as T }
  } catch (reason) {
    return { ok: false, status: 0, error: reason instanceof Error ? reason.message : String(reason) }
  }
}

/** Translated message of a failed write. */
export function errorText(result: { status: number; error: string }, t: (text: string) => string): string {
  if (result.status === 403) return t("Недостаточно прав")
  if (result.status === 0) return t("Сервер недоступен, попробуйте ещё раз")
  return t(result.error)
}

/** Demo Toggle with a title and an optional sub-title. */
export function Switch({
  checked,
  onChange,
  title,
  subTitle,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: ReactNode
  subTitle?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center justify-between gap-3 py-1 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span className="min-w-0">
        <span className="block text-[14px] text-[#17233b]">{title}</span>
        {subTitle && <span className="block text-[12px] text-[#9aa3b6]">{subTitle}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${checked ? "bg-[#4f71dc]" : "bg-[#c7ccd6]"}`}
      >
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[21px]" : "translate-x-[3px]"}`} />
      </button>
    </label>
  )
}

export function YesNo({ value }: { value: boolean }) {
  return value ? <Check className="h-5 w-5 text-[#8acb8d]" /> : <X className="h-5 w-5 text-[#e57373]" />
}

/** "Где используется" list of a 409 hard delete. */
export function UsageList({ usage, t }: { usage: CatalogUsage[]; t: (text: string) => string }) {
  return (
    <ul className="mt-3 space-y-1 text-[14px] text-[#586174]">
      {usage.map((entry) => (
        <li key={entry.table} className="flex justify-between gap-4 border-b border-dashed border-[#e1e5eb] py-1">
          <span>{t(entry.label)}</span>
          <span className="font-semibold text-[#17233b]">{entry.count}</span>
        </li>
      ))}
    </ul>
  )
}

/** Sort state icon of a list header. */
export function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

/** ⋮ menu of a list row (closes on outside click); the card opens over the button like the reference's. */
export function RowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  return (
    <div ref={ref} className="relative" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label="⋮" className="flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-0 z-[30] w-[168px] rounded-[2px] bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">{children(() => setOpen(false))}</div>
      )}
    </div>
  )
}
