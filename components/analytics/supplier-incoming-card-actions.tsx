"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { MaterialAlert, MaterialBody, MaterialDialog, MaterialFooter } from "@/components/analytics/cash-material"
import { PrintMenu } from "@/components/orders/print-menu"
import { RI } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatStatementDate, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Incoming, IncomingLog } from "./supplier-incomings-data"
import { isoToRuDate } from "./supplier-incoming-form"

// The supply card's header actions that are Linko's menus and dialogs (Склад → Приход от поставщиков → «Поставка № N»):
// - «Изменить»: a menu of «Изменить детали» (the full-screen form, ?openUpdateDialog=true), «Изменить детали счет
//   фактуры» (?openInvoiceDialog=true) and «Добавить лог» (a popover, no URL state); an inventory surplus has only the
//   invoice item, «Изменить детали» is greyed for a cancelled supply or without the right to change supplies;
// - «Скачать»: «Продукты поставки» and «Цены» (Excel files);
// - the print icon: «Кол - во повторений» and the «supply» print templates;
// - the Логи tab: one card per history entry (Поставка / Статус / Кем / Когда / Комментарий).

const PENCIL = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
/** Linko's «Изменить детали счет фактуры» icon: a receipt with torn edges. */
const LIST = "M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z"
const INFO = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
const CALENDAR =
  "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const DOWNLOAD = "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"

/** The card's blue header button (Linko's 30 px action), here with a dropdown under it. */
function HeaderButton({ icon, children, onClick, active }: { icon: string; children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className="inline-flex h-[30px] min-w-[88px] items-center justify-center gap-[8px] rounded-[5px] bg-[#1E4A9A] pl-[12px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden>
        <path d={icon} />
      </svg>
      {children}
    </button>
  )
}

type MenuItem = { label: string; icon?: string; disabled?: boolean; onClick: () => void }

/** Material's IconMenu: anchored at the button's bottom-right corner, 13 px items with a 44 px icon (22 px, #666). */
function DropdownMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <>
      <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      <div role="menu" className="absolute right-0 top-[31px] z-[115] min-w-[112px] whitespace-nowrap rounded-[4px] bg-white py-[3px] text-left text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
            className={`flex h-12 w-full items-center text-left ${item.icon ? "pl-[22px] pr-[59px]" : "pl-[20px] pr-[24px]"} ${item.disabled ? "cursor-not-allowed text-black/30" : "cursor-pointer hover:bg-[rgba(0,0,0,0.098)]"}`}
          >
            {item.icon && (
              <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" style={{ fill: item.disabled ? "rgba(0,0,0,0.3)" : "#666" }} aria-hidden>
                  <path d={item.icon} />
                </svg>
              </span>
            )}
            <p className={item.icon ? "ml-[13px]" : ""}>{t(item.label)}</p>
          </button>
        ))}
      </div>
    </>
  )
}

