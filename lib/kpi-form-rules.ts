// Rules of the reference's "Добавление KPI" form: which options a plan type ("Правила отбора") shows.
// Read from app.linko.uz by choosing every plan type and diffing the dialog.

export const KPI_PLANS = [
  { code: "sales_sum", label: "Сумма фактической продажи (продажа - возврат)" },
  { code: "product_sales_amount", label: "Кол-во фактической продажи (продажа - возврат)" },
  { code: "sales_sum_order", label: "Сумма продаж (продажа-возврат от продаж)" },
  { code: "product_sales_amount_order", label: "Кол-во продаж (продажа-возврат от продаж)" },
  { code: "activate_count", label: "Активация неактивных" },
  { code: "active_client_count", label: "АКБ" },
  { code: "active_client_count_by_day", label: "Дневной АКБ" },
  { code: "payment_to_cashbox", label: "Оплата (принятые на кассу)" },
  { code: "product_sales_weight", label: "Вес фактической продажи (продажа - возврат)" },
  { code: "visit", label: "Визит" },
  { code: "attendance", label: "Посещение" },
  { code: "delivered_weight", label: "Вес фактической доставки" },
  { code: "delivered_product_amount", label: "Кол-во доставленных продуктов" },
  { code: "delivered_order_sum", label: "Сумма доставки (продажа-возврат от продаж)" },
  { code: "payed_market_count", label: "Количество оплативших клиентов" },
  { code: "mml", label: "Индикатор ММЛ / АКБ" },
  { code: "plan_visit_by_day", label: "Плановый Визит ПО ДНЯМ" },
  { code: "perfect_store_visit_percent", label: "Perfect Store (% от визитов)" },
  { code: "order_count", label: "Количество заказов" },
] as const

export type KpiPlanCode = (typeof KPI_PLANS)[number]["code"]

export type KpiPlanRule = {
  /** Blue hint under the list of plan types. */
  desc: string
  ownAgents: boolean
  blocks: boolean
  priceList: boolean
  planMonth: boolean
  userTypes: boolean
  /** "Дополнительные условия" with the order / return / attendance statuses. */
  conditions: boolean
  orderStatus: boolean
  returnStatus: boolean
  attendance: boolean
  orderDate: boolean
  returnDate: boolean
  hidePaid: boolean
  hideProducts: boolean
  hideTransport: boolean
  hideMml: boolean
}

const BASE: KpiPlanRule = {
  desc: "",
  ownAgents: false,
  blocks: false,
  priceList: false,
  planMonth: false,
  userTypes: false,
  conditions: false,
  orderStatus: false,
  returnStatus: false,
  attendance: false,
  orderDate: false,
  returnDate: false,
  hidePaid: false,
  hideProducts: false,
  hideTransport: false,
  hideMml: false,
}

const rule = (patch: Partial<KpiPlanRule>): KpiPlanRule => ({ ...BASE, ...patch })

const FULL_RETURN = "Не учитываются заказы с полным возвратом !"

export const KPI_PLAN_RULES: Record<KpiPlanCode, KpiPlanRule> = {
  sales_sum: rule({
    desc: "Сумма продажи за период минус сумма возврата за период. Учитывается все возвраты создание в указанном периоде в т.ч возвраты со старой базы !",
    ownAgents: true,
    priceList: true,
    conditions: true,
    orderStatus: true,
    returnStatus: true,
    orderDate: true,
    returnDate: true,
  }),
  product_sales_amount: rule({
    desc: "Количество продуктов проданных за период минус количество продуктов возвращенных за период. Учитывается все возвраты создание в указанном периоде в т.ч возвраты со старой базы !",
    ownAgents: true,
    blocks: true,
    conditions: true,
    orderStatus: true,
    returnStatus: true,
    orderDate: true,
    returnDate: true,
  }),
  sales_sum_order: rule({
    desc: "Сумма продажи за период минус сумма возврата от этих продаж !",
    ownAgents: true,
    priceList: true,
    conditions: true,
    orderStatus: true,
    orderDate: true,
  }),
  product_sales_amount_order: rule({
    desc: "Количество продуктов проданных за период минус количество продуктов возвращенных по заказам проданных за период !",
    ownAgents: true,
    blocks: true,
    priceList: true,
    conditions: true,
    orderStatus: true,
    orderDate: true,
  }),
  activate_count: rule({ desc: FULL_RETURN, ownAgents: true, hideProducts: true, hideMml: true }),
  active_client_count: rule({ desc: FULL_RETURN, ownAgents: true, userTypes: true, conditions: true, orderStatus: true, orderDate: true }),
  active_client_count_by_day: rule({ ownAgents: true, userTypes: true, conditions: true, orderStatus: true, returnStatus: true, orderDate: true, returnDate: true }),
  payment_to_cashbox: rule({ ownAgents: true, hidePaid: true, hideProducts: true, hideTransport: true, hideMml: true }),
  product_sales_weight: rule({
    desc: "Вес продуктов проданных за период - вес продуктов возвращенных по заказам проданных за период !",
    ownAgents: true,
    planMonth: true,
    conditions: true,
    orderStatus: true,
    orderDate: true,
  }),
  visit: rule({ ownAgents: true, conditions: true, hidePaid: true, hideProducts: true, hideTransport: true }),
  attendance: rule({ conditions: true, attendance: true, hidePaid: true, hideProducts: true, hideTransport: true }),
  delivered_weight: rule({ userTypes: true, conditions: true, orderDate: true, hideProducts: true }),
  delivered_product_amount: rule({ blocks: true, userTypes: true, orderDate: true }),
  delivered_order_sum: rule({ priceList: true, conditions: true, orderStatus: true, orderDate: true }),
  payed_market_count: rule({ ownAgents: true, hidePaid: true, hideTransport: true, hideMml: true }),
  mml: rule({ ownAgents: true, priceList: true, conditions: true, orderStatus: true, returnStatus: true, orderDate: true, returnDate: true, hidePaid: true }),
  plan_visit_by_day: rule({ ownAgents: true, conditions: true, hidePaid: true, hideProducts: true, hideTransport: true }),
  perfect_store_visit_percent: rule({ ownAgents: true, hideMml: true }),
  order_count: rule({ userTypes: true, conditions: true, orderStatus: true, orderDate: true }),
}

/** Plan types whose label is stored instead of the code in older rows. */
export function kpiPlanCode(stored: string): KpiPlanCode | "" {
  const byCode = KPI_PLANS.find((plan) => plan.code === stored)
  if (byCode) return byCode.code
  return KPI_PLANS.find((plan) => plan.label === stored)?.code ?? ""
}

export const KPI_ORDER_STATUSES = [
  { value: "0", label: "Не подтвержден" },
  { value: "1", label: "Есть на складе" },
  { value: "2", label: "Передан доставщику" },
  { value: "3", label: "Доставлен" },
] as const

export const KPI_RETURN_STATUSES = [
  { value: "1", label: "Ожидает" },
  { value: "2", label: "Завершен" },
] as const

export const KPI_ATTENDANCE_STATUSES = [
  { value: "on_time", label: "Во время" },
  { value: "late", label: "Опоздал" },
  { value: "vacation", label: "Отпуск" },
  { value: "sick_leave", label: "Больничный" },
] as const

export const KPI_USER_TYPES = [
  { value: "delivery_man", label: "Доставщик" },
  { value: "expeditor", label: "Экспедитор" },
  { value: "collector", label: "Коллектор" },
  { value: "user", label: "Агент" },
] as const
