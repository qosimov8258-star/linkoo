export type ExpenseCategory = {
  id: number
  name: string
  parameter: string
  parentId: number | null
  direct: boolean
  excludeFromPnl: boolean
  createdDate: string
}

export const expenseParameterOptions = ["Доп. расход", "Расход на сотрудников", "Поставка", "Клиент"]

export const knownExpenseCategories: ExpenseCategory[] = [
  { id: 1, name: "1111", parameter: "Доп. расход", parentId: 4, direct: true, excludeFromPnl: false, createdDate: "06 мар. 2025" },
  { id: 2, name: "ananas", parameter: "", parentId: null, direct: false, excludeFromPnl: false, createdDate: "10 дек. 2025" },
  { id: 3, name: "Avans OYlik", parameter: "Расход на сотрудников", parentId: 4, direct: false, excludeFromPnl: false, createdDate: "13 мая 2025" },
  { id: 4, name: "Firma umumiy rasxod", parameter: "Доп. расход", parentId: null, direct: true, excludeFromPnl: false, createdDate: "15 сент. 2025" },
  { id: 5, name: "Gruzchik rasxod", parameter: "Поставка", parentId: null, direct: true, excludeFromPnl: false, createdDate: "13 мая 2025" },
  { id: 6, name: "ishchilaga bonus", parameter: "Расход на сотрудников", parentId: null, direct: false, excludeFromPnl: false, createdDate: "11 июля 2025" },
  { id: 7, name: "Ishchilaga oylik", parameter: "Расход на сотрудников", parentId: null, direct: false, excludeFromPnl: false, createdDate: "22 дек. 2025" },
  { id: 8, name: "keshbek", parameter: "Клиент", parentId: null, direct: false, excludeFromPnl: false, createdDate: "10 янв. 2026" },
  { id: 9, name: "klient", parameter: "Клиент", parentId: null, direct: false, excludeFromPnl: false, createdDate: "05 авг. 2026" },
  { id: 10, name: "kosvennie", parameter: "Доп. расход", parentId: null, direct: false, excludeFromPnl: false, createdDate: "24 апр. 2025" },
  { id: 11, name: "PEPSI", parameter: "Доп. расход", parentId: null, direct: false, excludeFromPnl: false, createdDate: "26 июля 2025" },
]
