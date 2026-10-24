"use client"

import { useRef, useState } from "react"
import { X } from "lucide-react"

import { CheckBox, LineField, LineSelect } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

// Full-screen "Новая акция" form of the reference's "Маркетинговые акции". The left column (type, calculation,
// audience, conditions) and the right panel change with the promotion type exactly like the reference.

export type PromoType = "Скидка" | "Бонус" | "Надбавка" | "Балл" | "Кэшбэк"
export type PromoConfig = {
  type: PromoType
  calc: string
  addMode: string
  audience: string
  cashbackBase: string
  currency: string
  conditions: string[]
  purchase: { bonusSame: boolean; block: boolean; combo: boolean; perItem: boolean; qty: string }
  gift: { once: boolean; fund: string }
  allProducts: boolean
  cashbackPercent: string
  extraFrom: string
  extraPercent: string
}
export type PromoFormValue = { name: string; start: string; end: string; active: boolean; config: PromoConfig }

export const emptyPromoForm = (): PromoFormValue => ({
  name: "",
  start: "",
  end: "",
  active: true,
  config: {
    type: "Бонус",
    calc: "Процент",
    addMode: "Авто",
    audience: "Для всех",
    cashbackBase: "От суммы оплаты",
    currency: "",
    conditions: [],
    purchase: { bonusSame: false, block: false, combo: false, perItem: false, qty: "" },
    gift: { once: false, fund: "" },
    allProducts: false,
    cashbackPercent: "",
    extraFrom: "",
    extraPercent: "",
  },
})

const TYPES: { value: PromoType; label: string }[] = [
  { value: "Скидка", label: "Скидочная акция" },
  { value: "Бонус", label: "Бонусная акция" },
  { value: "Надбавка", label: "Надбавка" },
  { value: "Балл", label: "Балл" },
  { value: "Кэшбэк", label: "Кэшбек" },
]

const COND = {
  price: "Фильтровать по прайс листу",
  stock: "Фильтровать по складу",
  pay: "Фильтровать по тип оплаты",
  cls: "Фильтровать по класс клиента",
  channel: "Фильтровать по категории канала",
  amount: "Фильтровать по сумме заказа",
  limitQty: "Лимит на количество продуктов",
  limitBlock: "Лимит на блок продуктов",
  branch: "Фильтровать по филиалам",
}

function conditionsFor(type: PromoType): string[] {
  if (type === "Бонус") return [COND.price, COND.stock, COND.pay, COND.cls, COND.channel, COND.amount, COND.limitQty, COND.limitBlock]
  if (type === "Скидка") return [COND.price, COND.stock, COND.pay, COND.cls, COND.channel, COND.amount]
  if (type === "Надбавка") return [COND.price, COND.pay, COND.cls, COND.channel]
  if (type === "Балл") return [COND.cls, COND.channel]
  return [COND.pay, COND.cls, COND.channel, COND.branch]
}

function audienceFor(type: PromoType): string[] {
  if (type === "Кэшбэк") return ["Для всех", "Выбранным типам клиентов", "Выбранным клиентам"]
  if (type === "Скидка") return ["Для всех", "Выбранным агентам", "Выбранным филиалам", "Выбранным типам клиентов", "Выбранным зонам", "Выбранным клиентам"]
  return ["Для всех", "Выбранным агентам", "Выбранным филиалам", "Выбранным типам клиентов", "Выбранным клиентам"]
}

function Radio({ checked, onChange, label, small, info }: { checked: boolean; onChange: () => void; label: string; small?: boolean; info?: boolean }) {
  const size = small ? 18 : 20
  return (
    <label className={`flex cursor-pointer items-center text-[13px] text-[#333] ${small ? "h-[29px]" : "mb-[10px] h-[24px]"}`}>
      <span
        style={{ width: size, height: size, marginLeft: small ? 2 : 2 }}
        className={`${small ? "mr-[20px]" : "mr-[18px]"} flex shrink-0 items-center justify-center rounded-full border-2 ${small ? "border-[#aaa]" : checked ? "border-[#9aa0aa]" : "border-[#222]"}`}
      >
        {checked && <span style={{ width: size - 10, height: size - 10 }} className="rounded-full bg-[#5d6474]" />}
      </span>
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      <span>{label}</span>
      {info && <InfoDot className={small ? "ml-[8px]" : "ml-[8px]"} />}
    </label>
  )
}

