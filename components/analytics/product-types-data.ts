export type ProductType = { id: number; name: string; organization: string; createdDate: string; showInBot: boolean; parentId: number | null }

export const productTypeOrganizations = ["7777", "05,08,2025", "878", "agent"]

export const knownProductTypes: ProductType[] = [
  { id: 1, name: '02, "OLIVIA" ТВЕРДОЕ МЫЛО', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 2, name: '01, "OLIVIA" ТУАЛЕТНОЕ МЫЛО', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: 1 },
  { id: 3, name: "Агент", organization: "05,08,2025", createdDate: "24 янв. 2026", showInBot: true, parentId: 1 },
  { id: 4, name: '03, "OLIVIA" ЖИДКОЕ МЫЛО', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 5, name: '04, "OLIVIA" ШАМПУНЬДЛЯ ВОЛОС', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 6, name: '06, "OLIVIA" "COTTON BUDS" ВАТНЫЕ ПАЛОЧКИ', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 7, name: '07, "PALMERA" ВЛАЖНЫЕ САЛФЕТКИ', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 8, name: '08, "OLIVIA" АНТИПЕРСПЕРАНТ', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 9, name: '09, "OLIVIA" ДЛЯ ДЕТЕЙ', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 10, name: '102, "Deo" Твердое мыло', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
  { id: 11, name: '11, "PALMERA" ЖИДКОЕ МЫЛО', organization: "7777", createdDate: "23 янв. 2026", showInBot: true, parentId: null },
]
