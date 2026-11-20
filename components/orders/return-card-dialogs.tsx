"use client"

import { X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { RI, RefButton } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

// The return card's status buttons and their confirmations, as Linko draws them (#/return/<id>):
// - «Принять на склад» (pending) → ?openConfirmDialog=3: «ВЫПОЛНИТЬ» / «Подтверждение запроса» / a grey band
//   «Запрос № N» with the «Дата» of the acceptance (today by default; only with Linko's can_manage_stock_date, an
//   administrator here) / «ДА» → «Успешно принят»;
// - «Отменить запрос» (accepted) → ?cancelDialog=true: «ПОДТВЕРЖДЕНИЕ ОТМЕНЫ» / «Вы уверены что хотите отменить эти
//   данные?» / «ДА» → back to «Ожидает», «Успешно отменен»;
// - the trash icon (pending) → the same «ПОДТВЕРЖДЕНИЕ ОТМЕНЫ» with the band «Возврат №N» (local state, the address
//   stays) → cancelled, «Успешно удалено».
// Like Linko: the two address dialogs are history entries (opening writes the parameter, closing writes "false", so
// Back reopens or closes them) and open from the address whatever the return's status (the server then refuses ДА);
// no dialog closes on Escape or a click beside it, only on ✕ or after ДА succeeded (a refusal keeps it open).

const CALENDAR = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const REMOVE_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"

type Act = (path: "accept" | "unaccept" | "cancel", message: string, body?: unknown) => Promise<boolean>

/** The card's dialog parameters live in the address only on the returns page (like the card's other parameters). */
const onReturnsPage = () => typeof window !== "undefined" && window.location.pathname.startsWith("/analytics/returns")

function urlParam(name: string): string | null {
  return onReturnsPage() ? new URLSearchParams(window.location.search).get(name) : null
}

function pushUrlParam(name: string, value: string) {
  if (!onReturnsPage()) return
  const params = new URLSearchParams(window.location.search)
  params.set(name, value)
  window.history.pushState(window.history.state, "", `${window.location.pathname}?${params}`)
}

const acceptParamOpen = (value: string | null) => Number(value) > 0
const undoParamOpen = (value: string | null) => value === "true"

/** A dialog kept in the address parameter `name` (see the header): its state follows Back / Forward. */
function useAddressDialog(name: string, isOpen: (value: string | null) => boolean, openValue: string) {
  const [open, setOpen] = useState(() => isOpen(urlParam(name)))
  useEffect(() => {
    const sync = () => setOpen(isOpen(urlParam(name)))
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [name, isOpen])
  const set = (next: boolean) => {
    setOpen(next)
    pushUrlParam(name, next ? openValue : "false")
  }
  return [open, set] as const
}

let stockDateRight: Promise<boolean> | null = null

/** Linko's can_manage_stock_date (the «Дата» of an acceptance): an administrator here, the rule the accept routes apply. */
export function loadStockDateRight(): Promise<boolean> {
  stockDateRight ??= fetch("/api/auth/me", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((user: { role?: string } | null) => user?.role === "admin")
    .catch(() => {
      stockDateRight = null
      return false
    })
  return stockDateRight
}

export function useStockDateRight(): boolean {
  const [right, setRight] = useState(false)
  useEffect(() => {
    let alive = true
    void loadStockDateRight().then((value) => alive && setRight(value))
    return () => {
      alive = false
    }
  }, [])
  return right
}

/** «Принять на склад» / «Отменить запрос» of the card with their dialogs. `act` posts /api/client-returns/<id>/<path>
 * (with `body`), shows the message or the error and answers whether it worked. */
export function ReturnStatusActions({ returnId, status, busy, act }: { returnId: number; status: string; busy?: boolean; act: Act }) {
  const { t } = useLanguage()
  const [acceptOpen, openAccept] = useAddressDialog("openConfirmDialog", acceptParamOpen, "3")
  const [undoOpen, openUndo] = useAddressDialog("cancelDialog", undoParamOpen, "true")
  // Known before the dialog opens, so its «Дата» does not pop in.
  useEffect(() => void loadStockDateRight(), [])
  return (
    <>
      {status === "pending" && <RefButton icon={CHECK_CIRCLE} green label={t("Принять на склад")} disabled={busy} onClick={() => openAccept(true)} exact />}
      {status === "accepted" && <RefButton icon={REMOVE_CIRCLE} red label={t("Отменить запрос")} disabled={busy} onClick={() => openUndo(true)} exact />}
      {acceptOpen && (
        <AcceptReturnDialog
          returnId={returnId}
          busy={busy}
          onClose={() => openAccept(false)}
          onConfirm={(date) => void act("accept", t("Успешно принят"), date ? { date } : undefined).then((done) => done && openAccept(false))}
        />
      )}
      {undoOpen && <UndoAcceptDialog busy={busy} onClose={() => openUndo(false)} onConfirm={() => void act("unaccept", t("Успешно отменен")).then((done) => done && openUndo(false))} />}
    </>
  )
}

/** The card header's trash: Linko's 20 px delete icon (grey #666; rgba(0,0,0,0.3) and disabled unless the return is
 * pending) and its «ПОДТВЕРЖДЕНИЕ ОТМЕНЫ» with the band «Возврат №N». */
export function ReturnTrashButton({ returnId, status, busy, act }: { returnId: number; status: string; busy?: boolean; act: Act }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const enabled = status === "pending"
  return (
    <>
      <button
        type="button"
        title={enabled ? t("Отменить") : undefined}
        aria-label={t("Отменить")}
        disabled={!enabled}
        onClick={() => setOpen(true)}
        className="flex h-12 w-12 cursor-pointer justify-center pt-[12px] disabled:cursor-default"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: enabled ? "#666" : "rgba(0,0,0,0.3)" }} aria-hidden>
          <path d={RI.trash} />
        </svg>
      </button>
      {open && (
        <CancelConfirmDialog
          item={`${t("Возврат")} №${returnId}`}
          busy={busy}
          onClose={() => setOpen(false)}
          onConfirm={() => void act("cancel", t("Успешно удалено")).then((done) => done && setOpen(false))}
        />
      )}
    </>
  )
}

/** Today in Asia/Tashkent (the business day the server checks against) as YYYY-MM-DD. */
export function tashkentToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date())
}

