"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { MaterialAlert } from "@/components/analytics/cash-material"
import { docDate, formatQty } from "@/components/analytics/internal-transfers-shared"
import { RI } from "@/components/ref/list-kit"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

import { PrintMenu } from "./print-menu"

// Printing client returns (Продажи → Возвраты), like the reference:
// - the card's print icon (tooltip «Распечатать», greyed for a cancelled return) and the list's «Распечатать выбранное»
//   open Linko's print menu: «Кол - во повторений» and the active print templates «order_return» (Справочники →
//   Шаблоны документов). A template prints the returns merged into it (GET /api/client-returns/print), N copies each;
// - the list's menu also has «Для зав.склада»: «Распечатать» and «Сводка для склада», the goods of the chosen returns
//   summed per product (GET /api/client-returns/release).
// Each sheet covers the page, prints itself once loaded (window.print()) and closes with its ✕, like the reference.
// When a sheet cannot be made, it closes and the reference's «Ошибка» box is shown instead.

type Sheet = { kind: "template"; templateId: number; copies: number } | { kind: "release" } | { kind: "summary" }

type Release = {
  products: Array<{
    id: number | null
    name: string
    unit: string
    type: string
    barcodes: string[]
    vendorCode: string
    boxAmount: number
    boxUnit: string
    /** The whole-number quantity the reference prints (see lib/client-returns-print.ts). */
    count: number
    totalAmount: number
    currency: string
    totalPrice: number
  }>
  orderReturns: number[]
  beginDate: string | null
  endDate: string | null
  agents: string[]
  deliveryMans: string[]
  clients: string[]
}

const idsParam = (ids: number[]) => encodeURIComponent(ids.join("-"))

/** "659 750 SOM": an amount with the decimals of Настройки → Округление сумм and the currency's name. */
const money = (value: number, currency: string) => `${formatMoney(value)} ${currencyLabel(currency)}`

