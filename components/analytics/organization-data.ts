export type Organization = { id: number; name: string; limitByDebt: boolean }

export const knownOrganizations: Organization[] = [
  { id: 1, name: "05,08,2025", limitByDebt: true },
  { id: 2, name: "111111111111111111111111", limitByDebt: false },
  { id: 3, name: "1112233", limitByDebt: true },
  { id: 4, name: "7777", limitByDebt: false },
  { id: 5, name: "878", limitByDebt: false },
  { id: 6, name: "avto organizatsiya 2", limitByDebt: false },
  { id: 7, name: "baby still", limitByDebt: false },
  { id: 8, name: "Buxoro 2", limitByDebt: false },
  { id: 9, name: "ddr", limitByDebt: false },
  { id: 10, name: "ddr1", limitByDebt: false },
  { id: 11, name: "doston2organizationCola", limitByDebt: false },
]