/** Linko's confirmation (Material dialog, 500 px): a 60 px header with the title and ✕, the body, a footer with the
 * 88 px «ДА» flat button. Only ✕ or «ДА» act: no Escape, no click beside it. */
function ConfirmShell({ title, busy, onConfirm, onClose, footerHeight = 57, children }: { title: string; busy?: boolean; onConfirm: () => void; onClose: () => void; footerHeight?: number; children: ReactNode }) {
  const { t } = useLanguage()
  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-center justify-center overflow-y-auto bg-black/[0.54] px-[16px] font-sans text-[13px] text-black">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-[500px] flex-col bg-white shadow-[0_10px_30px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <div className="flex h-[60px] shrink-0 items-center border-b border-[#efefef] pl-[30px] pr-[10px]">
          <h2 className="min-w-0 flex-1 text-[13px] font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333]">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </div>
        {children}
        <div className="flex shrink-0 items-start justify-end border-t border-[#efefef] pr-[10px] pt-[10px]" style={{ height: footerHeight }}>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-9 min-w-[88px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:opacity-50">
            {t("Да")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Linko's «ПОДТВЕРЖДЕНИЕ ОТМЕНЫ» (500 × 327): the question, then `item` on a grey band when given. */
function CancelConfirmDialog({ item, busy, onConfirm, onClose }: { item?: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <ConfirmShell title={t("Подтверждение отмены")} busy={busy} onConfirm={onConfirm} onClose={onClose}>
      <div className="h-[210px] text-[13px] text-black">
        <p className="px-[30px] py-[20px] leading-4">{t("Вы уверены что хотите отменить эти данные?")}</p>
        {item && <div className="flex h-[56px] items-center bg-[#f1f5f8] px-[30px] font-semibold">{item}</div>}
      </div>
    </ConfirmShell>
  )
}

/** Linko's popover calendar of a form date (MUI DatePicker, container "inline"): under the field when it fits in the
 * window, else above it. `field` is the date's box; Linko's anchor is the 49 px block right under its text field. */
function calendarAnchor(field: DOMRect): { left: number; top: number } {
  const height = 434
  const anchorTop = field.top + 35
  const anchorBottom = anchorTop + 49
  return { left: field.left, top: anchorBottom + height > window.innerHeight ? Math.max(0, anchorTop - height) : anchorBottom }
}

/** «ВЫПОЛНИТЬ»: accepts the return into its warehouse; with the right, on the chosen day (the server refuses a day after
 * today). Without it no day is sent: the acceptance is now. */
export function AcceptReturnDialog({
  returnId,
  busy,
  onConfirm,
  onClose,
  emptyDate = false,
}: {
  returnId: number
  busy?: boolean
  onConfirm: (date: string | undefined) => void
  onClose: () => void
  /** Start with an empty «Дата» (empty = now), as Linko's supplier return confirm does. */
  emptyDate?: boolean
}) {
  const { t, language } = useLanguage()
  const canDate = useStockDateRight()
  const [date, setDate] = useState(() => (emptyDate ? "" : tashkentToday()))
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const box = useRef<HTMLButtonElement>(null)
  const locale = ({ ru: "ru-RU", uz: "uz-UZ", tk: "tk-TM", en: "en-US" } as Record<string, string>)[language] ?? "ru-RU"
  const text = date ? new Date(`${date}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : ""
  return (
    <ConfirmShell title={t("Выполнить")} busy={busy} footerHeight={58} onClose={onClose} onConfirm={() => onConfirm(canDate ? date : undefined)}>
      <div className="text-[13px] text-[#333]">
        <div className="px-[30px] py-[20px] leading-4">{t("Подтверждение запроса")}</div>
        <div className="h-[161px] bg-[#f1f5f8] px-[30px] py-[20px] font-semibold">
          <p className="leading-4">
            {t("Запрос №")} {returnId}
          </p>
          {canDate && (
            <div className="mt-[1px]">
              <span className="block text-[10px] leading-3 text-black">{t("Дата")}</span>
              <button
                ref={box}
                type="button"
                aria-label={t("Дата")}
                onClick={() => box.current && setAnchor(calendarAnchor(box.current.getBoundingClientRect()))}
                className="relative mt-[8px] block h-[27px] w-full cursor-pointer border-b border-[#e0e0e0] text-left"
              >
                <span className="absolute left-0 top-0 text-[13px] leading-6 text-black">{text}</span>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-0 h-5 w-5 fill-[#ccc]" aria-hidden>
                  <path d={CALENDAR} />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      {anchor && (
        <DatePickerDialog
          anchor={anchor}
          value={date || tashkentToday()}
          onCancel={() => setAnchor(null)}
          onPick={(next) => {
            setDate(next)
            setAnchor(null)
          }}
        />
      )}
    </ConfirmShell>
  )
}

/** «Отменить запрос» of an accepted return (Linko's cancel_accepts): back to «Ожидает». */
export function UndoAcceptDialog({ busy, onConfirm, onClose }: { busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <CancelConfirmDialog busy={busy} onConfirm={onConfirm} onClose={onClose} />
}