/** «Изменить»: Linko's three-item menu. `canEdit` = the right to change supplies (procurement). */
export function SupplyEditMenu({
  row,
  canEdit,
  onEditDetails,
  onEditInvoice,
  onAddLog,
}: {
  row: Incoming
  canEdit: boolean
  onEditDetails: () => void
  onEditInvoice: () => void
  onAddLog: () => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const items: MenuItem[] = [
    ...(row.isInventory ? [] : [{ label: "Изменить детали", icon: PENCIL, disabled: row.status === "отменен" || !canEdit, onClick: onEditDetails }]),
    { label: "Изменить детали счет фактуры", icon: LIST, onClick: onEditInvoice },
    ...(row.isInventory ? [] : [{ label: "Добавить лог", icon: INFO, onClick: onAddLog }]),
  ]
  return (
    <span className="relative inline-flex">
      <HeaderButton icon={PENCIL} active={open} onClick={() => setOpen((value) => !value)}>
        {t("Изменить")}
      </HeaderButton>
      {open && <DropdownMenu items={items} onClose={close} />}
    </span>
  )
}

/** «Скачать»: «Продукты поставки» / «Цены». */
export function SupplyDownloadMenu({ onProducts, onPrices }: { onProducts: () => void; onPrices: () => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <span className="relative inline-flex">
      <HeaderButton icon={DOWNLOAD} active={open} onClick={() => setOpen((value) => !value)}>
        {t("Скачать")}
      </HeaderButton>
      {open && (
        <DropdownMenu
          items={[
            { label: "Продукты поставки", onClick: onProducts },
            { label: "Цены", onClick: onPrices },
          ]}
          onClose={close}
        />
      )}
    </span>
  )
}

/** A Material text field: the label is the placeholder (13 px, bold) and floats above the value (10 px) once filled. */
function FloatingField({ label, value, onChange, multiline, error }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; error?: string }) {
  const [focused, setFocused] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const floating = focused || Boolean(value)
  useEffect(() => {
    const element = area.current
    if (!element) return
    // 1 to 6 rows, like Linko's multiline field.
    element.style.height = "0px"
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 19), 6 * 19)}px`
  }, [value])
  return (
    <label className="relative block pt-[26px]">
      <span
        className={`pointer-events-none absolute left-0 font-semibold text-black ${floating ? "top-[10px] text-[10px] leading-3" : "top-[30px] text-[13px] leading-4"}`}
      >
        {label}
      </span>
      {multiline ? (
        <textarea
          ref={area}
          rows={1}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          className="block w-full resize-none overflow-hidden bg-transparent pb-[6px] text-[13px] leading-[19px] text-black outline-none"
        />
      ) : (
        <input
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          className="block h-[26px] w-full bg-transparent text-[13px] text-black outline-none"
        />
      )}
      <span className={`block h-px ${error ? "bg-[#f44336]" : focused ? "bg-[#1E4A9A]" : "bg-[#e0e0e0]"}`} />
      {error && <span className="block pt-[3px] text-[12px] leading-[15px] text-[#f44336]">{error}</span>}
    </label>
  )
}

/** A Material date field opening the calendar dialog; shows «10 декабря 2025 г.». */
function DateFieldButton({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  const shown = value ? (language === "ru" ? `${isoToRuDate(value)} г.` : formatStatementDate(value, language, false)) : ""
  return (
    <div className="relative pt-[26px]">
      {shown && <span className="pointer-events-none absolute left-0 top-[10px] text-[10px] font-semibold leading-3 text-black">{label}</span>}
      <button type="button" onClick={() => setOpen(true)} className="flex h-[26px] w-full items-center justify-between text-left text-[13px] text-black">
        <span data-no-translate={shown ? "" : undefined}>{shown || label}</span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
          <path d={CALENDAR} fill="#ccc" />
        </svg>
      </button>
      <span className={`block h-px ${error ? "bg-[#f44336]" : "bg-[#e0e0e0]"}`} />
      {error && <span className="block pt-[3px] text-[12px] leading-[15px] text-[#f44336]">{error}</span>}
      {open && (
        <DatePickerDialog
          value={value}
          onCancel={() => setOpen(false)}
          onPick={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

type SaveResult = { ok: true; incoming: Incoming } | { ok: false; error: string; fields?: Record<string, string> }

async function post(url: string, body: unknown, failure: string, t: (key: string) => string): Promise<SaveResult> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const data = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> }
    if (!response.ok) return { ok: false, error: data.error ? t(data.error) : t(failure), fields: data.fields }
    return { ok: true, incoming: data as unknown as Incoming }
  } catch {
    return { ok: false, error: t("Сервер недоступен, попробуйте ещё раз") }
  }
}

/** «Изменить детали счет фактуры»: number, day and comment of the supplier's invoice (550 px dialog). */
export function SupplyInvoiceDialog({ row, onClose, onSaved }: { row: Incoming; onClose: () => void; onSaved: (incoming: Incoming) => void }) {
  const { t } = useLanguage()
  const [number, setNumber] = useState(row.invoiceNumber)
  const [date, setDate] = useState(parseAnyDay(row.invoiceDate) ?? "")
  const [comment, setComment] = useState(row.invoiceComment)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  async function save() {
    if (busy) return
    if (!date) {
      setErrors({ invoiceDate: t("Укажите дату счет фактуры") })
      return
    }
    setBusy(true)
    const result = await post(`/api/supplier-incomings/${row.id}/invoice`, { invoiceNumber: number, invoiceDate: date, invoiceComment: comment }, "Не удалось сохранить", t)
    setBusy(false)
    if (result.ok) onSaved(result.incoming)
    else {
      setErrors(Object.fromEntries(Object.entries(result.fields ?? {}).map(([key, value]) => [key, t(value)])))
      setError(result.fields ? "" : result.error)
    }
  }
  return (
    <MaterialDialog title={t("Изменить детали счет фактуры")} onClose={onClose} width={550} top={100} zIndex={300} onSubmit={() => void save()} footer={<MaterialFooter label={t("Сохранить")} busy={busy} error={error} />}>
      <MaterialBody minHeight={300} className="pb-[20px] pt-[0px]">
        <FloatingField label={t("Номер счет фактуры")} value={number} onChange={(value) => { setNumber(value); setErrors({}) }} error={errors.invoiceNumber} />
        <div className="mt-[10px]">
          <DateFieldButton label={t("Дата счет фактуры")} value={date} onChange={(value) => { setDate(value); setErrors({}) }} error={errors.invoiceDate} />
        </div>
        <div className="mt-[10px]">
          <FloatingField label={t("Комментарий")} value={comment} onChange={(value) => { setComment(value); setErrors({}) }} error={errors.invoiceComment} />
        </div>
      </MaterialBody>
    </MaterialDialog>
  )
}

const EVENT_OPTIONS: Array<{ value: "sent_out" | "come_to_post"; label: string }> = [
  { value: "sent_out", label: "Вышел с завода" },
  { value: "come_to_post", label: "Прибыл в таможню" },
]

/** «Добавить лог»: a 290 px box under the card header (right 250 px, top 50 px) with «Статус», «Дата события»,
 * «Комментарий» and a «Сохранить» text button. */
export function SupplyLogPopover({ row, onClose, onSaved }: { row: Incoming; onClose: () => void; onSaved: (incoming: Incoming) => void }) {
  const { t, language } = useLanguage()
  const [action, setAction] = useState<"" | "sent_out" | "come_to_post">("")
  const [date, setDate] = useState("")
  const [comment, setComment] = useState("")
  const [calendar, setCalendar] = useState(false)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save() {
    if (busy) return
    if (!action) {
      setError(t("Выберите статус"))
      return
    }
    setBusy(true)
    const result = await post(`/api/supplier-incomings/${row.id}/logs`, { action, date, comment }, "Не удалось сохранить", t)
    setBusy(false)
    if (result.ok) onSaved(result.incoming)
    else setError(result.error)
  }
  const shownDate = date ? (language === "ru" ? `${isoToRuDate(date)} г.` : formatStatementDate(date, language, false)) : ""
  const chosen = EVENT_OPTIONS.find((option) => option.value === action)
  return (
    <div className="absolute right-[250px] top-[50px] z-[100] w-[290px] bg-white px-[20px] pb-[20px] pt-[35px] text-left text-[13px] text-black shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-[12px] top-[8px] flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
          <path d={RI.close} />
        </svg>
      </button>
      <div className="relative pt-[32px]">
        {chosen && <span className="pointer-events-none absolute left-0 top-[16px] text-[10px] font-semibold leading-3">{t("Статус")}</span>}
        <button type="button" onClick={() => setMenu((value) => !value)} className="flex h-[26px] w-full items-center justify-between text-left">
          <span className={chosen ? "" : "font-semibold"}>{chosen ? t(chosen.label) : t("Статус")}</span>
          <svg viewBox="0 0 10 5" className="h-[5px] w-[10px]" aria-hidden>
            <path d="M0 0h10L5 5z" fill="#999" fillOpacity={0.7} />
          </svg>
        </button>
        <span className="block h-px bg-[#e0e0e0]" />
        {menu && (
          <div className="absolute inset-x-0 top-[59px] z-10 bg-white py-[8px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {EVENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setAction(option.value)
                  setMenu(false)
                  setError("")
                }}
                className={`block h-8 w-full px-[16px] text-left leading-8 hover:bg-[rgba(0,0,0,0.098)] ${option.value === action ? "text-[#1E4A9A]" : ""}`}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative mt-[22px] pt-[26px]">
        {shownDate && <span className="pointer-events-none absolute left-0 top-[10px] text-[10px] font-semibold leading-3">{t("Дата события")}</span>}
        <button type="button" onClick={() => setCalendar(true)} className="flex h-[26px] w-full items-center justify-between text-left">
          <span data-no-translate={shownDate ? "" : undefined}>{shownDate || t("Дата события")}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path d={CALENDAR} fill="#ccc" />
          </svg>
        </button>
        <span className="block h-px bg-[#e0e0e0]" />
      </div>
      <div className="mt-[20px]">
        <FloatingField label={t("Комментарий")} value={comment} onChange={setComment} multiline />
      </div>
      {error && <p className="mt-[8px] text-[12px] leading-[15px] text-[#f44336]">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void save()} className="mt-[20px] block h-[21px] w-full px-[6px] text-left text-[13px] font-normal text-black hover:text-[#1E4A9A] disabled:opacity-60">
        {t("Сохранить")}
      </button>
      {calendar && (
        <DatePickerDialog
          value={date || todayIso()}
          onCancel={() => setCalendar(false)}
          onPick={(next) => {
            setDate(next)
            setCalendar(false)
          }}
        />
      )}
    </div>
  )
}

/** Linko's chip of each history action (supply_log.action), with the app's own entries named as before. */
const LOG_CHIPS: Record<string, { label: string; tone: "green" | "blue" | "red" | "grey" }> = {
  created: { label: "Создан", tone: "green" },
  updated: { label: "Обновленный", tone: "blue" },
  sent_out: { label: "Вышел с завода", tone: "blue" },
  come_to_post: { label: "Прибыл в таможню", tone: "blue" },
  accepted: { label: "Принят на склад", tone: "green" },
  unaccepted: { label: "Отмена приемки на склад", tone: "red" },
  cancelled: { label: "Отмена поставки", tone: "red" },
  change_invoice: { label: "Счет фактура изменена", tone: "blue" },
  expense_added: { label: "Добавлен расход", tone: "grey" },
  expense_deleted: { label: "Удален расход", tone: "grey" },
  repriced: { label: "Наценка проставлена", tone: "grey" },
}

const CHIP_TONE = {
  green: "border-[#81c784] text-[#4caf50]",
  blue: "border-[#64b5f6] text-[#42a5f5]",
  red: "border-[#e57373] text-[#e57373]",
  grey: "border-[#bdbdbd] text-[#757575]",
}

/** Linko's status of a history entry: 0 Ожидает, 1 В процессе, 2 Доставлен, 4 Отмена поставки. */
const LOG_STATUS: Record<string, { label: string; dot: string }> = {
  "0": { label: "Ожидает", dot: "bg-[#f5a623]" },
  "1": { label: "В процессе", dot: "bg-[#64b5f6]" },
  "2": { label: "Доставлен", dot: "bg-[#81c784]" },
  "4": { label: "Отмена поставки", dot: "bg-[#e57373]" },
}

/** "09 янв. 2026, 13:41" in the page language (stored UTC ISO or Linko's local time). */
function when(value: string, language: string) {
  const local = parseAnyDate(value, /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value))
  return local ? formatStatementDate(local.slice(0, 16), language).replace(/\s*г\.,/, ",") : value
}

/** The Логи tab: one card per history entry, newest first (Linko shows when an entry was written, not the event day of
 * «Добавить лог»). `details` formats an entry's comment. */
export function SupplyLogCards({ logs, details }: { logs: IncomingLog[]; details: (log: IncomingLog) => string }) {
  const { t, language } = useLanguage()
  if (!logs.length) return <p className="py-[20px] text-center text-[13px] text-[#999]">{t("Записей нет")}</p>
  return (
    <div className="pb-[4px] pt-[16px]">
      {logs.map((log) => {
        const chip = LOG_CHIPS[log.action] ?? { label: log.action, tone: "grey" as const }
        const status = log.status ? LOG_STATUS[log.status] : undefined
        const comment = details(log)
        return (
          <div key={log.id} className="mb-[20px] rounded-[4px] border border-[#ececec] bg-[#fafafa] px-[20px] py-[20px] text-[13px] leading-[22px] text-[#333]">
            <div className="flex flex-wrap items-center justify-between gap-x-[20px] gap-y-[6px]">
              <div className="flex flex-wrap items-center gap-x-[18px] gap-y-[6px]">
                <span className="flex items-center">
                  <b className="mr-[6px] font-semibold">{t("Поставка")}:</b>
                  <span className={`rounded-full border px-[8px] leading-[20px] ${CHIP_TONE[chip.tone]}`}>{t(chip.label)}</span>
                </span>
                {status && (
                  <span className="flex items-center">
                    <b className="mr-[6px] font-semibold">{t("Статус")}:</b>
                    <i className={`mr-[5px] inline-block h-[10px] w-[10px] rounded-full ${status.dot}`} />
                    {t(status.label)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-x-[20px]">
                <span>
                  <b className="mr-[4px] font-semibold">{t("Кем")}:</b>
                  {log.userName}
                </span>
                <span>
                  <b className="mr-[4px] font-semibold">{t("Когда")}:</b>
                  <span data-no-translate>{when(log.createdAt, language)}</span>
                </span>
              </div>
            </div>
            {comment && (
              <p className="mt-[10px]">
                <b className="mr-[6px] font-semibold">{t("Комментарий")}:</b>
                {comment}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The print icon (tooltip «Распечатать»): «Кол - во повторений» and the «supply» templates; a template prints the
 * supply merged into it, N copies, on a sheet over the page that prints itself and closes with its ✕. */
export function SupplyPrintButton({ id }: { id: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState<{ templateId: number; copies: number } | null>(null)
  return (
    <span className="relative ml-[10px] flex">
      <button type="button" title={t("Распечатать")} aria-label={t("Распечатать")} data-tip-side="left" onClick={() => setOpen((value) => !value)} className="flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]" aria-hidden>
          <path d={RI.print} />
        </svg>
      </button>
      {open && (
        <PrintMenu
          keyName="supply"
          className="right-[-12px] top-[36px]"
          onClose={() => setOpen(false)}
          onPick={(copies, templateId) => {
            setOpen(false)
            setSheet({ templateId, copies })
          }}
        />
      )}
      {sheet && <SupplyPrintSheet id={id} templateId={sheet.templateId} copies={sheet.copies} onClose={() => setSheet(null)} />}
    </span>
  )
}

function SupplyPrintSheet({ id, templateId, copies, onClose }: { id: number; templateId: number; copies: number; onClose: () => void }) {
  const { t } = useLanguage()
  const [pages, setPages] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const printed = useRef(false)
  useEffect(() => {
    let alive = true
    fetch(`/api/supplier-incomings/${id}/print?template=${templateId}&count=${copies}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { pages?: Array<{ html: string }> }
        if (!alive) return
        if (response.ok && body.pages?.length) setPages(body.pages.map((page) => page.html))
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [id, templateId, copies])
  useEffect(() => {
    if (!pages || printed.current) return
    printed.current = true
    const frame = requestAnimationFrame(() => window.setTimeout(() => window.print(), 50))
    return () => cancelAnimationFrame(frame)
  }, [pages])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  if (failed) return createPortal(<MaterialAlert message={t("Ошибка")} onClose={onClose} />, document.body)
  return createPortal(
    // A template prints as written in Шаблоны документов (its own language and amounts), like Linko.
    <div data-supply-print data-no-translate="" data-keep-currency="" className="fixed inset-0 z-[140] overflow-auto bg-white text-[14px] text-[#333]">
      <style>{`[data-supply-print] .printItem { width: 100%; padding: 20px 30px 40px; box-sizing: border-box; border-bottom: 1px solid #212121; background: #fff; }
@media print {
  body > *:not([data-supply-print]) { display: none !important; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  [data-supply-print] { position: static !important; inset: auto !important; overflow: visible !important; }
  [data-supply-print] .printItem { break-inside: avoid; }
}`}</style>
      {pages ? (
        pages.map((html, index) => <div key={index} className="printItem" dangerouslySetInnerHTML={{ __html: html }} />)
      ) : (
        <div className="flex h-screen w-screen items-center justify-center">
          <span className="h-[30px] w-[30px] animate-spin rounded-full border-[3px] border-[#1E4A9A] border-t-transparent" />
        </div>
      )}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className="fixed right-[5px] top-[5px] z-[141] flex h-12 w-12 items-center justify-center print:hidden">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
          <path d={RI.close} />
        </svg>
      </button>
    </div>,
    document.body,
  )
}

