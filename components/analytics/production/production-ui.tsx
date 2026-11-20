"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Check, ChevronDown, Pencil, Trash2, X } from "lucide-react"

import { parseAnyDate } from "@/lib/finance/dates"
import { formatDate as formatLocalDate, formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"
import { notify } from "@/lib/notify"
import { strictNumber } from "@/lib/strict-number"

// Shared pieces of the production pages (Партии / Этапы производства).

export type ItemKind = "product" | "raw_material"
/** `code`: the item's article ('' or absent without one). */
export type CatalogItem = { key: string; kind: ItemKind; id: number; name: string; unit: string; type: string; code?: string }
/** available = what can be used now; onHand = everything there (brak included);
 * stockDefects = the brak inside onHand; defects = the brak on hand the pickers show as «Браковано». */
export type StockItem = CatalogItem & { available: number; onHand: number; stockDefects: number; defects: number; cost: number }
export type Stage = { id: number; name: string; warehouse: string; responsible: string; responsibleId: number | null; createdAt: string }
export type PartyStatusTransitions = Record<PartyStatus, PartyStatus[]>
/** The statuses «Изменение партии» offers: like the reference, all three for every batch (a finished batch can be
 * reopened, a cancelled one taken back into work); the server checks what each change does to the stock. */
export const STATUS_TRANSITIONS: PartyStatusTransitions = {
  pending: ["pending", "finished", "cancelled"],
  finished: ["pending", "finished", "cancelled"],
  cancelled: ["pending", "finished", "cancelled"],
}
export type PartyStatus = "pending" | "finished" | "cancelled"

export const STATUS_LABELS: Record<PartyStatus, string> = { pending: "В процессе", finished: "Завершен", cancelled: "Отменен" }
/** The reference's status colours: waiting #f0ad4e, begin #64b5f6, error #e57373 (list dots). */
export const STATUS_DOT: Record<PartyStatus, string> = { pending: "bg-[#f0ad4e]", finished: "bg-[#64b5f6]", cancelled: "bg-[#e57373]" }
/** The batch header's status word: like the reference, a cancelled batch's status is plain text (no colour). */
export const STATUS_TEXT: Record<PartyStatus, string> = { pending: "text-[#f0ad4e]", finished: "text-[#64b5f6]", cancelled: "" }

/** Who may change production (the server's rule for /api/production writes): the pages hide their write controls
 * from anyone else (useCanManage). stage-tabs.tsx re-exports it. */
export const PRODUCTION_WRITE = ["production.manage"] as const

/** A refused API call: the server's message, its HTTP status (0 when the server was not reached) and the field it
 * names (null without one). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly field: string | null = null,
  ) {
    super(message)
  }
}

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
  if (!response.ok) {
    const refusal = data as { error?: string; field?: unknown }
    throw new ApiError(refusal.error || "Не удалось выполнить запрос", response.status, typeof refusal.field === "string" && refusal.field ? refusal.field : null)
  }
  return data as T
}

/** `quiet`: a failed load is not announced (the caller reads `error`, e.g. to treat a 404 as "nothing to show"). */
export function useApiData<T>(url: string | null, initial: T, options: { quiet?: boolean } = {}) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [version, setVersion] = useState(0)
  const quiet = Boolean(options.quiet)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api<T>(url)
      .then((value) => !cancelled && setData(value))
      .catch((reason: Error) => {
        if (cancelled) return
        setError(reason instanceof ApiError ? reason : new ApiError(reason.message))
        if (!quiet) notify(reason.message)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [url, version, quiet])
  return { data, setData, loading, error, reload: () => setVersion((value) => value + 1) }
}

const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 })
export const formatNumber = (value: number) => numberFormat.format(Number.isFinite(value) ? value : 0)
export const formatAmount = (value: number, unit: string) => `${formatNumber(value)} ${unit}`.trim()

export function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

// The reference formats ru dates with moment's Russian short months ("26 июля 2025", "19 окт. 2026");
// the other UI languages go through lib/i18n/format-date ("26 iyul 2025", "26 Jul 2025").
const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

