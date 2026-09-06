export type Warehouse = {
  id: number
  name: string
  address: string
  branch: string
  manager: string
  createdDate: string
  online: boolean
  active: boolean
}

const managers = ["Admin Ritm", "Админ 1", "A Rustam", "Asad Asadov", "Samandar Abdurahmonov", "Temur Raupov"]
const branchPool = ["Buxoro", "samarqand", "mozdini", "Ташкент", "Bobomotors", "korea kosmetika", "toshkent", "Surxandaryo", "Andijon skladi", "Farg'ona"]
const addressPool = ["Adana", "Toshkent", "Тест Магазин 01", "Tashkent", "RITM", "Andijon skladi", "Surxandaryo", "Namangan", "Buxoro shahri"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function fmt(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownActive: Omit<Warehouse, "active">[] = [
  { id: 59, name: "05,08,2025(1)", address: "Adana", branch: "Buxoro", manager: "Admin Ritm", createdDate: "05 авг. 2025", online: false },
  { id: 60, name: "05,08,2025(2)", address: "Adana", branch: "samarqand", manager: "Admin Ritm", createdDate: "05 авг. 2025", online: false },
  { id: 7, name: "11111", address: "11222", branch: "Mirzo Ulugbek1", manager: "Admin Ritm", createdDate: "23 сент. 2024", online: true },
  { id: 64, name: "123 test", address: "Toshkent", branch: "mozdini", manager: "Asad Asadov", createdDate: "13 сент. 2025", online: false },
  { id: 72, name: "250607250607", address: "Тест Магазин 01", branch: "Buxoro", manager: "Admin Ritm", createdDate: "30 сент. 2025", online: false },
  { id: 22, name: "878", address: "Tashkent", branch: "Ташкент", manager: "Админ 1", createdDate: "12 июня 2025", online: true },
  { id: 99, name: "All", address: "RITM", branch: "Bobomotors", manager: "Admin Ritm", createdDate: "30 янв. 2026", online: false },
  { id: 13, name: "Andijon skladi", address: "Andijon skladi", branch: "korea kosmetika", manager: "A Rustam", createdDate: "28 дек. 2024", online: true },
  { id: 8, name: "ANGOR", address: "Surxandaryo", branch: "toshkent", manager: "Admin Ritm", createdDate: "04 окт. 2024", online: false },
  { id: 24, name: "anjan marajni", address: "Tashkent", branch: "Ташкент", manager: "Админ 1", createdDate: "12 июня 2025", online: true },
]

const ACTIVE_TOTAL = 105

function buildWarehouses(): Warehouse[] {
  const rows: Warehouse[] = knownActive.map((row) => ({ ...row, active: true }))
  const knownIds = new Set(knownActive.map((row) => row.id))
  const baseline = new Date(2025, 7, 5)
  const namePool = ["baby still (сирия)", "sklad 11", "Яндекс Лавка", "ПРОФРЕШ", "Suhrob sklad", "основной", "Asosiy ombor", "Xomashyo", "Tayyor mahsulotlar", "Zaxira sklad"]

  let id = 1
  while (rows.length < ACTIVE_TOTAL) {
    if (!knownIds.has(id)) {
      const date = new Date(baseline)
      date.setDate(date.getDate() - id * 3)
      rows.push({
        id,
        name: `${namePool[id % namePool.length]}${id % 4 === 0 ? ` ${id}` : ""}`,
        address: addressPool[id % addressPool.length],
        branch: branchPool[id % branchPool.length],
        manager: managers[id % managers.length],
        createdDate: fmt(date),
        online: id % 3 === 0,
        active: true,
      })
    }
    id += 1
  }

  const inactiveNames = ["Закрытый склад Юг", "Старый филиал", "Тест удалён", "Демо склад", "Резерв 2024", "Списан 2023", "Временный склад", "Архив Ташкент", "Архив Бухара", "Неактуальный", "Пробный склад", "Старая точка"]
  for (let index = 0; index < inactiveNames.length; index += 1) {
    const date = new Date(2024, index % 12, 10 + index)
    rows.push({
      id: 200 + index,
      name: inactiveNames[index],
      address: addressPool[index % addressPool.length],
      branch: branchPool[index % branchPool.length],
      manager: managers[index % managers.length],
      createdDate: fmt(date),
      online: false,
      active: false,
    })
  }

  return rows
}

export const warehouseBranchPool = branchPool
export const warehouseManagerPool = managers
export const seedWarehouses: Warehouse[] = buildWarehouses()
