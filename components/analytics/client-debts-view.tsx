"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart, ChevronDown, ChevronRight, Expand, Filter, Settings, Star, Trash2, X } from "lucide-react"

const tabs = ["ВИДЖЕТЫ", "KPI", "БАЛАНС", "ОХВАТ", "ФИЛИАЛ", "P&L", "ДОЛГ КЛИЕНТОВ", "ПРОДАЖА", "ГИБКИЙ ДАШБОРД"] as const
const tabHref: Partial<Record<(typeof tabs)[number], string>> = {
  "ВИДЖЕТЫ": "/",
  "ОХВАТ": "/analytics/coverage-analysis",
  "P&L": "/analytics/pnl",
  "ДОЛГ КЛИЕНТОВ": "/analytics/client-debts",
  "ГИБКИЙ ДАШБОРД": "/analytics/flexible-dashboard",
  "ФИЛИАЛ": "/analytics/branch-tab",
  "ПРОДАЖА": "/analytics/sales-tab",
  "KPI": "/analytics/kpi-performance",
  "БАЛАНС": "/analytics/balance-tab",
}

type DebtRow = {
  id: number
  client: string
  daysPassed: number
  orderAmount: number
  orderCurrency: "SUM" | "USD"
  debt: number
  dueDate: string
  agent: string
  totalDebtSum: number
  totalDebtUsd: number
  totalDebtEur: number
  courier: string
  realizationDate: string
  deliveryDate: string
  createdAt: string
}

