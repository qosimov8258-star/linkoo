"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, Pencil, Trash2, X } from "lucide-react"

import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { PAGE_SIZES, stateFromParams, stateToSearch } from "@/components/products/catalog-state"
import { useLanguage } from "@/lib/i18n/language-context"
import { EMPTY_CATALOG_FILTERS, type CatalogFilters } from "@/lib/products-types"
import { strictNumber } from "@/lib/strict-number"
import { duplicateNameHints, type CatalogItem } from "./production-ui"

export { RobotEmpty } from "./production-ui"

// Pieces of «Этапы производства» → «Продукция» (the stage products and their norms, components/analytics/
// production/stage-tabs.tsx): quantities, the item picker of the norm dialogs, the raw list of «Добавление
// продукта», the operations field of «Прикрепить операцию» and the list state kept in the address.

export const QTY_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"
export const REQUIRED_ERROR = "Это поле обязательно к заполнению"

/** A typed quantity ("0,25", "1 000,5", "2") → number; null for anything else (empty, "abc", "0x10", 0, < 0,
 * > 1e9), so a bad value is reported, never silently dropped. A decimal comma is accepted, as in every Mezon
 * stock form (the reference shows norms with a comma but reads only a point: «не число»). */
export function parseQuantity(text: string): number | null {
  const value = strictNumber(text, { locale: true })
  return Number.isFinite(value) && value > 0 && value <= 1e9 ? value : null
}

// The reference keeps 9 decimals of a norm and shows them all: with 3, a norm of 0.0004 kg read "0 kg".
const normFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 })
export const formatNorm = (value: number, unit: string) => `${normFormat.format(Number.isFinite(value) ? value : 0)} ${unit}`.trim()

/** The catalog as the norm pickers list it: products newest first (the reference's catalog, id DESC), then the
 * Mezon-only raw materials. `productsOnly`: a product's output («Готовый продукт») is a product. */
export function normPickerItems(catalog: CatalogItem[], productsOnly = false): CatalogItem[] {
  const newestFirst = (a: CatalogItem, b: CatalogItem) => b.id - a.id
  const products = catalog.filter((item) => item.kind === "product").sort(newestFirst)
  return productsOnly ? products : [...products, ...catalog.filter((item) => item.kind !== "product").sort(newestFirst)]
}

/** Whether the signed-in user may change the stage products (their controls are hidden otherwise). */
export function useCanChangeProducts(codes: readonly string[]): boolean {
  return useCanManage(codes)
}

/** «Успешно сохранено» / «Успешно удалено»: the reference's snackbar after a save or a delete. */
export function useSuccessNotice() {
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const close = useCallback(() => setMessage(null), [])
  const show = useCallback((text: string) => setMessage({ text, tone: "success" }), [])
  return { show, node: <CashSnackbar message={message} onClose={close} /> }
}

/** A refused request with the API's whole answer (e.g. {error, stage} of «Этот продукт уже добавлен в другой этап»). */
export class RequestError extends Error {
  body: Record<string, unknown>
  constructor(message: string, body: Record<string, unknown>) {
    super(message)
    this.name = "RequestError"
    this.body = body
  }
}

/** The text of a refused save: the API's message, with the stage that «Этот продукт уже добавлен в другой этап» names. */
export function refusalMessage(error: unknown, t: (text: string) => string): string {
  const message = error instanceof Error ? error.message : "Не удалось выполнить запрос"
  const stage = error instanceof RequestError && typeof error.body.stage === "string" ? error.body.stage.trim() : ""
  return stage ? `${t(message)}: «${stage}»` : message
}

/** fetch + JSON like production-ui's api(), keeping the refusal's extra fields. */
export async function requestJson<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new RequestError("Сервер недоступен, попробуйте ещё раз", {})
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new RequestError(typeof data.error === "string" && data.error ? data.error : "Не удалось выполнить запрос", data)
  return data as T
}

// ---------------------------------------------------------------------------
// Item picker
// ---------------------------------------------------------------------------

const PICKER_PAGE = 50
const MENU_HEIGHT = 288

type MenuPlace = { left: number; width: number; top?: number; bottom?: number }

/** Searchable item picker whose menu floats above the dialog (a portal placed under the field, or above it when
 * the window has no room below), so a dialog's scrolling body never clips it. Like the reference's paged list it
 * shows 50 items and 50 more each time the list is scrolled to its end; the search covers every item and, like the
 * reference's (GET /main/product/?search=), reads the name and the code (article). Escape inside the menu closes
 * the menu only, never the dialog around it. */
