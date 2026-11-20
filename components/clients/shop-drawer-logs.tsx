"use client"

import { useEffect, useState } from "react"

import { formatStatementDate } from "@/lib/finance/dates"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { readShopDrawerParam, writeShopDrawerParams } from "./shop-drawer-url"

// КЛИЕНТ → ЛОГИ and ДОГОВОРЫ of the shop drawer, as Linko's: the filter pills Все / Заказ / Возврат / Финансы / Клиент
// (each asks for its type, in Linko's order of that type; the pill and the page live in the address: type=…&dPage=…),
// a pager of 25, the columns Тип / Статус / Кем / Дата создания / Сумма with amounts to the decimals of Настройки →
// Округление сумм (Linko's ROUND_AMOUNT_FOR_CURRENCY; GET /api/clients/[id]/logs); the contracts № / Дата / Организация (GET
// /api/clients/[id]/contracts) with the pager on the right.

type LogRow = { key: string; type: string; action: string; createdBy: string; createdAt: string; totalPrice: number | null; currency: string; comment: string }
type ContractRow = { id: number; number: string; createdAt: string; organization: string }
type Page<T> = { count: number; results: T[] }

const FILTERS: Array<{ label: string; type: string }> = [
  { label: "Все", type: "" },
  { label: "Заказ", type: "order" },
  { label: "Возврат", type: "order_return" },
  { label: "Финансы", type: "client_transaction" },
  { label: "Клиент", type: "market" },
]

const TYPE_LABELS: Record<string, string> = { order: "Заказ", order_return: "Возврат", market: "Клиент", client_transaction: "Оплата" }

type Tone = "success" | "begin" | "error"
const TONES: Record<Tone, string> = { success: "border-[#81c784] text-[#81c784]", begin: "border-[#64b5f6] text-[#64b5f6]", error: "border-[#e57373] text-[#e57373]" }

/** Linko's chip of a log action (its switch: the first case of an action wins, whatever the entry's type). A cancelled
 * return reads «Отменен» here: Linko's switch shows the order's «Заказ отменен» for it too. */
function actionChip(type: string, action: string): { label: string; tone: Tone } | null {
  switch (action) {
    case "market_created":
    case "created":
      return { label: "Создан", tone: "success" }
    case "market_updated":
    case "updated":
      return { label: "Обновленный", tone: "begin" }
    case "market_deleted":
      return { label: "Удален", tone: "error" }
    case "given":
      return { label: "Передан доставщику", tone: "begin" }
    case "cancel_given":
      return { label: "Отменил передачу", tone: "error" }
    case "delivered":
      return { label: "Доставлен", tone: "success" }
    case "undelivered":
      return { label: "Отменена доставка", tone: "error" }
    case "add_discount":
      return { label: "Добавление ручной скидки", tone: "success" }
    case "cancel_discount":
      return { label: "Добавление ручной скидки отменено", tone: "error" }
    case "add_bonus":
      return { label: "Добавлен бонус", tone: "success" }
    case "canceled":
      return { label: type === "order_return" ? "Отменен" : "Заказ отменен", tone: "error" }
    case "accepted_to_stock":
      return { label: "Принят на склад", tone: "begin" }
    case "cancel_accept":
      return { label: "Отменил приемку на склад", tone: "success" }
    case "deleted":
      return { label: "Удаленный", tone: "error" }
    default:
      return null
  }
}

/** Linko's dotted row line (its dottedList: 2 px dots 8 px apart along the row's bottom, over the padding). */
export const DOTTED_ROW =
  "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

const PAGE_SIZES = [10, 25, 50, 100]

/** Linko's round arrows (a circle with a filled triangle), 0.56 black, 0.3 when disabled. */
const ARROW_PATHS = {
  back: "M22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12M14,7L9,12L14,17V7Z",
  next: "M2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12M4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12M10,17L15,12L10,7V17Z",
}

function Pager({
  page,
  pageSize,
  count,
  onPage,
  onPageSize,
  align = "center",
}: {
  page: number
  pageSize: number
  count: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  align?: "center" | "end"
}) {
  const { t } = useLanguage()
  // Linko prints «1 - 0 из 0» for an empty list.
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, count)
  const arrow = (direction: "back" | "next", disabled: boolean, onClick: () => void) => (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={t(direction === "back" ? "Назад" : "Вперед")} className="flex h-[24px] w-[24px] items-center justify-center disabled:cursor-default">
      <svg viewBox="0 0 24 24" className={`h-[24px] w-[24px] ${disabled ? "fill-black/30" : "fill-black/[0.56]"}`}>
        <path d={ARROW_PATHS[direction]} />
      </svg>
    </button>
  )
  return (
    <div className={`flex items-center gap-[20px] text-[#666] ${align === "end" ? "justify-end" : "justify-center"}`}>
      <label className="relative flex items-center">
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label={t("Количество строк")} className="appearance-none bg-transparent pr-[28px] text-[13px] text-[#333] outline-none">
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 h-[24px] w-[24px] fill-[#e0e0e0]">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </label>
      <span>
        {first} - {last} {t("из")} {count}
      </span>
      <span className="flex gap-[5px]">
        {arrow("back", page <= 1, () => onPage(page - 1))}
        {arrow("next", last >= count, () => onPage(page + 1))}
      </span>
    </div>
  )
}

