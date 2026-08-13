export type Cashbox = {
  id: number
  name: string
  currency: string
  cashier: string
  branch: string
  paymentType: string
  vansell: boolean
  orderNumber: number
}

export const cashboxCurrencies = ["SUM", "USD"]
export const cashiers = ["Admin Ritm", "Otabek Komiljonov", "Шохрух Туляганов", "doston2kassir kassirov", "Salohiddin Kassir Tashkent", "universal kassir"]
export const paymentTypes = ["наличный", "банковский счет"]
export const branches = ["Ташкент", "Samarqand", "buxoro", "777", "Andijon"]

export const knownCashboxes: Cashbox[] = [
  { id: 42, name: "adaw", currency: "SUM", cashier: "Admin Ritm", branch: "Ташкент", paymentType: "банковский счет", vansell: false, orderNumber: 1 },
  { id: 39, name: "Карим2", currency: "USD", cashier: "Admin Ritm", branch: "Ташкент", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 38, name: "Карим1", currency: "SUM", cashier: "Admin Ritm", branch: "Ташкент", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 37, name: "kassa11", currency: "SUM", cashier: "Admin Ritm", branch: "Ташкент", paymentType: "банковский счет", vansell: false, orderNumber: 1 },
  { id: 35, name: "kassa", currency: "SUM", cashier: "Otabek Komiljonov", branch: "Samarqand", paymentType: "банковский счет", vansell: true, orderNumber: 1 },
  { id: 29, name: "Касса Центральный — Карта/Перевод", currency: "SUM", cashier: "Шохрух Туляганов", branch: "Ташкент", paymentType: "банковский счет", vansell: false, orderNumber: 1 },
  { id: 25, name: "Doston2KASSA", currency: "SUM", cashier: "doston2kassir kassirov", branch: "buxoro", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 23, name: "Pullar", currency: "SUM", cashier: "Admin Ritm", branch: "Ташкент", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 21, name: "Salohiddin Kassa Tashkent", currency: "SUM", cashier: "Salohiddin Kassir Tashkent", branch: "Ташкент", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 11, name: "123", currency: "SUM", cashier: "Admin Ritm", branch: "777", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 9, name: "xorazm Usd", currency: "USD", cashier: "universal kassir", branch: "Andijon", paymentType: "наличный", vansell: false, orderNumber: 1 },
  { id: 5, name: "naqd", currency: "SUM", cashier: "Admin Ritm", branch: "Ташкент", paymentType: "наличный", vansell: false, orderNumber: 1 },
]
