"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { Check, Line, MonthField, MultiSelect, Radio, RefSelect, type PickItem } from "@/components/analytics/kpi-form-fields"
import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { KPI_ATTENDANCE_STATUSES, KPI_ORDER_STATUSES, KPI_PLANS, KPI_PLAN_RULES, KPI_RETURN_STATUSES, KPI_USER_TYPES, kpiPlanCode, type KpiPlanCode } from "@/lib/kpi-form-rules"

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
export const PLAN_TYPE_LABELS: Record<string, string> = Object.fromEntries(KPI_PLANS.map((plan) => [plan.code, plan.label]))
export const planCode = (label: string) => kpiPlanCode(label) || label

export const CALC_LABELS: Record<string, string> = {
  percent_from_sales: "Процент от продаж",
  percent_from_bonus_amount: "Процент от бонусные суммы",
  percent_from_bonus_fund: "Процент от бонусного фонда",
  bonus: "Единоразовый бонус",
  percent_from_sales_for_all: "Процент от продаж без учета предыдущих",
  for_each_unit: "Бонус за каждую единицу",
  percent_from_bonus_amount_for_all: "Процент от бонуса без учета предыдущих",
  for_each_unit_same_bonus_for_all: "Бонус за каждую единицу без учета предыдущих",
}

type ClientKey = "choosen" | "border" | "market_type" | "branch"
const CLIENT_FILTERS: Array<{ label: string; key: ClientKey; flag: string }> = [
  { label: "Фильтровать по клиентам", key: "choosen", flag: "use_chosen" },
  { label: "Фильтровать по зонам", key: "border", flag: "use_border" },
  { label: "Фильтровать по типам клиентов", key: "market_type", flag: "use_market_type" },
  { label: "Фильтровать по филиалам", key: "branch", flag: "use_branch" },
]

type ProductKey = "brand" | "product" | "type" | "group"
type Options = {
  brands: PickItem[]
  products: PickItem[]
  productTypes: PickItem[]
  groupProducts: PickItem[]
  priceLists: PickItem[]
  zones: PickItem[]
  marketTypes: PickItem[]
  branches: PickItem[]
  organizations: PickItem[]
  currencies: PickItem[]
  transports: PickItem[]
}
const PRODUCT_FILTERS: Array<{ key: ProductKey; label: string; list: keyof Options; selected: string; exclude: string; pick: string; include: string; excluded: string }> = [
  { key: "brand", label: "Фильтровать по брендам", list: "brands", selected: "brands", exclude: "exclude_brand", pick: "По брендам", include: "Выбранные бренды", excluded: "Исключить бренды" },
  { key: "product", label: "Фильтровать по продуктам", list: "products", selected: "products", exclude: "exclude_product", pick: "По продуктам", include: "Выбранные продукты", excluded: "Исключить продукты" },
  { key: "type", label: "Фильтровать по типам продуктов", list: "productTypes", selected: "product_types", exclude: "exclude_product_type", pick: "Тип товара", include: "Выбранные тип продукты", excluded: "Исключить тип продукты" },
  { key: "group", label: "Фильтровать группы товаров", list: "groupProducts", selected: "group_products", exclude: "exclude_group_product", pick: "Группы товаров", include: "Выбранные группы товаров", excluded: "Исключить группы товаров" },
]

type Level = { from: number; to: number; bonus: number; calc: string; exclude: boolean }
const EMPTY_OPTIONS: Options = { brands: [], products: [], productTypes: [], groupProducts: [], priceLists: [], zones: [], marketTypes: [], branches: [], organizations: [], currencies: [], transports: [] }