function InfoDot({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[#5c7ae0] text-[13px] font-bold italic text-white shadow-[0_0_0_3px_rgba(92,122,224,0.25)] ${className}`} aria-hidden>
      i
    </span>
  )
}

function Heading({ children, mt = 11, mb = 16 }: { children: React.ReactNode; mt?: number; mb?: number }) {
  return (
    <p style={{ marginTop: mt, marginBottom: mb }} className="text-[13px] font-bold leading-[15px] text-[#333]">
      {children}
    </p>
  )
}

function DateLine({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const display = value ? value.split("-").reverse().join(".") : ""
  return (
    <div className="relative h-[40px] cursor-pointer border-b border-[#d5dae1]" onClick={() => ref.current?.showPicker?.()}>
      <span className={`pointer-events-none absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] leading-4"}`}>
        {label}
        <span className="text-[#e57373]"> *</span>
      </span>
      {value && <span className="absolute inset-x-0 bottom-[6px] text-[13px] font-semibold">{display}</span>}
      <svg viewBox="0 0 24 24" className="absolute bottom-[6px] right-[2px] h-[20px] w-[20px] fill-[#c4c8d0]" aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
      </svg>
      <input ref={ref} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full opacity-0" aria-label={label} />
    </div>
  )
}

function SoftCheck({ checked, onChange, label, info }: { checked: boolean; onChange: (value: boolean) => void; label: string; info?: boolean }) {
  return (
    <div className="flex items-center">
      <CheckBox checked={checked} onChange={onChange} label={label} />
      {info && <InfoDot className="ml-[18px]" />}
    </div>
  )
}

function ProductTable({ title, withQty }: { title: string; withQty?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="rounded-[8px] bg-white px-[15px] pb-[15px] pt-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.16)]">
      <div className="flex items-center justify-between">
        <b className="text-[13px] font-semibold">{t(title)}</b>
        <span className="text-[12px] text-[#2a6df4]">⇪ {t("Импортировать с Excel")}</span>
      </div>
      <div className="mt-[10px] flex items-end gap-[12px] rounded-[6px] bg-[#f4f6f9] px-[12px] pb-[18px] pt-[22px]">
        <div className="flex-1">
          <LineSelect label={t("Наименование")} value="" onChange={() => {}} options={[]} />
        </div>
        {withQty && (
          <div className="w-[85px]">
            <LineField label={t("Кол-во")} value="" onChange={() => {}} />
          </div>
        )}
        <button type="button" disabled className="mb-[4px] h-[34px] rounded-[3px] bg-[#e2e6ec] px-[14px] text-[12px] text-[#9aa0aa]">
          + {t("Добавить")}
        </button>
      </div>
      <div className="mt-[12px] flex h-[53px] items-center justify-center rounded-[4px] border border-dashed border-[#dfe3e8] text-[13px] text-[#9aa0aa]">{t("Вы еще не выбрали ни одного товара")}</div>
    </div>
  )
}

function ProductList({ value, onChange, withImport }: { value: boolean; onChange: (value: boolean) => void; withImport: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="pl-[30px] pr-[46px] pt-[30px]">
      <CheckBox checked={value} onChange={onChange} label={t("Действует для всех товаров")} />
      <div className="mt-[22px] flex items-center justify-between text-[13px]">
        <b className="font-semibold">{t("Список товаров")}</b>
        <span className={withImport ? "mr-[110px]" : ""}>+ {t("добавить товар")}</span>
        {withImport && <span className="-ml-[110px]">{t("импортировать с excel")}</span>}
      </div>
      <div className="mt-[34px] flex flex-col items-center text-[13px] leading-[17px] text-[#9aa0aa]">
        <svg viewBox="0 0 60 70" className="mb-[22px] h-[70px] w-[60px] fill-none stroke-[#d9dce1] stroke-[2.5]" aria-hidden>
          <path d="M8 22h44l-3 44H11L8 22zM20 22c0-8 4-14 10-14s10 6 10 14M20 38h20M20 46h12" />
        </svg>
        <span>{t("Вы еще не выбрали ни одного товара.")}</span>
        <span>
          <span className="text-[#0a9ddb]">{t("Добавить")}</span>
          {t("товар?")}
        </span>
      </div>
    </div>
  )
}

export function PromoForm({
  value,
  onChange,
  onSave,
  onClose,
  currencies,
}: {
  value: PromoFormValue
  onChange: (next: PromoFormValue) => void
  onSave: () => void
  onClose: () => void
  currencies: string[]
}) {
  const { t } = useLanguage()
  const c = value.config
  const setConfig = (partial: Partial<PromoConfig>) => onChange({ ...value, config: { ...c, ...partial } })
  const toggleCondition = (name: string) => setConfig({ conditions: c.conditions.includes(name) ? c.conditions.filter((item) => item !== name) : [...c.conditions, name] })
  const audiences = audienceFor(c.type)

  return (
    <div className="fixed inset-0 z-[1400] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[28px]">
        <b className="text-[13px] font-bold uppercase">{t("Новая акция")}</b>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <X className="h-6 w-6" strokeWidth={1.5} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[450px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[#efefef] px-[30px] pb-[30px] pt-[24px]">
          <LineField label={t("Название новой акции")} required value={value.name} onChange={(next) => onChange({ ...value, name: next })} />
          <div className="mt-[12px]">
            <DateLine label={t("Дата начала акции")} value={value.start} onChange={(next) => onChange({ ...value, start: next })} />
          </div>
          <div className="mt-[12px]">
            <DateLine label={t("Дата завершения акции")} value={value.end} onChange={(next) => onChange({ ...value, end: next })} />
          </div>
          <div className="mt-[17px]">
            {TYPES.map((item) => (
              <Radio key={item.value} small checked={c.type === item.value} onChange={() => setConfig({ type: item.value, conditions: [], audience: "Для всех" })} label={t(item.label)} />
            ))}
          </div>

          {c.type === "Кэшбэк" && (
            <div className="mt-[14px]">
              <LineSelect label={t("Валюта")} value={c.currency} onChange={(next) => setConfig({ currency: next })} options={currencies} />
            </div>
          )}

          {(c.type === "Скидка" || c.type === "Надбавка") && (
            <>
              <Heading mt={18}>{t("Тип вычисления:")}</Heading>
              {["Процент", "Сумма", "Процент на СЕТ", ...(c.type === "Скидка" ? ["Ручной процент"] : [])].map((item) => (
                <Radio key={item} checked={c.calc === item} onChange={() => setConfig({ calc: item })} label={t(item)} info={c.type === "Скидка" && item === "Процент на СЕТ"} />
              ))}
            </>
          )}

          {c.type === "Бонус" && (
            <>
              <Heading mt={18}>{t("Добавление продуктов:")}</Heading>
              {["Авто", "Ручной", "Авто от суммы заказа", "Авто от веса", "Авто от остатка"].map((item) => (
                <Radio key={item} checked={c.addMode === item} onChange={() => setConfig({ addMode: item })} label={t(item)} info={item === "Авто от остатка"} />
              ))}
            </>
          )}

          {c.type !== "Балл" && (
            <>
              <Heading>{t("Действует для клиентов:")}</Heading>
              {audiences.map((item) => (
                <div key={item} className="flex items-center justify-between">
                  <Radio checked={c.audience === item} onChange={() => setConfig({ audience: item })} label={t(c.type === "Бонус" && item === "Выбранным клиентам" ? "Выбраанным клиентам" : item)} />
                  {item === "Выбранным клиентам" && <InfoDot className="mr-[65px]" />}
                </div>
              ))}
            </>
          )}

          {c.type === "Кэшбэк" && (
            <>
              <Heading>{t("Тип кешбека:")}</Heading>
              {["От суммы оплаты", "От суммы заказа"].map((item) => (
                <Radio key={item} checked={c.cashbackBase === item} onChange={() => setConfig({ cashbackBase: item })} label={t(item)} />
              ))}
            </>
          )}

          <Heading mb={10}>{t("Условия акции:")}</Heading>
          <div className="space-y-[10px]">
            {conditionsFor(c.type).map((item) => (
              <CheckBox key={item} checked={c.conditions.includes(item)} onChange={() => toggleCondition(item)} label={t(item)} />
            ))}
          </div>
          <div className="mt-[22px]">
            <CheckBox checked={value.active} onChange={(next) => onChange({ ...value, active: next })} label={t("Активная акция")} />
          </div>
        </aside>

        <main className="min-w-0 overflow-y-auto bg-white">
          {c.type === "Бонус" ? (
            <div className="px-[30px] pb-[30px] pt-[20px]">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-[16px] rounded-[8px] bg-[#f7f8fa] px-[20px] pb-[24px] pt-[12px]">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#7b8190]">{t("Условия закупа")}</p>
                  <div className="mt-[12px] space-y-[10px]">
                    <div className="flex items-start justify-between gap-[10px]">
                      <CheckBox checked={c.purchase.bonusSame} onChange={(next) => setConfig({ purchase: { ...c.purchase, bonusSame: next } })} label={t("В качестве бонуса давать только тот продукт, который купили.")} />
                      <InfoDot className="mr-[16px] mt-[8px]" />
                    </div>
                    <CheckBox checked={c.purchase.block} onChange={(next) => setConfig({ purchase: { ...c.purchase, block: next } })} label={t("Считать в блоке")} />
                    <SoftCheck checked={c.purchase.combo} onChange={(next) => setConfig({ purchase: { ...c.purchase, combo: next } })} label={t("При полном наборе выбранного списка (КОМБО, СЕТ)")} info />
                    <CheckBox checked={c.purchase.perItem} onChange={(next) => setConfig({ purchase: { ...c.purchase, perItem: next } })} label={t("Указать кол-во для каждой позиции закупа")} />
                  </div>
                  <div className="mt-[13px] w-[370px]">
                    <LineField label={t("Кол-во товаров для закупа")} value={c.purchase.qty} onChange={(next) => setConfig({ purchase: { ...c.purchase, qty: next } })} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#7b8190]">{t("Условия подарков")}</p>
                  <div className="mt-[12px]">
                    <CheckBox checked={c.gift.once} onChange={(next) => setConfig({ gift: { ...c.gift, once: next } })} label={t("Подарок один раз за заказ")} />
                  </div>
                  <div className="mt-[12px] w-[370px]">
                    <LineField label={t("Фонд (шт.)")} value={c.gift.fund} onChange={(next) => setConfig({ gift: { ...c.gift, fund: next } })} />
                  </div>
                </div>
              </div>
              <div className="mt-[20px] grid grid-cols-2 gap-[16px]">
                <ProductTable title="Товары для закупа" />
                <ProductTable title="Товар в подарок" withQty />
              </div>
            </div>
          ) : c.type === "Кэшбэк" ? (
            <div>
              <div className="flex items-start justify-between px-[30px] pt-[18px]">
                <p className="text-[16px]">{t("Основной процент кэшбэка")}</p>
                <div className="mr-[56px] w-[256px]">
                  <LineField label={t("процент")} value={c.cashbackPercent} onChange={(next) => setConfig({ cashbackPercent: next })} />
                </div>
              </div>
              <p className="mt-[40px] px-[30px] text-[15px]">{t("Дополнительные условия")}</p>
              <div className="mt-[14px] flex h-[100px] items-end justify-between bg-[#f0f4f8] px-[30px] pb-[24px]">
                <div className="flex gap-[247px]">
                  <div className="w-[256px]">
                    <LineField label={t("Начиная с накопленной суммы")} value={c.extraFrom} onChange={(next) => setConfig({ extraFrom: next })} />
                  </div>
                  <div className="w-[256px]">
                    <LineField label={t("Дополнительный процент")} value={c.extraPercent} onChange={(next) => setConfig({ extraPercent: next })} />
                  </div>
                </div>
                <svg viewBox="0 0 24 24" className="mb-[20px] mr-[33px] h-[22px] w-[22px] fill-[#4f71dc]" aria-hidden>
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                </svg>
              </div>
            </div>
          ) : (
            <ProductList value={c.allProducts} onChange={(next) => setConfig({ allProducts: next })} withImport={c.type !== "Балл"} />
          )}
        </main>
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-[#efefef] px-[26px]">
        <button type="button" onClick={onSave} className="text-[13px] font-bold uppercase text-[#0a9ddb]">
          {t("Применить акцию")}
        </button>
      </footer>
    </div>
  )
}

export function usePromoFormState() {
  return useState<PromoFormValue>(emptyPromoForm)
}
