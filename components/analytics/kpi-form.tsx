"use client"

import { FormEvent, useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { FilterSelect, RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

export type KpiDetailInput = Record<string, unknown>
export type KpiFormValue = {
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
  detail: KpiDetailInput
  startDate: string | null
  tillDate: string | null
}
export type KpiFormEditing = {
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
  detail?: KpiDetailInput | null
  startDate?: string | null
  tillDate?: string | null
}

// The reference stores plan / client / calculation types as codes and translates them in the page.
export const PLAN_TYPE_LABELS: Record<string, string> = {
  sales_sum: "Сумма фактической продажи (продажа - возврат)",
  product_sales_amount: "Кол-во фактической продажи (продажа - возврат)",
  sales_sum_order: "Сумма продаж (продажа-возврат от продаж)",
  product_sales_amount_order: "Кол-во продаж (продажа-возврат от продаж)",
  active_client_count: "АКБ",
  active_client_count_by_day: "Дневной АКБ",
  payment_to_cashbox: "Оплата (принятые на кассу)",
  product_sales_weight: "Вес фактической продажи (продажа - возврат)",
  visit: "Визит",
  payed_market_count: "Количество оплативших клиентов",
  mml: "Индикатор ММЛ / АКБ",
  plan_visit_by_day: "Плановый Визит ПО ДНЯМ",
}
// Plan types the local data has no reference code for are stored under their label.
const PLAN_TYPE_ORDER = [
  "Сумма фактической продажи (продажа - возврат)",
  "Кол-во фактической продажи (продажа - возврат)",
  "Сумма продаж (продажа-возврат от продаж)",
  "Кол-во продаж (продажа-возврат от продаж)",
  "Активация неактивных",
  "АКБ",
  "Дневной АКБ",
  "Оплата (принятые на кассу)",
  "Вес фактической продажи (продажа - возврат)",
  "Визит",
  "Посещение",
  "Вес фактической доставки",
  "Кол-во доставленных продуктов",
  "Сумма доставки (продажа-возврат от продаж)",
  "Количество оплативших клиентов",
  "Индикатор ММЛ / АКБ",
  "Плановый Визит ПО ДНЯМ",
  "Perfect Store (% от визитов)",
  "Количество заказов",
]
const LABEL_TO_CODE = Object.fromEntries(Object.entries(PLAN_TYPE_LABELS).map(([code, label]) => [label, code]))
export const planCode = (label: string) => LABEL_TO_CODE[label] ?? label
const planLabelOf = (code: string) => PLAN_TYPE_LABELS[code] ?? code

export const CALC_LABELS: Record<string, string> = {
  bonus: "Единоразовый бонус",
  for_each_unit: "Бонус за каждую единицу",
  percent_from_sales: "Процент от продаж",
  percent_from_sales_for_all: "Процент от продаж без учета предыдущих",
  percent_from_bonus_amount: "Процент от бонусные суммы",
  percent_from_bonus_amount_for_all: "Процент от бонуса без учета предыдущих",
  percent_from_bonus_fund: "Процент от бонусного фонда",
}

const CLIENT_FILTERS: Array<{ label: string; code: string; flag: string }> = [
  { label: "Фильтровать по клиентам", code: "choosen", flag: "use_chosen" },
  { label: "Фильтровать по зонам", code: "border", flag: "use_border" },
  { label: "Фильтровать по типам клиентов", code: "market_type", flag: "use_market_type" },
  { label: "Фильтровать по филиалам", code: "branch", flag: "use_branch" },
]
const EXTRA_FLAGS = [
  "Учитывать только оплаченные заказы",
  "Фильтровать по брендам",
  "Фильтровать по продуктам",
  "Фильтровать по типам продуктов",
  "Фильтровать группы товаров",
  "Фильтровать по транспортам",
]
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

type Level = { from: number; to: number; bonus: number; calc: string; exclude: boolean }

function Line({ label, value, onChange, required, type = "text", children }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; children?: React.ReactNode }) {
  return (
    <label className="relative block h-[50px] border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder=" " className="peer absolute inset-x-0 bottom-0 h-[34px] bg-transparent text-[13px] text-black outline-none" />
      <span className="pointer-events-none absolute left-0 top-[14px] text-[13px] font-semibold text-black transition-all peer-focus:top-[2px] peer-focus:text-[10px] peer-[:not(:placeholder-shown)]:top-[2px] peer-[:not(:placeholder-shown)]:text-[10px]">
        {label}
        {required && <span className="ml-[3px] text-[#e53935]">*</span>}
      </span>
      {children}
    </label>
  )
}

function MonthField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Number(value?.slice(0, 4)) || new Date().getFullYear())
  const text = value ? `${t(MONTHS[Number(value.slice(5, 7)) - 1])} ${value.slice(0, 4)}` : ""
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="relative block h-[50px] w-full border-b border-[#e0e0e0] text-left">
        <span className="absolute left-0 top-[2px] text-[10px] text-[#666]">{label}</span>
        <span className={`absolute left-0 top-[24px] text-[13px] ${text ? "text-black" : "text-black/30"}`}>{text || t("Выберите месяц")}</span>
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[20px] h-5 w-5 fill-[#b0b0b0]"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" /></svg>
      </button>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[52px] z-50 w-[240px] bg-white p-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            <div className="mb-[6px] flex items-center justify-between font-semibold">
              <button type="button" onClick={() => setYear((current) => current - 1)} className="px-2">‹</button>
              <span>{year}</span>
              <button type="button" onClick={() => setYear((current) => current + 1)} className="px-2">›</button>
            </div>
            <div className="grid grid-cols-3 gap-[4px]">
              {MONTHS.map((month, index) => (
                <button key={month} type="button" onClick={() => { onChange(`${year}-${String(index + 1).padStart(2, "0")}`); setOpen(false) }} className="h-[30px] rounded-[2px] text-[12px] hover:bg-[#e6f2ff]">{t(month).slice(0, 3)}</button>
              ))}
            </div>
            {value && <button type="button" onClick={() => { onChange(null); setOpen(false) }} className="mt-[6px] w-full text-left text-[12px] text-[#999]">{t("Сбросить")}</button>}
          </div>
        </>
      )}
    </div>
  )
}

