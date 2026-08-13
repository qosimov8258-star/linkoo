export type IncomeCategory = { id: number; name: string; parameter: string; otherIncome: boolean; createdDate: string }

export const incomeParameterOptions = ["Детализация", "Клиент", "Заказ"]

export const knownIncomeCategories: IncomeCategory[] = [
  { id: 1, name: "distrubutor", parameter: "Детализация", otherIncome: false, createdDate: "06 мар. 2025" },
  { id: 2, name: "Ichki perevod", parameter: "", otherIncome: false, createdDate: "22 дек. 2025" },
  { id: 3, name: "kassa 2", parameter: "", otherIncome: false, createdDate: "10 дек. 2025" },
  { id: 4, name: "old", parameter: "", otherIncome: false, createdDate: "20 июня 2025" },
  { id: 5, name: "Админ", parameter: "Детализация", otherIncome: false, createdDate: "02 июня 2025" },
  { id: 6, name: "Внутренние переводы", parameter: "", otherIncome: false, createdDate: "22 нояб. 2025" },
  { id: 7, name: "возврат", parameter: "Клиент", otherIncome: false, createdDate: "01 мар. 2025" },
  { id: 8, name: "Возвраты клиентов", parameter: "", otherIncome: false, createdDate: "22 нояб. 2025" },
  { id: 9, name: "Детализация", parameter: "Детализация", otherIncome: false, createdDate: "25 февр. 2022" },
  { id: 10, name: "Заказ", parameter: "Заказ", otherIncome: false, createdDate: "11 янв. 2022" },
  { id: 11, name: "Клиент", parameter: "Клиент", otherIncome: false, createdDate: "25 февр. 2022" },
  { id: 12, name: "Инкассация", parameter: "", otherIncome: false, createdDate: "18 янв. 2022" },
  { id: 13, name: "Оплата от клиента", parameter: "Клиент", otherIncome: false, createdDate: "15 янв. 2022" },
  { id: 14, name: "Пополнение баланса", parameter: "", otherIncome: false, createdDate: "10 янв. 2022" },
  { id: 15, name: "Прочий приход", parameter: "", otherIncome: true, createdDate: "05 янв. 2022" },
]
