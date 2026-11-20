"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { MaterialDialog, MaterialFooter } from "@/components/analytics/cash-material"
import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { RI, RefButton, RefIconButton } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { loadStockDateRight, useStockDateRight } from "./return-card-dialogs"
import { PrintSheets } from "./return-print"

// The returns list's checkbox actions (Продажи → Возвраты, ticked rows), as the reference draws them
// (#/return?select=205-207&showCheckboxes=true):
// - «Скачать» → «Скачать для 1C»: OrderReturnOnec.xlsx of the ticked returns (GET /api/client-returns/onec?ids=…);
// - «Изменить выбранные возвраты» (?openMultiUpdateDialog=true): «Изменение выбранных возвратов», the responsible agent
//   and the delivery man of every ticked return (POST /api/client-returns/bulk-update);
// - «Продажа товаров»: «Распечатать» (the goods of the ticked returns summed per product) and «Выбранные возвраты»
//   (the ticked rows as an Excel file);
// - «Принять на склад» (?openDelivery=true): «ВЫПОЛНИТЬ» with the ticked numbers and «Дата принятия» (only for who may
//   set the stock date, an administrator here, as POST /api/client-returns/accept enforces).
// Both dialogs are modal (a click beside them does nothing) and are closed by their close mark, which leaves
// `<flag>=false` in the address, as the reference does.

const SALES_ICON = "M13 13v8h8v-8h-8zM3 21h8v-8H3v8zM3 3v8h8V3H3zm13.66-1.31L11 7.34 16.66 13l5.66-5.66-5.66-5.65z"
const CALENDAR = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"

/** A dialog parameter of the returns page in the address (Linko keeps `<name>=false` once a dialog was closed), with
 * the keys sorted as Linko writes them. */