export function NormItemPicker({ items, value, onChange, placeholder = "", invalid }: { items: CatalogItem[]; value: string; onChange: (key: string) => void; placeholder?: string; invalid?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [limit, setLimit] = useState(PICKER_PAGE)
  const [place, setPlace] = useState<MenuPlace | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = items.find((item) => item.key === value)
  // Namesakes (e.g. a product and a raw material, or three «pepsi») get a grey line that tells them apart, as the
  // batch pickers show it (production-ui ItemPicker).
  const hints = useMemo(() => duplicateNameHints(items, t), [items, t])
  const selectedHint = selected ? hints.get(selected.key) : undefined
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru")
    if (!needle) return items
    return items.filter((item) => item.name.toLocaleLowerCase("ru").includes(needle) || (item.code ?? "").toLocaleLowerCase("ru").includes(needle))
  }, [items, query])

  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom
      const next: MenuPlace =
        below >= MENU_HEIGHT + 8 || below >= rect.top
          ? { left: rect.left, width: rect.width, top: rect.bottom + 4 }
          : { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4 }
      setPlace((current) => (current && current.left === next.left && current.width === next.width && current.top === next.top && current.bottom === next.bottom ? current : next))
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const choose = (key: string) => {
    onChange(key)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          setQuery("")
          setLimit(PICKER_PAGE)
        }}
        className={`flex w-full items-center justify-between border-b py-[6px] text-left text-[13px] ${invalid ? "border-[#f44336]" : "border-[#e8e8e8]"} ${selected ? "text-[#333]" : "text-[#999]"}`}
      >
        {/* Stored names, types and codes are data: the page translator leaves them alone (app texts go through t()). */}
        <span className="truncate" {...(selected ? { "data-no-translate": "" } : {})}>
          {selected ? selected.name : placeholder ? t(placeholder) : " "}
          {selectedHint && <span className="text-slate-400"> · {selectedHint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", left: place.left, width: Math.max(place.width, 220), top: place.top, bottom: place.bottom, maxHeight: MENU_HEIGHT }}
            className="z-[95] flex flex-col overflow-hidden rounded border border-slate-200 bg-white font-sans text-[13px] shadow-xl"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              // The menu (search or an item) has the focus: Escape closes it, not the dialog (Modal closeOnEscape).
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              triggerRef.current?.focus()
            }}
          >
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setLimit(PICKER_PAGE)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                // Inside a dialog's form, Enter picks; it never submits the dialog.
                event.preventDefault()
                if (filtered[0]) choose(filtered[0].key)
              }}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="w-full shrink-0 border-b border-slate-200 bg-white px-3 py-2 outline-none"
            />
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onScroll={(event) => {
                const list = event.currentTarget
                if (list.scrollTop + list.clientHeight >= list.scrollHeight - 40 && limit < filtered.length) setLimit((current) => current + PICKER_PAGE)
              }}
            >
              {filtered.slice(0, limit).map((item) => {
                const hint = hints.get(item.key)
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => choose(item.key)}
                    className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-blue-50 ${item.key === value ? "bg-blue-50" : ""}`}
                  >
                    <span className="min-w-0">
                      <span data-no-translate className="block break-words font-semibold text-slate-800">{item.name}</span>
                      {hint && <span data-no-translate className="block text-[11px] text-slate-400">{hint}</span>}
                    </span>
                    {/* Mezon's own raw materials can share a name with a product: tell them apart (a namesake's line
                        already says «Сырье»). */}
                    {item.kind === "raw_material" && !hint?.startsWith(t("Сырье")) && <span className="shrink-0 text-[11px] text-slate-400">{t("Сырье")}</span>}
                  </button>
                )
              })}
              {!filtered.length && <p className="px-3 py-4 text-center text-slate-400">{t("Ничего не найдено")}</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// «Добавление продукта» → «Сырье»
// ---------------------------------------------------------------------------

export type NormLine = { key: string; amount: number }

/** The reference's raw list of «Добавление продукта» (ManufactureListMaterialField): «+ добавить сырье» opens the add
 * row (Наименование товара, Кол-во, unit, ✓) and the new line goes on top. An item already listed and the product
 * itself are not offered (the reference drops them on ✓). The table reads «Наименование | Кол-во | Ед»; the pencil
 * edits the amount in place with the old value as the hint; the bin removes the line at once. */
export function NormLinesField({ items, lines, onChange, exclude }: { items: CatalogItem[]; lines: NormLine[]; onChange: (lines: NormLine[]) => void; exclude?: string }) {
  const { t } = useLanguage()
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [editError, setEditError] = useState("")
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])
  const offered = useMemo(() => items.filter((item) => item.key !== exclude && !lines.some((line) => line.key === item.key)), [items, lines, exclude])

  function add() {
    if (!key) {
      setError(REQUIRED_ERROR)
      return
    }
    const value = parseQuantity(amount)
    if (value === null) {
      setError(amount.trim() ? QTY_ERROR : REQUIRED_ERROR)
      return
    }
    if (key !== exclude && !lines.some((line) => line.key === key)) onChange([{ key, amount: value }, ...lines])
    setKey("")
    setAmount("")
    setError("")
  }

  function saveEdit(lineKey: string) {
    const value = parseQuantity(editAmount)
    if (value === null) {
      setEditError(editAmount.trim() ? QTY_ERROR : REQUIRED_ERROR)
      return
    }
    onChange(lines.map((line) => (line.key === lineKey ? { ...line, amount: value } : line)))
    setEditing(null)
    setEditError("")
  }

  return (
    <div>
      <div className="flex items-center justify-between pt-2">
        <p className="text-[16px] font-semibold">{t("Сырье")}</p>
        <button type="button" onClick={() => setAdding((value) => !value)} className="text-[13px] text-[#129fdd] hover:underline">+ {t("добавить сырье")}</button>
      </div>
      {adding && (
        <div className="-mx-[30px] mt-2 bg-[#eef2f8] px-[30px] py-3">
          <div className="flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <NormItemPicker items={offered} value={key} placeholder="Наименование товара" invalid={error === REQUIRED_ERROR && !key} onChange={(next) => { setKey(next); setError("") }} />
            </div>
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setError("")
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                add()
              }}
              inputMode="decimal"
              placeholder={t("Кол-во")}
              aria-label={t("Кол-во")}
              className="w-28 border-b border-slate-300 bg-transparent py-[6px] outline-none focus:border-[#1E4A9A]"
            />
            <span className="w-12 truncate pb-[6px] text-[13px] text-[#666]">{byKey.get(key)?.unit}</span>
            <button type="button" onClick={add} aria-label={t("Добавить")} title={t("Добавить")} className="pb-[6px] text-[#1E4A9A]"><Check className="h-6 w-6" /></button>
          </div>
          {error && <p className="mt-1 text-[12px] text-[#f44336]">{t(error)}</p>}
        </div>
      )}
      {lines.length ? (
        <table className="mt-2 w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr className="h-[40px] border-b border-[#e8e8e8] text-left font-semibold">
              <th className="pr-2">{t("Наименование")}</th>
              <th className="pr-2">{t("Кол-во")}</th>
              <th className="pr-2">{t("Ед")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const item = byKey.get(line.key)
              return (
                <tr key={line.key} className="h-[44px] border-b border-dashed border-slate-200 align-middle">
                  <td data-no-translate className="break-words pr-2">{item?.name ?? line.key}</td>
                  {editing === line.key ? (
                    <td colSpan={3}>
                      <span className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editAmount}
                          onChange={(event) => {
                            setEditAmount(event.target.value)
                            setEditError("")
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              // Cancels the edit only, not the dialog around it (Modal closeOnEscape).
                              event.preventDefault()
                              event.stopPropagation()
                              setEditing(null)
                            }
                            if (event.key !== "Enter") return
                            event.preventDefault()
                            saveEdit(line.key)
                          }}
                          placeholder={formatNorm(line.amount, "")}
                          aria-label={t("Кол-во")}
                          inputMode="decimal"
                          className="w-24 border-b border-[#1E4A9A] py-1 outline-none"
                        />
                        <span data-no-translate className="text-[#666]">{item?.unit}</span>
                        <button type="button" onClick={() => saveEdit(line.key)} className="text-[#1E4A9A]" aria-label={t("Сохранить")} title={t("Сохранить")}><Check className="h-5 w-5" /></button>
                      </span>
                      {editError && <span className="block text-[12px] text-[#f44336]">{t(editError)}</span>}
                    </td>
                  ) : (
                    <>
                      <td className="pr-2">{formatNorm(line.amount, "")}</td>
                      <td data-no-translate className="truncate pr-2">{item?.unit}</td>
                      <td>
                        <span className="flex items-center justify-end gap-3">
                          <button type="button" onClick={() => { setEditing(line.key); setEditAmount(""); setEditError("") }} className="text-slate-500 hover:text-[#1E4A9A]" aria-label={t("Изменить")} title={t("Изменить")}><Pencil className="h-4 w-4" /></button>
                          <button type="button" onClick={() => onChange(lines.filter((entry) => entry.key !== line.key))} className="text-slate-500 hover:text-[#e53935]" aria-label={t("Удалить")} title={t("Удалить")}><Trash2 className="h-4 w-4" /></button>
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col items-center py-8 text-center text-[13px] text-[#999]">
          <svg viewBox="0 0 24 24" className="mb-3 h-[70px] w-[70px] fill-none stroke-[#d9dde3]" strokeWidth={0.8} aria-hidden>
            <path d="M6 7h12l1 13H5L6 7z" strokeLinejoin="round" />
            <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
            <path d="M8 13h8M8 16h5" strokeLinecap="round" />
          </svg>
          <span>{t("Вы еще не выбрали")}</span>
          <span>{t("ни одного сырья")}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// «Прикрепить операцию» → «Добавление операций»
// ---------------------------------------------------------------------------

export type OperationOption = { id: number; title: string; type: "equipment" | "human" }

/** The reference's chip field «Добавление операций»: the chosen operations as chips (× takes one off), a menu of the
 * others with a search. Titles may repeat, so every option also names its type. */
export function OperationsChipField({ label, options, value, onChange, invalid }: { label: string; options: OperationOption[]; value: number[]; onChange: (ids: number[]) => void; invalid?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  // The highlighted option: ↑ / ↓ (or the mouse) move it and Enter picks it, so the keyboard reaches every option,
  // the second of two namesakes too (the options take no Tab stop: the search keeps the focus).
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const typeLabel = (type: OperationOption["type"]) => t(type === "human" ? "Трудовые затраты" : "Оборудование")
  const chosen = value.map((id) => options.find((option) => option.id === id)).filter((option): option is OperationOption => Boolean(option))
  const needle = search.trim().toLocaleLowerCase("ru")
  const shown = options.filter((option) => !value.includes(option.id) && (!needle || option.title.toLocaleLowerCase("ru").includes(needle)))
  const current = Math.min(active, Math.max(shown.length - 1, 0))
  const openMenu = () => {
    if (!open) setActive(0)
    setOpen(true)
  }
  const pick = (option: OperationOption) => {
    onChange([...value, option.id])
    // Without a search the next option slides into the picked one's place and stays highlighted.
    if (search) setActive(0)
    setSearch("")
  }
  /** Moves the highlight and keeps it inside the list's own scroll (the dialog does not move). */
  const move = (step: number) => {
    if (!shown.length) return
    const next = Math.min(Math.max(current + step, 0), shown.length - 1)
    setActive(next)
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-index="${next}"]`)
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // An open menu takes the first Escape wherever the focus is (e.g. on the page after a click in the menu's empty
  // space): the menu closes and the chips stay; the dialog (Modal closeOnEscape, a window listener that skips a
  // handled key) closes on the next one. The focus is left where it is (focusing the search would reopen the menu).
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open])

  return (
    <div ref={rootRef} className="relative pt-[18px]">
      <span className="absolute left-0 top-0 text-[13px] font-semibold text-black">{t(label)}</span>
      <div
        onClick={() => {
          openMenu()
          inputRef.current?.focus()
        }}
        className={`flex min-h-[40px] cursor-text flex-wrap items-center gap-[5px] border-b py-[4px] pr-[24px] ${invalid ? "border-[#f44336]" : open ? "border-[#1E4A9A]" : "border-[#e8e8e8]"}`}
      >
        {chosen.map((option) => (
          <span key={option.id} className="flex items-center rounded-[2px] bg-[#5868f0] text-[12px] font-semibold text-white">
            <button
              type="button"
              aria-label={t("Удалить")}
              title={t("Удалить")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                onChange(value.filter((id) => id !== option.id))
              }}
              className="px-[5px] py-[2px] hover:bg-[#4a58d8]"
            >
              <X className="h-3 w-3" />
            </button>
            <span data-no-translate className="max-w-[260px] truncate px-[5px] py-[2px]">{option.title}</span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={search}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && shown[current] ? `${listId}-${current}` : undefined}
          onFocus={openMenu}
          onChange={(event) => {
            setSearch(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            // An open menu closes first; with the menu closed, Escape closes the dialog (Modal closeOnEscape).
            if (event.key === "Escape" && open) {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }
            if (event.key === "Backspace" && !search && value.length) onChange(value.slice(0, -1))
            // Tab leaves the field (to «Сохранить»): the menu closes behind it.
            if (event.key === "Tab") setOpen(false)
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              if (open) move(event.key === "ArrowDown" ? 1 : -1)
              else openMenu()
            }
            if (event.key !== "Enter") return
            // Inside the dialog's form Enter picks (never submits); a closed menu opens first, nothing is picked unseen.
            event.preventDefault()
            if (!open) openMenu()
            else if (shown[current]) pick(shown[current])
          }}
          aria-label={t(label)}
          className="h-[30px] min-w-[80px] flex-1 bg-transparent text-[13px] outline-none"
        />
        <ChevronDown className="pointer-events-none absolute right-0 top-[30px] h-4 w-4 text-slate-400" />
      </div>
      {open && (
        <div ref={listRef} id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 max-h-[220px] overflow-y-auto rounded-b bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {shown.length ? (
            shown.map((option, index) => (
              <button
                key={option.id}
                id={`${listId}-${index}`}
                data-index={index}
                type="button"
                role="option"
                aria-selected={index === current}
                tabIndex={-1}
                // The search keeps the focus (the menu stays open for the next pick, and Escape reaches it).
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  pick(option)
                  inputRef.current?.focus()
                }}
                className={`flex w-full items-baseline justify-between gap-3 px-[10px] py-2 text-left text-[13px] ${index === current ? "bg-[#e6f2ff]" : ""}`}
              >
                <span data-no-translate className="min-w-0 break-words font-semibold text-[#333]">{option.title}</span>
                <span className="shrink-0 text-[11px] text-[#999]">{typeLabel(option.type)}</span>
              </button>
            ))
          ) : (
            <div className="px-[10px] py-2 text-[13px] text-[#999]">{t("Ничего не найдено")}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The list state in the address
// ---------------------------------------------------------------------------

/** `expanded`: the item key of the opened product ("product:966"). */
export type ProductsView = { search: string; filters: CatalogFilters; page: number; pageSize: number; expanded: string | null }

const EMPTY_VIEW: ProductsView = { search: "", filters: EMPTY_CATALOG_FILTERS, page: 1, pageSize: 25, expanded: null }
// The catalog list keys (components/products/catalog-state.ts) plus the opened product.
const VIEW_KEYS = ["search", "page", "pageSize", "productId", "materialId", "typeParent", "typeChild", "canSell", "measurement", "brand", "provider", "color", "division", "supply", "isMML", "isGear", "isPerfectStore"]

function readView(stageId: number): ProductsView {
  if (typeof window === "undefined") return EMPTY_VIEW
  const params = new URLSearchParams(window.location.search)
  const tab = params.get("tab")
  // The address still names the previous stage or tab while a switch renders this one: start empty then.
  if (params.get("stage") !== String(stageId) || (tab !== null && tab !== "products")) return EMPTY_VIEW
  const state = stateFromParams(params, "product")
  const id = (name: string) => {
    const value = Number(params.get(name))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  const productId = id("productId")
  const materialId = id("materialId")
  return {
    search: state.search,
    // This page's filter has no «Только Perfect Store продукты» (neither has the reference's).
    filters: { ...state.filters, isPerfectStore: false },
    page: state.page,
    pageSize: (PAGE_SIZES as readonly number[]).includes(state.pageSize) ? state.pageSize : 25,
    expanded: productId ? `product:${productId}` : materialId ? `raw_material:${materialId}` : null,
  }
}

function writeView(view: ProductsView) {
  const params = new URLSearchParams(window.location.search)
  for (const key of VIEW_KEYS) params.delete(key)
  new URLSearchParams(stateToSearch({ tab: "", search: view.search, ordering: "", page: view.page, pageSize: view.pageSize, filters: view.filters, detailId: null })).forEach((value, key) => params.append(key, value))
  const [kind, id] = view.expanded?.split(":") ?? []
  if (id) params.set(kind === "product" ? "productId" : "materialId", id)
  const next = params.toString()
  if (next !== window.location.search.replace(/^\?/, "")) window.history.replaceState(window.history.state, "", `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`)
}

/** Search, filter, page and the opened product of a stage's «Продукция», kept in the address like the reference's
 * (?productId=966&typeParent=…&page=1&pageSize=25&search=…), so a reload or a shared link opens the same view.
 * A stage switch keeps them, as the reference's handleClickItem keeps filterProduct.getParams(); a tab switch drops
 * them (production-stages-view go() keeps only stage and tab). Unmounting writes nothing: by then the address may
 * already be the next page's. */
export function useProductsView(stageId: number) {
  const [view, setView] = useState<ProductsView>(() => readView(stageId))
  useEffect(() => {
    writeView(view)
  }, [view])
  return [view, setView] as const
}
