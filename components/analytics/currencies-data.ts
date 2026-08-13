export type Currency = { id: number; name: string; code: string; rate: number; isBase: boolean; createdDate: string }

export const knownCurrencies: Currency[] = [
  { id: 1, name: "Узбекский сум", code: "SUM", rate: 1, isBase: true, createdDate: "11 янв. 2022" },
  { id: 2, name: "Доллар США", code: "USD", rate: 12700, isBase: false, createdDate: "11 янв. 2022" },
  { id: 3, name: "Евро", code: "EUR", rate: 13850, isBase: false, createdDate: "25 февр. 2022" },
]
