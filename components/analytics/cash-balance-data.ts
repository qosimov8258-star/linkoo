export type Currency = "SUM" | "USD" | "Euro"
export type Register = {
  id: number
  name: string
  openingAmount: number
  openingCurrency: Currency
  income: number
  expense: number
  transferIn: number
  transferOut: number
  cashier: string
  type: "Наличными" | "Перечислением"
}

export const registers: Register[] = [
  {"id": 43, "name": "aaaa1", "openingAmount": 20, "openingCurrency": "Euro", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 42, "name": "adaw", "openingAmount": 223123, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Перечислением"},
  {"id": 41, "name": "Агент", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Перечислением"},
  {"id": 40, "name": "Ahmad", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "onec onec", "type": "Перечислением"},
  {"id": 39, "name": "Карим2", "openingAmount": 23.36, "openingCurrency": "USD", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 38, "name": "Карим1", "openingAmount": 191040, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 37, "name": "kassa11", "openingAmount": 500010000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Перечислением"},
  {"id": 36, "name": "kassa 2", "openingAmount": 50000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Перечислением"},
  {"id": 35, "name": "kassa", "openingAmount": 710434, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Otabek Komiljonov", "type": "Перечислением"},
  {"id": 34, "name": "Касса Юнусабад — Наличные", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Ветряк Электросистема", "type": "Наличными"},
  {"id": 33, "name": "Касса Чиланзар — Наличные", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Улугбек Рахмиддинов", "type": "Наличными"},
  {"id": 32, "name": "Касса Центральный — Наличные", "openingAmount": 6800000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Шохрух Туляганов", "type": "Наличными"},
  {"id": 31, "name": "Касса Юнусабад — Карта/Перевод", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Ветряк Электросистема", "type": "Перечислением"},
  {"id": 30, "name": "Касса Чиланзар — Карта/Перевод", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Улугбек Рахмиддинов", "type": "Перечислением"},
  {"id": 29, "name": "Касса Центральный — Карта/Перевод", "openingAmount": 2100000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Шохрух Туляганов", "type": "Перечислением"},
  {"id": 28, "name": "test_dilmurod_kassa", "openingAmount": 5000000, "openingCurrency": "USD", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 27, "name": "novza", "openingAmount": 10826200, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "test test", "type": "Наличными"},
  {"id": 26, "name": "05,08,2025", "openingAmount": 9900000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 25, "name": "Doston2KASSA", "openingAmount": 600000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "doston2kassir kassirov", "type": "Наличными"},
  {"id": 24, "name": "Click", "openingAmount": 419999, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 23, "name": "Pullar", "openingAmount": 12432000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 22, "name": "Salohiddin Kassa Farg'ona", "openingAmount": 15325002, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Salohiddin Kassir Farg'ona", "type": "Наличными"},
  {"id": 21, "name": "Salohiddin Kassa Tashkent", "openingAmount": 56369751, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Salohiddin Kassir Tashkent", "type": "Наличными"},
  {"id": 20, "name": "kassa 1", "openingAmount": 500000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Temur Raupov", "type": "Наличными"},
  {"id": 19, "name": "ggggg", "openingAmount": 504540, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Тп 2 Алиса", "type": "Наличными"},
  {"id": 18, "name": "Парус", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Админ 1", "type": "Наличными"},
  {"id": 17, "name": "Orbit", "openingAmount": 5853090, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Тп 2 Алиса", "type": "Наличными"},
  {"id": 16, "name": "korea kosmetika", "openingAmount": 7.692307692, "openingCurrency": "USD", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Перечислением"},
  {"id": 15, "name": "korea kosmetika", "openingAmount": 100000, "openingCurrency": "USD", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 14, "name": "ПРОФРЕШ", "openingAmount": 131598640, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 13, "name": "BURN", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Админ 1", "type": "Наличными"},
  {"id": 12, "name": "Магнит", "openingAmount": 0, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 11, "name": "123", "openingAmount": 2083623, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 10, "name": "yangi kassa", "openingAmount": 1524000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "universal kassir", "type": "Наличными"},
  {"id": 9, "name": "xorazm Usd", "openingAmount": 664775.223605329, "openingCurrency": "USD", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "universal kassir", "type": "Наличными"},
  {"id": 8, "name": "Xorazm kassasi", "openingAmount": 21203400, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "universal kassir", "type": "Наличными"},
  {"id": 7, "name": "payme", "openingAmount": 73985451.5, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Админ 1", "type": "Перечислением"},
  {"id": 5, "name": "test kassa", "openingAmount": 783000, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Тп 2 Алиса", "type": "Наличными"},
  {"id": 4, "name": "naqd", "openingAmount": 24973894819.94, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Temur Raupov", "type": "Перечислением"},
  {"id": 3, "name": "Перечисления", "openingAmount": 1264200, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 2, "name": "USD", "openingAmount": 812987.02, "openingCurrency": "USD", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"},
  {"id": 1, "name": "SUM", "openingAmount": 55238744, "openingCurrency": "SUM", "income": 0, "expense": 0, "transferIn": 0, "transferOut": 0, "cashier": "Admin Ritm", "type": "Наличными"}
]
