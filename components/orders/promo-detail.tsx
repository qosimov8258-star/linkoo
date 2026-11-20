"use client"

import { useState, type ReactNode } from "react"

import { askDelete } from "@/lib/ask-confirm"
import { notify } from "@/lib/notify"
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
  bonus_each_condition_separately?: boolean
  give_in_box?: boolean
  give_only_for_max_remain?: boolean
  bonus_by_max_remain?: boolean
  check_by_order_price?: boolean
  product_box_amount_from?: string | number | null
  product_box_amount_to?: string | number | null
  product_weight_from?: string | number | null
  product_weight_to?: string | number | null
  bonus_fund?: string | number | null
  created_date?: string
  division?: Named | null
  currency?: Named | null
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

function IconButton({ path, label, onClick, disabled }: { path: string; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={`flex h-6 w-6 items-center justify-center ${onClick ? "" : "cursor-default"}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={path} /></svg>
    </button>
  )
}

/** Linko's bodyTitle chip of the card's first row (a bold value in it). */
function Chip({ children }: { children: ReactNode }) {
  return <div className="mb-[12px] mr-[8px] inline-block rounded-[8px] border border-[#e4e9ee] bg-[#f7f9fb] px-[12px] py-[6px] text-[13px] leading-[17px] text-[#333] [&_b]:font-semibold">{children}</div>
}

/** Linko's partTitle: a hairline, then the small grey uppercase heading. */
const PART_TITLE = "mt-[14px] w-full border-t border-[#e4e9ee] pt-[12px] text-[11px] font-bold uppercase tracking-[0.5px] text-[#8a97a3]"
const AUTORENEW = "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
const CARD = "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"
const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** The white glyph of a Linko header button. */
function ButtonIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden>
      <path d={path} />
    </svg>
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
          {withAmount ? <span className="w-[100px]">{t("КОЛ-ВО")}</span> : null}
        </div>
        <div className="px-[15px] py-[6px]">
          {rows.map((row, index) => (
            <div key={index} className="flex min-h-[33px] items-center border-b border-[#eef1f4] text-[13px] text-[#333] last:border-b-0">
              <span className="w-[48px] text-[#8a94a0]">№{index + 1}</span>
              <span className="flex-1 py-[6px]">{row.name}</span>
              {withAmount ? <span className="w-[100px]">{row.amount}</span> : null}
            </div>
          ))}
        </div>
        {footer ? <div className="flex h-[37px] items-center justify-end border-t border-[#e6eaee] bg-[#f8fafb] px-[15px] text-[13px] text-[#333]">{footer}</div> : null}
      </div>
    </div>
  )
}

export function PromoDetail({ promo, onClose, onDeleted }: { promo: PromoRef; onClose?: () => void; onDeleted?: () => void }) {
  const { t, language } = useLanguage()
  const [deleting, setDeleting] = useState(false)

  // «Отменить»: Linko's delete confirmation (the promotion's name), then the promotion is removed from the list.
  async function remove() {
    if (deleting || !(await askDelete(promo.name ?? ""))) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/ref-records/promo/${promo.id}`, { method: "DELETE" })
      if (response.ok) onDeleted?.()
      else {
        const body = (await response.json().catch(() => ({}))) as { error?: unknown }
        notify(t(typeof body.error === "string" && body.error ? body.error : "Не удалось сохранить изменения на сервере"))
      }
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setDeleting(false)
    }
  }
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

  // Linko's first row of chips, in its order (for every promotion type).
  const flags: ReactNode[] = []
  const has = (value: unknown) => value !== null && value !== undefined && value !== ""
  if (has(promo.product_amount_from)) flags.push(<Chip key="qf">{t("Количество от")}: <b>{plain(promo.product_amount_from)} {t("ед.")}</b></Chip>)
  if (has(promo.product_amount_to)) flags.push(<Chip key="qt">{t("Количество до")}: <b>{plain(promo.product_amount_to)} {t("ед.")}</b></Chip>)
  if (has(promo.product_box_amount_from)) flags.push(<Chip key="bf">{t("От")}: <b>{plain(promo.product_box_amount_from)} {t("блок")}</b></Chip>)
  if (has(promo.product_box_amount_to)) flags.push(<Chip key="bt">{t("До")}: <b>{plain(promo.product_box_amount_to)} {t("блок")}</b></Chip>)
  if (asNumber(promo.order_price_from)) flags.push(<Chip key="pf">{t("При заказе от")}: <b>{plain(promo.order_price_from)}</b></Chip>)
  if (asNumber(promo.order_price_to)) flags.push(<Chip key="pt">{t("При заказе до")}: <b>{plain(promo.order_price_to)}</b></Chip>)
  if (asNumber(promo.order_price_from) || asNumber(promo.order_price_to)) flags.push(<Chip key="ps"><b>({t(promo.check_by_order_price ? "Сумма всего заказа" : "Сумма выбранных продуктов")})</b></Chip>)
  if (asNumber(promo.product_weight_from)) flags.push(<Chip key="wf">{t("Вес от")}: <b>{plain(promo.product_weight_from)}</b></Chip>)
  if (asNumber(promo.product_weight_to)) flags.push(<Chip key="wt">{t("Вес до")}: <b>{plain(promo.product_weight_to)}</b></Chip>)
  if (asNumber(promo.bonus_fund)) flags.push(<Chip key="fund">{t("Фонд")}: <b>{plain(promo.bonus_fund)}{isBonus ? ` ${t("шт.")}` : ""}</b></Chip>)
  const checks: [boolean | undefined, string][] = [
    [promo.bonus_each_condition_separately, "Будем давать только один продукт для одного условия (Например: 10+1):"],
    [promo.calc_in_box, "Считать в блоке:"],
    [promo.give_in_box, "Считать в блоке (Подарок):"],
    [promo.bonus_least_condition, "За наименьшее из бонусов:"],
    [promo.give_only_for_max_remain, "Только продукт с наибольшим остатком из выбранных:"],
    [promo.bonus_by_max_remain, "Добавить по остатку:"],
    [promo.give_bonus_only_once, "Подарок один раз за заказ:"],
  ]
  for (const [on, label] of checks) if (on) flags.push(<Chip key={label}>{t(label)}<span className="ml-[6px]"><Check /></span></Chip>)

  const valueHead = promo.type === "ball" ? "Балл" : sumKind
  const buyWithAmount = Boolean(promo.is_condition_set) || buy.some((item) => asNumber(item.amount) > 0)
  const totalAmount = asNumber(promo.total_amount)
  const productName = (item: PromoProduct) => item.product?.name ?? ""

  return (
    <div className="-mx-[15px] bg-[#f2f5f8] py-[20px]" onClick={(event) => event.stopPropagation()}>
      <div className="rounded-[4px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className="flex items-start justify-between px-[30px] pt-[22px]">
          <button type="button" onClick={onClose} className="text-left text-[18px] font-bold leading-[24px] text-[#333]">
            № {promo.id} | {promo.name}
          </button>
          <div className="flex items-center gap-[14px] pr-[2px]">
            {isCashback ? (
              <>
                <span className="flex h-[30px] items-center gap-2 rounded-[4px] bg-[#6fcf7f] px-[14px] text-[13px] font-semibold text-white"><ButtonIcon path={AUTORENEW} />{t("Пересчитать доп.условия")}</span>
                <span className="flex h-[30px] items-center gap-2 rounded-[4px] bg-[#f5806b] px-[14px] text-[13px] font-semibold text-white"><ButtonIcon path={CARD} />{t(promo.is_approved ? "Снять подтверждения" : "Подтвердить")}</span>
              </>
            ) : null}
            <span className="flex h-[30px] items-center gap-[8px] rounded-[4px] px-[14px] text-[13px] font-semibold text-white" style={{ background: BLUE }}>
              <ButtonIcon path={CHECK_CIRCLE} />
              {t("Предлагать агентам")}
            </span>
            <span className="ml-[16px] flex items-center gap-[30px]">
              <IconButton path={COPY} label={t("Дублируйте этот акции")} />
              <IconButton path={EDIT} label={t("Изменить")} />
              <IconButton path={DELETE} label={t("Отменить")} onClick={() => void remove()} disabled={deleting} />
            </span>
          </div>
        </div>
        {flags.length ? <div className="flex flex-wrap items-center px-[30px] pt-[14px]">{flags}</div> : null}

        {/* Linko's «details» band: the type and audience, the dates stacked on the right. */}
        <div className={`mx-[30px] ${flags.length ? "mt-[2px]" : "mt-[14px]"} flex items-start justify-between gap-[24px] rounded-[10px] border border-[#e4e9ee] bg-[#f7f9fb] px-[20px] py-[16px] text-[13px] leading-[1.5] text-[#333]`}>
          <div className="min-w-0 flex-auto">
            <div>
              <b className="text-[16px] font-bold" style={{ color: BLUE }}>{typeLabel}</b>
              <span> | {audience}</span>
              {isCashback ? <span>| {t(promo.cashback_type === "order" ? "От суммы заказа" : "От суммы оплаты")}</span> : null}
            </div>
          {clientTypes.length ? (
            <div>
              <div className={PART_TITLE}>{t("Действует для клиентов")}:</div>
              <div className="mt-[5px]"><span className="mr-[6px] text-[#6b7885]">{t("Для типов")} :</span><b className="font-semibold">{clientTypes.join(", ")}</b></div>
            </div>
          ) : null}
          {conditions.length ? (
            <div>
              <div className={PART_TITLE}>{t("Условия акции")}:</div>
              {conditions.map((row) => (
                <div key={row.label} className="mt-[5px]"><span className="mr-[6px] text-[#6b7885]">{t(row.label)} :</span><b className="font-semibold">{row.values.join(", ")}</b></div>
              ))}
            </div>
          ) : null}
          </div>
          <div className="flex shrink-0 gap-[24px] text-[12px] text-[#8a97a3]">
            <div>
              {t("Начало акции")}:
              <span className="mt-[2px] block text-[14px] font-semibold text-[#333]">{formatDateText(refDate(promo.begin_date), language)}</span>
            </div>
            <div>
              {t("Завершение акции")}:
              <span className="mt-[2px] block text-[14px] font-semibold text-[#333]">{formatDateText(refDate(promo.till_date), language)}</span>
            </div>
          </div>
        </div>

        <div className="px-[30px] pb-[26px] pt-[20px]">
          {isCashback ? (
            <div className="text-[13px] text-[#333]">
              <div className="mb-[14px] text-[15px] font-bold">{t("Основной процент кэшбэка")}:&nbsp; {plain(promo.cashback_percent)} %</div>
              {(promo.cashback_conditions ?? []).length ? (
                <div className="mt-[28px]">
                  <div className="mb-[14px] text-[15px] font-bold">{t("Дополнительные условия")}</div>
                  <div className="mt-[12px] overflow-hidden rounded-[10px] border border-[#e4e9ee]">
                    <div className="flex items-center gap-[8px] border-b border-[#e4e9ee] bg-[#f7f9fb] px-[15px] pb-[8px] pt-[10px] text-[11px] uppercase tracking-[0.5px] text-[#8a97a3]">
                      <span className="min-w-0 flex-1">{t("Начиная с накопленной суммы")}</span>
                      <span className="min-w-0 flex-1">{t("Дополнительный процент")}</span>
                    </div>
                    <div className="px-[15px] pb-[12px] pt-[6px]">
                      {(promo.cashback_conditions ?? []).map((row, index) => (
                        <div key={index} className="flex items-center gap-[8px] border-b border-dotted border-[#efefef] py-[8px] last:border-b-0">
                          <span className="min-w-0 flex-1">{plain(row.limit_from)}</span>
                          <span className="min-w-0 flex-1">{plain(row.percent)} %</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : isBonus ? (
            <div className="grid grid-cols-2 gap-[20px]">
              <ProductTable
                head={
                  <>
                    <h4 className="text-[13px] font-semibold uppercase tracking-[0.5px] text-[#333]">{t("ТОВАРЫ ДЛЯ ЗАКУПА")}</h4>
                    {promo.calc_in_box ? <div className="-mb-[12px] mt-[12px]"><Chip>{t("Считать в блоке")}<span className="ml-[6px]"><Check /></span></Chip></div> : null}
                    {promo.bonus_least_condition ? <div className="-mb-[12px] mt-[12px]"><Chip>{t("За наименьшее из бонусов")}<span className="ml-[6px]"><Check /></span></Chip></div> : null}
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
                    {promo.give_bonus_only_once ? <div className="-mb-[12px] mt-[12px]"><Chip>{t("Подарок один раз за заказ")}<span className="ml-[6px]"><Check /></span></Chip></div> : null}
                  </>
                }
                rows={gifts.map((item) => ({ name: productName(item), amount: plain(item.amount) }))}
                withAmount
              />
            </div>
          ) : promo.is_apply_all ? (
            <div className="rounded-[10px] border border-[#d6e0f7] bg-[#eef2fb] px-[20px] py-[14px] text-center text-[13px] font-semibold text-[#33415c]">
              {t("Скидка действует всем товарам по")}{plain(promo.discount)} {promo.discount_type !== "static" ? "%" : (promo.currency?.name ?? "")}
            </div>
          ) : buy.length ? (
            <div className="overflow-hidden rounded-[10px] border border-[#e4e9ee] text-[13px] text-[#333]">
              <div className="flex items-center gap-[8px] border-b border-[#e4e9ee] bg-[#f7f9fb] px-[15px] pb-[8px] pt-[10px] text-[11px] uppercase tracking-[0.5px] text-[#8a97a3]">
                <span className="w-[40px] shrink-0">№</span>
                <span className="min-w-0 flex-1">{t("Товар")}</span>
                <span className="w-[100px] shrink-0">{t(valueHead)}</span>
              </div>
              <div className="px-[15px] pb-[12px] pt-[6px]">
                {buy.map((item, index) => (
                  <div key={index} className="flex items-center gap-[8px] border-b border-dotted border-[#efefef] py-[8px] last:border-b-0">
                    <span className="w-[40px] shrink-0 text-[#8a97a3]">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{productName(item)}</span>
                    <span className="w-[100px] shrink-0">{plain(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
