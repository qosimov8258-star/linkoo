export type InventoryItem = {
  id: number
  serialNumber: string
  client: string
  inventoryType: string
  inventoryCode: string
  warehouse: string
  condition: string
  responsible: string
  attachDate: string
  createdDate: string
  checkDate: string
  approved: boolean
}

export const inventoryConditions = ["Новый", "Хороший", "Средний"]
export const inventoryResponsibles = ["Admin Ritm", "Тп 2 Алиса", "Тп 1 Исмоилов Гани"]
export const inventoryWarehouses = ["05,08,2025(1)", "toshkent", "Бухоро склад", "Яндекс Лавка", "ОЧАКОВО", "sklad tayoriga", "Suhrob sklad"]
export const inventoryProductTypes = ["g'ilof", "coca-cola", "Холодильник", "test inventar", "lipton", "Muzlatkich 2", "Marojna Xaladilnik", "Polka Xrusti"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
export function formatInventoryDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}