/** «Скачать» → «Продукты поставки»: Linko's client file and sheet «Продукты поставки № N» (№ = Linko's line id for a
 * supply copied from it, Продукт, Кол-во, Принято, Брак, Недостача, Ед. измерения, Стоимость, Итог, Валюта; Принято and
 * Брак are texts there). A waiting supply has received nothing yet. */
export function downloadSupplyProducts(row: Incoming, units: Record<string, string>, t: (key: string) => string) {
  const accepted = row.status === "принят"
  const title = `${t("Продукты поставки")} № ${row.id}`
  downloadExcelTable(
    title,
    [
      [` ${t("№")}`, t("Продукт"), t("Кол-во"), t("Принято"), t("Брак"), t("Недостача"), t("Ед. измерения"), t("Стоимость"), t("Итог"), t("Валюта")],
      ...row.items.map((item) => {
        const posted = item.posted ?? (accepted ? item.qty : 0)
        return [item.linkoId ?? item.id, item.product, item.qty, String(posted), "0", Math.round((item.qty - posted) * 1e6) / 1e6, units[item.product] ?? "", item.cost, item.total, row.currency]
      }),
    ],
    { sheetName: title },
  )
}

/** Linko's server sorts the price lists by name the way its database collates: spaces and punctuation ignored. */
const PRICE_LIST_ORDER = new Intl.Collator("en", { ignorePunctuation: true })