const rows: DebtRow[] = [
  { id: 1582, client: "Doston market", daysPassed: 21, orderAmount: 17.6, orderCurrency: "USD", debt: -17.6, dueDate: "13 июля 2026", agent: "Samandar Abdurahmonov", totalDebtSum: 0, totalDebtUsd: -17.6, totalDebtEur: 0, courier: "Хайрулло Доставщик", realizationDate: "13 июля 2026", deliveryDate: "13 июля 2026", createdAt: "12 июля 16:16" },
  { id: 1577, client: "Частное Лицо", daysPassed: 79, orderAmount: 363375, orderCurrency: "SUM", debt: -363375, dueDate: "—", agent: "Admin Ritm", totalDebtSum: -343375, totalDebtUsd: -14.4, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "16 мая 2026", deliveryDate: "16 мая 2026", createdAt: "15 мая 12:06" },
  { id: 1575, client: "klient 1", daysPassed: 86, orderAmount: 110000, orderCurrency: "SUM", debt: -99000, dueDate: "09 мая 2026", agent: "Samandar Abdurahmonov", totalDebtSum: -169000, totalDebtUsd: 0, totalDebtEur: 0, courier: "Quvonchbek Admin", realizationDate: "09 мая 2026", deliveryDate: "08 мая 2026", createdAt: "08 мая 00:52" },
  { id: 1568, client: "Частное Лицо", daysPassed: 102, orderAmount: 300000, orderCurrency: "SUM", debt: -300000, dueDate: "22 апр. 2026", agent: "Admin Ritm", totalDebtSum: -343375, totalDebtUsd: -14.4, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "23 апр. 2026", deliveryDate: "17 июля 2026", createdAt: "22 апр. 23:20" },
  { id: 1562, client: "Частное Лицо", daysPassed: 126, orderAmount: 14.4, orderCurrency: "USD", debt: -14.4, dueDate: "30 мар. 2026", agent: "Admin Ritm", totalDebtSum: -343375, totalDebtUsd: -14.4, totalDebtEur: 0, courier: "Quvonchbek Admin", realizationDate: "30 мар. 2026", deliveryDate: "08 мая 2026", createdAt: "29 мар. 15:13" },
  { id: 1560, client: "ЧЛ Николай", daysPassed: 133, orderAmount: 40000, orderCurrency: "SUM", debt: -40000, dueDate: "24 мар. 2026", agent: "Samandar Abdurahmonov", totalDebtSum: -40000, totalDebtUsd: 0, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "23 мар. 2026", deliveryDate: "08 мая 2026", createdAt: "23 мар. 12:12" },
  { id: 1556, client: "Arslan", daysPassed: 162, orderAmount: 0.8, orderCurrency: "USD", debt: -0.8, dueDate: "22 февр. 2026", agent: "Admin Ritm", totalDebtSum: -590000, totalDebtUsd: -0.8, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "22 февр. 2026", deliveryDate: "08 мая 2026", createdAt: "21 февр. 17:09" },
  { id: 1550, client: "Arslan", daysPassed: 176, orderAmount: 600000, orderCurrency: "SUM", debt: -600000, dueDate: "07 февр. 2026", agent: "MrJakhon Ziyayev", totalDebtSum: -590000, totalDebtUsd: -0.8, totalDebtEur: 0, courier: "Quvonchbek Admin", realizationDate: "08 февр. 2026", deliveryDate: "08 мая 2026", createdAt: "07 февр. 14:36" },
  { id: 1549, client: "Будка внутри академического лицея", daysPassed: 161, orderAmount: 600000, orderCurrency: "SUM", debt: -600000, dueDate: "08 февр. 2026", agent: "MrJakhon Ziyayev", totalDebtSum: -600000, totalDebtUsd: 0, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "23 февр. 2026", deliveryDate: "08 мая 2026", createdAt: "07 февр. 14:29" },
  { id: 1537, client: "Pepsi Market", daysPassed: 178, orderAmount: 550000, orderCurrency: "SUM", debt: -550000, dueDate: "03 февр. 2026", agent: "Admin Ritm", totalDebtSum: -2414799.2, totalDebtUsd: -4834.005, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "06 февр. 2026", deliveryDate: "08 мая 2026", createdAt: "02 февр. 16:40" },
  { id: 1529, client: "Asu market", daysPassed: 192, orderAmount: 123134434, orderCurrency: "SUM", debt: -123134434, dueDate: "24 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Quvonchbek Admin", realizationDate: "23 янв. 2026", deliveryDate: "08 мая 2026", createdAt: "23 янв. 16:39" },
  { id: 1528, client: "Asu market", daysPassed: 191, orderAmount: 12608640, orderCurrency: "SUM", debt: -12608640, dueDate: "23 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Quvonchbek Admin", realizationDate: "24 янв. 2026", deliveryDate: "08 мая 2026", createdAt: "23 янв. 16:25" },
  { id: 1493, client: "Asu market", daysPassed: 195, orderAmount: 2388000, orderCurrency: "SUM", debt: -881059.26, dueDate: "20 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Quvonchbek Admin", realizationDate: "20 янв. 2026", deliveryDate: "08 мая 2026", createdAt: "20 янв. 17:10" },
  { id: 1485, client: "Asu market", daysPassed: 198, orderAmount: 577100, orderCurrency: "SUM", debt: -577100, dueDate: "17 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Quvonchbek Admin", realizationDate: "17 янв. 2026", deliveryDate: "08 мая 2026", createdAt: "16 янв. 21:08" },
  { id: 1484, client: "Asu market", daysPassed: 199, orderAmount: 23880, orderCurrency: "SUM", debt: -13680, dueDate: "16 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Admin Ritm", realizationDate: "16 янв. 2026", deliveryDate: "16 янв. 2026", createdAt: "16 янв. 11:59" },
  { id: 1480, client: "Asu market", daysPassed: 199, orderAmount: 572216.54, orderCurrency: "SUM", debt: -572216.54, dueDate: "16 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Admin Ritm", realizationDate: "16 янв. 2026", deliveryDate: "16 янв. 2026", createdAt: "15 янв. 16:20" },
  { id: 1477, client: "Asu market", daysPassed: 200, orderAmount: 3.98, orderCurrency: "SUM", debt: -3.98, dueDate: "15 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Admin Ritm", realizationDate: "15 янв. 2026", deliveryDate: "15 янв. 2026", createdAt: "15 янв. 15:28" },
  { id: 1458, client: "mustafo", daysPassed: 203, orderAmount: 6467500, orderCurrency: "SUM", debt: -5820750, dueDate: "12 янв. 2026", agent: "Admin Ritm", totalDebtSum: -5821425, totalDebtUsd: 0, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "12 янв. 2026", deliveryDate: "12 янв. 2026", createdAt: "11 янв. 19:45" },
  { id: 1453, client: "Asu market", daysPassed: 205, orderAmount: 13.85, orderCurrency: "USD", debt: -1.547, dueDate: "10 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Admin Ritm", realizationDate: "10 янв. 2026", deliveryDate: "11 янв. 2026", createdAt: "10 янв. 11:29" },
  { id: 1424, client: "Asu market", daysPassed: 206, orderAmount: 29850, orderCurrency: "SUM", debt: -29850, dueDate: "09 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Admin Ritm", realizationDate: "09 янв. 2026", deliveryDate: "09 янв. 2026", createdAt: "08 янв. 10:08" },
  { id: 1422, client: "Asu market", daysPassed: 206, orderAmount: 44775, orderCurrency: "SUM", debt: -8925, dueDate: "08 янв. 2026", agent: "Admin Ritm", totalDebtSum: -118906528.4, totalDebtUsd: 34.711, totalDebtEur: -1200000, courier: "Admin Ritm", realizationDate: "09 янв. 2026", deliveryDate: "09 янв. 2026", createdAt: "08 янв. 09:57" },
  { id: 1419, client: "Klient_Karim100", daysPassed: 207, orderAmount: 300000, orderCurrency: "SUM", debt: -300000, dueDate: "08 янв. 2026", agent: "Ares are", totalDebtSum: -300000, totalDebtUsd: 0, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "08 янв. 2026", deliveryDate: "08 янв. 2026", createdAt: "07 янв. 16:59" },
  { id: 1418, client: "mustafo", daysPassed: 207, orderAmount: 129350, orderCurrency: "SUM", debt: -64675, dueDate: "07 янв. 2026", agent: "Admin Ritm", totalDebtSum: -5821425, totalDebtUsd: 0, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "08 янв. 2026", deliveryDate: "08 янв. 2026", createdAt: "07 янв. 16:34" },
  { id: 1416, client: "test_klient_50", daysPassed: 208, orderAmount: 100000, orderCurrency: "SUM", debt: -100000, dueDate: "07 янв. 2026", agent: "Admin Ritm", totalDebtSum: 1000070, totalDebtUsd: -0.008, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "07 янв. 2026", deliveryDate: "07 янв. 2026", createdAt: "06 янв. 21:40" },
  { id: 1413, client: "test_klient_47", daysPassed: 208, orderAmount: 570, orderCurrency: "USD", debt: -290, dueDate: "07 янв. 2026", agent: "Admin Ritm", totalDebtSum: 190208, totalDebtUsd: -290, totalDebtEur: 0, courier: "Admin Ritm", realizationDate: "06 янв. 2026", deliveryDate: "06 янв. 2026", createdAt: "06 янв. 12:49" },
]