function ruDay(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${RU_SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** "14 апр. 2026" from YYYY-MM-DD, in the UI language ("14 apr 2026"). */
export function formatDate(value: string, language: LanguageCode = "ru") {
  if (!value) return ""
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return language === "ru" ? ruDay(date) : formatLocalDate(date, language)
}

/** The wall time of a stored moment in the business time zone (Asia/Tashkent), "YYYY-MM-DDTHH:mm:ss": the
 * reference shows the server's time to every viewer, wherever the browser is. Null when it is no moment. */
function businessMoment(value: string): string | null {
  const parsed = parseAnyDate(value)
  if (parsed) return parsed
  const time = Date.parse(value)
  return Number.isFinite(time) ? parseAnyDate(new Date(time).toISOString()) : null
}

/** "14 апр. 2026, 18:30" from an ISO timestamp (business time zone), in the UI language. */
export function formatDateTime(value: string, language: LanguageCode = "ru") {
  if (!value) return ""
  const moment = businessMoment(value)
  if (!moment) return value
  if (language !== "ru") return formatDateText(moment, language, { withTime: true })
  const month = RU_SHORT_MONTHS[Number(moment.slice(5, 7)) - 1] ?? ""
  return `${moment.slice(8, 10)} ${month} ${moment.slice(0, 4)}, ${moment.slice(11, 16)}`
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  onSubmit,
  width = "max-w-[600px]",
  tall,
  fullScreen,
  closeOnEscape,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  onSubmit?: (event: FormEvent) => void
  width?: string
  /** A taller body (440 px) for the dialogs with pickers. */
  tall?: boolean
  /** The whole window (the reference's full-screen dialogs, e.g. a batch's «Добавить сырье»); `width` is ignored. */
  fullScreen?: boolean
  /** Escape closes the dialog (an open picker inside closes first). */
  closeOnEscape?: boolean
}) {
  const { t } = useLanguage()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!closeOnEscape) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      // Only the topmost dialog closes: a confirmation opened above this one (e.g. «Удалить» → askDelete, which
      // closes on the same key from its own listener) takes the key, and this dialog stays.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (dialogs.length && dialogs[dialogs.length - 1] !== root.current) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeOnEscape, onClose])
  // The body scrolls only when its content does not fit in it. A body that fits does not clip: the pickers' menus
  // (SearchSelect, ItemPicker, the chip fields: absolute lists under their field) open over the footer and past the
  // dialog's edge, as the reference's selects do, instead of inside a scroll-in-scroll. Until measured (and on the
  // server) the body scrolls as before; the full-screen dialogs always scroll.
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(false)
  useEffect(() => {
    const body = bodyRef.current
    const content = contentRef.current
    if (fullScreen || !body || !content) return
    const check = () => {
      const style = window.getComputedStyle(body)
      // The body's tallest box: max-h-[70vh], or the `tall` minimum when the window is so low that it wins.
      const limit = Math.max(Number.parseFloat(style.maxHeight), Number.parseFloat(style.minHeight) || 0)
      const height = content.getBoundingClientRect().height + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      // A wide table keeps its horizontal scroll: content wider than the body scrolls too (a full-bleed part,
      // -mx-[30px] into the padding, still fits).
      const room = content.clientWidth + Number.parseFloat(style.paddingRight)
      setFits((!Number.isFinite(limit) || height <= limit + 0.5) && content.scrollWidth <= room + 1)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(content)
    window.addEventListener("resize", check)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", check)
    }
  }, [fullScreen])
  // An opened menu is kept in the window, as the reference keeps its select lists in view. In a body that fits, a
  // picker's list hangs over the footer and past the dialog's edge, and on a low window (a 1366 x 768 laptop) past
  // the window's bottom too: the overlay then scrolls just enough to show the whole list (a scrolling body scrolls
  // first). A menu is an absolute, z-indexed box added under a field (SearchSelect, ItemPicker, the chip fields); it
  // is watched while it is open, so a list that grows after opening (options loaded later) is shown whole too.
  useEffect(() => {
    const host = bodyRef.current
    const overlay = root.current
    if (!host || !overlay) return
    // The menu's laid-out place: its box is still shifted by the opening animation (globals.css soft-drop-in).
    const placeOf = (menu: HTMLElement) => {
      const anchor = menu.offsetParent
      if (!(anchor instanceof HTMLElement)) return menu.getBoundingClientRect()
      const top = anchor.getBoundingClientRect().top + anchor.clientTop + menu.offsetTop
      return { top, bottom: top + menu.offsetHeight }
    }
    const revealIn = (scroller: HTMLElement, menu: HTMLElement) => {
      const room = scroller.getBoundingClientRect()
      const box = placeOf(menu)
      const below = box.bottom - (room.bottom - 8)
      // Only as far as the list hangs past the bottom, and never so far that its top (under its field) leaves the view.
      const step = Math.min(below, box.top - (room.top + 8))
      if (below > 0 && step > 0) scroller.scrollTop += step
    }
    const reveal = (menu: HTMLElement) => {
      if (window.getComputedStyle(host).overflowY !== "visible") revealIn(host, menu)
      if (!fullScreen) revealIn(overlay, menu)
    }
    const watched = new Set<Element>()
    const menus = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        if (!(target instanceof HTMLElement) || !target.isConnected) {
          menus.unobserve(target)
          watched.delete(target)
          continue
        }
        reveal(target)
      }
    })
    // While the opening animation runs, its shifted box still bounds how far the overlay can scroll: reveal once more
    // when it ends.
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target instanceof HTMLElement && watched.has(event.target) && event.target.isConnected) reveal(event.target)
    }
    const added = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          const style = window.getComputedStyle(node)
          if (style.position !== "absolute" || style.zIndex === "auto") continue
          watched.add(node)
          menus.observe(node)
        }
      }
    })
    added.observe(host, { childList: true, subtree: true })
    host.addEventListener("animationend", onAnimationEnd)
    return () => {
      added.disconnect()
      menus.disconnect()
      host.removeEventListener("animationend", onAnimationEnd)
    }
  }, [fullScreen])
  const scrolls = fullScreen || !fits
  const body = (
    <>
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
        <h2 className="text-[13px] font-bold uppercase text-[#333]">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><X className="h-6 w-6 text-[#333]" strokeWidth={1.6} /></button>
      </div>
      <div ref={bodyRef} className={`${fullScreen ? "min-h-0 flex-1" : "max-h-[70vh]"} ${scrolls ? "overflow-y-auto" : "overflow-visible"} px-[30px] pb-[20px] pt-[16px] ${tall && !fullScreen ? "min-h-[440px]" : ""}`}>
        {fullScreen ? children : <div ref={contentRef} className="flow-root">{children}</div>}
      </div>
      {footer && <div className="flex h-[57px] shrink-0 items-center justify-end gap-4 border-t border-[#efefef] pr-[26px]">{footer}</div>}
    </>
  )
  // A menu that opens past the bottom of a low window can be scrolled to (the overlay scrolls; `my-auto` keeps the
  // dialog centred and lets a dialog taller than the window scroll from its top).
  const panel = fullScreen ? "flex h-full w-full flex-col bg-white" : `my-auto w-full ${width} bg-white shadow-2xl`
  return (
    <div ref={root} className={`fixed inset-0 z-[80] flex bg-black/45 font-sans text-[13px] ${fullScreen ? "" : "justify-center overflow-y-auto p-4"}`} role="dialog" aria-modal="true">
      {onSubmit ? (
        <form onSubmit={onSubmit} className={panel}>{body}</form>
      ) : (
        <div className={panel}>{body}</div>
      )}
    </div>
  )
}

