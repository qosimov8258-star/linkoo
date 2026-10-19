"use client"

import { useEffect, type MouseEvent } from "react"
import { CircleAlert, ExternalLink, Loader2, X } from "lucide-react"

import { BalanceAmount } from "@/components/analytics/balance/amount"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import type { ExpenseDetailRow, ExpenseReportDetail } from "@/lib/cash/reports"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Drill-down of "Расходы по категориям" / "Расходы на персонал" (demo module
// 2191): title = category / employee, "Общая сумма:" per currency, then the
// paged operations № | Касса | Дата | Описание | Сумма. The № opens the
// operation on the cash page (?search=<№>, new tab); on the staff report the
// whole row does (demo: link to the cash staff popup).

export const DETAIL_PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const
export const DEFAULT_DETAIL_PAGE_SIZE = 25

export function cashOperationHref(docNo: number | null): string | null {
  return docNo ? `/analytics/cash-management?search=${docNo}` : null
}

export function ExpenseDrilldownDialog({
  url,
  requestKey,
  fallbackName,
  emptyName,
  page,
  pageSize,
  onPageChange,
  onClose,
  rowLinks = false,
}: {
  /** GET …/detail?… (null = closed). */
  url: string | null
  /** Key the dialog is open for; a response for another key is not shown. */
  requestKey: string
  /** Name from the list row, shown until the response arrives. */
  fallbackName: string
  /** Title of a row without a name ("Не указано" / "Не указан"), translated. */
  emptyName: string
  page: number
  pageSize: number
  onPageChange: (next: { page: number; pageSize: number }) => void
  onClose: () => void
  /** Whole rows open the cash page (staff report). */
  rowLinks?: boolean
}) {
  const { t, language } = useLanguage()
  const { data: response, loading, error, reload } = useCashJson<ExpenseReportDetail>(url)
  const data = response && response.key === requestKey ? response : null

  useEffect(() => {
    if (!url) return
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", close)
    return () => document.removeEventListener("keydown", close)
  }, [url, onClose])

  if (!url) return null
  const name = data?.name || fallbackName || (data ? emptyName : "")
  const base = data?.baseCurrency ?? ""

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 sm:py-10" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className="flex min-h-full w-full flex-col bg-white text-[#17233b] shadow-xl sm:min-h-0 sm:max-w-[900px] sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[#e1e5eb] px-4 py-4 sm:px-6">
          <h2 className="min-w-0 break-words text-lg font-bold">{name}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="shrink-0 text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </header>

        {!data && loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-[#586174]">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-[#586174]">
            <CircleAlert className="h-10 w-10 text-[#e57373]" />
            <p>
              {t("Не удалось выполнить запрос")}: {t(error)}
            </p>
            <button type="button" onClick={reload} className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]">
              {t("Повторить")}
            </button>
          </div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:px-6">
              <span className="font-semibold text-[#586174]">{t("Общая сумма")}:</span>
              {data.currencies.length ? (
                data.currencies.map((item, index) => (
                  <span key={item.currency}>
                    <BalanceAmount value={item.amount} currency={currencyLabel(item.currency)} />
                    {index < data.currencies.length - 1 ? "," : ""}
                  </span>
                ))
              ) : (
                <span>0</span>
              )}
            </div>

            <div className={`border-t border-[#efefef] transition-opacity ${loading ? "opacity-60" : ""}`}>
              <div className="hidden grid-cols-12 gap-3 border-b border-[#efefef] px-6 py-3 text-[13px] font-semibold text-[#666] md:grid">
                <span className="col-span-1">{t("№")}</span>
                <span className="col-span-2">{t("Касса")}</span>
                <span className="col-span-2">{t("Дата")}</span>
                <span className="col-span-4">{t("Описание")}</span>
                <span className="col-span-3 text-right">{t("Сумма")}</span>
              </div>
              {data.rows.length ? (
                <div className="md:max-h-[424px] md:overflow-y-auto">
                  {data.rows.map((row) => (
                    <DetailRow key={row.key} row={row} base={base} language={language} rowLink={rowLinks} />
                  ))}
                </div>
              ) : (
                <p className="px-6 py-16 text-center text-[13px] text-[#666]">{t("Нет операций за период")}</p>
              )}
            </div>

            <footer className="mt-auto flex justify-end border-t border-[#efefef] px-4 py-3 sm:px-6">
              <BalancePagination page={page} pageSize={pageSize} count={data.count} sizes={DETAIL_PAGE_SIZES} onChange={onPageChange} />
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function DetailRow({ row, base, language, rowLink }: { row: ExpenseDetailRow; base: string; language: string; rowLink: boolean }) {
  const { t } = useLanguage()
  const href = cashOperationHref(row.docNo)
  const open = () => {
    if (href) window.open(href, "_blank", "noopener")
  }
  const lines: Array<[string, string]> = [
    ["Описание", t(row.title)],
    ["Категория", row.category],
    ["Клиент", row.client],
    ["Поставщик", row.supplier],
    ["Филиал", row.branch],
    ["Организация", row.organization],
    ["Комментарий", row.comment],
  ]
  const clickable = rowLink && Boolean(href)
  return (
    <div
      onClick={clickable ? open : undefined}
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-dotted border-[#dbe0e8] px-4 py-3 text-[14px] last:border-b-0 sm:px-6 md:grid-cols-12 md:items-center md:gap-3 ${
        clickable ? "cursor-pointer hover:bg-[#f2f5f8]" : ""
      }`}
    >
      <span className="font-semibold md:col-span-1 md:font-normal">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event: MouseEvent) => event.stopPropagation()}
            title={t("Открыть в кассе")}
            className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline"
          >
            {row.docNo}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          "—"
        )}
      </span>
      <span className="min-w-0 break-words text-[#586174] md:col-span-2 md:text-[#17233b]">
        {row.cashbox}
        <span className="text-[#9aa3b6] md:hidden"> · {row.date ? formatStatementDate(row.date, language) : "—"}</span>
      </span>
      <span className="hidden md:col-span-2 md:block">{row.date ? formatStatementDate(row.date, language) : "—"}</span>
      <div className="col-span-2 min-w-0 text-[13px] leading-5 text-[#586174] md:col-span-4">
        {lines
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <p key={label} className="break-words">
              <span className="text-[#9aa3b6]">{t(label)}:</span> {value}
            </p>
          ))}
      </div>
      <div className="col-span-2 text-right md:col-span-3">
        <BalanceAmount value={row.amount} currency={currencyLabel(row.currency)} />
        {row.currency !== base && row.baseAmount !== null && (
          <p className="whitespace-nowrap text-[13px] text-[#586174]">
            {formatMoney(row.baseAmount)} {currencyLabel(base)}
            {row.rate ? <span className="ml-1 text-[12px] text-[#9aa3b6]">({formatMoney(row.rate, 5)})</span> : null}
          </p>
        )}
      </div>
    </div>
  )
}
