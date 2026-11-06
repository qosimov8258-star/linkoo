"use client"

import type { ReactNode } from "react"

import { refDate } from "@/lib/ref-date"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// The detail card the reference ("Маркетинговые акции", #/prices/<id>) opens under a promotion row: title with the
// actions, the flags, the type and audience band with the dates and conditions, then the products — purchase and gift
// tables of a bonus, the product / value table of a discount, mark-up or points promotion, the percentages of a
// cashback. It renders the reference's own promotion document (`ref`, imported by scripts/linko-sync).

type Named = { id?: number; name?: string; first_name?: string; second_name?: string }
type PromoProduct = { product?: { id?: number; name?: string }; amount?: string | number | null; type?: string | number }
type CashbackCondition = { limit_from?: string | number; percent?: string | number }
export type PromoRef = {
  id: number
  type?: string
  name?: string
  discount?: string | number | null
  begin_date?: string
  till_date?: string
  total_amount?: string | number | null
  bonus_type?: string
  promotion_type?: string
  discount_type?: string
  is_apply_all?: boolean
  agents?: Named[]
  branches?: Named[]
  market_types?: Named[]
  stocks?: Named[]
  price_lists?: Named[]
  payment_types?: (Named | string)[]
  market_classes?: Named[]
  channel_categories?: Named[]
  borders?: Named[]
  brands?: Named[]
  products?: PromoProduct[]
  cashback_type?: string | null
  cashback_percent?: string | number | null
  cashback_conditions?: CashbackCondition[]
  order_price_from?: string | number | null
  order_price_to?: string | number | null
  product_amount_from?: string | number | null
  product_amount_to?: string | number | null
  calc_in_box?: boolean
  give_bonus_only_once?: boolean
  bonus_least_condition?: boolean
  is_condition_set?: boolean
  is_approved?: boolean
  show_advert?: boolean
}

const BLUE = "#1E4A9A"

const asNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** "1 000 000", "15", "0,5": the reference prints these values with space thousands and no trailing zeros. */
function plain(value: unknown): string {
  const n = asNumber(value)
  const [int, frac] = String(Math.round(n * 1000) / 1000).split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return frac ? `${grouped},${frac}` : grouped
}

const personName = (item: Named) => item.name ?? [item.first_name, item.second_name].filter(Boolean).join(" ")
const names = (items: (Named | string)[] | undefined) => (items ?? []).map((item) => (typeof item === "string" ? item : personName(item))).filter(Boolean)

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[16px] w-[16px] align-[-3px]" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#59c26a" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconButton({ path, label }: { path: string; label: string }) {
  return (
    <span title={label} aria-label={label} className="flex h-6 w-6 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={path} /></svg>
    </span>
  )
}

const COPY = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
const EDIT = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const DELETE = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"

function ProductTable({ head, rows, withAmount, footer }: { head: ReactNode; rows: { name: string; amount: string }[]; withAmount: boolean; footer?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div>
      {head}
      <div className="mt-[12px] overflow-hidden rounded-[10px] border border-[#e6eaee]">
        <div className="flex h-[34px] items-center border-b border-[#e6eaee] bg-[#f8fafb] px-[15px] text-[11px] font-medium uppercase tracking-[0.4px] text-[#8a94a0]">
          <span className="w-[48px]">ID</span>
          <span className="flex-1">{t("НАИМЕНОВАНИЕ")}</span>
          {withAmount ? <span className="w-[116px]">{t("КОЛ-ВО")}</span> : null}
        </div>
        <div className="px-[15px] py-[6px]">
          {rows.map((row, index) => (
            <div key={index} className="flex min-h-[33px] items-center border-b border-[#eef1f4] text-[13px] text-[#333] last:border-b-0">
              <span className="w-[48px] text-[#8a94a0]">№{index + 1}</span>
              <span className="flex-1 py-[6px]">{row.name}</span>
              {withAmount ? <span className="w-[116px]">{row.amount}</span> : null}
            </div>
          ))}
        </div>
        {footer ? <div className="flex h-[37px] items-center justify-end border-t border-[#e6eaee] bg-[#f8fafb] px-[15px] text-[13px] text-[#333]">{footer}</div> : null}
      </div>
    </div>
  )
}