export function SaveButton({ saving, label = "Сохранить", type = "submit", onClick, disabled }: { saving?: boolean; label?: string; type?: "submit" | "button"; onClick?: () => void; disabled?: boolean }) {
  const { t } = useLanguage()
  return (
    <button type={type} onClick={onClick} disabled={saving || disabled} className="h-9 text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:no-underline disabled:opacity-40">
      {saving ? "..." : t(label)}
    </button>
  )
}

export function Field({ label, required, children, className = "" }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  const { t } = useLanguage()
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[13px] font-semibold text-black">
        {t(label)} {required && <span className="text-[#f44336]">*</span>}
      </span>
      {children}
    </label>
  )
}

export const inputClass = "w-full border-b border-[#e8e8e8] bg-transparent py-[6px] text-[13px] outline-none focus:border-[#1E4A9A]"

const nameKey = (name: string) => name.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ")

/** A second line for the items of a list whose names repeat (the catalog has products and Mezon's own raw materials
 * of the same name, and products that share a name), so that they can be told apart: «Сырье» / «Продукт» when the
 * namesakes are of both kinds, then the type and the code — and the id when even those are equal. Items with a
 * name of their own get none. */
export function duplicateNameHints(items: readonly CatalogItem[], t: (text: string) => string): Map<string, string> {
  const groups = new Map<string, CatalogItem[]>()
  for (const item of items) {
    const group = groups.get(nameKey(item.name))
    if (group) group.push(item)
    else groups.set(nameKey(item.name), [item])
  }
  const hints = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const mixed = group.some((item) => item.kind !== group[0].kind)
    const base = group.map((item) => [mixed ? t(item.kind === "raw_material" ? "Сырье" : "Продукт") : "", item.type, item.code ?? ""].map((part) => part.trim()).filter(Boolean).join(" · "))
    group.forEach((item, index) => {
      const shared = base.filter((hint) => hint === base[index]).length > 1
      hints.set(item.key, shared || !base[index] ? [base[index], `№ ${item.id}`].filter(Boolean).join(" · ") : base[index])
    })
  }
  return hints
}

