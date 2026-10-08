import type { PriceListEntry } from "./products-data"

export type { PriceListEntry }

export type RawMaterial = {
  id: number
  name: string
  fullName: string
  barcode: string
  article: string
  type: string
  organization: string
  unit: string
  subUnit: string
  createdDate: string
  orderNumber: string
  supplier: string
  brand: string
  minStock: string
  color: string
  integrationCode: string
  mass: string
  netWeight: string
  volume: string
  description: string
  canSell: boolean
  onlyMml: boolean
  perfectStore: boolean
  showAsInventory: boolean
  groupOnly: boolean
  showInBot: boolean
  trackExpiry: boolean
  markedProduct: boolean
  limitPrice: boolean
  group: string
  ikpu: string
  invoiceUnitCode: string
  vat: string
  salePoints: string
  priceLists: PriceListEntry[]
  priceMin: number
  priceMax: number
}

export const rawMaterialOrganizations = ["05,08,2025", "Konditerka", "Dosya organization", 'ООО "ТестМаркет"', "1112233"]
export const rawMaterialUnits = ["шт", "новый шт", "kg", "kilogram", "Qop", "коробка", "block", "Gr"]
export const rawMaterialVatOptions = ["Без НДС", "0%", "12%", "15%"]
export const rawMaterialPriceListOptions = ["donalik", "o'rtacha narx", "optom narxlar", "Розница", "Опт"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
export function formatRawMaterialDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

function baseFlags() {
  return {
    onlyMml: false, perfectStore: false, showAsInventory: false, groupOnly: false, showInBot: true, trackExpiry: false,
    markedProduct: false, limitPrice: false, group: "", ikpu: "", invoiceUnitCode: "", vat: rawMaterialVatOptions[0], salePoints: "0",
  }
}

function priceFields(): Pick<RawMaterial, "priceLists" | "priceMin" | "priceMax"> {
  return { priceLists: [], priceMin: 0, priceMax: 0 }
}

const knownRows: RawMaterial[] = [
  { id: 1, name: "demotest_proizvotsva_2", fullName: "demotest_proizvotsva_2", barcode: "21307444130618", article: "", type: "ichimlik", organization: "05,08,2025", unit: "block", subUnit: "100 новый шт", createdDate: "27 янв. 2026", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 2, name: "test poizvotva", fullName: "test poizvotva", barcode: "22789740436175", article: "", type: "ichimlik suvi", organization: "05,08,2025", unit: "kilogram", subUnit: "1 000 Gr", createdDate: "27 янв. 2026", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 3, name: "Kotlet", fullName: "Kotlet", barcode: "не установлен", article: "", type: "54455", organization: "05,08,2025", unit: "новый шт", subUnit: "", createdDate: "16 янв. 2026", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 4, name: "Un", fullName: "Un", barcode: "не установлен", article: "", type: "54455", organization: "05,08,2025", unit: "Qop", subUnit: "50 kilogram", createdDate: "16 янв. 2026", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 5, name: "Sugar", fullName: "Sugar", barcode: "не установлен", article: "", type: "energetik", organization: "Konditerka", unit: "kilogram", subUnit: "", createdDate: "12 янв. 2026", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 6, name: "Sweet 101", fullName: "Sweet 101", barcode: "не установлен", article: "", type: "gutyutu", organization: "Dosya organization", unit: "коробка", subUnit: "", createdDate: "10 янв. 2026", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 7, name: "тесто", fullName: "тесто", barcode: "не установлен", article: "", type: "сырье", organization: 'ООО "ТестМаркет"', unit: "kg", subUnit: "", createdDate: "10 дек. 2025", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 8, name: "Банан СУЛТАНА КУК", fullName: "Банан СУЛТАНА КУК", barcode: "не установлен", article: "", type: "54455", organization: "1112233", unit: "коробка", subUnit: "", createdDate: "27 нояб. 2025", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 9, name: "видеокарта", fullName: "видеокарта", barcode: "не установлен", article: "", type: "ACER Aspire", organization: 'ООО "ТестМаркет"', unit: "шт", subUnit: "", createdDate: "22 нояб. 2025", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
  { id: 10, name: "материнка", fullName: "материнка", barcode: "не установлен", article: "", type: "ACER Aspire", organization: 'ООО "ТестМаркет"', unit: "шт", subUnit: "", createdDate: "22 нояб. 2025", orderNumber: "", supplier: "Не указано", brand: "No brand", minStock: "0", color: "Не указано", integrationCode: "", mass: "0", netWeight: "0", volume: "Не указано", description: "Не указано", canSell: true, ...baseFlags(), ...priceFields() },
]

export const seedRawMaterials: RawMaterial[] = knownRows
