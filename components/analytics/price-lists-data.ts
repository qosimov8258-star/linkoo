export type PriceList = { id: number; name: string; currency: string; createdDate: string; linkedList: string; calcMethod: string }

export const priceListCurrencies = ["SUM", "USD", "EUR"]
export const priceListCalcMethods = ["Не указано", "Фиксированная наценка", "Процент от себестоимости", "Как в связанном прайс-листе"]

export const knownPriceLists: PriceList[] = [
  { id: 12, name: "donalik", currency: "SUM", createdDate: "26 дек. 2024", linkedList: "Bozor narx", calcMethod: "Не указано" },
  { id: 18, name: "o'rtacha narx", currency: "SUM", createdDate: "20 февр. 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 21, name: "optom narxlar", currency: "SUM", createdDate: "27 февр. 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 22, name: "ООО ПРОФШ", currency: "USD", createdDate: "11 июня 2025", linkedList: "optomga", calcMethod: "Не указано" },
  { id: 24, name: "123123123", currency: "SUM", createdDate: "11 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 31, name: "TestPriceList", currency: "USD", createdDate: "16 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 33, name: "Orbit", currency: "SUM", createdDate: "17 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 34, name: "Прайс-лист для ноутбуков Apple", currency: "USD", createdDate: "17 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 35, name: "PEPSI", currency: "SUM", createdDate: "18 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 39, name: "Salohiddin Chakana Narx", currency: "SUM", createdDate: "20 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
  { id: 40, name: "Salohiddin Optom Narx", currency: "SUM", createdDate: "20 июня 2025", linkedList: "Не указано", calcMethod: "Не указано" },
]