/** Reference lists ([{id, name | title}]) → picked items. */
function asItems(value: unknown): PickItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      return { id: Number(row.id), name: String(row.name ?? row.title ?? "") }
    })
    .filter((item) => Number.isFinite(item.id) && item.name)
}
const asCodes = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

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
  const [organization, setOrganization] = useState(((old.division as { name?: string } | null)?.name) ?? "")
  const [plan, setPlan] = useState<KpiPlanCode | "">(editing?.planType ? kpiPlanCode(editing.planType) : "")
  const [clientOn, setClientOn] = useState<Record<ClientKey, boolean>>(() => ({
    choosen: Boolean(old.use_chosen) || editing?.clientType === "choosen",
    border: Boolean(old.use_border) || editing?.clientType === "border",
    market_type: Boolean(old.use_market_type) || editing?.clientType === "market_type",
    branch: Boolean(old.use_branch) || editing?.clientType === "branch",
  }))
  const [zones, setZones] = useState<PickItem[]>(() => asItems(old.borders))
  const [marketTypes, setMarketTypes] = useState<PickItem[]>(() => asItems(old.market_types))
  const [branches, setBranches] = useState<PickItem[]>(() => asItems(old.branches))
  const [active, setActive] = useState(editing?.active ?? true)
  const [paid, setPaid] = useState(Boolean(old.is_paid_fully))
  const [paidFrom, setPaidFrom] = useState(old.paid_days_from == null ? "" : String(old.paid_days_from))
  const [paidTo, setPaidTo] = useState(old.paid_days_to == null ? "" : String(old.paid_days_to))
  const [ownAgents, setOwnAgents] = useState(Boolean(old.for_supervisor))
  const [productOn, setProductOn] = useState<Record<ProductKey, boolean>>(() => ({
    brand: asItems(old.brands).length > 0,
    product: asItems(old.products).length > 0,
    type: asItems(old.product_types).length > 0,
    group: asItems(old.group_products).length > 0,
  }))
  const [productItems, setProductItems] = useState<Record<ProductKey, PickItem[]>>(() => ({
    brand: asItems(old.brands),
    product: asItems(old.products),
    type: asItems(old.product_types),
    group: asItems(old.group_products),
  }))
  const [productExclude, setProductExclude] = useState<Record<ProductKey, boolean>>(() => ({
    brand: Boolean(old.exclude_brand),
    product: Boolean(old.exclude_product),
    type: Boolean(old.exclude_product_type),
    group: Boolean(old.exclude_group_product),
  }))
  const [transports, setTransports] = useState<PickItem[]>(() => asItems(old.transports))
  const [transportOn, setTransportOn] = useState(asItems(old.transports).length > 0)
  const [priceLists, setPriceLists] = useState<PickItem[]>(() => asItems(old.price_lists))
  const [priceListOn, setPriceListOn] = useState(asItems(old.price_lists).length > 0)
  const [blocks, setBlocks] = useState(Boolean(old.calc_in_box))
  const [planMonth, setPlanMonth] = useState(Boolean(old.is_date_return))
  const [userType, setUserType] = useState(typeof old.user_type === "string" && old.user_type ? old.user_type : "delivery_man")
  const [orderOn, setOrderOn] = useState(Boolean(old.is_order_status))
  const [orderStatus, setOrderStatus] = useState<string[]>(() => asCodes(old.order_status))
  const [returnOn, setReturnOn] = useState(Boolean(old.is_order_return_status))
  const [returnStatus, setReturnStatus] = useState<string[]>(() => asCodes(old.order_return_status))
  const [attendanceOn, setAttendanceOn] = useState(asCodes(old.attendance_type).length > 0)
  const [attendance, setAttendance] = useState<string[]>(() => asCodes(old.attendance_type))
  const [orderDate, setOrderDate] = useState(typeof old.order_date_type === "string" && old.order_date_type ? old.order_date_type : "created_date")
  const [returnDate, setReturnDate] = useState(typeof old.order_return_date_type === "string" && old.order_return_date_type ? old.order_return_date_type : "created_date")
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
  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/kpi-tasks/options")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Options | null) => data && setOptions({ ...EMPTY_OPTIONS, ...data }))
      .catch(() => {})
  }, [])

  const rule = plan ? KPI_PLAN_RULES[plan] : null
  const showPaid = !rule?.hidePaid
  const showProducts = !rule?.hideProducts
  const showTransport = !rule?.hideTransport
  const showMml = !rule?.hideMml
  const productRows = showProducts ? PRODUCT_FILTERS.filter((filter) => productOn[filter.key]) : []
  const nextFrom = levels.length ? levels[levels.length - 1].to : 0
  const calcLabel = (code: string) => t(CALC_LABELS[code] ?? code)
  const pick = (items: PickItem[], label: string) => items.find((item) => item.name === label) ?? null
  const toggleCode = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const currencyNames = useMemo(() => options.currencies.map((item) => item.name), [options.currencies])
  const organizationNames = useMemo(() => options.organizations.map((item) => item.name), [options.organizations])

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
    if (!plan && !editing?.planType) {
      setError(t("Выберите правило отбора"))
      return
    }
    const clientKey = CLIENT_FILTERS.find((item) => clientOn[item.key])?.key
    const base = { ...old }
    delete base.levels
    delete base.ui_flags
    const productDetail = Object.fromEntries(
      PRODUCT_FILTERS.flatMap((filter) => {
        const on = showProducts && productOn[filter.key]
        return [
          [filter.selected, on ? productItems[filter.key] : []],
          [filter.exclude, on && productExclude[filter.key]],
        ]
      }),
    )
    const currencyRow = pick(options.currencies, currency)
    const divisionRow = pick(options.organizations, organization)
    const oldCurrency = typeof old.currency === "object" && old.currency ? (old.currency as Record<string, unknown>) : {}
    const useTransport = showTransport && transportOn
    const usePriceList = Boolean(rule?.priceList) && priceListOn
    const useOrder = Boolean(rule?.orderStatus) && orderOn
    const useReturn = Boolean(rule?.returnStatus) && returnOn
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        planType: plan || (editing?.planType ?? ""),
        clientType: clientKey ?? "all",
        comment,
        active,
        startDate: startDate ? `${startDate}-01` : null,
        tillDate: tillDate ? `${tillDate}-${String(new Date(Number(tillDate.slice(0, 4)), Number(tillDate.slice(5, 7)), 0).getDate()).padStart(2, "0")}` : null,
        detail: {
          ...base,
          ...productDetail,
          levels: levels.map((level, index) => ({ calculation_type: level.calc, from_amount: String(level.from), to_amount: String(level.to), bonus_amount: String(level.bonus), level: index + 1, exclude_low_level: level.exclude })),
          currency: currencyRow ? { ...oldCurrency, id: currencyRow.id, name: currencyRow.name } : currency ? { name: currency } : null,
          division: divisionRow ? { id: divisionRow.id, name: divisionRow.name } : organization ? { name: organization } : null,
          bonus_fund: bonusFund === "" ? null : bonusFund,
          is_mml: showMml && mml,
          ...Object.fromEntries(CLIENT_FILTERS.map((item) => [item.flag, clientOn[item.key]])),
          borders: clientOn.border ? zones.map((item) => ({ id: item.id, title: item.name })) : [],
          market_types: clientOn.market_type ? marketTypes : [],
          branches: clientOn.branch ? branches : [],
          is_paid_fully: showPaid && paid,
          paid_days_from: showPaid && paid && paidFrom !== "" ? Number(paidFrom) : null,
          paid_days_to: showPaid && paid && paidTo !== "" ? Number(paidTo) : null,
          for_supervisor: Boolean(rule?.ownAgents) && ownAgents,
          transports: useTransport ? transports : [],
          price_lists: usePriceList ? priceLists : [],
          calc_in_box: Boolean(rule?.blocks) && blocks,
          is_date_return: Boolean(rule?.planMonth) && planMonth,
          user_type: rule?.userTypes ? userType : null,
          is_order_status: useOrder,
          order_status: useOrder ? orderStatus : [],
          is_order_return_status: useReturn,
          order_return_status: useReturn ? returnStatus : [],
          attendance_type: Boolean(rule?.attendance) && attendanceOn ? attendance : [],
          order_date_type: orderDate,
          order_return_date_type: returnDate,
        },
      })
    } finally {
      setSaving(false)
    }
  }

  const subSelect = (on: boolean, label: string, items: PickItem[], selected: PickItem[], onChange: (next: PickItem[]) => void) =>
    on ? <div className="pb-[9px] pt-[18px]"><MultiSelect label={t(label)} items={items} selected={selected} onChange={onChange} /></div> : null
  const statusList = (items: ReadonlyArray<{ value: string; label: string }>, selected: string[], onChange: (next: string[]) => void) => (
    <div className="pb-[5px]">
      {items.map((item) => (
        <Check key={item.value} indent={20} checked={selected.includes(item.value)} label={t(item.label)} onToggle={() => onChange(toggleCode(selected, item.value))} />
      ))}
    </div>
  )
  const headingLight = "text-[13px] font-normal leading-[16.3px] text-[#333]"
  const dateGroup = (label: string, first: { value: string; label: string }, second: { value: string; label: string }, value: string, onChange: (value: string) => void) => (
    <>
      <p className={`mb-[4.9px] ${headingLight}`}>{t(label)}</p>
      <div className="mb-[10px]">
        <Radio indent={20} checked={value === first.value} label={t(first.label)} onSelect={() => onChange(first.value)} />
        <Radio indent={20} checked={value === second.value} label={t(second.label)} onSelect={() => onChange(second.value)} />
      </div>
    </>
  )
  const hasStatuses = Boolean(rule && (rule.orderStatus || rule.returnStatus || rule.attendance))

  if (typeof document === "undefined") return null
  return createPortal(
    <form onSubmit={submit} className="fixed inset-0 z-[1400] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#eee] pl-[30px] pr-[10px]">
        <h2 className="text-[13px] font-bold uppercase">{t(editing ? "Изменение KPI" : "Добавление KPI")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid h-[93px] grid-cols-3 gap-x-[29.2px] border-b border-[#eee] pl-[30px] pr-[10px] pt-[14px]">
          <Line label={t("Название задачи")} required value={name} onChange={setName} />
          <Line label={t("Комментарий")} value={comment} onChange={setComment} />
          <Line label={t("Бонусный фонд")} type="number" value={bonusFund} onChange={setBonusFund} />
        </div>
        <div className="flex">
          <div className="w-[450px] shrink-0 border-r border-[#eee] pb-[24px] pl-[30px] pr-[10px] pt-[19px]">
            <div className="flex">
              <MonthField className="mx-[10px] w-[190px]" popupLeft={-10} label={t("Дата начала")} value={startDate} onChange={setStartDate} />
              <MonthField className="w-[198.5px]" padLeft={9.5} label={t("Дата окончания")} value={tillDate} onChange={setTillDate} />
            </div>
            <div className="relative mt-[24px]">
              <RefSelect clearable className="w-[384px]" label={t("Валюта")} value={currency} onChange={setCurrency} options={currencyNames} />
              <svg viewBox="0 0 24 24" className="absolute left-[385.5px] top-0 h-6 w-6 fill-[#4f71dc]"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
            </div>
            <RefSelect clearable className="mt-[26px]" label={t("Организация")} value={organization} onChange={setOrganization} options={organizationNames} />
            <p className="mb-[10px] mt-[3px] font-bold leading-[16.3px] text-[#333]">{t("Правила отбора")}</p>
            {KPI_PLANS.map((item) => (
              <Radio key={item.code} checked={plan === item.code} label={t(item.label)} onSelect={() => setPlan(item.code)} />
            ))}
            {rule?.desc && <div className="-mt-[5px] mb-[10px] bg-[#f1f5f8] px-[5px] text-[13px] font-semibold leading-[18px] text-[#4f71dc]">{t(rule.desc)}</div>}
            <p className={`mb-[10px] font-bold leading-[16.3px] text-[#333] ${rule?.desc ? "" : "mt-[5px]"}`}>{t("Действует для клиентов:")}</p>
            <Check checked={clientOn.choosen} label={t(CLIENT_FILTERS[0].label)} onToggle={() => setClientOn((state) => ({ ...state, choosen: !state.choosen }))} />
            <Check checked={clientOn.border} label={t(CLIENT_FILTERS[1].label)} onToggle={() => setClientOn((state) => ({ ...state, border: !state.border }))} />
            {subSelect(clientOn.border, "Зона", options.zones, zones, setZones)}
            <Check checked={clientOn.market_type} label={t(CLIENT_FILTERS[2].label)} onToggle={() => setClientOn((state) => ({ ...state, market_type: !state.market_type }))} />
            {subSelect(clientOn.market_type, "Тип клиента", options.marketTypes, marketTypes, setMarketTypes)}
            <Check checked={clientOn.branch} label={t(CLIENT_FILTERS[3].label)} onToggle={() => setClientOn((state) => ({ ...state, branch: !state.branch }))} />
            {subSelect(clientOn.branch, "Филиалы", options.branches, branches, setBranches)}
            <div className="pb-[12.5px] pt-[2.5px]"><div className="border-t border-[#e0e0e0]" /></div>
            <Check checked={active} label={t("Активный")} onToggle={() => setActive((current) => !current)} />
            {showPaid && <Check checked={paid} label={t("Учитывать только оплаченные заказы")} onToggle={() => setPaid((current) => !current)} />}
            {showPaid && paid && (
              <>
                <div className="-mt-[10px] h-[72px] pt-[24px]"><Line label={t("Период закрытия от (дн.)")} type="number" value={paidFrom} onChange={setPaidFrom} /></div>
                <div className="h-[68px]"><Line label={t("Период закрытия до (дн.)")} type="number" value={paidTo} onChange={setPaidTo} /></div>
              </>
            )}
            {rule?.ownAgents && <Check checked={ownAgents} label={t("Учитывать продажу своих агентов")} onToggle={() => setOwnAgents((current) => !current)} />}
            {showProducts && PRODUCT_FILTERS.map((filter) => <Check key={filter.key} checked={productOn[filter.key]} label={t(filter.label)} onToggle={() => setProductOn((state) => ({ ...state, [filter.key]: !state[filter.key] }))} />)}
            {showTransport && <Check checked={transportOn} label={t("Фильтровать по транспортам")} onToggle={() => setTransportOn((current) => !current)} />}
            {showTransport && subSelect(transportOn, "Транспорт", options.transports, transports, setTransports)}
            {rule?.blocks && <Check checked={blocks} label={t("В блоках")} onToggle={() => setBlocks((current) => !current)} />}
            {rule?.priceList && <Check checked={priceListOn} label={t("Фильтровать по прайс листу")} onToggle={() => setPriceListOn((current) => !current)} />}
            {rule?.priceList && subSelect(priceListOn, "Прайс лист", options.priceLists, priceLists, setPriceLists)}
            {rule?.planMonth && <Check checked={planMonth} label={t("Возвраты считать за плановый месяц")} onToggle={() => setPlanMonth((current) => !current)} />}
            {rule?.userTypes && (
              <>
                <p className={headingLight}>{t("Действует для:")}</p>
                <div className="mb-[10px] mt-[5px]">
                  {KPI_USER_TYPES.map((item) => (
                    <Radio key={item.value} indent={20} checked={userType === item.value} label={t(item.label)} onSelect={() => setUserType(item.value)} />
                  ))}
                </div>
              </>
            )}
            {rule?.conditions && (
              <>
                <p className={`font-bold leading-[16.3px] text-[#333] ${rule.userTypes ? "" : "pt-[5px]"} ${hasStatuses ? "pb-[10px]" : "pb-[14.9px]"}`}>{t("Дополнительные условия")}</p>
                {rule.orderStatus && (
                  <>
                    <Check className={orderOn ? "mb-[10px]" : "mb-[15px]"} checked={orderOn} label={t("Выбранные статусы заказов")} onToggle={() => setOrderOn((current) => !current)} />
                    {orderOn && statusList(KPI_ORDER_STATUSES, orderStatus, setOrderStatus)}
                  </>
                )}
                {rule.returnStatus && (
                  <>
                    <Check className={returnOn ? "mb-[10px]" : "mb-[15px]"} checked={returnOn} label={t("Выбранные статусы возвратов")} onToggle={() => setReturnOn((current) => !current)} />
                    {returnOn && statusList(KPI_RETURN_STATUSES, returnStatus, setReturnStatus)}
                  </>
                )}
                {rule.attendance && (
                  <>
                    <Check className={attendanceOn ? "mb-[10px]" : "mb-[15px]"} checked={attendanceOn} label={t("Выбранным статусам посещения")} onToggle={() => setAttendanceOn((current) => !current)} />
                    {attendanceOn && statusList(KPI_ATTENDANCE_STATUSES, attendance, setAttendance)}
                  </>
                )}
              </>
            )}
            {rule?.orderDate && dateGroup("Учитывать заказы по дате:", { value: "created_date", label: "Создания" }, { value: "delivered_date", label: "Доставки" }, orderDate, setOrderDate)}
            {rule?.returnDate && dateGroup("Учитывать возвраты по дате:", { value: "created_date", label: "Создания" }, { value: "accepted_date", label: "Принятия" }, returnDate, setReturnDate)}
          </div>
          <div className="min-w-0 flex-1 pt-[14px]">
            {productRows.length > 0 && (
              <div className="relative ml-[30px] mr-[11px]" style={{ height: 21.3 + 129 * Math.ceil(productRows.length / 2) }}>
                <p className="font-bold leading-[16.3px] text-[#333]">{t("Действует для продуктов:")}</p>
                {productRows.map((filter, index) => (
                  <div key={filter.key} className="absolute w-[calc(50%-10.1px)]" style={{ top: 129 * Math.floor(index / 2) + 44.3, left: index % 2 ? "calc(50% + 10.1px)" : 0 }}>
                    <RefSelect
                      clearable
                      className="w-full"
                      label={t("Выбранные или Исключить")}
                      value={t(productExclude[filter.key] ? filter.excluded : filter.include)}
                      onChange={(label) => setProductExclude((state) => ({ ...state, [filter.key]: label === t(filter.excluded) }))}
                      options={[t(filter.excluded), t(filter.include)]}
                    />
                    <MultiSelect className="mt-[21px]" label={t(filter.pick)} items={options[filter.list] as PickItem[]} selected={productItems[filter.key]} onChange={(next) => setProductItems((state) => ({ ...state, [filter.key]: next }))} />
                  </div>
                ))}
              </div>
            )}
            {showMml && (
              <button type="button" onClick={() => setMml((current) => !current)} className="ml-[30px] flex h-[24px] items-center font-semibold text-[#333]">
                <span className="relative block h-[24px] w-[44px]"><span className={`absolute left-0 top-[5px] h-[14px] w-[36px] rounded-full ${mml ? "bg-[#9fb3ef]" : "bg-[#b9bcc1]"}`} /><span className={`absolute top-[2px] h-[20px] w-[20px] rounded-full shadow ${mml ? "left-[16px] bg-[#4f71dc]" : "left-0 bg-white"}`} /></span>
                {t("Учитывать только ММЛ продукты")}
              </button>
            )}
            <p className="ml-[30px] mt-[15px] font-bold leading-[16.3px] text-[#333]">{t("Уровень вознаграждения")}</p>
            <div className="relative mt-[29.7px] flex h-[84px] items-start bg-[#f2f5f8] pl-[38px]">
              <span className="mt-[41.1px] block w-[112.8px] shrink-0 text-[13px] leading-[16.3px]">{t("от")} <b>{nextFrom} %</b> -{t("до")}</span>
              <input type="number" value={draftTo} onChange={(event) => setDraftTo(event.target.value.replace(/[^\d.]/g, ""))} className="mt-[30.3px] h-[36px] w-[112.8px] shrink-0 border-b border-[#e0e0e0] bg-transparent text-right text-[13px] font-semibold text-black outline-none focus:border-[#5d6474] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="mt-[23.3px] block w-[26.7px] shrink-0 pl-[4.4px] text-[13px] leading-[52px]">%</span>
              <label className="relative mt-[30.3px] block h-[45px] w-[152.2px] shrink-0"><span className={`pointer-events-none absolute left-0 font-semibold transition-all ${draftBonus ? "top-[2px] text-[10px]" : "top-[13px] text-[13px]"}`}>{t("Бонус")}</span><input value={draftBonus} onChange={(event) => setDraftBonus(event.target.value.replace(/[^\d.]/g, ""))} className="absolute inset-x-0 top-0 h-[36px] border-b border-[#e0e0e0] bg-transparent pt-[10px] text-[13px] font-semibold text-black outline-none focus:border-[#5d6474]" /></label>
              <RefSelect clearable className="ml-[15.9px] mt-[31.3px] w-[236.3px] shrink-0" label={t("Тип расчета")} value={draftCalc} onChange={setDraftCalc} options={Object.values(CALC_LABELS).map((label) => t(label))} />
              <Check className="ml-[16px] mt-[25.3px] w-[236.3px] shrink-0 !items-center" labelClass="w-[176.3px]" checked={draftExclude} label={t("Обнулить предыдущие уровни")} onToggle={() => setDraftExclude((current) => !current)} />
              <button type="button" onClick={addLevel} aria-label={t("Добавить уровень")} className="absolute right-[19px] top-[27.3px] flex h-[48px] w-[48px] items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg></button>
            </div>
            {error && <p className="ml-[30px] mt-[12px] text-[12px] text-[#e53935]">{error}</p>}
            {levels.length > 0 && (
              <div className="ml-[22px] mr-[18px] mt-[11px]">
                <div className="grid h-[50px] grid-cols-[168.2px_168.2px_84.1px_168.2px_168.2px_168.2px_1fr] items-center border-b border-dotted border-[#ccc] font-semibold">
                  <span>№</span><span>{t("От")}</span><span>{t("До")}</span><span>{t("Бонус")}</span><span>{t("Тип расчета")}</span><span>{t("Обнуление уровней")}</span><span />
                </div>
                {levels.map((level, index) => ({ level, index })).reverse().map(({ level, index }) => (
                  <div key={index} className="grid min-h-[50px] grid-cols-[168.2px_168.2px_84.1px_168.2px_168.2px_168.2px_1fr] items-center border-b border-dotted border-[#ccc] font-semibold">
                    <span>{index + 1}</span>
                    <span>{level.from} %</span>
                    <span>{level.to} %</span>
                    <span>{level.bonus}</span>
                    <span className="pr-[8px] leading-[16.2px]">{calcLabel(level.calc)}</span>
                    <b className="font-black">{t(level.exclude ? "Включено" : "Отключено")}</b>
                    <button type="button" aria-label={t("Удалить")} onClick={() => setLevels((current) => current.filter((_, i) => i !== index))} className="justify-self-start pl-[18.8px]"><svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex h-[60px] shrink-0 items-center justify-end border-t border-[#eee] pb-[3px] pr-[10px]">
        <button type="submit" disabled={saving} className="h-[36px] px-4 text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
      </div>
    </form>,
    document.body,
  )
}
