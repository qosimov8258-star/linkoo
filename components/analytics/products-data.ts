export type PriceListEntry = { name: string; cash: number; nonCash: number; min: number; max: number }
export type ProductTab = "sellable" | "inventory" | "delisted" | "all" | "deleted"

export type Product = {
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
  hasPhoto: boolean
  canSell: boolean
  isInventory: boolean
  deleted: boolean
  onlyMml: boolean
  perfectStore: boolean
  groupOnly: boolean
  trackExpiry: boolean
  manualDiscount: boolean
  hideFromAgent: boolean
  trackSeries: boolean
  subcategory: string
  brand: string
  minStock: string
  description: string
  supplier: string
  integrationCode: string
  volume: string
  weight: string
  netWeight: string
  color: string
  priceLists: PriceListEntry[]
  cost: number
  priceMin: number
  priceMax: number
  priceUpdatedDate: string
}

export const productOrganizations = ["05,08,2025", "DostonFood", "Lalaku", "energetik", "NEW ORG", "Salohiddin Texnika", "HANGUK", "Coca Cola", "robototexnika", "baby still"]
export const productUnits = ["шт", "Dona", "dona", "Qop", "gramm", "коробка", "блок", "Блок", "Коробка"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
export function formatProductDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

export function defaultPriceLists(): PriceListEntry[] {
  return [
    { name: "Крупный опт", cash: 3340, nonCash: 3340, min: 0, max: 0 },
    { name: "Дилерская", cash: 2540, nonCash: 2540, min: 0, max: 0 },
    { name: "Розница", cash: 3950, nonCash: 3950, min: 0, max: 0 },
    { name: "Опт", cash: 3550, nonCash: 3550, min: 0, max: 0 },
    { name: "Талдыкорган Розница", cash: 4110, nonCash: 4110, min: 0, max: 0 },
    { name: "Талдыкорган Опт", cash: 3700, nonCash: 3700, min: 0, max: 0 },
    { name: "Талдыкорган Крупный Опт", cash: 3560, nonCash: 3560, min: 0, max: 0 },
    { name: "Ожидается синхронизация: f909cb1f-0bb8-11f1-b823-9584f0dce932", cash: 3410, nonCash: 3410, min: 0, max: 0 },
    { name: "Ожидается синхронизация: a317f043-0bb8-11f1-b823-9584f0dce932", cash: 3590, nonCash: 3590, min: 0, max: 0 },
  ]
}

function baseFlags() {
  return { onlyMml: false, perfectStore: false, groupOnly: false, trackExpiry: false, manualDiscount: false, hideFromAgent: false, trackSeries: false }
}

function priceFields() {
  return { cost: 0, priceMin: 0, priceMax: 0, priceUpdatedDate: "Не установлена" }
}

const knownSellable: Product[] = [
  {
    id: 1, name: "Arslan 111111", fullName: "Arslan 111111", barcode: "28812949090720", article: "6263",
    type: '02, "OLIVIA" ТВЕРДОЕ МЫЛО', organization: "05,08,2025", unit: "Dona", subUnit: "", createdDate: "22 апр. 2026", orderNumber: "",
    hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(),
    subcategory: "OLIVIA", brand: "OLIVIA", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "6263", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано",
    priceLists: defaultPriceLists(), ...priceFields(),
  },
  {
    id: 2, name: "seriya test", fullName: "seriya test", barcode: "не установлен", article: "EO00720",
    type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "",
    hasPhoto: true, canSell: true, isInventory: false, deleted: false, ...baseFlags(),
    subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00720", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано",
    priceLists: defaultPriceLists(), ...priceFields(),
  },
  {
    id: 3, name: "Масло трансмиссионное EAGLE PEGASUS MULTI ATF 1л (EO00710)", fullName: "Масло трансмиссионное EAGLE PEGASUS MULTI ATF 1л (EO00710)", barcode: "не установлен", article: "EO00710",
    type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "",
    hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(),
    subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00710", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано",
    priceLists: defaultPriceLists(), ...priceFields(),
  },
  { id: 4, name: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 200л (EO00690)", fullName: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 200л (EO00690)", barcode: "не установлен", article: "EO00690", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00690", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 5, name: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 4л (EO00620)", fullName: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 4л (EO00620)", barcode: "не установлен", article: "EO00620", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00620", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 6, name: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 1л (EO00610)", fullName: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 1л (EO00610)", barcode: "не установлен", article: "EO00610", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00610", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 7, name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 200л (EO00590)", fullName: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 200л (EO00590)", barcode: "не установлен", article: "EO00590", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00590", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 8, name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 4л (EO00520)", fullName: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 4л (EO00520)", barcode: "не установлен", article: "EO00520", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00520", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 9, name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 1л (EO00510)", fullName: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 1л (EO00510)", barcode: "не установлен", article: "EO00510", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00510", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 10, name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-30 API SP ILSAC GF-6A 200л (EO00490)", fullName: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-30 API SP ILSAC GF-6A 200л (EO00490)", barcode: "не установлен", article: "EO00490", type: "Eagle", organization: "05,08,2025", unit: "шт", subUnit: "", createdDate: "24 февр. 2026", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Eagle", brand: "Eagle", minStock: "2 шт.", description: "Не указано", supplier: "Fardad", integrationCode: "EO00490", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },

  { id: 11, name: "shkaf3", fullName: "shkaf3", barcode: "22401081206942", article: "", type: "54455", organization: "DostonFood", unit: "Dona", subUnit: "", createdDate: "30 дек. 2025", orderNumber: "", hasPhoto: false, canSell: true, isInventory: true, deleted: false, ...baseFlags(), subcategory: "54455", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 12, name: "test inventar", fullName: "test inventar", barcode: "не установлен", article: "", type: "yutut", organization: "Salohiddin Texnika", unit: "dona", subUnit: "", createdDate: "20 июня 2025", orderNumber: "", hasPhoto: true, canSell: true, isInventory: true, deleted: false, ...baseFlags(), subcategory: "yutut", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 13, name: "moscow prezik", fullName: "moscow prezik", barcode: "27503373236698", article: "", type: "Шоколад", organization: "HANGUK", unit: "коробка", subUnit: "", createdDate: "17 июня 2025", orderNumber: "1000", hasPhoto: false, canSell: true, isInventory: true, deleted: false, ...baseFlags(), subcategory: "Шоколад", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 14, name: "coco cola 1.5l", fullName: "coco cola 1.5l", barcode: "21199989924762", article: "", type: "напитки", organization: "Coca Cola", unit: "Блок", subUnit: "6 dona", createdDate: "25 февр. 2025", orderNumber: "5", hasPhoto: false, canSell: true, isInventory: true, deleted: false, ...baseFlags(), subcategory: "напитки", brand: "Coca Cola", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 15, name: "g'ilof", fullName: "g'ilof", barcode: "не установлен", article: "62", type: "idish", organization: "robototexnika", unit: "шт", subUnit: "", createdDate: "13 февр. 2025", orderNumber: "0", hasPhoto: false, canSell: true, isInventory: true, deleted: false, ...baseFlags(), subcategory: "idish", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "62", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
]

const knownDelisted: Product[] = [
  { id: 16, name: "Coca 2l", fullName: "Coca 2l", barcode: "не установлен", article: "C-123", type: "TypeOne2", organization: "05,08,2025", unit: "блок", subUnit: "12 шт", createdDate: "23 февр. 2026", orderNumber: "", hasPhoto: false, canSell: false, isInventory: false, deleted: false, ...baseFlags(), subcategory: "TypeOne2", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 17, name: "Coca 2l", fullName: "Coca 2l", barcode: "не установлен", article: "C-123", type: "TypeOne", organization: "05,08,2025", unit: "блок", subUnit: "12 шт", createdDate: "23 февр. 2026", orderNumber: "", hasPhoto: false, canSell: false, isInventory: false, deleted: false, ...baseFlags(), subcategory: "TypeOne", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 18, name: "Marojna Xaladilnik", fullName: "Marojna Xaladilnik", barcode: "22567699240980", article: "", type: "Lalaku", organization: "05,08,2025", unit: "Qop", subUnit: "", createdDate: "21 дек. 2025", orderNumber: "", hasPhoto: false, canSell: false, isInventory: true, deleted: false, ...baseFlags(), subcategory: "Lalaku", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 19, name: "Xaladilnik Pepsi", fullName: "Xaladilnik Pepsi", barcode: "21084559722004", article: "", type: "energetik", organization: "05,08,2025", unit: "dona", subUnit: "", createdDate: "21 дек. 2025", orderNumber: "", hasPhoto: false, canSell: false, isInventory: true, deleted: false, ...baseFlags(), subcategory: "energetik", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 20, name: "Polka Xrusti", fullName: "Polka Xrusti", barcode: "не установлен", article: "", type: "idish", organization: "Lalaku", unit: "Dona", subUnit: "", createdDate: "20 дек. 2025", orderNumber: "", hasPhoto: false, canSell: false, isInventory: true, deleted: false, ...baseFlags(), subcategory: "idish", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 21, name: "нон1", fullName: "нон1", barcode: "24983709173513", article: "123321", type: "56756", organization: "Maishiy texnika", unit: "dona", subUnit: "", createdDate: "10 нояб. 2025", orderNumber: "", hasPhoto: true, canSell: false, isInventory: false, deleted: false, ...baseFlags(), subcategory: "56756", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "123321", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 22, name: "туз", fullName: "туз", barcode: "не установлен", article: "", type: "5656", organization: "NEW ORG", unit: "gramm", subUnit: "", createdDate: "21 окт. 2025", orderNumber: "", hasPhoto: false, canSell: false, isInventory: true, deleted: false, ...baseFlags(), subcategory: "5656", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 23, name: "Молии+ йогурт питьевой мульти 285г", fullName: "Молии+ йогурт питьевой мульти 285г", barcode: "не установлен", article: "54455", type: "Коробка", organization: "05,08,2025", unit: "Коробка", subUnit: "12 plok", createdDate: "30 сент. 2025", orderNumber: "", hasPhoto: false, canSell: false, isInventory: false, deleted: false, ...baseFlags(), subcategory: "Коробка", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "54455", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
  { id: 24, name: "Полотенца для очистки поверхностей (100 шт)", fullName: "Полотенца для очистки поверхностей (100 шт)", barcode: "не установлен", article: "", type: "салфетки", organization: "baby still", unit: "коробка", subUnit: "12 пачка", createdDate: "23 сент. 2025", orderNumber: "", hasPhoto: false, canSell: false, isInventory: false, deleted: false, ...baseFlags(), subcategory: "салфетки", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано", integrationCode: "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(), ...priceFields() },
]

export const seedProducts: Product[] = [...knownSellable, ...knownDelisted]