/** Searchable dropdown over catalog / stock items; stock items show the reference's "Доступно / Браковано" lines
 * under the name, and namesakes a line that tells them apart (duplicateNameHints). Every match is listed (a long
 * list scrolls; nothing is cut off silently). */
export function ItemPicker<T extends CatalogItem>({
  items,
  value,
  onChange,
  placeholder = "Наименование товара",
  showStock,
  emptyText = "Ничего не найдено",
}: {
  items: T[]
  value: string
  onChange: (key: string) => void
  placeholder?: string
  showStock?: boolean
  /** Shown when nothing matches (the reference's batch pickers say «Не найдено»). */
  emptyText?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const selected = items.find((item) => item.key === value)
  const hints = useMemo(() => duplicateNameHints(items, t), [items, t])

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
    return items.filter((item) => !normalized || item.name.toLocaleLowerCase("ru").includes(normalized) || (item.code ?? "").toLocaleLowerCase("ru").includes(normalized))
  }, [items, query])
  const selectedHint = selected ? hints.get(selected.key) : undefined

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current)
          setQuery("")
        }}
        className={`flex w-full items-center justify-between border-b border-[#e8e8e8] py-[6px] text-left text-[13px] ${selected ? "text-[#333]" : "text-[#999]"}`}
      >
        {/* Stored names, types, codes and units are data: the page translator leaves them alone (app texts go
            through t() here). */}
        <span className="truncate" {...(selected ? { "data-no-translate": "" } : {})}>
          {selected ? selected.name : t(placeholder)}
          {selectedHint && <span className="text-slate-400"> · {selectedHint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded border border-slate-200 bg-white shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                // Closes the list only, not the dialog around it (Modal closeOnEscape).
                event.preventDefault()
                setOpen(false)
              }
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
            const hint = hints.get(item.key)
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
                <span data-no-translate className="block font-semibold text-slate-800">{item.name}</span>
                {hint && <span data-no-translate className="block text-xs text-slate-400">{hint}</span>}
                {stock && (
                  <span className="block text-xs text-slate-500">
                    {t("Доступно")}: <span data-no-translate className={stock.available > 0 ? "" : "text-red-400"}>{formatAmount(stock.available, item.unit)}</span>
                    <br />
                    {t("Браковано")}: <span data-no-translate>{formatAmount(stock.defects, item.unit)}</span>
                  </span>
                )}
              </button>
            )
          })}
          {!filtered.length && <p className="px-3 py-4 text-center text-sm text-slate-400">{t(emptyText)}</p>}
        </div>
      )}
    </div>
  )
}

export function RobotEmpty({ text, size = 150 }: { text: string; size?: number }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Image src="/robot-empty.png" alt="" width={size} height={size} />
      <p className="mt-3 text-slate-500">{t(text)}</p>
    </div>
  )
}

/** A file as a data URL, whatever its size. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ApiError("Не удалось прочитать файл"))
    reader.readAsDataURL(file)
  })
}

/** The picture types the server keeps (lib/production-api.ts `image`): the file input offers only these. */
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

/** A request body is at most 2 MB (proxy.ts) and a photo travels inside it as base64 text (4/3 of the file). */
const MAX_PHOTO_CHARS = 1_900_000

/** A photo as the data URL the server accepts: png / jpeg / webp / gif only (anything else is refused right
 * away, not after saving), of any size: scaled down to a JPEG when its text would not fit in a request (as a
 * machine's photo is, equipment-photo.ts), so a camera photo over 2 MB is taken too. */
export async function readPhotoFile(file: File): Promise<string> {
  if (!PHOTO_TYPES.includes(file.type)) throw new ApiError("Неверный формат изображения")
  const dataUrl = await readDataUrl(file)
  return dataUrl.length <= MAX_PHOTO_CHARS ? dataUrl : shrinkPhoto(dataUrl)
}

async function shrinkPhoto(dataUrl: string): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new ApiError("Не удалось прочитать файл"))
    element.src = dataUrl
  })
  const longest = Math.max(image.naturalWidth, image.naturalHeight, 1)
  for (const side of [2048, 1600, 1280, 1024, 800]) {
    const scale = Math.min(1, side / longest)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext("2d")
    if (!context) break
    // JPEG has no transparency: a transparent PNG gets a white background.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL("image/jpeg", 0.85)
    if (result.length <= MAX_PHOTO_CHARS) return result
  }
  throw new ApiError("Файл слишком большой (макс. 2 МБ)")
}

