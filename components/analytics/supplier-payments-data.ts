export type SupplierPaymentRow = {
  id: number
  supplier: string
  createdBy: string
  paidAt: string
  organization: string
  amount: number
  currency: "SUM" | "USD"
  cashAmount: number
  kassa: string
  comment: string
  icon: "cash" | "card"
}

export const initialSupplierPayments: SupplierPaymentRow[] = [
  { id: 519, supplier: "Fardad", createdBy: "Admin Ritm", paidAt: "17 дек. 2025, 10:37", organization: "05,08,2025", amount: 2876008, currency: "SUM", cashAmount: 0, kassa: "Salohiddin Kassa Tashkent", comment: "Не указано", icon: "cash" },
  { id: 496, supplier: "PGC", createdBy: "Admin Ritm", paidAt: "23 янв. 2026, 11:28", organization: "baby still", amount: 2700000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 428, supplier: "ali aliyev", createdBy: "Admin Ritm", paidAt: "30 дек. 2025, 17:51", organization: "7777", amount: 1000, currency: "SUM", cashAmount: 0, kassa: "Salohiddin Kassa Tashkent", comment: "test", icon: "cash" },
  { id: 390, supplier: "ali aliyev", createdBy: "Admin Ritm", paidAt: "15 дек. 2025, 22:40", organization: "05,08,2025", amount: 10000000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 382, supplier: "Demo", createdBy: "Admin Ritm", paidAt: "10 дек. 2025, 12:12", organization: "05,08,2025", amount: 1000000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "test", icon: "card" },
  { id: 342, supplier: "Otash", createdBy: "Admin Ritm", paidAt: "25 окт. 2025, 08:16", organization: "05,08,2025", amount: 123465, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "test", icon: "card" },
  { id: 337, supplier: "Sarvar", createdBy: "Admin Ritm", paidAt: "13 окт. 2025, 15:11", organization: "05,08,2025", amount: 150000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 319, supplier: "Aqua de lux", createdBy: "Admin Ritm", paidAt: "03 окт. 2025, 16:03", organization: "878", amount: 650000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 305, supplier: "RITM TEST", createdBy: "Admin Ritm", paidAt: "25 сент. 2025, 10:44", organization: "878", amount: 39526, currency: "USD", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 243, supplier: "SaidQosimov", createdBy: "Admin Ritm", paidAt: "30 июля 2025, 14:09", organization: "Ichimliklar", amount: 1000000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 200, supplier: "Fardad", createdBy: "Admin Ritm", paidAt: "18 июня 2025, 09:21", organization: "05,08,2025", amount: 1200000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 185, supplier: "Otash", createdBy: "Admin Ritm", paidAt: "02 июня 2025, 14:47", organization: "05,08,2025", amount: 850505, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "cash" },
  { id: 170, supplier: "PGC", createdBy: "Admin Ritm", paidAt: "21 мая 2025, 11:03", organization: "baby still", amount: 2000000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 155, supplier: "Demo", createdBy: "Admin Ritm", paidAt: "09 мая 2025, 16:58", organization: "05,08,2025", amount: 300000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "test", icon: "card" },
  { id: 140, supplier: "Sarvar", createdBy: "Admin Ritm", paidAt: "27 апр. 2025, 10:14", organization: "05,08,2025", amount: 1000000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 125, supplier: "Aqua de lux", createdBy: "Admin Ritm", paidAt: "15 апр. 2025, 13:36", organization: "878", amount: 640000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "cash" },
  { id: 110, supplier: "SaidQosimov", createdBy: "Admin Ritm", paidAt: "02 апр. 2025, 08:52", organization: "Ichimliklar", amount: 750000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 95, supplier: "ali aliyev", createdBy: "Admin Ritm", paidAt: "20 мар. 2025, 17:29", organization: "05,08,2025", amount: 1300000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 80, supplier: "RITM TEST", createdBy: "Admin Ritm", paidAt: "06 мар. 2025, 12:11", organization: "878", amount: 500000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
  { id: 65, supplier: "Fardad", createdBy: "Admin Ritm", paidAt: "19 февр. 2025, 09:47", organization: "05,08,2025", amount: 1000000, currency: "SUM", cashAmount: 0, kassa: "naqd", comment: "Не указано", icon: "card" },
]