type PriceProduct = { id: number; name: string; barcode?: string; article?: string; priceLists?: Array<{ name: string; cash?: number }> }

/** «Скачать» → «Цены»: Linko's SupplyProductPrice.xlsx — per product of the supply its id, name, barcode, article, the
 * supply's unit cost, «Новая цена» / «Наценка» (0) and its current price in every price list (by name). */
export async function downloadSupplyPrices(row: Incoming, t: (key: string) => string): Promise<boolean> {
  try {
    const [productsResponse, listsResponse] = await Promise.all([fetch("/api/products"), fetch("/api/price-lists")])
    if (!productsResponse.ok || !listsResponse.ok) return false
    const products = (await productsResponse.json()) as PriceProduct[]
    const lists = ((await listsResponse.json()) as Array<{ name: string }>).map((list) => list.name).sort(PRICE_LIST_ORDER.compare)
    const byKey = new Map(products.map((product) => [`product:${product.id}`, product]))
    const byName = new Map([...products].reverse().map((product) => [product.name.trim().toLowerCase(), product]))
    const seen = new Set<number>()
    const rows: Array<Array<string | number | null>> = []
    for (const item of row.items) {
      const product = (item.key ? byKey.get(item.key) : undefined) ?? byName.get(item.product.trim().toLowerCase())
      if (!product || seen.has(product.id)) continue
      seen.add(product.id)
      const prices = new Map((product.priceLists ?? []).map((entry) => [entry.name, entry.cash]))
      const barcode = product.barcode && !/^не установлен/i.test(product.barcode) ? product.barcode : null
      rows.push([product.id, product.name, barcode, product.article || null, null, item.cost, 0, 0, ...lists.map((name) => (prices.get(name) ? Number(prices.get(name)) : null))])
    }
    downloadExcelTable("SupplyProductPrice", [
      ["ID", t("Наименование товара"), t("Штрих код"), t("Артикуль"), t("Доступно"), t("Стоимость поставки"), t("Новая цена"), t("Наценка"), ...lists.map((name) => `${t("Текушая цена")} (${name})`)],
      ...rows,
    ], { blankNulls: true })
    return true
  } catch {
    return false
  }
}

