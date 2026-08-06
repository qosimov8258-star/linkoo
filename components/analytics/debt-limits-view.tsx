"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import {
  BarChart,
  ChevronDown,
  ChevronRight,
  Expand,
  MapIcon,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react"

type Currency = "SUM" | "USD" | "Euro"
type Category = "unconfirmed" | "problem" | "planned-okb" | "closure"
type BalanceLine = { value: number; currency: Currency }

type ClientRow = {
  id: number
  name: string
  phone: string
  info?: string[]
  type: string
  zoneLabel: string
  zoneCity: string
  agent: string
  courier: string
  collector: string
  balance: BalanceLine[]
  colorBar: "green" | "red" | "gray" | "none"
  category: Category
  debtLimitType: "unlimited" | "amount"
  debtLimit?: number
  debtLimitCurrency?: Currency
}

const clients: ClientRow[] = [
  // Плановый ОКБ
  { id: 1, name: "Markus Vitinha", phone: "+998911111111", type: "chakana savdo", zoneLabel: "Arslan", zoneCity: "Salohiddin Tashkent Filial", agent: "Admin Ritm", courier: "Admin Ritm", collector: "Не указано", balance: [], colorBar: "green", category: "planned-okb", debtLimitType: "unlimited" },
  { id: 2, name: "Usman Dembele", phone: "+998911111111", type: "chakana savdo", zoneLabel: "spark", zoneCity: "Salohiddin Tashkent Filial", agent: "Admin Ritm", courier: "Admin Ritm", collector: "Не указано", balance: [{ value: 12050000, currency: "SUM" }], colorBar: "green", category: "planned-okb", debtLimitType: "unlimited" },
  { id: 3, name: "Ashraf Hakimi", phone: "+998911111111", type: "chakana savdo", zoneLabel: "spark", zoneCity: "Salohiddin Tashkent Filial", agent: "Admin Ritm", courier: "Admin Ritm", collector: "Не указано", balance: [{ value: -251171800, currency: "SUM" }], colorBar: "green", category: "planned-okb", debtLimitType: "amount", debtLimit: 500000, debtLimitCurrency: "SUM" },
  { id: 4, name: "Doston market", phone: "+998914458808", type: "chakana savdo", zoneLabel: "spark", zoneCity: "Buxoro", agent: "Samandar Abdurahmonov", courier: "Не указано", collector: "Не указано", balance: [{ value: -17.6, currency: "USD" }], colorBar: "green", category: "planned-okb", debtLimitType: "unlimited" },
  { id: 5, name: "333333333333333333333333333", phone: "+998906298044", type: "chakana savdo", zoneLabel: "spark", zoneCity: "Samarqand", agent: "Admin Ritm", courier: "Admin Ritm", collector: "Не указано", balance: [{ value: 40000000, currency: "SUM" }], colorBar: "red", category: "planned-okb", debtLimitType: "unlimited" },
  { id: 6, name: "Частное Лицо", phone: "+998554445", type: "Юр. лицо", zoneLabel: "Andijon shaharchasi", zoneCity: "Ташкент", agent: "Samandar Abdurahmonov", courier: "Не указано", collector: "Не указано", balance: [{ value: -343375, currency: "SUM" }, { value: -14.4, currency: "USD" }], colorBar: "green", category: "planned-okb", debtLimitType: "amount", debtLimit: 400000, debtLimitCurrency: "SUM" },
  { id: 7, name: "ЧЛ Кылышбай", phone: "998996087387", type: "Физ. лицо", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Samandar Abdurahmonov", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "green", category: "planned-okb", debtLimitType: "unlimited" },
  { id: 8, name: "ИП Каркабаев", phone: "+998914458808", type: "Физ. лицо", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Samandar Abdurahmonov", courier: "Не указано", collector: "Не указано", balance: [{ value: 30000, currency: "SUM" }], colorBar: "gray", category: "planned-okb", debtLimitType: "unlimited" },
  { id: 9, name: "klient 1", phone: "+998900459655", type: "не какокоаткт пкп", zoneLabel: "chilonzor", zoneCity: "777", agent: "Samandar Abdurahmonov", courier: "Не указано", collector: "Не указано", balance: [{ value: -169000, currency: "SUM" }], colorBar: "green", category: "planned-okb", debtLimitType: "amount", debtLimit: 200000, debtLimitCurrency: "SUM" },
  { id: 10, name: "Ritm ritm", phone: "+998900459618", type: "chakana savdo", zoneLabel: "Arslan", zoneCity: "", agent: "Admin Ritm", courier: "Admin Ritm", collector: "Не указано", balance: [], colorBar: "gray", category: "planned-okb", debtLimitType: "unlimited" },
  // Не подтвержденные
  { id: 11, name: "ЧЛ Николай", phone: "-", type: "Физ. лицо", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Samandar Abdurahmonov", courier: "Не указано", collector: "Не указано", balance: [{ value: -40000, currency: "SUM" }], colorBar: "gray", category: "unconfirmed", debtLimitType: "amount", debtLimit: 100000, debtLimitCurrency: "SUM" },
  { id: 12, name: ".", phone: "-", type: "Физ. лицо", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 13, name: "ЧЛ Балаев Файк Мусаевич", phone: "-", info: ["ИНН: 980101302048", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 14, name: 'ТОО "SEDA ELECTRIC"', phone: "-", info: ["ИНН: 240840031027", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 15, name: "ИП Рамазан (Каметулы Бауыржан)", phone: "-", info: ["ИНН: 851211300988", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 16, name: 'ТОО "Пол Берри Юг"', phone: "-", info: ["ИНН: 231240019582", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 17, name: 'ТОО "Mega zakaz"', phone: "-", info: ["ИНН: 060340026351", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 18, name: "ЧЛ Курбатов Вадим Николаевич", phone: "-", info: ["ИНН: 810405399139", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 19, name: "ЧЛ Автигунов Замон Едилбайугли", phone: "-", info: ["ИНН: 910823302151", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 20, name: "ИП Торехан (Анна)", phone: "-", info: ["ИНН: 990113401445", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 21, name: "ИП Ибраева Мадина Амангельдыева", phone: "-", info: ["ИНН: 670129401837", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 22, name: "ИП Алина", phone: "-", info: ["ИНН: 861212302901", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 23, name: "ЧЛ Ведлер Руслан Алексеевич", phone: "-", info: ["ИНН: 880119300821", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 24, name: "ИП АРЕНОВ АБУ-АЛИ НУРЛАНОВИЧ", phone: "-", info: ["ИНН: 900603301113", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 25, name: "ИП Эльмира", phone: "-", info: ["ИНН: 881005401422", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  { id: 26, name: "ИП Исаева", phone: "-", info: ["ИНН: 000818600541", "PRICE_LIST_ID: 12"], type: "не какокоаткт пкп", zoneLabel: "Не указано", zoneCity: "Ташкент", agent: "Admin Ritm", courier: "Не указано", collector: "Не указано", balance: [], colorBar: "none", category: "unconfirmed", debtLimitType: "unlimited" },
  // Закрытие (все 11)
  { id: 27, name: "55521632", phone: "+998977712266", info: ["Abdinazarov: фа"], type: "market152", zoneLabel: "test zona", zoneCity: "Buxoro", agent: "Admin Ritm", courier: "Admin Ritm", collector: "Не указано", balance: [{ value: -1200000, currency: "Euro" }, { value: -118906528.78, currency: "SUM" }, { value: 34.711, currency: "USD" }], colorBar: "red", category: "closure", debtLimitType: "unlimited" },
  { id: 28, name: "Самсунг", phone: "+998+79015632136", type: "Оптовый", zoneLabel: "spark", zoneCity: "Xorazm", agent: "Шохрух Туляганов", courier: "Islom Yuldashev", collector: "Не указано", balance: [{ value: 10157879519, currency: "SUM" }, { value: 6520741.902, currency: "USD" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 29, name: "Magaz", phone: "+998946454843", info: ["Полное наименование: Polnoe imya", "Test: Test"], type: "chakana savdo", zoneLabel: "spark", zoneCity: "777", agent: "Шохрух Туляганов", courier: "Quvonchbek dostavchik Baxromov", collector: "Не указано", balance: [], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 30, name: "145 Rasta", phone: "+998900000001", info: ["geografik joylashuvi: 4", "ИНН: 1700888"], type: "chakana savdo", zoneLabel: "Не указано", zoneCity: "Dodge LLC", agent: "Salohiddin Agent Tashkent", courier: "Quvonchbek dostavchik Baxromov", collector: "Достон Расулов", balance: [{ value: -598998, currency: "SUM" }, { value: -8.3, currency: "USD" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 31, name: "тест для продаж", phone: "+998+7999999999", info: ["data: 25/07/2025", "Havas Алайский: али баба"], type: "market", zoneLabel: "Не указано", zoneCity: "Buxoro", agent: "Salohiddin Agent Tashkent", courier: "Quvonchbek dostavchik Baxromov", collector: "Не указано", balance: [{ value: -598998, currency: "SUM" }, { value: -8.3, currency: "USD" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 32, name: "test2", phone: "+998+79396939393", info: ["data: 17/07/2025", "Havas Алайский: ft"], type: "market", zoneLabel: "Не указано", zoneCity: "ORG", agent: "Fozil Agent", courier: "Quvonchbek dostavchik Baxromov", collector: "Не указано", balance: [{ value: -598998, currency: "SUM" }, { value: -8.3, currency: "USD" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 33, name: "Makro 49", phone: "+998905006033", type: "Супермаркет", zoneLabel: "Не указано", zoneCity: "Toshkent viloyat", agent: "Salohiddin Agent Tashkent", courier: "Quvonchbek dostavchik Baxromov", collector: "Не указано", balance: [{ value: -598998, currency: "SUM" }, { value: -8.3, currency: "USD" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 34, name: "Makro 48", phone: "+998905006075", type: "Супермаркет", zoneLabel: "Не указано", zoneCity: "Toshkent viloyat", agent: "Salohiddin Agent Tashkent", courier: "Quvonchbek dostavchik Baxromov", collector: "Не указано", balance: [{ value: -598998, currency: "SUM" }, { value: -8.3, currency: "USD" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 35, name: "Клиент777", phone: "+998339999969", info: ["Havas Алайский: +998339999969", "nomer: 998339999969"], type: "testClient", zoneLabel: "Не указано", zoneCity: "ORG", agent: "Fozil Agent", courier: "Quvonchbek dostavchik Baxromov", collector: "Не указано", balance: [{ value: 200000, currency: "SUM" }], colorBar: "gray", category: "closure", debtLimitType: "unlimited" },
  { id: 36, name: "dfghj", phone: "+998976004545", info: ["nomer: 9523"], type: "chakana savdo", zoneLabel: "chilonzor zonasi 2", zoneCity: "Ташкент", agent: "agent TIMUR 007", courier: "Admin Ritm", collector: "Quvonchbek Admin", balance: [], colorBar: "red", category: "closure", debtLimitType: "unlimited" },
  { id: 37, name: "Xorazm qirq to'qqizinchi kilent", phone: "+998911234567", type: "Розничный", zoneLabel: "Не указано", zoneCity: "Xorazm", agent: "agent TIMUR 007", courier: "Не указано", collector: "Не указано", balance: [{ value: -552000, currency: "SUM" }, { value: 200, currency: "USD" }], colorBar: "red", category: "closure", debtLimitType: "unlimited" },
  // Проблемные
  ...Array.from({ length: 9 }).map((_, index) => {
    const n = 109 - index
    return {
      id: 40 + index,
      name: `Klient_Karim${n}`,
      phone: `+998${900000000 + n * 111}`,
      type: `market${n - 1}`,
      zoneLabel: "Не указано",
      zoneCity: "ddr",
      agent: "Admin Ritm",
      courier: "Не указано",
      collector: "Не указано",
      balance: [],
      colorBar: "red" as const,
      category: "problem" as const,
      debtLimitType: "unlimited" as const,
    }
  }),
]

const CATEGORY_TOTALS: Record<Category, number> = {
  unconfirmed: 1052,
  problem: 671,
  "planned-okb": 3231,
  closure: 11,
}
const TOTAL_ALL = 4294

const favoriteItemsInitial = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]
const debtLimitTypes = ["Все типы", "Не ограничено", "По сумме"]
const problemSubTabs = ["Неправильный ИНН", "Нет территории", "Нет маршрута", "Все"] as const

const colorBarClass: Record<ClientRow["colorBar"], string> = {
  green: "bg-[#3aa76d]",
  red: "bg-[#e5484d]",
  gray: "bg-[#9aa3b6]",
  none: "bg-transparent",
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

function BalanceCell({ lines }: { lines: BalanceLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className="space-y-0.5">
      {lines.map((line, index) => (
        <div key={index} className={line.value >= 0 ? "text-[#3aa76d]" : "text-[#e5484d]"}>
          {number(line.value)} {line.currency}
        </div>
      ))}
    </div>
  )
}

export function DebtLimitsView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteItems, setFavoriteItems] = useState(favoriteItemsInitial)
  const [hoveredFavorite, setHoveredFavorite] = useState<number | null>(null)
  const [rows, setRows] = useState(clients)
  const [tab, setTab] = useState<Category | "all">("unconfirmed")
  const [problemSubTab, setProblemSubTab] = useState<(typeof problemSubTabs)[number]>("Все")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [limitType, setLimitType] = useState(debtLimitTypes[0])
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [drawerTab, setDrawerTab] = useState<"activity" | "tasks" | "client" | "reports" | "refusals">("activity")
  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [bulkAction, setBulkAction] = useState<"edit" | "route" | null>(null)

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab !== "all" && row.category !== tab) return false
      if (search.trim() && !row.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (limitType === "Не ограничено" && row.debtLimitType !== "unlimited") return false
      if (limitType === "По сумме" && row.debtLimitType !== "amount") return false
      return true
    })
  }, [limitType, rows, search, tab])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultFilters = !search.trim() && limitType === "Все типы"
  const fixedTotal = tab === "all" ? TOTAL_ALL : tab === "problem" ? CATEGORY_TOTALS.problem : CATEGORY_TOTALS[tab]
  const totalLabel = isDefaultFilters ? fixedTotal : filtered.length

  const changeTab = (value: Category | "all") => {
    setTab(value)
    setPage(1)
    setSelected(null)
  }

  const saveClientLimit = (id: number, unlimited: boolean, limit: number, currency: Currency) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, debtLimitType: unlimited ? "unlimited" : "amount", debtLimit: unlimited ? undefined : limit, debtLimitCurrency: unlimited ? undefined : currency } : row,
      ),
    )
    setSelected((current) => (current && current.id === id ? { ...current, debtLimitType: unlimited ? "unlimited" : "amount", debtLimit: unlimited ? undefined : limit, debtLimitCurrency: unlimited ? undefined : currency } : current))
  }

  const removeFavorite = (index: number) => {
    setFavoriteItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const downloadAll = () => {
    const header = ["Название", "Тел. номер", "Тип", "Зона", "Ответственный агент", "Ответственный доставщик", "Ответственный инкассатор", "Тип лимита долга", "Лимит"]
    const body = filtered.map((row) => [
      row.name,
      row.phone,
      row.type,
      `${row.zoneLabel} ${row.zoneCity}`,
      row.agent,
      row.courier,
      row.collector,
      row.debtLimitType === "unlimited" ? "Неограниченный долг" : "По сумме",
      row.debtLimitType === "unlimited" ? "" : `${number(row.debtLimit ?? 0)} ${row.debtLimitCurrency}`,
    ])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "clients.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Клиенты</span>
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={downloadAll} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><BarChart className="h-4 w-4" /> Импортировать акции</button>
          <button onClick={() => setBulkAction("route")} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><MapIcon className="h-4 w-4" /> Показать на карте</button>
          <button onClick={() => setImportOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><Upload className="h-4 w-4" /> Импортировать</button>
          <button onClick={() => setPage(1)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><RefreshCw className="h-4 w-4" /> Обновить с excel</button>
          <button onClick={() => setAddOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-4 font-semibold text-white"><Plus className="h-4 w-4" /> Добавить</button>
        </div>
      </header>

      <section className="grid grid-cols-1 border-b border-[#e1e5eb] bg-white text-center sm:grid-cols-5">
        {(
          [
            ["unconfirmed", "Не подтвержденные"],
            ["problem", "Проблемные"],
            ["planned-okb", "Плановый ОКБ"],
            ["closure", "Закрытие"],
            ["all", "Все"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => changeTab(key)}
            className={`border-b-2 py-4 text-[16px] font-medium ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {label}
          </button>
        ))}
      </section>

      {tab === "problem" && (
        <section className="grid grid-cols-1 border-b border-[#e1e5eb] bg-white text-center sm:grid-cols-4">
          {problemSubTabs.map((label) => (
            <button
              key={label}
              onClick={() => setProblemSubTab(label)}
              className={`border-b-2 py-3 text-[15px] font-medium ${problemSubTab === label ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
            >
              {label}
            </button>
          ))}
        </section>
      )}

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {totalLabel}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
        <button onClick={() => setBulkAction("edit")} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white"><Pencil className="h-4 w-4" /> Изменить</button>
        <button onClick={() => setBulkAction("route")} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white"><TrendingUp className="h-4 w-4" /> Уст. маршрут</button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Клиент
            <input placeholder="Введите имя..." value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" />
          </label>
          {["Тип клиента", "Статус", "Показать только", "Последнее посещение", "Создал", "Зона", "Ответственный агент", "Ответственные доставщики", "Тип отказа", "Филиалы", "Инкассаторы", "Категория"].map((label) => (
            <label key={label} className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium text-[#17233b]">
              {label}
              <select defaultValue="" className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                <option value="" />
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
            </label>
          ))}
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Тип лимита долга
            <select value={limitType} onChange={(event) => { setLimitType(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              {debtLimitTypes.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-[15px] font-medium">
            <input type="checkbox" checked={limitType === "Не ограничено"} onChange={(event) => setLimitType(event.target.checked ? "Не ограничено" : "Все типы")} className="h-4 w-4 accent-[#4f70e7]" />
            Неограниченный долг
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1500px] w-full border-collapse text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="w-2 px-0 py-3" />
              {["Название", "Тел. номер", "Информация", "Тип", "Зона", "Ответственный агент", "Ответственный доставщик", "Ответственный инкассатор", "Баланс"].map((title) => (
                <th key={title} className="whitespace-nowrap px-4 py-3 text-left font-semibold">{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={row.id} onClick={() => { setSelected(row); setDrawerTab("activity") }} className={`cursor-pointer border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"} hover:bg-[#eef2ff]`}>
                <td className={`w-2 p-0 ${colorBarClass[row.colorBar]}`} />
                <td className="px-4 py-3.5 font-medium text-[#4f70e7]">{row.name}</td>
                <td className="px-4 py-3.5">{row.phone}</td>
                <td className="px-4 py-3.5 text-[13px]">{row.info?.map((line, lineIndex) => <div key={lineIndex}>{line.includes(":") ? <>{line.split(":")[0]}: <b>{line.split(":").slice(1).join(":").trim()}</b></> : line}</div>)}</td>
                <td className="px-4 py-3.5">{row.type}</td>
                <td className="px-4 py-3.5">{row.zoneLabel}<br /><span className="text-[#4f70e7]">{row.zoneCity}</span></td>
                <td className="px-4 py-3.5">{row.agent}</td>
                <td className="px-4 py-3.5">{row.courier}</td>
                <td className="px-4 py-3.5">{row.collector}</td>
                <td className="px-4 py-3.5"><BalanceCell lines={row.balance} /></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && <ClientDrawer client={selected} tab={drawerTab} setTab={setDrawerTab} onClose={() => setSelected(null)} onSaveLimit={saveClientLimit} />}

      {importOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setImportOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">Импорт с Excel</h2>
              <button aria-label="Закрыть" onClick={() => setImportOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="px-8 py-7">
              <p className="mb-4 text-center font-semibold text-[#4f70e7]">1. Скачать шаблон</p>
              <label className="flex h-44 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#dbe0e8] text-[#586174] cursor-pointer">
                <Upload className="h-6 w-6" />
                <span>Добавьте файл Excel или <span className="text-[#4f70e7] underline">нажмите для выбора</span></span>
                <input type="file" accept=".xlsx,.xls" className="hidden" />
              </label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button onClick={() => setImportOpen(false)} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87]">Сохранить</button>
            </footer>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setAddOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[480px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">Добавить клиента</h2>
              <button aria-label="Закрыть" onClick={() => setAddOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="space-y-6 px-8 py-7">
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">Название<input className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" /></label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">Тел. номер<input className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" /></label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">Тип<input className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" /></label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button onClick={() => setAddOpen(false)} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87]">Сохранить</button>
            </footer>
          </div>
        </div>
      )}

      {bulkAction && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setBulkAction(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold">{bulkAction === "edit" ? "Изменить" : "Установить маршрут"}</h2>
            <p className="mb-6 text-[#586174]">Будет применено к {filtered.length} клиентам из текущей выборки.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setBulkAction(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">Отмена</button>
              <button onClick={() => setBulkAction(null)} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">Применить</button>
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

function ClientDrawer({
  client,
  tab,
  setTab,
  onClose,
  onSaveLimit,
}: {
  client: ClientRow
  tab: "activity" | "tasks" | "client" | "reports" | "refusals"
  setTab: (value: "activity" | "tasks" | "client" | "reports" | "refusals") => void
  onClose: () => void
  onSaveLimit: (id: number, unlimited: boolean, limit: number, currency: Currency) => void
}) {
  const [unlimited, setUnlimited] = useState(client.debtLimitType === "unlimited")
  const [limit, setLimit] = useState(String(client.debtLimit ?? ""))
  const [currency, setCurrency] = useState<Currency>(client.debtLimitCurrency ?? "SUM")

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button aria-label="Закрыть" onClick={onClose} className="flex-1 bg-black/40" />
      <aside className="w-[680px] max-w-[96vw] overflow-y-auto bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b px-6 py-5">
          <span className={`h-3 w-3 rounded-full ${colorBarClass[client.colorBar] || "bg-[#9aa3b6]"}`} />
          <h2 className="flex-1 text-lg font-bold uppercase tracking-wide">{client.name}</h2>
          <button aria-label="Редактировать" className="text-[#586174] hover:text-[#17233b]"><Pencil className="h-5 w-5" /></button>
          <button aria-label="Удалить" className="text-[#e5484d] hover:text-[#c53238]"><Trash2 className="h-5 w-5" /></button>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>

        <nav className="flex border-b text-[13px] font-bold uppercase tracking-wide">
          {(
            [
              ["activity", "Активность"],
              ["tasks", "Задачи"],
              ["client", "Клиент"],
              ["reports", "Отчеты"],
              ["refusals", "Отказы"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`flex-1 border-b-2 py-4 ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}>{label}</button>
          ))}
        </nav>

        {tab === "activity" && (
          <div className="space-y-8 px-6 py-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <p className="text-[#586174]">Фактические продажи (30 дней)</p>
                <p className="text-xl font-bold">0 SUM</p>
              </div>
              <div>
                <p className="text-[#586174]">Прошло дней с последнего заказа</p>
                <p className="text-xl font-bold text-[#e5484d]">2407</p>
              </div>
              <div>
                <p className="text-[#586174]">Сумма продаж за период (30 дней)</p>
                <p className="text-xl font-bold">0 SUM</p>
              </div>
              <div>
                <p className="text-[#586174]">Прошло дней с последнего визита</p>
                <p className="text-xl font-bold text-[#e5484d]">2407</p>
              </div>
              <div>
                <p className="text-[#586174]">Сумма возврата с заказов за период (30 дней)</p>
                <p className="text-xl font-bold">0 SUM</p>
              </div>
              <div>
                <p className="text-[#586174]">Комментарий отказа</p>
                <p className="text-xl font-bold">Не указан</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className="flex items-center gap-2 rounded-md bg-[#6fcf97] px-5 py-2.5 font-semibold text-white"><Phone className="h-4 w-4" /> Позвонить</button>
              <button className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white"><ShoppingCart className="h-4 w-4" /> Заказать</button>
              <button className="flex items-center gap-2 rounded-md bg-[#e5484d] px-5 py-2.5 font-semibold text-white"><XCircle className="h-4 w-4" /> Отказ</button>
              <button className="flex items-center gap-2 rounded-md bg-[#3aa76d] px-5 py-2.5 font-semibold text-white"><Wallet className="h-4 w-4" /> Добавить оплату</button>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-bold">Агенты магазина</h3>
              <table className="w-full border-collapse text-[14px]">
                <thead className="text-[#586174]"><tr><th className="border-b py-2 text-left font-semibold">Агент</th><th className="border-b py-2 text-left font-semibold">Комментарий</th><th className="border-b py-2 text-left font-semibold">Прайс лист</th><th className="border-b py-2" /></tr></thead>
                <tbody><tr><td className="py-6 text-center text-[#9aa3b6]" colSpan={4}>Нет данных</td></tr></tbody>
              </table>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-bold">Маршруты</h3>
              <table className="w-full border-collapse text-[14px]">
                <thead className="text-[#586174]"><tr><th className="border-b py-2 text-left font-semibold">Агент</th><th className="border-b py-2 text-left font-semibold">Частота посещения</th><th className="border-b py-2 text-left font-semibold">Дни недели</th><th className="border-b py-2" /></tr></thead>
                <tbody>
                  <tr>
                    <td className="border-b py-3">{client.agent}</td>
                    <td className="border-b py-3">Раз в неделю</td>
                    <td className="border-b py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                          <span key={day} className="rounded-sm bg-[#f6f9fc] px-2 py-1 text-[13px]">{day}</span>
                        ))}
                      </div>
                    </td>
                    <td className="border-b py-3"><Pencil className="h-4 w-4 text-[#586174]" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold">Баланс</h3>
                <span className="text-[#4f70e7]">05 Июля 2026 - 04 Авг. 2026</span>
              </div>
              <BalanceCell lines={client.balance} />
              {client.balance.length === 0 && <p className="text-[#9aa3b6]">0</p>}
              <p className="mt-3 text-[#586174]">Последняя дата платежа: <span className="font-semibold text-[#17233b]">01 янв. 2020</span></p>
            </div>
          </div>
        )}

        {tab === "client" && (
          <div className="space-y-7 px-6 py-6">
            <h3 className="text-lg font-bold">Лимит долга</h3>
            <label className="flex items-center gap-2 text-[15px] font-medium">
              <input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
              Неограниченный долг
            </label>
            {!unlimited && (
              <>
                <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                  Лимит
                  <input type="number" value={limit} onChange={(event) => setLimit(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
                </label>
                <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                  Валюта
                  <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
                    <option value="SUM">SUM</option>
                    <option value="USD">USD</option>
                    <option value="Euro">Euro</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
                </label>
              </>
            )}
            <button
              onClick={() => onSaveLimit(client.id, unlimited, Number(limit) || 0, currency)}
              className="rounded-md bg-[#4f70e7] px-6 py-3 font-semibold text-white"
            >
              Сохранить
            </button>

            <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-t pt-6 text-[15px]">
              <div><p className="text-[#586174]">Телефон</p><p className="font-semibold">{client.phone}</p></div>
              <div><p className="text-[#586174]">Тип</p><p className="font-semibold">{client.type}</p></div>
              <div><p className="text-[#586174]">Ответственный агент</p><p className="font-semibold">{client.agent}</p></div>
              <div><p className="text-[#586174]">Ответственный доставщик</p><p className="font-semibold">{client.courier}</p></div>
            </div>
          </div>
        )}

        {(tab === "tasks" || tab === "reports" || tab === "refusals") && (
          <div className="flex flex-col items-center justify-center py-24">
            <Image src="/robot-mascot.png" alt="Робот-помощник" width={110} height={110} className="h-24 w-24 object-contain" />
            <p className="mt-4 text-[#9aa3b6]">Нет данных</p>
          </div>
        )}
      </aside>
    </div>
  )
}