type ClientDebtProfile = {
  id: number
  client: string
  overSum: number
  overUsd: number
  phone: string
  address: string
  landmark: string
  agent: string
  type: string
}

const clientProfiles: ClientDebtProfile[] = [
  { id: 1, client: "Pepsi Market", overSum: 2026000, overUsd: 14.886, phone: "+998777777777777", address: "Ашхобод", landmark: "chorraha", agent: "Тп 1 Исмоилов Гани", type: "Оптовый" },
  { id: 2, client: "1", overSum: 169180, overUsd: 12.604, phone: "+998777777777", address: "Тойтепинская улица", landmark: "1", agent: "Тп 1 Исмоилов Гани", type: "Оптовый" },
  { id: 3, client: "Anvar Market", overSum: 622200000, overUsd: 12.4, phone: "+998999999999", address: "test", landmark: "xodim2 1", agent: "Тп 1 Исмоилов Гани", type: "Розничный" },
  { id: 4, client: "test 2", overSum: 12000, overUsd: 1.182, phone: "+998877777777", address: "Истикбол улица", landmark: "yfyxffxy", agent: "Тп 1 Исмоилов Гани", type: "Розничный" },
  { id: 5, client: "test 20007", overSum: 1200, overUsd: 0, phone: "+998777777777777", address: "Toshkent", landmark: "New", agent: "Тп 1 Исмоилов Гани", type: "Розничный" },
  { id: 6, client: "Пранк", overSum: 0, overUsd: 83.5, phone: "+998707777777", address: "Ташкент", landmark: "Kafe", agent: "Тп 1 Исмоилов Гани", type: "Оптовый" },
  { id: 7, client: "Тест один", overSum: 200000, overUsd: 960, phone: "+998777777777", address: "Алматы", landmark: "Алматы", agent: "Тп 1 Исмоилов Гани", type: "Розничный" },
  { id: 8, client: "Магазин р-м узгазоил", overSum: 1400000, overUsd: 0, phone: "+998902765555", address: "Samarkand", landmark: "Samarkand", agent: "Admin Ritm", type: "Оптовый" },
  { id: 9, client: "Барод 7 термез ост", overSum: 610000, overUsd: 0, phone: "+998", address: "", landmark: "Не указано", agent: "Admin Ritm", type: "Розница" },
  { id: 10, client: "Отель Жахон Пелас", overSum: 123138000, overUsd: 0, phone: "+998662340708", address: "", landmark: "Не указано", agent: "Admin Ritm", type: "Розница" },
  { id: 11, client: "Академик литсей гагарина", overSum: 0, overUsd: 0.78, phone: "+998934398989", address: "", landmark: "Не указано", agent: "Admin Ritm", type: "Розница" },
  { id: 12, client: "Дилшод ака октош", overSum: 12502000, overUsd: 50.2, phone: "+998933481881", address: "", landmark: "Не указано", agent: "Admin Ritm", type: "Розница" },
  { id: 13, client: "Бахрилло р-м Фамилия бух ост", overSum: 2400000, overUsd: 0, phone: "+998915463314", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 14, client: "Бахтиер 1 бух ост", overSum: 62420000, overUsd: 0, phone: "+998981300990", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 15, client: "Фаррух 3 бух ост", overSum: 117000000, overUsd: 0, phone: "+998938375060", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 16, client: "Самарканд нон 2 тошкент ост-ка", overSum: 800000, overUsd: 0, phone: "+998937261212", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 17, client: "Хасан мотрид", overSum: 72000, overUsd: 0, phone: "+998933427477", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 18, client: "Шохрух платинум голд", overSum: 2100000, overUsd: 0, phone: "+998915212622", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 19, client: "Хлебо-булочная пищевой", overSum: 2000000, overUsd: 0, phone: "+998915487981", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 20, client: "Ост-ка Кооперативный", overSum: 150000, overUsd: 0, phone: "+998975791553", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 21, client: "Лутфи бобо намозго", overSum: 600000, overUsd: 0, phone: "+998975799636", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 22, client: "Абдулло кинап", overSum: 200000, overUsd: 0, phone: "+998932320098", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 23, client: "Ботир ака 65 школа", overSum: 100000, overUsd: 0, phone: "+998915498323", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 24, client: "Барака маркет до ост глем завод", overSum: 200000, overUsd: 0, phone: "+998933311310", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
  { id: 25, client: "Журабек победа шлагбаум", overSum: 6240000, overUsd: 0, phone: "+998995294925", address: "", landmark: "Не указано", agent: "Тп 2 Алиса", type: "Розница" },
]

const TOTAL_ORDERS = 336
const TOTAL_CLIENTS = 147
const favoriteItemsInitial = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

const number = (value: number, maxFraction = 3) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: maxFraction }).format(value)

