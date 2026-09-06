export type IncomingPaymentType = "Банковский счет" | "Наличный"
export type IncomingStatus = "принят" | "ожидает" | "отменен"

export type IncomingItem = {
  id: number
  product: string
  expiry: string
  qty: number
  block: number
  kg: number
  netWeight: number
  cost: number
  total: number
}

export type Incoming = {
  id: number
  supplier: string
  warehouse: string
  date: string
  paymentType: IncomingPaymentType
  contractNumber: string
  amount: number
  status: IncomingStatus
  invoiceNumber: string
  organization: string
  branch: string
  phone: string
  email: string
  initiator: string
  paid: number
  time: string
  comment: string
  items: IncomingItem[]
}

export const incomingSuppliers = ["Fardad", "Инвентаризация", "карим", "tillochi", "ANGOR MChJ", "Nestle Uzbekistan"]
export const incomingWarehouses = ["Andijon skladi", "основной", "ANGOR", "Toshkent skladi", "Buxoro skladi"]
export const incomingBranches = ["Toshkent", "Buxoro", "Andijon", "Samarqand", "Farg'ona"]
export const incomingOrganizations = ["05,08,2025", "Linko Distribution", "Linko Trade"]
export const incomingPaymentTypes: IncomingPaymentType[] = ["Банковский счет", "Наличный"]
export const incomingProducts = ["coca-cola", "lipton", "sprayt", "energetik", "g'ilof", "baby still", "Lalaku", "Холодильник"]

const monthNames = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
]

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownRows: Omit<Incoming, "organization" | "branch" | "phone" | "email" | "initiator" | "paid" | "time" | "comment" | "items">[] = [
  { id: 351, supplier: "Fardad", warehouse: "Andijon skladi", date: "06 июля 2026", paymentType: "Банковский счет", contractNumber: "", amount: 256800, status: "принят", invoiceNumber: "" },
  { id: 350, supplier: "Fardad", warehouse: "Andijon skladi", date: "23 июня 2026", paymentType: "Банковский счет", contractNumber: "", amount: 25400, status: "ожидает", invoiceNumber: "" },
  { id: 349, supplier: "Fardad", warehouse: "Andijon skladi", date: "23 июня 2026", paymentType: "Наличный", contractNumber: "", amount: 2000, status: "принят", invoiceNumber: "" },
  { id: 348, supplier: "Инвентаризация", warehouse: "05,08,2025(1)", date: "14 мая 2026", paymentType: "Наличный", contractNumber: "", amount: 205.22, status: "принят", invoiceNumber: "" },
  { id: 346, supplier: "Инвентаризация", warehouse: "Andijon skladi", date: "22 апр. 2026", paymentType: "Наличный", contractNumber: "", amount: 10000, status: "принят", invoiceNumber: "" },
  { id: 345, supplier: "Fardad", warehouse: "основной", date: "20 апр. 2026", paymentType: "Банковский счет", contractNumber: "", amount: 300000, status: "принят", invoiceNumber: "" },
  { id: 344, supplier: "Fardad", warehouse: "Andijon skladi", date: "14 апр. 2026", paymentType: "Банковский счет", contractNumber: "", amount: 100, status: "ожидает", invoiceNumber: "" },
  { id: 343, supplier: "карим", warehouse: "ANGOR", date: "11 апр. 2026", paymentType: "Банковский счет", contractNumber: "", amount: 120708500, status: "принят", invoiceNumber: "" },
  { id: 342, supplier: "Fardad", warehouse: "основной", date: "10 апр. 2026", paymentType: "Банковский счет", contractNumber: "19", amount: 36000, status: "принят", invoiceNumber: "" },
  { id: 341, supplier: "tillochi", warehouse: "Andijon skladi", date: "06 апр. 2026", paymentType: "Наличный", contractNumber: "", amount: 36212550, status: "принят", invoiceNumber: "" },
]

function seededItems(id: number, amount: number): IncomingItem[] {
  const product = incomingProducts[id % incomingProducts.length]
  const qty = 1 + (id % 12)
  const cost = Math.round((amount / qty) * 100) / 100
  return [{ id: 1, product, expiry: "", qty, block: 0, kg: 0, netWeight: 0, cost, total: amount }]
}

function generateRows(): Incoming[] {
  const baseline = new Date(2026, 3, 6)
  const statusPool: IncomingStatus[] = ["принят", "принят", "принят", "принят", "ожидает", "принят", "принят", "отменен"]
  const rows: Incoming[] = []

  for (const row of knownRows) {
    rows.push({
      ...row,
      organization: "05,08,2025",
      branch: "Buxoro",
      phone: "Не указан",
      email: "Не указан",
      initiator: "Admin Ritm",
      paid: 0,
      time: "14 мая 2026, 13:20",
      comment: "",
      items: seededItems(row.id, row.amount),
    })
  }

  for (let id = 340; id >= 37; id -= 1) {
    if (id === 347) continue
    const offsetDays = (341 - id) * 3
    const date = new Date(baseline)
    date.setDate(date.getDate() - offsetDays)
    const supplier = incomingSuppliers[id % incomingSuppliers.length]
    const warehouse = incomingWarehouses[id % incomingWarehouses.length]
    const paymentType = incomingPaymentTypes[id % incomingPaymentTypes.length]
    const status = statusPool[id % statusPool.length]
    const amount = 5000 + ((id * 3733) % 480000)
    rows.push({
      id,
      supplier,
      warehouse,
      date: formatDate(date),
      paymentType,
      contractNumber: id % 5 === 0 ? String(10 + (id % 40)) : "",
      amount,
      status,
      invoiceNumber: "",
      organization: incomingOrganizations[id % incomingOrganizations.length],
      branch: incomingBranches[id % incomingBranches.length],
      phone: "Не указан",
      email: "Не указан",
      initiator: "Admin Ritm",
      paid: status === "принят" ? amount : 0,
      time: `${formatDate(date)}, ${String(8 + (id % 10)).padStart(2, "0")}:${String((id * 7) % 60).padStart(2, "0")}`,
      comment: "",
      items: seededItems(id, amount),
    })
  }

  return rows
}

export const seedIncomings: Incoming[] = generateRows()