function Radio({ checked, label, onSelect }: { checked: boolean; label: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className="flex h-[34px] w-full items-center gap-[14px] text-left text-[13px] text-[#333]">
      <span className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-[#4f71dc]" : "border-[#757575]"}`}>
        {checked && <span className="h-[10px] w-[10px] rounded-full bg-[#4f71dc]" />}
      </span>
      {label}
    </button>
  )
}

function Check({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex h-[30px] w-full items-center gap-[12px] text-left text-[13px] font-semibold text-black">
      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px] border-2 ${checked ? "border-[#4f71dc] bg-[#4f71dc]" : "border-[#757575]"}`}>
        {checked && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
      </span>
      {label}
    </button>
  )
}

/** The reference's full-screen "ДОБАВЛЕНИЕ KPI" / "ИЗМЕНЕНИЕ KPI" form. */
export function KpiFormDialog({ editing, onClose, onSave }: { editing?: KpiFormEditing | null; onClose: () => void; onSave: (value: KpiFormValue) => void | Promise<void> }) {
  const { t } = useLanguage()
  const old = (editing?.detail ?? {}) as Record<string, unknown>
  const [name, setName] = useState(editing?.name ?? "")
  const [comment, setComment] = useState(editing?.comment ?? "")
  const [bonusFund, setBonusFund] = useState(old.bonus_fund == null ? "" : String(Number(old.bonus_fund)))
  const [startDate, setStartDate] = useState<string | null>(editing?.startDate ? editing.startDate.slice(0, 7) : null)
  const [tillDate, setTillDate] = useState<string | null>(editing?.tillDate ? editing.tillDate.slice(0, 7) : null)
  const [currency, setCurrency] = useState(((old.currency as { name?: string } | null)?.name) ?? "")
  const [organization, setOrganization] = useState("")
  const [planLabel, setPlanLabel] = useState(editing?.planType ? planLabelOf(editing.planType) : "")
  const [clientCode, setClientCode] = useState<string[]>(CLIENT_FILTERS.filter((item) => item.code === editing?.clientType).map((item) => item.label))
  const [extra, setExtra] = useState<string[]>(Array.isArray(old.ui_flags) ? (old.ui_flags as string[]) : [])
  const [active, setActive] = useState(editing?.active ?? true)
  const [mml, setMml] = useState(Boolean(old.is_mml))
  const [levels, setLevels] = useState<Level[]>(
    Array.isArray(old.levels)
      ? (old.levels as Array<{ from_amount: string; to_amount: string; bonus_amount: string; calculation_type: string; exclude_low_level: boolean }>).map((level) => ({ from: Number(level.from_amount), to: Number(level.to_amount), bonus: Number(level.bonus_amount), calc: level.calculation_type, exclude: Boolean(level.exclude_low_level) }))
      : [],
  )
  const [draftTo, setDraftTo] = useState("")
  const [draftBonus, setDraftBonus] = useState("")
  const [draftCalc, setDraftCalc] = useState("")
  const [draftExclude, setDraftExclude] = useState(false)
  const [currencies, setCurrencies] = useState<string[]>([])
  const [organizations, setOrganizations] = useState<string[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const names = (url: string, set: (list: string[]) => void) =>
      fetch(url)
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: Array<{ name?: string }>) => set([...new Set(rows.map((row) => row.name ?? "").filter(Boolean))]))
        .catch(() => {})
    void names("/api/currencies", setCurrencies)
    void names("/api/organizations", setOrganizations)
  }, [])

  const nextFrom = levels.length ? levels[levels.length - 1].to : 0
  const calcLabel = (code: string) => t(CALC_LABELS[code] ?? code)

  function addLevel() {
    const to = Number(draftTo)
    const bonus = Number(draftBonus)
    const calc = Object.entries(CALC_LABELS).find(([, label]) => t(label) === draftCalc)?.[0]
    if (!draftTo || !(to > nextFrom) || draftBonus === "" || !Number.isFinite(bonus) || !calc) {
      setError(t("Заполните уровень вознаграждения"))
      return
    }
    setError("")
    setLevels((current) => [...current, { from: nextFrom, to, bonus, calc, exclude: draftExclude }])
    setDraftTo("")
    setDraftBonus("")
    setDraftCalc("")
    setDraftExclude(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError(t("Введите название задачи"))
      return
    }
    if (!planLabel) {
      setError(t("Выберите правило отбора"))
      return
    }
    const clientFilter = CLIENT_FILTERS.find((item) => clientCode.includes(item.label))
    const base = { ...old }
    delete base.levels
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        planType: planCode(planLabel),
        clientType: clientFilter?.code ?? "all",
        comment,
        active,
        startDate: startDate ? `${startDate}-01` : null,
        tillDate: tillDate ? `${tillDate}-${String(new Date(Number(tillDate.slice(0, 4)), Number(tillDate.slice(5, 7)), 0).getDate()).padStart(2, "0")}` : null,
        detail: {
          ...base,
          levels: levels.map((level, index) => ({ calculation_type: level.calc, from_amount: String(level.from), to_amount: String(level.to), bonus_amount: String(level.bonus), level: index + 1, exclude_low_level: level.exclude })),
          currency: currency ? { name: currency } : null,
          bonus_fund: bonusFund === "" ? null : bonusFund,
          is_mml: mml,
          ui_flags: extra,
          order_date_type: (old.order_date_type as string) ?? "created_date",
          order_return_date_type: (old.order_return_date_type as string) ?? "created_date",
          ...Object.fromEntries(CLIENT_FILTERS.map((item) => [item.flag, clientCode.includes(item.label)])),
        },
      })
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <form onSubmit={submit} className="fixed inset-0 z-[1400] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#eee] pl-[28px] pr-[18px]">
        <h2 className="text-[13px] font-bold uppercase">{t(editing ? "Изменение KPI" : "Добавление KPI")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid h-[94px] grid-cols-3 items-end gap-x-[46px] border-b border-[#eee] px-[28px] pb-[12px]">
          <Line label={t("Название задачи")} required value={name} onChange={setName} />
          <Line label={t("Комментарий")} value={comment} onChange={setComment} />
          <Line label={t("Бонусный фонд")} type="number" value={bonusFund} onChange={setBonusFund} />
        </div>
        <div className="flex">
          <div className="w-[450px] shrink-0 border-r border-[#eee] px-[28px] pb-[24px] pt-[14px]">
            <div className="grid grid-cols-2 gap-x-[16px]">
              <MonthField label={t("Дата начала")} value={startDate} onChange={setStartDate} />
              <MonthField label={t("Дата окончания")} value={tillDate} onChange={setTillDate} />
            </div>
            <div className="relative mt-[14px]">
              <FilterSelect label={t("Валюта")} value={currency} onChange={setCurrency} options={currencies} />
              <svg viewBox="0 0 24 24" className="absolute -right-[16px] top-[16px] h-6 w-6 fill-[#4f71dc]"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
            </div>
            <FilterSelect label={t("Организация")} value={organization} onChange={setOrganization} options={organizations} />
            <p className="-mt-[2px] mb-[0px] font-semibold text-black">{t("Правила отбора")}</p>
            {PLAN_TYPE_ORDER.map((label) => (
              <Radio key={label} checked={planLabel === label} label={t(label)} onSelect={() => setPlanLabel(label)} />
            ))}
            <p className="mb-[6px] mt-[14px] font-semibold text-black">{t("Действует для клиентов:")}</p>
            {CLIENT_FILTERS.map((item) => (
              <Check key={item.label} checked={clientCode.includes(item.label)} label={t(item.label)} onToggle={() => setClientCode((current) => (current.includes(item.label) ? [] : [item.label]))} />
            ))}
            <div className="my-[10px] border-t border-[#eee]" />
            <Check checked={active} label={t("Активный")} onToggle={() => setActive((current) => !current)} />
            {EXTRA_FLAGS.map((label) => (
              <Check key={label} checked={extra.includes(label)} label={t(label)} onToggle={() => setExtra((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]))} />
            ))}
          </div>
          <div className="min-w-0 flex-1 px-[28px] pt-[18px]">
            <button type="button" onClick={() => setMml((current) => !current)} className="flex items-center gap-[10px] font-semibold text-black">
              <span className={`relative h-[14px] w-[34px] rounded-full ${mml ? "bg-[#9fb3ef]" : "bg-[#cfd3d8]"}`}><span className={`absolute -top-[3px] h-[20px] w-[20px] rounded-full shadow ${mml ? "left-[16px] bg-[#4f71dc]" : "left-0 bg-white"}`} /></span>
              {t("Учитывать только ММЛ продукты")}
            </button>
            <p className="mt-[16px] font-semibold text-black">{t("Уровень вознаграждения")}</p>
            <div className="mt-[18px] flex min-h-[84px] items-center gap-[14px] bg-[#f2f5f8] px-[20px]">
              <span className="w-[90px] shrink-0 text-[13px]">{t("от")} <b>{nextFrom} %</b> -{t("до")}</span>
              <input value={draftTo} onChange={(event) => setDraftTo(event.target.value.replace(/[^\d.]/g, ""))} className="h-[36px] w-[96px] border-b border-[#e0e0e0] bg-transparent text-right outline-none focus:border-[#5d6474]" />
              <span>%</span>
              <label className="relative w-[120px]"><span className={`pointer-events-none absolute left-0 font-semibold transition-all ${draftBonus ? "top-[-8px] text-[10px]" : "top-[8px]"}`}>{t("Бонус")}</span><input value={draftBonus} onChange={(event) => setDraftBonus(event.target.value.replace(/[^\d.]/g, ""))} className="h-[36px] w-full border-b border-[#e0e0e0] bg-transparent outline-none focus:border-[#5d6474]" /></label>
              <div className="w-[220px]"><FilterSelect compact label={t("Тип расчета")} value={draftCalc} onChange={setDraftCalc} options={Object.values(CALC_LABELS).map((label) => t(label))} /></div>
              <Check checked={draftExclude} label={t("Обнулить предыдущие уровни")} onToggle={() => setDraftExclude((current) => !current)} />
              <button type="button" onClick={addLevel} aria-label={t("Добавить уровень")} className="ml-auto"><svg viewBox="0 0 24 24" className="h-7 w-7 fill-[#4f71dc]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg></button>
            </div>
            {levels.map((level, index) => (
              <div key={index} className="flex items-center border-b border-dotted border-[#cfd8dc] py-[14px]">
                <span className="w-[40px]">{index + 1}</span>
                <span className="w-[160px]">{t("от")} {level.from} % {t("до")} {level.to} %</span>
                <span className="w-[140px]">{level.bonus.toLocaleString("ru-RU")}</span>
                <span className="flex-1">{calcLabel(level.calc)}</span>
                <span className="mr-[20px] font-semibold">{t(level.exclude ? "Включено" : "Отключено")}</span>
                <button type="button" aria-label={t("Удалить")} onClick={() => setLevels((current) => current.filter((_, i) => i !== index))}><svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d={RI.trash} /></svg></button>
              </div>
            ))}
            {error && <p className="mt-[12px] text-[12px] text-[#e53935]">{error}</p>}
          </div>
        </div>
      </div>
      <div className="flex h-[58px] shrink-0 items-center justify-end border-t border-[#eee] pr-[26px]">
        <button type="submit" disabled={saving} className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
      </div>
    </form>,
    document.body,
  )
}
