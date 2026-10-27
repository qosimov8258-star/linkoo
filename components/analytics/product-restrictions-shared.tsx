"use client"

import { useEffect, useRef } from "react"

import type { RestrictionMode, RestrictionTab } from "@/lib/product-restrictions-types"

// Shared pieces of "Ограничение продуктов": labels per tab, the dialog Escape stack,
// the demo checkbox and the API error text.

/** Russian i18n keys per tab (the demo's own wording). */
export const TAB_COPY: Record<
  RestrictionTab,
  {
    tab: string
    count: string
    add: string
    remove: string
    titles: Record<RestrictionMode, string>
    item: string
    list: string
    nothing: string
    addLink: string
    picker: string
    search: string
    selectOne: string
  }
> = {
  product: {
    tab: "По продуктам",
    count: "Количество продуктов",
    add: "Добавить продукты",
    remove: "Убрать продукты",
    titles: { add: "Добавить продукты", remove: "Убрать продукты", set: "Установить продукты" },
    item: "Товар",
    list: "Список товаров",
    nothing: "Вы еще не выбрали ни одного товара.",
    addLink: "Добавить товар?",
    picker: "Добавление продуктов",
    search: "Поиск товаров...",
    selectOne: "Выберите хотя бы один товар",
  },
  product_type: {
    tab: "По типам продуктов",
    count: "Количество тип продуктов",
    add: "Добавить тип продукты",
    remove: "Убрать тип продукты",
    titles: { add: "Добавить тип продукты", remove: "Убрать тип продукты", set: "Установить тип продукты" },
    item: "Тип продукта",
    list: "Список типов продуктов",
    nothing: "Вы еще не выбрали ни одного типа продукта.",
    addLink: "Добавить тип продукта?",
    picker: "Добавление типов продуктов",
    search: "Поиск типов продуктов...",
    selectOne: "Выберите хотя бы один тип продукта",
  },
}

/** Tooltip of the pencil and of "добавить из списка" (demo key, its spelling kept). */
export const SET_LIST_HINT = "Установка список продуктов которые подлежать к продаже"

// Open dialogs, newest last: Escape closes only the topmost one.
const escapeStack: number[] = []
let escapeSeq = 0

/** Escape closes this layer when it is the topmost open dialog. */
export function useEscapeLayer(onClose: () => void, active = true) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])
  useEffect(() => {
    if (!active) return
    const id = ++escapeSeq
    escapeStack.push(id)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || escapeStack[escapeStack.length - 1] !== id) return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      const index = escapeStack.indexOf(id)
      if (index >= 0) escapeStack.splice(index, 1)
    }
  }, [active])
}

/** The demo's square checkbox (dark when checked). */
export function DemoCheckbox({
  checked,
  partial,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  partial?: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className={`inline-flex items-center ${disabled ? "cursor-default opacity-50" : "cursor-pointer"}`} onClick={(event) => event.stopPropagation()}>
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 ${
          checked || partial ? "border-[#5d6474] bg-[#5d6474]" : "border-[#555] bg-white"
        }`}
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" />
          </svg>
        ) : partial ? (
          <span className="h-[2px] w-[8px] bg-white" />
        ) : null}
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={label}
          className="sr-only"
        />
      </span>
    </label>
  )
}

export type ApiErrorBody = { error?: string; items?: Array<{ id: number; name?: string }> }

/** Translated API error with the refused names (or ids) after it. */
export function apiErrorText(body: ApiErrorBody | null, fallback: string, t: (text: string) => string): string {
  const message = t(body?.error || fallback)
  const items = (body?.items ?? []).map((item) => item.name || `#${item.id}`)
  if (!items.length) return message
  const shown = items.slice(0, 5).join(", ")
  return `${message}: ${shown}${items.length > 5 ? ` (+${items.length - 5})` : ""}`
}

/** "from - to из total" of a page (0 - 0 when empty). */
export function rangeOf(page: number, pageSize: number, count: number): { from: number; to: number } {
  if (count <= 0) return { from: 0, to: 0 }
  const from = (page - 1) * pageSize + 1
  return { from, to: Math.min(count, page * pageSize) }
}
