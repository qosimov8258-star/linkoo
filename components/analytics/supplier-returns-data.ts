export type ReturnStatus = "завершен" | "в процессе" | "отменен"

export type ReturnItem = { id: number; product: string; qty: number; series: string; price: number; total: number }

export type SupplierReturn = {
  id: number
  fromWhom: string
  warehouse: string
  addedBy: string
  date: string
  time: string
  amount: number
  status: ReturnStatus
  organization: string
  currency: string
  paymentType: string
  priceList: string
  branch: string
  transferTime: string
  /** Who handed the goods over to the supplier ("Передал"). */
  transferredBy: string
  cancelledAt: string
  cancelledBy: string
  reason: string
  items: ReturnItem[]
}

export const returnSuppliers = ["ali aliyev", "Otash", "Sarvar", "name of supply", "qarzdorman", "SaidQosimov", "PAM", "Salohiddin Pastavshik 1"]
export const returnWarehouses = ["sklad 11", "Яндекс Лавка", "toshkent", "Andijon skladi", "Said Qosimov", "11111", "Salohiddin Farg'ona Sklad"]
export const returnBranches = ["777", "878", "agent", "Andijon", "Buxoro"]
export const returnOrganizations = ["ТестоваяОрганизация", "Linko Distribution"]
export const returnPriceLists = ["donalik", "11111", "savdo", "Bozor narx"]
export const returnPaymentTypes = ["банковский счет", "наличный"]
export const returnProducts = ["energetik 1 l", "coca-cola", "lipton", "sprayt", "baby still", "g'ilof"]
