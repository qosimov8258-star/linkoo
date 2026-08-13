export type Brand = {
  id: number
  name: string
  organization: string
  createdDate: string
  photoUrl: string | null
}

export const brandOrganizations = ["05,08,2025", "shirinliklar", "ТестоваяОрганизация", "напитки", "Electronika", "Ichimliklar", "energetik"]

export const knownBrands: Brand[] = [
  { id: 20, name: "Alpen Gold", organization: "shirinliklar", createdDate: "02 апр. 2025", photoUrl: null },
  { id: 37, name: "Aple", organization: "Не указано", createdDate: "26 июня 2025", photoUrl: null },
  { id: 26, name: "Apple", organization: "ТестоваяОрганизация", createdDate: "17 июня 2025", photoUrl: "brand" },
  { id: 54, name: "Aqua de lux", organization: "напитки", createdDate: "03 окт. 2025", photoUrl: null },
  { id: 64, name: "arbuz privet", organization: "05,08,2025", createdDate: "12 дек. 2025", photoUrl: "brand" },
  { id: 42, name: "asus vivobook", organization: "Electronika", createdDate: "29 июля 2025", photoUrl: "brand" },
  { id: 73, name: "Atack", organization: "05,08,2025", createdDate: "11 янв. 2026", photoUrl: null },
  { id: 52, name: "Baby Still", organization: "Не указано", createdDate: "23 сент. 2025", photoUrl: null },
  { id: 43, name: "b-fresh", organization: "Ichimliklar", createdDate: "30 июля 2025", photoUrl: "brand" },
  { id: 79, name: "BrandOne", organization: "Не указано", createdDate: "23 февр. 2026", photoUrl: null },
  { id: 22, name: "BURN", organization: "energetik", createdDate: "13 июня 2025", photoUrl: "brand" },
]