/** Rows of "item + amount" collected before saving (Добавить продукт /
 * сырье dialogs): pick, type the amount, press ✓ to add it to the list. */
export type DraftLine = { key: string; amount: number }

/** Validation texts of the item dialogs (the server's own wording, lib/production-api.ts). */
export const FIELD_REQUIRED = "Это поле обязательно к заполнению"
export const QUANTITY_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"
const MAX_QUANTITY = 1e9

/** A typed quantity read strictly (lib/strict-number.ts: a decimal comma and digit-group spaces are fine, "12abc" is
 * not a number) → NaN when it is none. */
export const readQuantity = (text: string) => strictNumber(text, { locale: true })
/** A quantity the server takes: 0 < x ≤ 1 000 000 000. */
export const validQuantity = (value: number) => Number.isFinite(value) && value > 0 && value <= MAX_QUANTITY

function FieldMessage({ text }: { text?: string }) {
  const { t } = useLanguage()
  return text ? <span className="mt-1 block text-[12px] text-[#f44336]">{t(text)}</span> : null
}

export function ItemLinesEditor<T extends CatalogItem>({
  items,
  lines,
  onChange,
  showStock,
  emptyText = "Вы еще не выбрали ни одного товара",
  hideInput,
  duplicates = "merge",
  validate,
  headers,
  editHint,
  checkAvailable,
  pickerEmptyText,
}: {
  items: T[]
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  showStock?: boolean
  /** Shown while the list is empty; "" shows nothing (the reference's batch dialogs). */
  emptyText?: string
  /** Hides the add row (the reference reveals it with the "+ добавить" link). */
  hideInput?: boolean
  /** ✓ for an item already in the list: "merge" adds the quantities (default); "drop" keeps the list as it is and
   * clears the fields, as the reference's batch dialogs do. */
  duplicates?: "merge" | "drop"
  /** ✓ with no item or a wrong quantity says so under the field (the message goes once it is fixed) instead of doing
   * nothing; quantities are read strictly (readQuantity). */
  validate?: boolean
  /** Column titles over the list (the reference's «Наименование | Кол-во»); the rows are then not numbered. */
  headers?: [string, string]
  /** The pencil opens an empty quantity with the current one as its hint (the reference), not a filled one; ✓ on
   * an empty field keeps the quantity. */
  editHint?: boolean
  /** Lines above the available stock are red (default: with showStock). Output needs no stock: off for it. */
  checkAvailable?: boolean
  /** The picker's text when nothing matches (default «Ничего не найдено»). */
  pickerEmptyText?: string
}) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [errors, setErrors] = useState<{ key?: string; amount?: string; edit?: string }>({})
  const [editing, setEditing] = useState<number | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])
  const hints = useMemo(() => duplicateNameHints(items, t), [items, t])
  const checksStock = checkAvailable ?? Boolean(showStock)
  const readAmount = (text: string) => (validate ? readQuantity(text) : Number(text.replace(",", ".")))
  const clearError = (field: "key" | "amount" | "edit") => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  function add() {
    const value = readAmount(amount)
    if (validate) {
      const found = { key: key ? undefined : FIELD_REQUIRED, amount: validQuantity(value) ? undefined : QUANTITY_ERROR }
      setErrors((current) => ({ ...current, ...found }))
      if (found.key || found.amount) return
    } else if (!key || !(value > 0)) return
    const existing = lines.findIndex((line) => line.key === key)
    if (existing < 0) onChange([{ key, amount: value }, ...lines])
    else if (duplicates === "merge") onChange(lines.map((line, index) => (index === existing ? { ...line, amount: line.amount + value } : line)))
    setKey("")
    setAmount("")
  }

  function startEdit(index: number) {
    setEditing(index)
    setEditAmount(editHint ? "" : String(lines[index].amount))
    clearError("edit")
  }

  function saveEdit(index: number) {
    const text = editAmount.trim()
    if (editHint && !text) {
      setEditing(null)
      return
    }
    const value = readAmount(text)
    if (validate ? validQuantity(value) : value > 0) onChange(lines.map((line, position) => (position === index ? { ...line, amount: value } : line)))
    else if (validate) {
      setErrors((current) => ({ ...current, edit: QUANTITY_ERROR }))
      return
    }
    clearError("edit")
    setEditing(null)
  }

  return (
    <div>
      <div className={`-mx-[30px] grid-cols-[minmax(0,1fr)_7rem_2.5rem_auto] items-end gap-x-4 bg-[#eef2f8] px-[30px] py-3 ${hideInput ? "hidden" : "grid"}`}>
        <div className="min-w-0">
          <ItemPicker
            items={items}
            value={key}
            onChange={(next) => {
              setKey(next)
              clearError("key")
            }}
            showStock={showStock}
            emptyText={pickerEmptyText}
          />
        </div>
        <input
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            clearError("amount")
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
          inputMode="decimal"
          placeholder={t("Кол-во")}
          className="w-full border-b border-slate-300 bg-transparent py-2 outline-none focus:border-blue-600"
        />
        <span data-no-translate className="pb-2 text-sm text-slate-500">{byKey.get(key)?.unit}</span>
        <button type="button" onClick={add} aria-label={t("Добавить")} className="pb-2 text-blue-600"><Check className="h-6 w-6" /></button>
        {(errors.key || errors.amount) && (
          <>
            {/* Always a cell of its own, so a quantity-only message still sits under «Кол-во». */}
            <span className="min-w-0">
              <FieldMessage text={errors.key} />
            </span>
            <span className="col-span-3">
              <FieldMessage text={errors.amount} />
            </span>
          </>
        )}
      </div>
      {lines.length ? (
        <>
          {headers && (
            <div className="mt-2 flex items-center gap-3 border-b border-dashed border-slate-200 py-2.5 text-sm font-semibold">
              <span className="min-w-0 flex-1">{t(headers[0])}</span>
              <span className="w-32 text-right">{t(headers[1])}</span>
              <span className="w-[44px]" />
            </div>
          )}
          <ul className={headers ? "" : "mt-2"}>
            {lines.map((line, index) => {
              const item = byKey.get(line.key)
              const stock = showStock ? (item as unknown as StockItem | undefined) : undefined
              const over = checksStock && stock ? line.amount > stock.available : false
              const hint = hints.get(line.key)
              return (
                <li key={line.key} className="flex items-center gap-3 border-b border-dashed border-slate-200 py-2.5 text-sm">
                  {/* The line's stored name and its amount with the unit are data (the page translator skips them). */}
                  <span data-no-translate className="min-w-0 flex-1 truncate">
                    {headers ? "" : `${index + 1}. `}
                    {item?.name ?? line.key}
                    {hint && <span className="text-slate-400"> · {hint}</span>}
                  </span>
                  {editing === index ? (
                    <>
                      <span className="w-32">
                        <input
                          autoFocus
                          value={editAmount}
                          onChange={(event) => {
                            setEditAmount(event.target.value)
                            clearError("edit")
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              saveEdit(index)
                            }
                          }}
                          placeholder={editHint ? formatNumber(line.amount) : undefined}
                          inputMode="decimal"
                          className="w-full border-b border-blue-500 py-1 outline-none"
                        />
                        <FieldMessage text={errors.edit} />
                      </span>
                      <button type="button" onClick={() => saveEdit(index)} className="text-blue-600" aria-label={t("Сохранить")}><Check className="h-5 w-5" /></button>
                    </>
                  ) : (
                    <>
                      <span data-no-translate className={`w-32 text-right ${over ? "text-red-500" : ""}`}>{formatAmount(line.amount, item?.unit ?? "")}</span>
                      <button type="button" onClick={() => startEdit(index)} className="text-slate-500 hover:text-blue-600" aria-label={t("Изменить")}><Pencil className="h-4 w-4" /></button>
                      <button
                        type="button"
                        onClick={() => {
                          if (editing !== null) setEditing(null)
                          onChange(lines.filter((_, position) => position !== index))
                        }}
                        className="text-slate-500 hover:text-red-500"
                        aria-label={t("Удалить")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      ) : emptyText ? (
        <div className="flex flex-col items-center py-8 text-center text-[13px] text-[#999]">
          <svg viewBox="0 0 24 24" className="mb-3 h-[70px] w-[70px] fill-none stroke-[#d9dde3]" strokeWidth={0.8} aria-hidden>
            <path d="M6 7h12l1 13H5L6 7z" strokeLinejoin="round" />
            <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
            <path d="M8 13h8M8 16h5" strokeLinecap="round" />
          </svg>
          {t(emptyText)}
        </div>
      ) : null}
    </div>
  )
}
