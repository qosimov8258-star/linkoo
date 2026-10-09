export type Order = {
  id: number
  client: string
  zone: string
  type: string
  product: string
  created: string
  delivery: string
  agent: string
  amount: string
  balance: string
  negative?: boolean
  status: string
  discount?: string
  /** Final payment date (YYYY-MM-DD) — "Ожидаемые оплаты" uses it as "Дата оплаты". */
  paymentDate?: string
  /** "cash" | "bank" */
  paymentType?: string
  organization?: string
}

export const statuses = ["Есть на складе", "В пути", "Доставлено", "Отменен"]

export const initialOrders: Order[] = [
  { id: 1584, client: "Tinchlik market", zone: "spark", type: "market", product: "ddr", created: "25 июля 17:17", delivery: "25 июля 2026", agent: "Admin Ritm", amount: "788,39 USD", balance: "6 970 000 SUM", status: statuses[0] },
  { id: 1583, client: "Tinchlik market", zone: "spark", type: "market", product: "baby still", created: "25 июля 17:13", delivery: "25 июля 2026", agent: "Admin Ritm", amount: "0,36 USD", balance: "6 970 000 SUM", status: statuses[0] },
  { id: 1581, client: "magazin", zone: "", type: "market", product: "NEW ORG", created: "05 июня 11:10", delivery: "06 июня 2026", agent: "Admin Ritm", amount: "130 USD", balance: "2 653 000 SUM", status: statuses[0] },
  { id: 1580, client: "Doston market", zone: "spark", type: "chakana savdo", product: "NEW ORG", created: "01 июня 23:03", delivery: "01 июня 2026", agent: "Admin Ritm", amount: "50 000 SUM", balance: "-220 000 SUM", negative: true, status: statuses[1] },
  { id: 1579, client: "Ashraf Hakimi", zone: "spark", type: "chakana savdo", product: "DostonFood", created: "24 мая 11:49", delivery: "17 июля 2026", agent: "Admin Ritm", amount: "1 171 800 SUM", balance: "0 SUM", status: statuses[2] },
  { id: 1578, client: "Ashraf Hakimi", zone: "spark", type: "chakana savdo", product: "energetik", created: "24 мая 11:49", delivery: "17 июля 2026", agent: "Admin Ritm", amount: "250 000 000 SUM", balance: "0 SUM", status: statuses[2] },
  { id: 1576, client: "Частное Лицо", zone: "Andijon shaharchasi", type: "Юр. лицо", product: "05,08,2025", created: "12 мая 13:48", delivery: "13 мая 2026", agent: "Samandar Abdurahmonov", amount: "0 SUM", balance: "-773 375 SUM", negative: true, status: statuses[0] },
  { id: 1573, client: "Android", zone: "spark", type: "Розничный", product: "robototexnika", created: "01 мая 11:47", delivery: "02 мая 2026", agent: "Admin Ritm", amount: "2 USD", balance: "92 643 690 003,5 SUM", status: statuses[0] },
  { id: 1571, client: "Частное Лицо", zone: "Andijon shaharchasi", type: "Юр. лицо", product: "05,08,2025", created: "25 апр. 13:22", delivery: "08 мая 2026", agent: "Admin Ritm", amount: "150 000 SUM", balance: "-773 375 SUM", negative: true, status: statuses[0] },
  { id: 1540, client: "Klient_Karim110", zone: "", type: "market109", product: "energetik", created: "03 февр. 14:18", delivery: "06 февр. 2026", agent: "Temur Raupov", amount: "50 000 SUM", balance: "0 SUM", status: statuses[2] },
]