function AmountCell({ value, fraction = 3 }: { value: number; fraction?: number }) {
  if (value === 0) return <span>0</span>
  return <span className="font-semibold text-[#e5484d]">{number(value, fraction)}</span>
}

function SelectField({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) {
  return (
    <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium text-[#586174]">
      {label}
      <select value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal text-[#17233b] outline-none">
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-8 h-4 w-4 text-[#9aa3b6]" />
    </label>
  )
}

export function ClientDebtsView() {
  const router = useRouter()
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteItems, setFavoriteItems] = useState(favoriteItemsInitial)
  const [hoveredFavorite, setHoveredFavorite] = useState<number | null>(null)
  const [view, setView] = useState<"clients" | "orders">("orders")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [needsRecalc, setNeedsRecalc] = useState(4)
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)

  const [p1, setP1] = useState(7)
  const [p2, setP2] = useState(30)
  const [p3, setP3] = useState(120)
  const [p1Draft, setP1Draft] = useState("7")
  const [p2Draft, setP2Draft] = useState("30")
  const [p3Draft, setP3Draft] = useState("120")

  const [branch, setBranch] = useState("Все филиалы")
  const [organization, setOrganization] = useState("Все организации")
  const [orderCreator, setOrderCreator] = useState("Все")
  const [courierFilter, setCourierFilter] = useState("Все")
  const [clientType, setClientType] = useState("Все типы")
  const [confirmStatus, setConfirmStatus] = useState("Все")
  const [zone, setZone] = useState("Все зоны")
  const [orderStatus, setOrderStatus] = useState("Все")
  const [transactionType, setTransactionType] = useState("Все")
  const [paymentType, setPaymentType] = useState("Все")
  const [hasDebtPeriod, setHasDebtPeriod] = useState("Не важно")
  const [daysFrom, setDaysFrom] = useState("")
  const [daysTo, setDaysTo] = useState("")
  const [onlyNeedsRecalc, setOnlyNeedsRecalc] = useState(false)

  const filteredOrders = useMemo(
    () => rows.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const filteredClients = useMemo(
    () => clientProfiles.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const visibleCount = view === "orders" ? filteredOrders.length : filteredClients.length
  const maxPage = Math.max(1, Math.ceil(visibleCount / pageSize))
  const safePage = Math.min(page, maxPage)
  const visibleOrders = filteredOrders.slice((safePage - 1) * pageSize, safePage * pageSize)
  const visibleClients = filteredClients.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const ordersTotalLabel = isDefaultView ? TOTAL_ORDERS : filteredOrders.length
  const clientsTotalLabel = isDefaultView ? TOTAL_CLIENTS : filteredClients.length

  const toggleOne = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeFavorite = (index: number) => {
    setFavoriteItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const savePeriods = () => {
    const first = Number(p1Draft) || p1
    const second = Number(p2Draft) || p2
    const third = Number(p3Draft) || p3
    setP1(first)
    setP2(second)
    setP3(third)
    setPeriodOpen(false)
  }

  const downloadAll = () => {
    if (view === "orders") {
      const header = ["Заказ №", "Клиент", "Прошло дней", "Сумма заказа", "Долг", "Срок оплаты", "Агент", "Общий долг SUM", "Общий долг USD", "Общий долг Euro", "Доставщик", "Дата реализации", "Дата доставки", "Дата создания"]
      const body = filteredOrders.map((row) => [row.id, row.client, row.daysPassed, `${number(row.orderAmount, row.orderAmount % 1 ? 2 : 0)} ${row.orderCurrency}`, number(row.debt, row.debt % 1 ? 2 : 0), row.dueDate, row.agent, number(row.totalDebtSum, 2), number(row.totalDebtUsd, 3), number(row.totalDebtEur), row.courier, row.realizationDate, row.deliveryDate, row.createdAt])
      const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
      const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "client-debts-orders.xls"
      link.click()
      URL.revokeObjectURL(link.href)
    } else {
      const header = ["Клиент", `Прошло до ${p1} дней SUM`, "USD", `С ${p1} дней - До ${p2} SUM`, "USD", `С ${p2} дней - До ${p3} SUM`, "USD", `Больше ${p3} дней SUM`, "USD", "Итого SUM", "USD", "Тел", "Адрес", "Ориентир", "Ответственный агент", "Тип"]
      const body = filteredClients.map((row) => [row.client, 0, 0, 0, 0, 0, 0, number(row.overSum, 2), number(row.overUsd, 3), number(row.overSum, 2), number(row.overUsd, 3), row.phone, row.address, row.landmark, row.agent, row.type])
      const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
      const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "client-debts-clients.xls"
      link.click()
      URL.revokeObjectURL(link.href)
    }
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Долги с заказов</span>
        </button>
        <nav className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }}
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "ДОЛГ КЛИЕНТОВ" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> Фильтр
        </button>
        <span className="font-semibold text-[#4f70e7]">Во всей организации</span>
        <button onClick={() => { setP1Draft(String(p1)); setP2Draft(String(p2)); setP3Draft(String(p3)); setPeriodOpen(true) }} className="ml-auto flex h-11 items-center gap-2 rounded-md border border-[#4f70e7] px-5 font-semibold text-[#4f70e7]">
          <Settings className="h-5 w-5" /> Настроить период
        </button>
        <button onClick={downloadAll} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> Скачать
        </button>
      </section>

      <section className="grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-5 md:px-9">
        <div>
          <p className="text-[#586174]">Прошло до {p1} дней</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f70e7]">0</span> / <span className="text-[#4f70e7]">0</span> Заказов обработано</p>
        </div>
        <div>
          <p className="text-[#586174]">С {p1} дней - До {p2}</p>
          <p className="font-semibold text-[#e0952e]">17,6 USD</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f70e7]">0</span> / <span className="text-[#4f70e7]">1</span> Заказов обработано</p>
        </div>
        <div>
          <p className="text-[#586174]">С {p2} дней - До {p3}</p>
          <p className="font-semibold text-[#e5484d]">99 000 SUM</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f70e7]">0</span> / <span className="text-[#4f70e7]">2</span> Заказов обработано</p>
        </div>
        <div>
          <p className="text-[#586174]">Больше {p3} дней</p>
          <p className="font-semibold text-[#e5484d]">10 508 311,57 Euro</p>
          <p className="font-semibold text-[#e5484d]">48 034 738 683,88 SUM</p>
          <p className="font-semibold text-[#e5484d]">948 912,07 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Общий долг</p>
          <p className="font-semibold text-[#e5484d]">10 508 311,57 Euro</p>
          <p className="font-semibold text-[#e5484d]">48 034 837 683,88 SUM</p>
          <p className="font-semibold text-[#e5484d]">948 929,67 USD</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f70e7]">0</span> / <span className="text-[#4f70e7]">314</span> Заказов обработано</p>
        </div>
      </section>

      {needsRecalc > 0 && (
        <section className="mx-6 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f5c2c7] bg-[#fdecee] px-6 py-4 md:mx-9">
          <p className="text-[#c53238]">Требуется перерасчет долгов клиентов: {needsRecalc} шт. Долги этих клиентов исключены из итогов</p>
          <button onClick={() => setNeedsRecalc(0)} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">Пересчитать</button>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-4 px-6 py-3 md:px-9">
        <h2 className="text-lg font-semibold text-[#586174]">Статистика по должникам</h2>
        <div className="flex overflow-hidden rounded-md">
          <button onClick={() => { setView("clients"); setPage(1) }} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${view === "clients" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}>Клиенты</button>
          <button onClick={() => { setView("orders"); setPage(1) }} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${view === "orders" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}>Заказы</button>
        </div>
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{visibleCount ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, visibleCount)} из {view === "orders" ? ordersTotalLabel : clientsTotalLabel}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
      </section>

      <section className="overflow-x-auto bg-white pb-10">
        {view === "orders" ? (
          <table className="min-w-[1900px] w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Заказ №</th>
                <th className="px-2 py-3" />
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Клиент</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Прошло дней</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Сумма заказа</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Долг</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Срок оплаты</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Агент</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Общий долг (SUM)</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Общий долг (USD)</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Общий долг (Euro)</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Доставщик</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Дата реализации</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Дата доставки</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Дата создания</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.id}</td>
                  <td className="border-t border-[#e1e5eb] px-2 py-3.5 text-center">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} className="h-4 w-4 accent-[#4f70e7]" />
                  </td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 font-medium text-[#4f70e7]">{row.client}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.daysPassed}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.orderAmount, row.orderAmount % 1 ? 2 : 0)} {row.orderCurrency}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#e5484d]">{number(row.debt, row.debt % 1 ? 2 : 0)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#4f70e7]">{row.dueDate}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.agent}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#e5484d]">{number(row.totalDebtSum, 2)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.totalDebtUsd, 3)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.totalDebtEur)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.courier}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.realizationDate}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.deliveryDate}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.createdAt}</td>
                </tr>
              ))}
              {visibleOrders.length === 0 && (
                <tr><td colSpan={15} className="border-t border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="min-w-[2100px] w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-[#edf2f7] text-[#253653]">
                <th className="border border-[#e1e5eb] px-4 py-2" />
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Прошло до {p1} дней</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">С {p1} дней - До {p2}</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">С {p2} дней - До {p3}</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Больше {p3} дней</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Итого</th>
                <th colSpan={5} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Дополнительная информация</th>
              </tr>
              <tr className="bg-white text-[#17233b]">
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Клиенты</th>
                {Array.from({ length: 5 }).map((_, groupIndex) =>
                  ["SUM", "USD", "Euro"].map((currency) => (
                    <th key={`${groupIndex}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                  )),
                )}
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Тел</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Адрес</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Ориентир</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Ответственный агент</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Тип</th>
              </tr>
            </thead>
            <tbody>
              {visibleClients.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.client}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overSum} fraction={2} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overUsd} fraction={3} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overSum} fraction={2} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overUsd} fraction={3} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.phone}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.address}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.landmark}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.agent}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.type}</td>
                </tr>
              ))}
              {visibleClients.length === 0 && (
                <tr><td colSpan={20} className="border-t border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {periodOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setPeriodOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[500px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">Настроить период</h2>
              <button aria-label="Закрыть" onClick={() => setPeriodOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="space-y-7 px-8 py-7">
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                Первый период
                <input type="number" min={1} value={p1Draft} onChange={(event) => setP1Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                Второй период
                <input type="number" min={1} value={p2Draft} onChange={(event) => setP2Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                Третий период
                <input type="number" min={1} value={p3Draft} onChange={(event) => setP3Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button onClick={savePeriods} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87]">Сохранить</button>
            </footer>
          </div>
        </div>
      )}

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[1100px] max-w-[94vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-semibold text-[#586174]">Фильтр</h2>
              <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </header>
            <div className="grid grid-cols-1 gap-x-10 gap-y-7 px-8 py-7 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField label="Филиалы" value={branch} setValue={setBranch} options={["Все филиалы", "Самарканд", "Ташкент", "Наманган"]} />
              <SelectField label="Организация" value={organization} setValue={setOrganization} options={["Все организации", "Linko"]} />
              <SelectField label="Заказ оформил" value={orderCreator} setValue={setOrderCreator} options={["Все", "Admin Ritm", "Тп 1 Исмоилов Гани", "Тп 2 Алиса"]} />
              <SelectField label="Доставщик" value={courierFilter} setValue={setCourierFilter} options={["Все", "Admin Ritm", "Quvonchbek Admin", "Хайрулло Доставщик"]} />
              <SelectField label="Тип клиента" value={clientType} setValue={setClientType} options={["Все типы", "Оптовый", "Розничный", "Розница"]} />
              <SelectField label="Статус подтверждения клиента" value={confirmStatus} setValue={setConfirmStatus} options={["Все", "Подтвержден", "Не подтвержден"]} />
              <SelectField label="Зона" value={zone} setValue={setZone} options={["Все зоны", "Розничный", "Рабочий", "Не рабочий зона"]} />
              <SelectField label="Статус заказа" value={orderStatus} setValue={setOrderStatus} options={["Все", "Доставлен", "В пути", "Отменен"]} />
              <SelectField label="Тип оплаты (транзакции)" value={transactionType} setValue={setTransactionType} options={["Все", "Наличными", "Перечислением"]} />
              <SelectField label="Тип оплаты" value={paymentType} setValue={setPaymentType} options={["Все", "SUM", "USD", "Euro"]} />
              <SelectField label="Есть задолженность за период" value={hasDebtPeriod} setValue={setHasDebtPeriod} options={["Не важно", "Да", "Нет"]} />
              <div>
                <p className="mb-1 text-[13px] font-medium text-[#586174]">Прошло дней с последней оплаты</p>
                <div className="flex items-center gap-3">
                  <input value={daysFrom} onChange={(event) => setDaysFrom(event.target.value)} type="number" placeholder="От (дней)" className="w-full border-b border-[#dbe0e8] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#586174]" />
                  <input value={daysTo} onChange={(event) => setDaysTo(event.target.value)} type="number" placeholder="До (дней)" className="w-full border-b border-[#dbe0e8] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#586174]" />
                </div>
              </div>
              {(["Период создания", "Дата доставки", "Период даты оплаты", "Период реализации"] as const).map((label) => (
                <label key={label} className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                  {label}
                  <input type="date" className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
                </label>
              ))}
            </div>
            <div className="border-t px-8 py-6">
              <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
                <input type="checkbox" checked={onlyNeedsRecalc} onChange={(event) => setOnlyNeedsRecalc(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
                Требуется перерасчет
              </label>
            </div>
            <div className="px-8 pb-8">
              <button onClick={() => setFilterOpen(false)} className="block w-full rounded-md bg-[#6fcf97] py-3.5 text-center font-semibold text-white hover:bg-[#5fbf87]">Применить</button>
            </div>
          </div>
        </div>
      )}

      {favoritesOpen && (
        <div className="fixed inset-0 z-[100] flex">
          <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)} className="flex-1 bg-black/40" />
          <aside className="w-[420px] max-w-[90vw] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-2xl font-semibold">Избранные</h2>
              <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)}><X className="h-6 w-6 text-slate-600" /></button>
            </header>
            {favoriteItems.map((item, index) => (
              <div
                key={`${item}-${index}`}
                onMouseEnter={() => setHoveredFavorite(index)}
                onMouseLeave={() => setHoveredFavorite((current) => (current === index ? null : current))}
                className={`flex w-full items-center justify-between border-b px-8 py-5 text-left text-lg ${hoveredFavorite === index ? "bg-[#eaf0fd]" : ""}`}
              >
                <button type="button" onClick={() => { setFavorite(true); setFavoritesOpen(false) }} className="flex flex-1 items-center gap-3 text-left">
                  {hoveredFavorite === index && (
                    <span role="button" aria-label="Удалить из избранного" onClick={(event) => { event.stopPropagation(); removeFavorite(index) }} className="text-slate-600 hover:text-[#e5484d]">
                      <Trash2 className="h-5 w-5" />
                    </span>
                  )}
                  {item}
                </button>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            ))}
          </aside>
        </div>
      )}
    </main>
  )
}