/** The card's print icon: Linko's 48 px icon button (#666), faded and inert for a cancelled return. */
export function ReturnPrintButton({ id, disabled = false }: { id: number; disabled?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  return (
    <span className="relative flex">
      <button
        type="button"
        title={t("Распечатать")}
        aria-label={t("Распечатать")}
        // Linko's print menu hints to the left of its icon.
        data-tip-side="left"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 cursor-pointer items-center justify-center disabled:cursor-default"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: disabled ? "rgba(0,0,0,0.3)" : "#666" }} aria-hidden>
          <path d={RI.print} />
        </svg>
      </button>
      {open && !disabled && (
        <PrintMenu
          keyName="order_return"
          className="right-0 top-12"
          onClose={() => setOpen(false)}
          onPick={(copies, templateId) => {
            setOpen(false)
            setSheet({ kind: "template", templateId, copies })
          }}
        />
      )}
      {sheet && <PrintSheets ids={[id]} sheet={sheet} onClose={() => setSheet(null)} />}
    </span>
  )
}

/** The list's «Распечатать выбранное» (shown while returns are ticked): the templates for the ticked returns, and
 * «Для зав.склада» → «Распечатать» / «Сводка для склада». */
export function ReturnsPrintSelected({ ids, color = "#666" }: { ids: number[]; color?: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const pick = (next: Sheet) => {
    setOpen(false)
    setSheet(next)
  }
  return (
    <span className="relative flex">
      <button
        type="button"
        title={t("Распечатать выбранное")}
        aria-label={t("Распечатать выбранное")}
        data-tip-side="left"
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 cursor-pointer items-center justify-center"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: color }} aria-hidden>
          <path d={RI.print} />
        </svg>
      </button>
      {open && (
        <PrintMenu keyName="order_return" className="right-0 top-12" onClose={() => setOpen(false)} onPick={(copies, templateId) => pick({ kind: "template", templateId, copies })}>
          <div className="px-[10px]">
            <p className="mb-[10px] whitespace-nowrap text-[13px] font-semibold leading-4">{t("Для зав.склада")}</p>
            {(
              [
                ["Распечатать", { kind: "release" }],
                ["Сводка для склада", { kind: "summary" }],
              ] as Array<[string, Sheet]>
            ).map(([label, next]) => (
              <button key={label} type="button" onClick={() => pick(next)} className="block h-12 w-full cursor-pointer whitespace-nowrap px-4 text-left leading-[48px] hover:bg-[rgba(51,51,51,0.1)]">
                {t(label)}
              </button>
            ))}
          </div>
        </PrintMenu>
      )}
      {sheet && ids.length > 0 && <PrintSheets ids={ids} sheet={sheet} onClose={() => setSheet(null)} />}
    </span>
  )
}

/** A print sheet of the chosen returns (also the list's «Продажа товаров» → «Распечатать»: the release sheet). When
 * the sheet cannot be made it closes and the reference's «Ошибка» box takes its place; its OK ends the print. */
export function PrintSheets({ ids, sheet, onClose }: { ids: number[]; sheet: Sheet; onClose: () => void }) {
  const { t } = useLanguage()
  const [failed, setFailed] = useState(false)
  const onError = useCallback(() => setFailed(true), [])
  if (failed) return createPortal(<MaterialAlert message={t("Ошибка")} onClose={onClose} />, document.body)
  if (sheet.kind === "template") return <TemplatePrintSheet ids={ids} templateId={sheet.templateId} copies={sheet.copies} onClose={onClose} onError={onError} />
  return <ReleaseSheet ids={ids} summary={sheet.kind === "summary"} onClose={onClose} onError={onError} />
}

/** The full-page print layer: only it prints (the app behind is hidden in print), ✕ closes it. Its pages are the
 * reference's `.printItem` boxes (20 px 30 px 40 px, a dark line between copies, never split across paper pages). */
function PrintLayer({ children, onClose, keepAsStored = false }: { children: ReactNode; onClose: () => void; keepAsStored?: boolean }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div
      data-return-print
      // A template prints as written in Шаблоны документов (its own language and amounts), like the reference.
      {...(keepAsStored ? { "data-no-translate": "", "data-keep-currency": "" } : {})}
      className="fixed inset-0 z-[140] overflow-auto bg-white text-[14px] text-[#333]"
    >
      <style>{`[data-return-print] .printItem { width: 100%; padding: 20px 30px 40px; box-sizing: border-box; border-bottom: 1px solid #212121; background: #fff; }
@media print {
  body > *:not([data-return-print]) { display: none !important; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  [data-return-print] { position: static !important; inset: auto !important; overflow: visible !important; }
  [data-return-print] .printItem { break-inside: avoid; }
  [data-return-print] .printItem > div:first-child > div { margin: 0; }
}`}</style>
      {children}
      {/* Fixed like the reference's .printCloseBtn: it stays in reach while the copies scroll. */}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className="fixed right-[5px] top-[5px] z-[141] flex h-12 w-12 cursor-pointer items-center justify-center print:hidden">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
          <path d={RI.close} />
        </svg>
      </button>
    </div>,
    document.body,
  )
}

function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-white">
      <span className="h-[30px] w-[30px] animate-spin rounded-full border-[3px] border-[#1E4A9A] border-t-transparent" />
    </div>
  )
}

/** Calls window.print() once, after the sheet has painted. */
function usePrintWhen(ready: boolean) {
  const printed = useRef(false)
  useEffect(() => {
    if (!ready || printed.current) return
    printed.current = true
    const frame = requestAnimationFrame(() => window.setTimeout(() => window.print(), 50))
    return () => cancelAnimationFrame(frame)
  }, [ready])
}

type SheetProps = { ids: number[]; onClose: () => void; onError: () => void }

function TemplatePrintSheet({ ids, templateId, copies, onClose, onError }: SheetProps & { templateId: number; copies: number }) {
  const [pages, setPages] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/client-returns/print?ids=${idsParam(ids)}&template=${templateId}&count=${copies}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { pages?: Array<{ html: string }> }
        if (!alive) return
        if (response.ok && body.pages?.length) setPages(body.pages.map((page) => page.html))
        else onError()
      })
      .catch(() => alive && onError())
    return () => {
      alive = false
    }
  }, [ids, templateId, copies, onError])
  usePrintWhen(pages !== null)
  return (
    <PrintLayer onClose={onClose} keepAsStored>
      {pages ? pages.map((html, index) => <div key={index} className="printItem" dangerouslySetInnerHTML={{ __html: html }} />) : <Loading />}
    </PrintLayer>
  )
}

