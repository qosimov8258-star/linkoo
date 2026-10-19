export type SupplierContact = { id: number; name: string; email: string; phone: string }
export type SupplierProduct = { id: number; product: string; qty: number; price: number; currency?: string }
export type Supplier = {
  id: number
  name: string
  category: string
  createdDate: string
  address: string
  branch: string
  organization: string
  contacts: SupplierContact[]
  products: SupplierProduct[]
}

export const supplierCategoryPool = ["Water", "напитки", "Zavod23", "Sardoraka Malochniy", "energetik", "toshkent filial", "Ноутбук", "Компьютер/Орг-техника", "operator", "Бозор", "Диллер"]
export const supplierBranchPool = ["Не указано", "Toshkent", "Buxoro", "Andijon"]
export const supplierOrganizationPool = ["Не указано", "Linko Distribution", "ТестоваяОрганизация"]
const productPool = ["energetik 1 l", "coca-cola", "lipton", "sprayt", "baby still", "g'ilof"]

const monthNames = [
  "янв.", "февр.", "марта", "апр.", "мая", "июня",
  "июля", "авг.", "сент.", "окт.", "нояб.", "дек.",
]

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownRows: Omit<Supplier, "contacts" | "products">[] = [
  { id: 79, name: "Fardad", category: "напитки", createdDate: "31 янв. 2026", address: "Не указано", branch: "Не указано", organization: "Не указано" },
  { id: 78, name: "tillochi", category: "Диллер", createdDate: "12 янв. 2026", address: "Не указано", branch: "Не указано", organization: "Не указано" },
  { id: 77, name: "наблюдатель", category: "Бозор", createdDate: "11 янв. 2026", address: "Ташкет", branch: "Не указано", organization: "Не указано" },
  { id: 76, name: "Zalal Mowafaq", category: "напитки", createdDate: "11 янв. 2026", address: "Не указано", branch: "Не указано", organization: "Не указано" },
  { id: 75, name: "PGC", category: "напитки", createdDate: "11 янв. 2026", address: "Не указано", branch: "Не указано", organization: "Не указано" },
]

function generateRows(): Supplier[] {
  const baseline = new Date(2026, 0, 31)
  const rows: Supplier[] = knownRows.map((row) => ({
    ...row,
    contacts: row.id === 77 ? [{ id: 1, name: "ЫВОмиорвир", email: "", phone: "+99988862648" }] : [],
    products: [],
  }))

  const namePool = ["Nestle Uzbekistan", "PepsiCo Distribution", "Mareven Food", "ANGOR MChJ", "Karim Supply", "Doston Trade", "Global Water", "Uzon Beverages", "Sarvar Group", "Otash Import", "Toshkent Logistics", "Farg'ona Trade"]

  for (let id = 74; id >= 3; id -= 1) {
    const offsetDays = (79 - id) * 5
    const date = new Date(baseline)
    date.setDate(date.getDate() - offsetDays)
    const hasProducts = id % 4 === 0
    rows.push({
      id,
      name: namePool[id % namePool.length] + (id % namePool.length === 0 ? ` #${id}` : ""),
      category: supplierCategoryPool[id % supplierCategoryPool.length],
      createdDate: formatDate(date),
      address: id % 3 === 0 ? "Ташкент" : "Не указано",
      branch: supplierBranchPool[id % supplierBranchPool.length],
      organization: supplierOrganizationPool[id % supplierOrganizationPool.length],
      contacts: id % 5 === 0 ? [{ id: 1, name: namePool[(id + 1) % namePool.length], email: "", phone: `+9989${String(10000000 + id * 137).slice(0, 7)}` }] : [],
      products: hasProducts
        ? [{ id: 1, product: productPool[id % productPool.length], qty: 1 + (id % 30), price: 1000 + (id * 733) % 40000 }]
        : [],
    })
  }

  return rows
}

export const seedSuppliers: Supplier[] = generateRows()
