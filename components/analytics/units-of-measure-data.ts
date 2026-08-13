export type UnitOfMeasure = { id: number; name: string; createdDate: string; parentId: number | null }

export const knownUnitsOfMeasure: UnitOfMeasure[] = [
  { id: 1, name: "шт15", createdDate: "11 апр. 2026", parentId: null },
  { id: 2, name: "блок14", createdDate: "07 янв. 2026", parentId: null },
  { id: 3, name: "шт14", createdDate: "07 янв. 2026", parentId: 2 },
  { id: 4, name: "тонна", createdDate: "06 янв. 2026", parentId: null },
  { id: 5, name: "Qop", createdDate: "19 дек. 2025", parentId: null },
  { id: 6, name: "block", createdDate: "20 нояб. 2025", parentId: null },
  { id: 7, name: "новый шт", createdDate: "10 дек. 2025", parentId: 6 },
  { id: 8, name: "Комплект", createdDate: "20 нояб. 2025", parentId: null },
  { id: 9, name: "blok2", createdDate: "20 нояб. 2025", parentId: 8 },
  { id: 10, name: "blok1", createdDate: "20 нояб. 2025", parentId: null },
  { id: 11, name: "plok", createdDate: "09 июля 2025", parentId: null },
]