export function PromoDetail({ promo, onClose }: { promo: PromoRef; onClose?: () => void }) {
  const { t, language } = useLanguage()
  const products = promo.products ?? []
  const buy = products.filter((item) => String(item.type) === "1")
  const gifts = products.filter((item) => String(item.type) === "2")
  const isBonus = promo.type === "bonus"
  const isCashback = promo.type === "cash_back"
  const sumKind = promo.discount_type === "percent" ? "Процент" : "Сумма"

  const typeLabel = (() => {
    if (isBonus) {
      const mode = promo.bonus_type === "auto" ? "Авто" : promo.bonus_type === "auto_for_price" ? "Авто от суммы заказа" : "Ручной"
      return `${t("Бонус")} (${t(mode)})`
    }
    if (promo.type === "discount") return `${t("Скидка")} (${t(sumKind)})`
    if (promo.type === "addup") return `${t("Надбавка")} (${t(sumKind)})`
    if (promo.type === "ball") return `${t("Балл")} (${t("Балл")})`
    if (isCashback) return t("Кэшбек")
    return promo.type ?? ""
  })()

  const audience = (() => {
    switch (promo.promotion_type) {
      case "promotion_agents":
        return `${t("Действует для агентов")}: ${names(promo.agents).join(", ")}`
      case "promotion_branches":
        return `${t("Действует для филиалов")}: ${names(promo.branches).join(", ")}`
      case "promotion_one":
      case "promotion_market_types":
        return t("Действует для выбранных клиентов")
      default:
        return t("Действует для всех")
    }
  })()

  const conditions: { label: string; values: string[] }[] = [
    { label: "Для прайс-листов", values: names(promo.price_lists) },
    { label: "Для складов", values: names(promo.stocks) },
    { label: "Для типов оплаты", values: names(promo.payment_types) },
    { label: "Для классов клиентов", values: names(promo.market_classes) },
    { label: "Для категорий канала", values: names(promo.channel_categories) },
    { label: "Для территорий", values: names(promo.borders) },
    { label: "Для брендов", values: names(promo.brands) },
  ].filter((row) => row.values.length > 0)
  const clientTypes = names(promo.market_types)

  const flags: ReactNode[] = []
  if (asNumber(promo.product_amount_from) || asNumber(promo.product_amount_to)) {
    flags.push(<span key="qf">{t("Количество от")}: <b>{plain(promo.product_amount_from)} {t("ед.")}</b></span>)
    flags.push(<span key="qt">{t("Количество до")}: <b>{plain(promo.product_amount_to)} {t("ед.")}</b></span>)
  }
  if (asNumber(promo.order_price_from) || asNumber(promo.order_price_to)) {
    flags.push(<span key="pf">{t("При заказе от")}: <b>{plain(promo.order_price_from)}</b></span>)
    flags.push(<span key="pt">{t("При заказе до")}: <b>{plain(promo.order_price_to)}</b></span>)
    flags.push(<b key="ps">({t("Сумма выбранных продуктов")})</b>)
  }
  if (isBonus && promo.calc_in_box) flags.push(<span key="box">{t("Считать в блоке")}: <Check /></span>)
  if (isBonus && promo.bonus_least_condition) flags.push(<span key="least">{t("За наименьшее из бонусов")}: <Check /></span>)
  if (isBonus && promo.give_bonus_only_once) flags.push(<span key="once">{t("Подарок один раз за заказ")}: <Check /></span>)

  const valueHead = promo.type === "ball" ? "Балл" : sumKind
  const buyWithAmount = Boolean(promo.is_condition_set) || buy.some((item) => asNumber(item.amount) > 0)
  const totalAmount = asNumber(promo.total_amount)
  const productName = (item: PromoProduct) => item.product?.name ?? ""

  return (
    <div className="-mx-[15px] bg-[#f2f5f8] py-[20px]" onClick={(event) => event.stopPropagation()}>
      <div className="rounded-[4px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className="flex items-start justify-between px-[30px] pt-[22px]">
          <button type="button" onClick={onClose} className="text-left text-[18px] font-semibold leading-[24px] text-[#333]">
            № {promo.id} | {promo.name}
          </button>
          <div className="flex items-center gap-[14px] pr-[2px]">
            {isCashback ? (
              <>
                <span className="flex h-[30px] items-center gap-2 rounded-[4px] bg-[#6fcf7f] px-[14px] text-[13px] font-semibold text-white">{t("Пересчитать доп.условия")}</span>
                <span className="flex h-[30px] items-center gap-2 rounded-[4px] bg-[#f5806b] px-[14px] text-[13px] font-semibold text-white">{t(promo.is_approved ? "Снять подтверждения" : "Подтвердить")}</span>
              </>
            ) : null}
            <span className="flex h-[30px] items-center gap-[8px] rounded-[4px] px-[14px] text-[13px] font-semibold text-white" style={{ background: BLUE }}>
              <Check />
              {t("Предлагать агентам")}
            </span>
            <span className="ml-[16px] flex items-center gap-[30px]">
              <IconButton path={COPY} label={t("Копировать")} />
              <IconButton path={EDIT} label={t("Изменить")} />
              <IconButton path={DELETE} label={t("Удалить")} />
            </span>
          </div>
        </div>
        {flags.length ? <div className="flex flex-wrap items-center gap-x-[8px] gap-y-1 px-[30px] pt-[14px] text-[13px] text-[#333]">{flags}</div> : null}

        <div className="mt-[14px] bg-[#f2f5f8] px-[30px] py-[14px] text-[13px] text-[#333]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <b className="text-[16px] font-semibold" style={{ color: BLUE }}>{typeLabel}</b>
              <span> | {audience}</span>
              {isCashback ? <span>| {t(promo.cashback_type === "order" ? "От суммы заказа" : "От суммы оплаты")}</span> : null}
            </div>
            <div className="flex shrink-0 gap-[30px] text-[13px] text-[#333]">
              <span>{t("Начало акции")}: <b className="text-[#8a94a0]">{formatDateText(refDate(promo.begin_date), language)}</b></span>
              <span>{t("Завершение акции")}: <b className="text-[#8a94a0]">{formatDateText(refDate(promo.till_date), language)}</b></span>
            </div>
          </div>
          {clientTypes.length ? (
            <div className="mt-[12px]">
              <b>{t("Действует для клиентов")}:</b>
              <div className="mt-[8px]">{t("Для типов")} :&nbsp;&nbsp;<b>{clientTypes.join(", ")}</b></div>
            </div>
          ) : null}
          {conditions.length ? (
            <div className="mt-[12px]">
              <b>{t("Условия акции")}:</b>
              {conditions.map((row) => (
                <div key={row.label} className="mt-[8px]">{t(row.label)} :&nbsp;&nbsp;<b>{row.values.join(", ")}</b></div>
              ))}
            </div>
          ) : null}
          {!clientTypes.length && !conditions.length ? <div className="h-[30px]" /> : null}
        </div>

        <div className="px-[30px] pb-[26px] pt-[20px]">
          {isCashback ? (
            <div className="text-[13px] text-[#333]">
              <div>{t("Основной процент кэшбэка")}:</div>
              <b className="mt-1 block text-[16px]">{plain(promo.cashback_percent)} %</b>
              {(promo.cashback_conditions ?? []).length ? (
                <div className="mt-[16px] max-w-[640px]">
                  <b className="text-[14px]">{t("Дополнительные условия")}</b>
                  <div className="mt-[10px] grid grid-cols-2 border-b border-[#e6eaee] pb-[8px] text-[12px] font-semibold text-[#8a94a0]">
                    <span>{t("Начиная с накопленной суммы")}</span>
                    <span>{t("Дополнительный процент")}</span>
                  </div>
                  {(promo.cashback_conditions ?? []).map((row, index) => (
                    <div key={index} className="grid h-[34px] grid-cols-2 items-center border-b border-[#eef1f4]">
                      <span>{plain(row.limit_from)}</span>
                      <span>{plain(row.percent)} %</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : isBonus ? (
            <div className="grid grid-cols-2 gap-[20px]">
              <ProductTable
                head={
                  <>
                    <h4 className="text-[13px] font-semibold uppercase tracking-[0.5px] text-[#333]">{t("ТОВАРЫ ДЛЯ ЗАКУПА")}</h4>
                    {promo.calc_in_box ? <div className="mt-[10px] text-[13px] text-[#333]">{t("Считать в блоке")} <Check /></div> : null}
                    {promo.bonus_least_condition ? <div className="mt-[10px] text-[13px] text-[#333]">{t("За наименьшее из бонусов")} <Check /></div> : null}
                  </>
                }
                rows={buy.map((item) => ({ name: productName(item), amount: plain(item.amount) }))}
                withAmount={buyWithAmount}
                footer={totalAmount > 0 ? <span>{t("Общее количество")}: <b>{plain(totalAmount)} {t("шт")}</b></span> : undefined}
              />
              <ProductTable
                head={
                  <>
                    <h4 className="text-[13px] font-semibold uppercase tracking-[0.5px] text-[#333]">{t("ТОВАР В ПОДАРОК")}</h4>
                    {promo.give_bonus_only_once ? <div className="mt-[10px] text-[13px] text-[#333]">{t("Подарок один раз за заказ")} <Check /></div> : null}
                  </>
                }
                rows={gifts.map((item) => ({ name: productName(item), amount: plain(item.amount) }))}
                withAmount
              />
            </div>
          ) : promo.is_apply_all ? (
            <p className="py-[6px] text-center text-[13px] font-semibold text-[#333]">
              {t("Скидка действует всем товарам по")}{plain(promo.discount)}
            </p>
          ) : buy.length ? (
            <div className="text-[13px] text-[#333]">
              <div className="grid grid-cols-[110px_1fr_340px] border-b border-[#e6eaee] pb-[12px] font-semibold">
                <span>№</span>
                <span>{t("Товар")}</span>
                <span>{t(valueHead)}</span>
              </div>
              {buy.map((item, index) => (
                <div key={index} className="grid min-h-[44px] grid-cols-[110px_1fr_340px] items-center border-b border-[#eef1f4] last:border-b-0">
                  <span>{index + 1}</span>
                  <span>{productName(item)}</span>
                  <span>{plain(item.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
