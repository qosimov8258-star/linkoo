export type TransferStatus = "принят" | "потвержден" | "отменен"

export type TransferItem = { id: number; product: string; quantity: number; weight: number; price: number }

export type Transfer = {
  id: number
  fromWarehouse: string
  toWarehouse: string
  createdBy: string
  createdAt: string
  deliveredAt: string
  amount: number
  weight: number
  status: TransferStatus
  priceList: string
  organization: string
  invoiceNumber: string
  transportNumber: string
  driver: string
  comment: string
  items: TransferItem[]
}

export const transferWarehouses = ["toshkent", "Manufacturing1", "Яндекс Лавка", "Suhrob sklad", "Toshkent sut ombori", "Центральный склад", "Чиланзарский склад", "123 test"]

const initialTransfers: Transfer[] = [
  { id: 59, fromWarehouse: "toshkent", toWarehouse: "Manufacturing1", createdBy: "Admin Ritm", createdAt: "16 янв. 2026", deliveredAt: "16 янв. 2026", amount: 1200000, weight: 0, status: "принят", priceList: "11111", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "robot moshina", quantity: 12, weight: 0, price: 100000 }] },
  { id: 58, fromWarehouse: "toshkent", toWarehouse: "Manufacturing1", createdBy: "Admin Ritm", createdAt: "09 янв. 2026", deliveredAt: "16 янв. 2026", amount: 78000, weight: 0, status: "принят", priceList: "878", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "g'ilof", quantity: 78, weight: 0, price: 1000 }] },
  { id: 57, fromWarehouse: "toshkent", toWarehouse: "Яндекс Лавка", createdBy: "Admin Ritm", createdAt: "07 янв. 2026", deliveredAt: "07 янв. 2026", amount: 0, weight: 0, status: "принят", priceList: "savdo", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [] },
  { id: 56, fromWarehouse: "toshkent", toWarehouse: "Яндекс Лавка", createdBy: "Admin Ritm", createdAt: "07 янв. 2026", deliveredAt: "07 янв. 2026", amount: 0, weight: 0, status: "потвержден", priceList: "donalik", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "avto 1.3 mator", quantity: 500, weight: 0, price: 0 }] },
  { id: 55, fromWarehouse: "Suhrob sklad", toWarehouse: "toshkent", createdBy: "Admin Ritm", createdAt: "30 дек. 2025", deliveredAt: "30 дек. 2025", amount: 60000, weight: 0, status: "потвержден", priceList: "11111", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "sndwch", quantity: 60, weight: 0, price: 1000 }] },
  { id: 54, fromWarehouse: "Suhrob sklad", toWarehouse: "toshkent", createdBy: "Admin Ritm", createdAt: "30 дек. 2025", deliveredAt: "30 дек. 2025", amount: 60000, weight: 0, status: "потвержден", priceList: "11111", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "sndwch", quantity: 60, weight: 0, price: 1000 }] },
  { id: 53, fromWarehouse: "toshkent", toWarehouse: "Manufacturing1", createdBy: "Admin Ritm", createdAt: "30 дек. 2025", deliveredAt: "30 дек. 2025", amount: 720000, weight: 0, status: "потвержден", priceList: "tovar", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "robot moshina", quantity: 72, weight: 0, price: 10000 }] },
  { id: 52, fromWarehouse: "Suhrob sklad", toWarehouse: "Toshkent sut ombori", createdBy: "Admin Ritm", createdAt: "20 дек. 2025", deliveredAt: "20 дек. 2025", amount: 1500000, weight: 0, status: "потвержден", priceList: "Bozor narx", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "energetik 1 l", quantity: 150, weight: 0, price: 10000 }] },
  { id: 51, fromWarehouse: "Центральный склад", toWarehouse: "Чиланзарский склад", createdBy: "Admin Ritm", createdAt: "10 дек. 2025", deliveredAt: "10 дек. 2025", amount: 45000, weight: 0, status: "принят", priceList: "Шт14", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "g'ilof", quantity: 45, weight: 0, price: 1000 }] },
  { id: 50, fromWarehouse: "toshkent", toWarehouse: "123 test", createdBy: "Admin Ritm", createdAt: "09 дек. 2025", deliveredAt: "17 дек. 2025", amount: 168000, weight: 0, status: "потвержден", priceList: "123123123", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "sndwch", quantity: 168, weight: 0, price: 1000 }] },
]

const generatedTransfers: Transfer[] = Array.from({ length: 36 }, (_, index) => {
  const id = 49 - index
  const from = transferWarehouses[id % transferWarehouses.length]
  const to = transferWarehouses[(id + 3) % transferWarehouses.length]
  const amount = (id * 3721) % 500000
  const status: TransferStatus = id % 4 === 0 ? "отменен" : id % 2 === 0 ? "принят" : "потвержден"
  const day = 1 + (id % 28)
  const month = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."][id % 12]
  const year = id > 20 ? 2025 : 2024
  return {
    id,
    fromWarehouse: from,
    toWarehouse: to,
    createdBy: "Admin Ritm",
    createdAt: `${String(day).padStart(2, "0")} ${month} ${year}`,
    deliveredAt: `${String(day).padStart(2, "0")} ${month} ${year}`,
    amount,
    weight: 0,
    status,
    priceList: "11111",
    organization: "",
    invoiceNumber: "",
    transportNumber: "",
    driver: "",
    comment: "",
    items: [{ id: 1, product: "sndwch", quantity: Math.max(1, Math.round(amount / 1000)), weight: 0, price: 1000 }],
  }
})

export const seedTransfers: Transfer[] = [...initialTransfers, ...generatedTransfers]