function usePage<T>(url: string): { data: Page<T> | null; error: string } {
  const [state, setState] = useState<{ url: string; data: Page<T> | null; error: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (Page<T> & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error || "Не удалось загрузить данные")
        setState({ url, data: body, error: "" })
      })
      .catch((cause: Error) => {
        if (cause.name !== "AbortError") setState({ url, data: null, error: cause.message })
      })
    return () => controller.abort()
  }, [url])
  return state?.url === url ? { data: state.data, error: state.error } : { data: null, error: "" }
}

const LOG_TYPES = FILTERS.map((filter) => filter.type)

export function ShopLogsTab({ clientId }: { clientId: number }) {
  const { t, language } = useLanguage()
  // The pill and the page come from the address (Linko's type / dPage), so a link or a reload shows the same list.
  const [type, setTypeState] = useState(() => {
    const value = readShopDrawerParam("type") ?? ""
    return LOG_TYPES.includes(value) ? value : ""
  })
  const [page, setPageState] = useState(() => {
    const value = Number(readShopDrawerParam("dPage"))
    return Number.isInteger(value) && value > 0 && value < 100_000 ? value : 1
  })
  const [pageSize, setPageSize] = useState(25)
  const setType = (next: string) => {
    setTypeState(next)
    setPageState(1)
    writeShopDrawerParams({ type: next || null, dPage: "1" })
  }
  const setPage = (next: number) => {
    setPageState(next)
    writeShopDrawerParams({ dPage: String(next) })
  }
  const { data, error } = usePage<LogRow>(`/api/clients/${clientId}/logs?${new URLSearchParams({ ...(type ? { type } : {}), page: String(page), pageSize: String(pageSize) })}`)
  // Linko's bootstrap row: columns of 2/3/2/3/2 twelfths over the row and its 8 px gutters, so a long amount wraps.
  const row = `-mx-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] [&>*]:px-2 ${DOTTED_ROW}`
  return (
    <div>
      <div className="flex flex-wrap items-center justify-center pt-[20px]">
        <b className="font-semibold">{t("Фильтры")}: </b>
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => setType(filter.type)}
            className={`ml-[10px] flex items-center rounded-[20px] border px-[15px] py-[4px] ${type === filter.type ? "border-[#1E4A9A] bg-[#1E4A9A] text-white" : "border-[#E5E8F1] hover:border-[#1E4A9A] hover:bg-[#1E4A9A] hover:text-white"}`}
          >
            {t(filter.label)}
          </button>
        ))}
      </div>
      <div className="mt-[12px]">
        <Pager page={page} pageSize={pageSize} count={data?.count ?? 0} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />
      </div>
      <div className={`${row} mt-[15px] py-[20px] font-semibold`}>
        <span>{t("Тип")}</span>
        <span>{t("Статус")}</span>
        <span>{t("Кем")}</span>
        <span>{t("Дата создания")}</span>
        <span>{t("Сумма")}</span>
      </div>
      {data === null ? (
        <p className="mt-[40px] text-center text-[#888]">{error ? t(error) : t("Загрузка...")}</p>
      ) : data.results.length === 0 ? (
        <p className="mt-[50px] text-center">{t("Ничего не найдено")}</p>
      ) : (
        data.results.map((log) => {
          const chip = actionChip(log.type, log.action)
          return (
            <div key={log.key} className={`${row} min-h-[72px] items-center py-[10px]`}>
              <span className="break-words">
                {t(TYPE_LABELS[log.type] ?? log.type)}
                {log.comment && (
                  <>
                    <br />
                    {log.comment}
                  </>
                )}
              </span>
              <span>{chip ? <span className={`flex justify-center rounded-[15px] border px-[7px] py-[1px] text-center ${TONES[chip.tone]}`}>{t(chip.label)}</span> : t("Не установлен")}</span>
              <span className="break-words">{log.createdBy.trim() || t("Не указан")}</span>
              <span>{log.createdAt ? formatStatementDate(log.createdAt, language, true) : ""}</span>
              <span>
                {formatMoney(log.totalPrice ?? 0)}
                {log.currency ? ` ${log.currency}` : ""}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

export function ShopContractsTab({ clientId }: { clientId: number }) {
  const { t, language } = useLanguage()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const { data, error } = usePage<ContractRow>(`/api/clients/${clientId}/contracts?page=${page}&pageSize=${pageSize}`)
  const row = `-mx-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] [&>*]:px-2 ${DOTTED_ROW}`
  return (
    <div className="pt-[13px]">
      <Pager align="end" page={page} pageSize={pageSize} count={data?.count ?? 0} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />
      <div className={`${row} mt-4 py-[18px] font-semibold`}>
        <span>№</span>
        <span>{t("Дата")}</span>
        <span>{t("Организация")}</span>
      </div>
      {data === null ? (
        <p className="mt-[40px] text-center text-[#888]">{error ? t(error) : t("Загрузка...")}</p>
      ) : data.results.length === 0 ? (
        <p className="mt-[50px] text-center">{t("Ничего не найдено")}</p>
      ) : (
        data.results.map((contract) => (
          <div key={contract.id} className={`${row} min-h-[56px] items-center`}>
            <span>{contract.number}</span>
            <span>{contract.createdAt ? formatStatementDate(contract.createdAt, language, true) : ""}</span>
            <span>{contract.organization || "-"}</span>
          </div>
        ))
      )}
    </div>
  )
}