function setUrlParam(name: string, value: string) {
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/analytics/returns")) return
  const params = new URLSearchParams(window.location.search)
  params.set(name, value)
  params.sort()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`)
}

const urlFlag = (name: string) => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(name) === "true"

/** Material's icon menu of the toolbar: a 48 px icon button with its hint, the menu under it, aligned to its right
 * (8 px rounded paper, 4 px inner padding, 48 px rows with 16 px text inset). */
function ToolbarMenu({ label, icon, iconSize = 24, width, children }: { label: string; icon: string; iconSize?: number; width: number; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
  return (
    <span className="relative flex">
      <button type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} data-tip-side="left" onClick={() => setOpen((value) => !value)} className="flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" style={{ width: iconSize, height: iconSize, fill: "#666" }} aria-hidden>
          <path d={icon} />
        </svg>
      </button>
      {open && (
        <>
          <button type="button" aria-label={label} tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-[110] cursor-default" />
          <div role="menu" className="absolute right-0 top-12 z-[115] rounded-[8px] bg-white p-[4px] font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" style={{ minWidth: width }}>
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </span>
  )
}

const MENU_ITEM = "block h-12 w-full cursor-pointer whitespace-nowrap px-4 text-left leading-[48px] text-[#333] hover:bg-[rgba(51,51,51,0.1)]"

/** «Скачать» → «Скачать для 1C». */
export function ReturnsDownloadMenu({ ids }: { ids: number[] }) {
  const { t } = useLanguage()
  return (
    <ToolbarMenu label={t("Скачать")} icon={RI.download} width={168}>
      {(close) => (
        <a role="menuitem" href={`/api/client-returns/onec?ids=${ids.join("-")}`} target="_blank" rel="noopener" onClick={close} className={MENU_ITEM}>
          {t("Скачать для 1C")}
        </a>
      )}
    </ToolbarMenu>
  )
}

/** «Продажа товаров»: «Распечатать» (the release sheet of the ticked returns) and «Выбранные возвраты» (Excel). */
export function ReturnsSalesMenu({ ids, onExcel }: { ids: number[]; onExcel: () => void }) {
  const { t } = useLanguage()
  const [printing, setPrinting] = useState(false)
  return (
    <>
      <ToolbarMenu label={t("Продажа товаров")} icon={SALES_ICON} iconSize={20} width={224}>
        {(close) => (
          <>
            <button type="button" role="menuitem" onClick={() => (close(), setPrinting(true))} className={MENU_ITEM}>
              {t("Распечатать")}
            </button>
            <button type="button" role="menuitem" onClick={() => (close(), onExcel())} className={MENU_ITEM}>
              {t("Выбранные возвраты")}
            </button>
          </>
        )}
      </ToolbarMenu>
      {printing && ids.length > 0 && <PrintSheets ids={ids} sheet={{ kind: "release" }} onClose={() => setPrinting(false)} />}
    </>
  )
}

type Person = { id: number; name: string }
type People = { agents: Person[]; deliverers: Person[] }

/** «Изменить выбранные возвраты» (shown with ticked rows) and its dialog «Изменение выбранных возвратов», which the
 * address opens too (?openMultiUpdateDialog=true), with or without ticked returns, as the reference. */
export function ReturnsMultiUpdate({ ids, withButton, onDone }: { ids: number[]; withButton: boolean; onDone: (message: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpenState] = useState(false)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    setUrlParam("openMultiUpdateDialog", next ? "true" : "false")
  }
  // The page is server-rendered: the deep link is read once mounted.
  useEffect(() => {
    if (urlFlag("openMultiUpdateDialog")) setOpenState(true)
  }, [])
  return (
    <>
      {withButton && <RefIconButton path={RI.edit} label={t("Изменить выбранные возвраты")} color="#666" tipSide="left" onClick={() => setOpen(true)} />}
      {open && (
        <MultiUpdateDialog
          ids={ids}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false)
            onDone(t("Выбранные возвраты успешно изменены"))
          }}
        />
      )}
    </>
  )
}

function MultiUpdateDialog({ ids, onClose, onDone }: { ids: number[]; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [people, setPeople] = useState<People | null>(null)
  const [agent, setAgent] = useState<RefSelectItem[]>([])
  const [deliverer, setDeliverer] = useState<RefSelectItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let alive = true
    // Linko's lists: every active user (Ответственный агент) and the delivery group (Доставщик), one entry per user.
    fetch("/api/client-returns/bulk-update")
      .then(async (response) => (response.ok ? ((await response.json()) as Partial<People>) : {}))
      .catch(() => ({}) as Partial<People>)
      .then((data) => alive && setPeople({ agents: data.agents ?? [], deliverers: data.deliverers ?? [] }))
    return () => {
      alive = false
    }
  }, [])
  const items = (list: Person[] | undefined) => (list ?? []).map((person) => ({ value: String(person.id), label: person.name }))
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/client-returns/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, agent: agent[0]?.label || undefined, deliverer: deliverer[0]?.label || undefined }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(body?.error ?? "Не удалось сохранить изменения на сервере")
        return
      }
      onDone()
    } catch {
      setError("Не удалось сохранить изменения на сервере")
    } finally {
      setBusy(false)
    }
  }
  return (
    <MaterialDialog
      title={t("Изменение выбранных возвратов")}
      onClose={onClose}
      width={500}
      zIndex={160}
      modal
      onSubmit={() => void submit()}
      footer={<MaterialFooter label={t("Изменить возвратов")} busy={busy} error={error ? t(error) : undefined} />}
    >
      {/* Linko's body: 234 px between the header and footer lines. */}
      <div className="min-h-[234px] px-[30px] pt-[25px]">
        <RefSearchSelect dense rowHeight={32} label={t("Ответственный агент")} items={items(people?.agents)} loading={!people} selected={agent} onChange={setAgent} />
        <RefSearchSelect dense rowHeight={32} className="mt-[5px]" label={t("Доставщик")} items={items(people?.deliverers)} loading={!people} selected={deliverer} onChange={setDeliverer} />
      </div>
    </MaterialDialog>
  )
}

/** The list's green «Принять на склад»: «ВЫПОЛНИТЬ» / «Подтверждение запроса» / «Выбранные заказы: …» with «Дата
 * принятия» (empty = now) / «ДА». Without ticked returns the band says «Выберите хотя бы один возврат !». */
export function ReturnsAcceptSelected({ ids, onAccept }: { ids: number[]; onAccept: (date: string | undefined) => Promise<boolean> }) {
  const { t } = useLanguage()
  const [open, setOpenState] = useState(false)
  const [busy, setBusy] = useState(false)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    setUrlParam("openDelivery", next ? "true" : "false")
  }
  // The button is part of the server render: the deep link (?openDelivery=true) is read once mounted. The stock-date
  // right is asked for at once, so the dialog's «Дата принятия» does not pop in.
  useEffect(() => {
    void loadStockDateRight()
    if (urlFlag("openDelivery")) setOpenState(true)
  }, [])
  return (
    <>
      <RefButton green label={t("Принять на склад")} onClick={() => setOpen(true)} />
      {open && (
        <AcceptDialog
          ids={ids}
          busy={busy}
          onClose={() => setOpen(false)}
          onConfirm={async (date) => {
            setBusy(true)
            const done = await onAccept(date)
            setBusy(false)
            if (!done) return
            setOpen(false)
            // Linko leaves an empty select= after the accept (openDelivery=false&select=).
            setUrlParam("select", "")
          }}
        />
      )}
    </>
  )
}

/** Linko's popover calendar of the date (MUI DatePicker, container "inline"): anchored to the 49 px block under the
 * text field — under that block when the calendar fits in the window, else ending at the field's bottom. */
function calendarAnchor(field: DOMRect): { left: number; top: number } {
  const height = 434
  const below = field.bottom + 49
  return { left: field.left, top: below + height > window.innerHeight ? Math.max(0, field.bottom - height) : below }
}

function AcceptDialog({ ids, busy, onClose, onConfirm }: { ids: number[]; busy: boolean; onClose: () => void; onConfirm: (date: string | undefined) => void }) {
  const { t, language } = useLanguage()
  // «Дата принятия» only for who may set the stock date (an administrator, the rule the accept route applies); anyone
  // else accepts now.
  const canDate = useStockDateRight()
  const [date, setDate] = useState("")
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const field = useRef<HTMLButtonElement>(null)
  const locale = ({ ru: "ru-RU", uz: "uz-UZ", tk: "tk-TM", en: "en-US" } as Record<string, string>)[language] ?? "ru-RU"
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null
  const text = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : ""
  return (
    <MaterialDialog
      title={t("Выполнить")}
      onClose={onClose}
      width={500}
      zIndex={160}
      modal
      onSubmit={() => onConfirm(canDate ? date || undefined : undefined)}
      // Material's 88 px flat button: a short label sits in its middle.
      footer={<MaterialFooter label={<span className="inline-block min-w-[56px] text-center">{t("Да")}</span>} busy={busy} />}
    >
      <div className="min-h-[210px] text-[13px] text-[#333]">
        <div className="px-[30px] py-[20px] leading-4">{t("Подтверждение запроса")}</div>
        {ids.length ? (
          <div className="bg-[#f1f5f8] px-[30px] pb-[20px] pt-[20px] font-semibold">
            <p className="leading-4">
              {t("Выбранные заказы:")} {ids.join(", ")}
            </p>
            {/* Linko's form: the 49 px text field (its line 40 px down) and an empty 49 px block under it. */}
            {canDate && (
              <>
                <button
                  ref={field}
                  type="button"
                  aria-label={t("Дата принятия")}
                  onClick={() => field.current && setAnchor(calendarAnchor(field.current.getBoundingClientRect()))}
                  className="relative mt-[25px] block h-[49px] w-full cursor-pointer text-left"
                >
                  {/* Material's floating label: the placeholder, shrunk to 75 % above the date once one is chosen. */}
                  {text ? (
                    <>
                      <span className="absolute left-0 top-[-6px] origin-top-left scale-75 whitespace-nowrap leading-4 text-black">{t("Дата принятия")}</span>
                      <span className="absolute left-0 top-[14px] leading-6 text-black">{text}</span>
                    </>
                  ) : (
                    <span className="absolute left-0 top-[14px] leading-4 text-black">{t("Дата принятия")}</span>
                  )}
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[14px] h-5 w-5 fill-[#ccc]" aria-hidden>
                    <path d={CALENDAR} />
                  </svg>
                  <span className="absolute inset-x-0 top-[40px] h-px bg-[#e0e0e0]" />
                </button>
                <div className="h-[49px]" />
              </>
            )}
          </div>
        ) : (
          <div className="bg-[#f1f5f8] px-[30px] py-[20px] text-center text-[18px] font-semibold leading-[23px]">{t("Выберите хотя бы один возврат !")}</div>
        )}
      </div>
      {anchor && (
        <DatePickerDialog
          anchor={anchor}
          value={date}
          onCancel={() => setAnchor(null)}
          onPick={(next) => {
            setDate(next)
            setAnchor(null)
          }}
        />
      )}
    </MaterialDialog>
  )
}