/** «Для зав.склада»: «Распечатать» (Наименование / Штрих - код товара / Тип товара / Кол-во / Сумма) or «Сводка для
 * склада» (№ / Наименование / Артикул / Тип товара / Группа / Кол-во / Сумма, then Отпустил / Получил). */
function ReleaseSheet({ ids, summary, onClose, onError }: SheetProps & { summary: boolean }) {
  const { t, language } = useLanguage()
  const [data, setData] = useState<Release | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/client-returns/release?ids=${idsParam(ids)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Release
        if (!alive) return
        if (response.ok && Array.isArray(body.products)) setData(body)
        else onError()
      })
      .catch(() => alive && onError())
    return () => {
      alive = false
    }
  }, [ids, onError])
  usePrintWhen(data !== null)

  if (!data)
    return (
      <PrintLayer onClose={onClose}>
        <Loading />
      </PrintLayer>
    )

  const day = (value: string | null) => (value ? docDate(value, language) : "")
  const unitText = (unit: string) => (unit ? t(unit) : "")
  // «Итого» of «Кол-во»: only when every product has the first one's unit, else blank (the reference's rule).
  const firstUnit = data.products[0]?.unit ?? ""
  const quantity = data.products.every((product) => product.unit === firstUnit)
    ? formatQty(
        data.products.reduce((sum, product) => sum + product.count, 0),
        unitText(firstUnit),
      )
    : ""
  // One sum per currency, never added across currencies, in the products' order.
  const sums = new Map<string, number>()
  for (const product of data.products) sums.set(product.currency, (sums.get(product.currency) ?? 0) + product.totalPrice)
  // «Сводка для склада»: each currency's sum after the other. «Распечатать»: the reference always names USD then SUM
  // ("0 USD, 659 750 SUM"); a sum in another currency follows them.
  const total = summary
    ? [...sums].map(([currency, amount]) => money(amount, currency)).join(" ")
    : [money(sums.get("USD") ?? 0, "USD"), money(sums.get("SUM") ?? 0, "SUM"), ...[...sums].filter(([currency]) => currency !== "USD" && currency !== "SUM").map(([currency, amount]) => money(amount, currency))].join(", ")
  // «Сводка для склада» puts the ids right after the colon, «Распечатать» after a space (as the reference does).
  const returnsLine = (
    <div>
      <strong>
        {t("Показаны товары по следующим возвратам")} ({data.orderReturns.length}):
      </strong>
      {summary ? null : " "}
      <span>{data.orderReturns.join(", ")}</span>
    </div>
  )
  const cell = "border border-[#555] px-2 align-middle"
  // The box breakdown of a quantity, by the reference's formula: "40 тонна (+1 кг)", "0 блок (+1 шт)" below one box,
  // "-" without a box.
  const boxes = (product: Release["products"][number]) => {
    if (!(product.boxAmount > 0)) return "-"
    const whole = Math.floor(product.count / product.boxAmount + 1e-9)
    const rest = Math.round((product.count - whole * product.boxAmount) * 1000) / 1000
    const head = product.count === 0 ? "-" : formatQty(whole)
    return `${head} ${unitText(product.boxUnit)}`.trim() + (rest !== 0 ? ` (+${formatQty(rest, unitText(product.unit))})` : "")
  }

  return (
    <PrintLayer onClose={onClose}>
      {/* The reference's warehouse sheets drop the .printItem bottom line. */}
      <div className="printItem text-[14px] leading-[17.5px] text-[#333] [&_header>div]:mb-[10px]" style={{ borderBottom: "none" }}>
        {summary ? (
          <header>
            <div>
              <strong>{t("Дата")}:</strong>{" "}
              <span>
                {day(data.beginDate)} - {day(data.endDate)}
              </span>
            </div>
            <div>
              <strong>{t("Доставщики")}:</strong> <span>{data.deliveryMans.join(", ")}</span>
            </div>
            <div>
              <strong>{t("Клиенты")}:</strong> <span>{data.clients.join(", ")}</span>
            </div>
            <div>
              <strong>{t("Агенты")}:</strong> <span>{data.agents.join(", ")}</span>
            </div>
            {returnsLine}
          </header>
        ) : (
          <header>
            <div>
              <strong>{t("Дата начала")}:</strong> <span className="mr-[94px]">{day(data.beginDate)}</span> <strong>{t("Дата окончания")}:</strong>
              <span>{day(data.endDate)}</span>
            </div>
            <div>
              <strong>{t("Клиенты")}:</strong> <span>{data.clients.join(", ")}</span>
            </div>
            <div>
              <strong>{t("Инициаторы")}:</strong> <span>{data.agents.join(", ")}</span>
            </div>
            {returnsLine}
          </header>
        )}
        <table className="mt-[10px] w-full border-collapse [&_tr]:h-[25px] [&_tr]:break-inside-avoid">
          <thead>
            {summary ? (
              <tr className="font-bold">
                <th className={`${cell} text-center`}>№</th>
                <th className={`${cell} text-left`}>{t("Наименование")}</th>
                <th className={`${cell} text-left`}>{t("Артикул")}</th>
                <th className={`${cell} text-left`}>{t("Тип товара")}</th>
                <th className={`${cell} text-left`}>{t("Группа")}</th>
                <th className={`${cell} text-left`}>{t("Кол-во")}</th>
                <th className={`${cell} text-right`}>{t("Сумма")}</th>
              </tr>
            ) : (
              <tr className="font-bold">
                <th className={`${cell} text-left`}>{t("Наименование")}</th>
                <th className={`${cell} text-left`}>{t("Штрих - код товара")}</th>
                <th className={`${cell} text-left`}>{t("Тип товара")}</th>
                <th className={`${cell} text-left`}>{t("Кол-во")}</th>
                <th className={`${cell} text-right`}>{t("Сумма")}</th>
              </tr>
            )}
          </thead>
          <tbody>
            {data.products.map((product, index) =>
              summary ? (
                <tr key={`${product.id ?? product.name}-${product.currency}`}>
                  <td className={`${cell} text-center`}>{index + 1}</td>
                  <td className={cell}>{product.name}</td>
                  <td className={cell}>{product.vendorCode}</td>
                  <td className={cell}>{product.type}</td>
                  <td className={cell}>{boxes(product)}</td>
                  <td className={cell}>{formatQty(product.count, unitText(product.unit))}</td>
                  <td className={`${cell} text-right`}>{money(product.totalPrice, product.currency)}</td>
                </tr>
              ) : (
                <tr key={`${product.id ?? product.name}-${product.currency}`}>
                  <td className={cell}>{product.name}</td>
                  <td className={cell}>{product.barcodes.join(", ")}</td>
                  <td className={cell}>{product.type}</td>
                  <td className={cell}>{formatQty(product.count, unitText(product.unit))}</td>
                  <td className={`${cell} text-right`}>{money(product.totalPrice, product.currency)}</td>
                </tr>
              ),
            )}
            <tr className="font-semibold">
              {summary && <td className={cell} />}
              <td className={cell}>
                <strong>{t("Итого")}:</strong>
              </td>
              <td className={cell} />
              <td className={cell} />
              {summary && <td className={cell} />}
              <td className={cell}>{quantity}</td>
              <td className={`${cell} text-right`}>{total}</td>
            </tr>
          </tbody>
        </table>
        {summary && (
          // The reference's sign row: flex boxes whose 100 px lines stretch to the text's height.
          <div className="mt-[20px] flex justify-between [&>div]:flex">
            <div>
              {t("Отпустил")}: <span className="ml-[20px] w-[100px] border-b border-[#333]" />
            </div>
            <div>
              {t("Получил")}:<span className="ml-[20px] w-[100px] border-b border-[#333]" />
            </div>
          </div>
        )}
      </div>
    </PrintLayer>
  )
}