const QR =
  "M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13-2h-2v3h-3v2h3v3h2v-3h3v-2h-3v-3z"
const COLLAPSE = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 11h10v2H7z"

/** The marking cell of a line whose product needs codes: the unfold mark and «N / L (+D)» (codes in the invoice /
 * scanned on the warehouse / scanned but not in the invoice), with Linko's hint. */
export function SupplyMarksCell({ stat, open, onToggle }: { stat?: { inInvoice: number; inStock: number; extra: number }; open: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  const counts = stat ?? { inInvoice: 0, inStock: 0, extra: 0 }
  const hint = `${t("Кол-во в счет фактуре")}: ${counts.inInvoice}\n${t("Отсканировано")}: ${counts.inStock}\n${t("Нету в счет фактуре")}: ${counts.extra}`
  return (
    <div className="flex w-full items-center justify-between pl-[10px] pr-[10px]">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={t("Коды маркировки")} className="flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#333]" aria-hidden>
          <path d={open ? COLLAPSE : QR} />
        </svg>
      </button>
      <RefTipText text={hint}>
        {counts.inInvoice} / {counts.inStock}
        {counts.extra ? ` (+${counts.extra})` : ""}
      </RefTipText>
    </div>
  )
}

function RefTipText({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex text-[10px] text-[#1E4A9A]" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-[1000] w-max -translate-x-1/2 whitespace-pre-line rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-left text-[13px] leading-[17px] text-white opacity-90">
          {text}
        </span>
      )}
    </span>
  )
}

/** The unfolded codes of a marked line: «Коды маркировки» and «Коды агрегации» (none were scanned for the supplies
 * copied from Linko: its get_marks answers an empty list). */
export function SupplyMarksPanel() {
  const { t } = useLanguage()
  return (
    <div className="grid grid-cols-2 border-t border-[#e0e0e0] text-[13px]">
      <div className="border-r border-[#e0e0e0] px-[16px] py-[12px]">
        <p className="font-semibold text-[#333]">{t("Коды маркировки")}</p>
        <p className="mt-[6px] text-[12px] text-[#999]">{t("Нет кодов маркировки")}</p>
      </div>
      <div className="border-r border-[#e0e0e0] px-[16px] py-[12px]">
        <p className="font-semibold text-[#333]">{t("Коды агрегации")}</p>
        <p className="mt-[6px] text-[12px] text-[#999]">{t("Нет кодов агрегации")}</p>
      </div>
    </div>
  )
}
