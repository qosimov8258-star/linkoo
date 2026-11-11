import "server-only"

import type { ClientInfo, EmployeeInfo, GearInfo, ProductInfo } from "./directory"
import type { GroupDef } from "./pivot"

// Groupings many models share: what a record tells about its product, its client (a shop) and its people. A model
// passes how to reach the product / client of its record and gets the grouping definitions to list under its ids.

type Of<R, T> = (record: R) => T | undefined

/** Product groupings; `name` is the line's own product name when the product is not in the catalog. */
export function productGroups<R>(product: Of<R, ProductInfo>, name: (record: R) => string, id: (record: R) => number | null | undefined) {
  const text = (pick: (info: ProductInfo) => string): GroupDef<R> => ({ label: (record) => { const info = product(record); return info ? pick(info) : "" } })
  return {
    name: { label: (record) => product(record)?.name || name(record) } as GroupDef<R>,
    id: { label: (record) => id(record) ?? "" } as GroupDef<R>,
    unit: text((info) => info.unit),
    brand: text((info) => info.brand),
    type: text((info) => info.type),
    parentType: text((info) => info.parentType),
    orderNumber: text((info) => info.orderNumber),
    article: text((info) => info.article),
    code: text((info) => info.code),
    barcode: text((info) => info.barcode),
    /** «Группа родитель»: the product itself (this app's products have no group parent). */
    groupParent: { label: (record) => product(record)?.name || name(record) } as GroupDef<R>,
    /** Units in a block. */
    box: { label: (record) => { const info = product(record); return info && info.box > 0 ? info.box : "" } } as GroupDef<R>,
  }
}

/** Client (shop) groupings; `name` is the document's own client name when the client is unknown. */
export function clientGroups<R>(client: Of<R, ClientInfo>, name: (record: R) => string, gear?: Of<R, GearInfo>) {
  const text = (pick: (info: ClientInfo) => string): GroupDef<R> => ({ label: (record) => { const info = client(record); return info ? pick(info) : "" } })
  return {
    name: { label: (record) => client(record)?.name || name(record) } as GroupDef<R>,
    id: { label: (record) => client(record)?.id ?? "" } as GroupDef<R>,
    inn: text((info) => info.inn),
    code: text((info) => info.code),
    type: text((info) => info.type),
    zone: text((info) => info.zone),
    agent: text((info) => info.agent),
    deliverer: text((info) => info.deliverer),
    contact: text((info) => info.contact),
    branch: text((info) => info.branch),
    channel: text((info) => info.channel),
    phone: text((info) => info.phone),
    address: text((info) => info.address),
    landmark: text((info) => info.landmark),
    note: text((info) => info.note),
    active: { label: (record) => { const info = client(record); return info ? (info.active ? "Да" : "Нет") : "" } } as GroupDef<R>,
    /** «Категория магазина»: clients of this app carry no store category. */
    category: { label: () => "" } as GroupDef<R>,
    gearCount: { label: (record) => (gear ? (gear(record)?.count ?? 0) : "") } as GroupDef<R>,
    gearNames: { label: (record) => (gear ? (gear(record)?.names ?? "") : "") } as GroupDef<R>,
    attribute: (attribute: string): GroupDef<R> => ({ label: (record) => client(record)?.attributes[attribute] ?? "" }),
  }
}

/** Employee groupings of a person named on a document. */
export function employeeGroups<R>(employee: Of<R, EmployeeInfo>, name: (record: R) => string) {
  return {
    name: { label: (record) => name(record) || employee(record)?.name || "" } as GroupDef<R>,
    id: { label: (record) => employee(record)?.id ?? "" } as GroupDef<R>,
    firstName: { label: (record) => employee(record)?.firstName || name(record).split(" ")[0] || "" } as GroupDef<R>,
    lastName: { label: (record) => employee(record)?.lastName || name(record).split(" ").slice(1).join(" ") } as GroupDef<R>,
    code: { label: (record) => employee(record)?.code ?? "" } as GroupDef<R>,
    supervisor: { label: (record) => employee(record)?.supervisor ?? "" } as GroupDef<R>,
    auditors: { label: (record) => employee(record)?.auditors ?? "" } as GroupDef<R>,
    login: { label: (record) => employee(record)?.login ?? "" } as GroupDef<R>,
  }
}

const PAY_CASH = "Наличные"
const PAY_BANK = "Перечисление"
const DEAL_STANDARD = "Стандартная"
const DEAL_CONSIGNMENT = "Консигнация"
const lower = (value: string) => value.toLocaleLowerCase("ru")

/** «Наличные» / «Перечисление» of a stored payment type (cash / bank codes or their names). */
export function payTypeLabel(...values: (string | null | undefined)[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (!text) continue
    const key = lower(text)
    if (key === "cash" || key === lower(PAY_CASH)) return PAY_CASH
    if (key === "bank" || key === "transfer" || key === lower(PAY_BANK)) return PAY_BANK
    return text
  }
  return ""
}

/** «Стандартная» / «Консигнация» of a stored deal type ("0" / "1", standard / consignment, or a name). */
export function dealTypeLabel(value: string | null | undefined): string {
  const text = String(value ?? "").trim()
  const key = lower(text)
  if (key === "1" || key === "consignment" || key === lower(DEAL_CONSIGNMENT)) return DEAL_CONSIGNMENT
  // "Стандарт" of the order filters is the same deal.
  if (key === "" || key === "0" || key === "standard" || lower(DEAL_STANDARD).startsWith(key)) return DEAL_STANDARD
  return text
}

/** The reference's report builders name two order statuses in their own words: «В пути» is «Передан доставщику»,
 * «Доставлено» is «Доставлен». */
const ORDER_STATUS_WORDS: Record<string, string> = { "В пути": "Передан доставщику", "Доставлено": "Доставлен" }
export const orderStatusLabel = (status: string | null | undefined) => {
  const text = String(status ?? "").trim()
  return ORDER_STATUS_WORDS[text] ?? text
}
export const ORDER_STATUS_OPTIONS = ["В процессе", "Есть на складе", "Передан доставщику", "Доставлен", "Отменен", "Не подтвержден"]

/** A client return's status in the builders' words. */
const RETURN_STATUS_WORDS: Record<string, string> = { pending: "Ожидает", accepted: "Завершен", cancelled: "Отменен" }
export const returnStatusLabel = (status: string | null | undefined) => {
  const text = String(status ?? "").trim()
  return RETURN_STATUS_WORDS[text] ?? text
}
export const RETURN_STATUS_OPTIONS = ["Ожидает", "Завершен", "Отменен"]
export const YES_NO = ["Да", "Нет"]
export const PAY_TYPE_OPTIONS = [PAY_CASH, PAY_BANK]
