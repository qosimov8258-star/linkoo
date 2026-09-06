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

const knownRows: Omit<SupplierReturn, "organization" | "currency" | "paymentType" | "priceList" | "branch" | "transferTime" | "reason" | "items">[] = [
  { id: 22, fromWhom: "ali aliyev", warehouse: "sklad 11", addedBy: "Admin Ritm", date: "29 дек. 2025", time: "17:09", amount: 18000, status: "завершен" },
  { id: 19, fromWhom: "ali aliyev", warehouse: "Яндекс Лавка", addedBy: "Admin Ritm", date: "10 дек. 2025", time: "13:41", amount: 0, status: "завершен" },
  { id: 18, fromWhom: "Otash", warehouse: "toshkent", addedBy: "Admin Ritm", date: "06 нояб. 2025", time: "14:53", amount: 0, status: "завершен" },
  { id: 17, fromWhom: "Sarvar", warehouse: "toshkent", addedBy: "Admin Ritm", date: "27 сент. 2025", time: "12:18", amount: 750, status: "завершен" },
  { id: 16, fromWhom: "name of supply", warehouse: "toshkent", addedBy: "Admin Ritm", date: "22 сент. 2025", time: "13:09", amount: 500000, status: "завершен" },
  { id: 13, fromWhom: "qarzdorman", warehouse: "toshkent", addedBy: "Admin Ritm", date: "03 сент. 2025", time: "15:44", amount: 632500, status: "завершен" },
  { id: 11, fromWhom: "SaidQosimov", warehouse: "Andijon skladi", addedBy: "Admin Ritm", date: "25 июля 2025", time: "16:10", amount: 10000, status: "завершен" },
  { id: 10, fromWhom: "SaidQosimov", warehouse: "Said Qosimov", addedBy: "Admin Ritm", date: "25 июля 2025", time: "15:43", amount: 110000, status: "завершен" },
  { id: 9, fromWhom: "PAM", warehouse: "11111", addedBy: "Admin Ritm", date: "28 июня 2025", time: "12:18", amount: 1107983877, status: "завершен" },
  { id: 8, fromWhom: "Salohiddin Pastavshik 1", warehouse: "Salohiddin Farg'ona Sklad", addedBy: "Admin Ritm", date: "23 июня 2025", time: "09:46", amount: 210000, status: "завершен" },
]

function seededItems(id: number, amount: number): ReturnItem[] {
  if (id === 19) return [{ id: 1, product: "energetik 1 l", qty: 60, series: "2025-12-11", price: 0, total: 0 }]
  const product = returnProducts[id % returnProducts.length]
  const qty = 1 + (id % 40)
  const price = qty ? Math.round(amount / qty) : 0
  return [{ id: 1, product, qty, series: "2025-11-01", price, total: amount }]
}

function generateRows(): SupplierReturn[] {
  const rows: SupplierReturn[] = knownRows.map((row) => ({
    ...row,
    organization: "ТестоваяОрганизация",
    currency: "SUM",
    paymentType: "банковский счет",
    priceList: "donalik",
    branch: "777",
    transferTime: `${row.date}, ${row.time}`,
    reason: "",
    items: seededItems(row.id, row.amount),
  }))

  const extras: [number, string, string, string, number, ReturnStatus][] = [
    [7, "ali aliyev", "sklad 11", "20 июня 2025", 15000, "завершен"],
    [6, "Sarvar", "toshkent", "14 июня 2025", 320000, "в процессе"],
    [4, "Otash", "Andijon skladi", "02 июня 2025", 8500, "завершен"],
    [3, "qarzdorman", "toshkent", "28 мая 2025", 45000, "в процессе"],
    [1, "PAM", "11111", "19 мая 2025", 92000, "завершен"],
  ]

  for (const [id, fromWhom, warehouse, date, amount, status] of extras) {
    rows.push({
      id,
      fromWhom,
      warehouse,
      addedBy: "Admin Ritm",
      date,
      time: `${String(9 + (id % 8)).padStart(2, "0")}:${String((id * 11) % 60).padStart(2, "0")}`,
      amount,
      status,
      organization: "ТестоваяОрганизация",
      currency: "SUM",
      paymentType: "банковский счет",
      priceList: "donalik",
      branch: "777",
      transferTime: `${date}, ${String(9 + (id % 8)).padStart(2, "0")}:${String((id * 11) % 60).padStart(2, "0")}`,
      reason: "",
      items: seededItems(id, amount),
    })
  }

  return rows.sort((a, b) => b.id - a.id)
}

export const seedReturns: SupplierReturn[] = generateRows()
