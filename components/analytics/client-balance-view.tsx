"use client"

import { useMemo, useRef, useState } from "react"
import { BarChart, Calendar, ChevronDown, ChevronRight, ChevronsRight, CreditCard, Filter, List, Star, Trash2, X } from "lucide-react"

type Money = { sum: number; usd: number; eur: number }
type Client = {
  id: number
  name: string
  taxId?: string
  type: string
  opening: Money
}

const zero: Money = { sum: 0, usd: 0, eur: 0 }

const clients: Client[] = [
  { id: 1, name: "Markus Vitinha", type: "Розничный", opening: { ...zero } },
  { id: 2, name: "Usman Dembele", type: "Оптовый", opening: { sum: 12050000, usd: 0, eur: 0 } },
  { id: 3, name: "Ashraf Hakimi", type: "Розница", opening: { sum: -251171800, usd: 0, eur: 0 } },
  { id: 4, name: "Doston market", type: "market", opening: { sum: 0, usd: -17.6, eur: 0 } },
  { id: 5, name: "333333333333333333333333333", type: "Розничный", opening: { sum: 40000000, usd: 0, eur: 0 } },
  { id: 6, name: "Частное Лицо", type: "Розничный", opening: { sum: -343375, usd: -14.4, eur: 0 } },
  { id: 7, name: "ЧЛ Кылышбай", type: "Розничный", opening: { ...zero } },
  { id: 8, name: "ИП Каркабаев", type: "Оптовый", opening: { sum: 30000, usd: 0, eur: 0 } },
  { id: 9, name: "ЧЛ Николай", type: "Розничный", opening: { sum: -40000, usd: 0, eur: 0 } },
  { id: 10, name: ".", type: "Розничный", opening: { ...zero } },
  { id: 11, name: "klient 1", type: "Розничный", opening: { sum: -169000, usd: 0, eur: 0 } },
  { id: 12, name: "ЧЛ Балаев Файк Мусаевич", taxId: "980101302048", type: "Розничный", opening: { ...zero } },
  { id: 13, name: 'ТОО "SEDA ELECTRIC"', taxId: "240840031027", type: "Оптовый", opening: { ...zero } },
  { id: 14, name: "ИП Рамазан (Каметулы Бауыржан)", taxId: "851211300988", type: "Оптовый", opening: { ...zero } },
  { id: 15, name: 'ТОО "Пол Берри Юг"', taxId: "231240019582", type: "Оптовый", opening: { ...zero } },
  { id: 16, name: 'ТОО "Mega zakaz"', taxId: "060340026351", type: "Оптовый", opening: { ...zero } },
  { id: 17, name: "ЧЛ Курбатов Вадим Николаевич", taxId: "810405399139", type: "Розничный", opening: { ...zero } },
  { id: 18, name: "ЧЛ Автигунов Замон Едилбайугли", taxId: "910823302151", type: "Розничный", opening: { ...zero } },
  { id: 19, name: "ИП Торехан", taxId: "Анна", type: "Оптовый", opening: { ...zero } },
]

const TOTAL_CLIENTS = 4294
const FIXED_TOTALS = { opening: { eur: -11704880.396, sum: -31872513709.134, usd: 7079763.002 } }

const typeAggregates: { type: string; balance: Money }[] = [
  { type: "Розничный", balance: { sum: -1082998955, usd: 1182558781, eur: 0 } },
  { type: "Оптовый", balance: { sum: 10156316832, usd: 6503221157, eur: 20 } },
  { type: "Розница", balance: { sum: -1197774081, usd: 200016047, eur: 0 } },
  { type: "Не рабочий зона", balance: { sum: -145928640, usd: 0, eur: 0 } },
  { type: "chakana savdo", balance: { sum: -290857785, usd: 12447345, eur: -6330400.396 } },
  { type: "QSR", balance: { sum: 622601, usd: 0, eur: 0 } },
  { type: "Врачи", balance: { sum: 56044545, usd: -102767, eur: 0 } },
  { type: "market", balance: { sum: -39079976, usd: -17655798, eur: -5374500 } },
  { type: "testClient", balance: { sum: -53800000, usd: 0, eur: 0 } },
  { type: "Супермакет", balance: { ...zero } },
  { type: "Супермаркет", balance: { sum: -184298795, usd: -800699032, eur: 0 } },
  { type: "Ишлаб чиқарувчи", balance: { ...zero } },
  { type: "Ошхона", balance: { sum: 1300000, usd: 0, eur: 0 } },
  { type: "Ресторан", balance: { ...zero } },
]

const favoriteItemsInitial = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

const groups = ["Баланс на начало периода", "Продано", "Возврат", "Оплачено", "Прочие приходы", "Прочие расходы", "Баланс на конец периода"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

export function ClientBalanceView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteItems, setFavoriteItems] = useState(favoriteItemsInitial)
  const [hoveredFavorite, setHoveredFavorite] = useState<number | null>(null)
  const [dateBasis, setDateBasis] = useState<"transaction" | "realization">("transaction")
  const [filterOpen, setFilterOpen] = useState(false)
  const [groupPaymentOpen, setGroupPaymentOpen] = useState(false)
  const [splitByCurrency, setSplitByCurrency] = useState(false)
  const [byType, setByType] = useState(false)
  const [typeFilter, setTypeFilter] = useState("Все типы")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

  const [branch, setBranch] = useState("Все филиалы")
  const [zone, setZone] = useState("Все зоны")
  const [lastVisit, setLastVisit] = useState("Не важно")
  const [organization, setOrganization] = useState("Все организации")
  const [agentClients, setAgentClients] = useState("Все агенты")
  const [supplier, setSupplier] = useState("Все поставщики")
  const [balanceType, setBalanceType] = useState("Любой")
  const [responsibleSupplier, setResponsibleSupplier] = useState("Не важно")
  const [responsibleCollector, setResponsibleCollector] = useState("Не важно")
  const [sinceOrderFrom, setSinceOrderFrom] = useState("")
  const [sinceOrderTo, setSinceOrderTo] = useState("")
  const [sincePaymentFrom, setSincePaymentFrom] = useState("")
  const [sincePaymentTo, setSincePaymentTo] = useState("")
  const [sinceRefusalFrom, setSinceRefusalFrom] = useState("")
  const [sinceRefusalTo, setSinceRefusalTo] = useState("")
  const [sinceVisitFrom, setSinceVisitFrom] = useState("")
  const [sinceVisitTo, setSinceVisitTo] = useState("")
  const [onlyRealized, setOnlyRealized] = useState(false)
  const [onlyDelivered, setOnlyDelivered] = useState(false)
  const [onlyInvoiced, setOnlyInvoiced] = useState(false)
  const [excludeClosed, setExcludeClosed] = useState(false)

  const today = useMemo(() => new Date(), [])
  const defaultFrom = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() - 2); return d }, [today])
  const [transFrom, setTransFrom] = useState("")
  const [transTo, setTransTo] = useState("")
  const [clientFrom, setClientFrom] = useState("")
  const [clientTo, setClientTo] = useState("")
  const [appliedFrom, setAppliedFrom] = useState(() => formatDate(defaultFrom))
  const [appliedTo, setAppliedTo] = useState(() => formatDate(today))

  const filterCount = appliedFrom && appliedTo ? 1 : 0

  const types = ["Все типы", ...new Set(clients.map((client) => client.type))]

  const filteredClients = useMemo(
    () => clients.filter((client) => typeFilter === "Все типы" || client.type === typeFilter),
    [typeFilter],
  )

  const maxPage = Math.max(1, Math.ceil(filteredClients.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visibleClients = filteredClients.slice((safePage - 1) * pageSize, safePage * pageSize)

  const allSelected = visibleClients.length > 0 && visibleClients.every((client) => selected.has(client.id))
  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allSelected) visibleClients.forEach((client) => next.delete(client.id))
      else visibleClients.forEach((client) => next.add(client.id))
      return next
    })
  }
  const toggleOne = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyFilter = () => {
    if (transFrom) setAppliedFrom(formatDate(new Date(transFrom)))
    if (transTo) setAppliedTo(formatDate(new Date(transTo)))
    setPage(1)
    setFilterOpen(false)
  }

  const removeFavorite = (index: number) => {
    setFavoriteItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const scrollTableToEnd = () => {
    tableRef.current?.scrollTo({ left: tableRef.current.scrollWidth, behavior: "smooth" })
  }

  const drillIntoType = (type: string) => {
    setByType(false)
    setTypeFilter(type)
    setPage(1)
  }

  const downloadAll = () => {
    const header = ["Клиент", "Тип", ...groups.flatMap((group) => [`${group} SUM`, `${group} USD`, `${group} Euro`])]
    const body = filteredClients.map((client) => {
      const cells = groups.flatMap((group) =>
        group === "Баланс на начало периода" || group === "Баланс на конец периода"
          ? [client.opening.sum, client.opening.usd, client.opening.eur]
          : [0, 0, 0],
      )
      return [client.name, client.type, ...cells]
    })
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "client-balance.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс клиентов</span>
        </button>
        <div className="flex overflow-hidden rounded-md border border-[#dbe0e8] my-3">
          <button
            onClick={() => setDateBasis("transaction")}
            className={`flex items-center gap-2 px-5 py-3 text-[15px] font-semibold ${dateBasis === "transaction" ? "bg-[#6fcf97] text-white" : "bg-white text-[#586174]"}`}
          >
            <Info className="h-4 w-4" /> По дате создание транзакции
          </button>
          <button
            onClick={() => setDateBasis("realization")}
            className={`flex items-center gap-2 px-5 py-3 text-[15px] font-semibold ${dateBasis === "realization" ? "bg-[#6fcf97] text-white" : "bg-white text-[#586174]"}`}
          >
            <Info className="h-4 w-4" /> По дате реализации
          </button>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> Фильтр / {filterCount}
        </button>
        <span className="font-semibold text-[#4f70e7]">{appliedFrom} - {appliedTo}</span>
        <span className="text-[#586174]">Во всей организации</span>
        <button onClick={() => setGroupPaymentOpen(true)} className="ml-auto flex h-11 items-center gap-2 rounded-md border border-[#4f70e7] px-5 font-semibold text-[#4f70e7]">
          <CreditCard className="h-5 w-5" /> Групповая оплата
        </button>
        <button onClick={downloadAll} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> Скачать
        </button>
      </section>

      <section className="grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div>
          <p className="text-[#586174]">Баланс на начало периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.eur} /> Euro</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Возврат</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие приходы</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[#586174]">Баланс на конец периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.eur} /> Euro</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.usd} /> USD</p>
        </div>
        <div className="sm:col-start-2 lg:col-start-2">
          <p className="text-[#586174]">Продажи</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Оплачено</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие расходы</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-[#e1e5eb] px-6 py-4 md:px-9">
        <button
          onClick={() => setSplitByCurrency((value) => !value)}
          className={`rounded-sm px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${splitByCurrency ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}
        >
          Разбить по валютам
        </button>
        <button
          onClick={() => { setByType((value) => !value); setTypeFilter("Все типы"); setPage(1) }}
          className={`rounded-sm px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${byType ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}
        >
          Показать по типам клиентов
        </button>

        <span className="mx-auto text-[15px] font-medium text-[#17233b]">{byType ? "Тип клиента" : "Клиент"}</span>

        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">
          {byType ? `1 - ${typeAggregates.length} из ${typeAggregates.length}` : `${filteredClients.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filteredClients.length)} из ${typeFilter === "Все типы" ? TOTAL_CLIENTS : filteredClients.length}`}
        </span>
        <button disabled={byType || safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={byType || safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><ChevronsRight className="h-5 w-5 rotate-45" /></button>
      </section>

      <div className="relative">
        <section ref={tableRef} className="overflow-x-auto pb-10">
          <table className="min-w-[2600px] w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-[#edf2f7] text-[#253653]">
                <th className="border border-[#e1e5eb] px-4 py-2" />
                <th className="border border-[#e1e5eb] px-2 py-2" />
                {groups.map((group) => (
                  <th key={group} colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
                ))}
              </tr>
              <tr className="bg-white text-[#17233b]">
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{byType ? "Тип клиента" : "Клиент"}</th>
                <th className="border-b border-[#e1e5eb] px-2 py-2">
                  {!byType && <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[#4f70e7]" />}
                </th>
                {groups.map((group) =>
                  ["SUM", "USD", "Euro"].map((currency) => (
                    <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {byType
                ? typeAggregates.map((row, index) => (
                    <tr key={row.type} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5">
                        <button onClick={() => drillIntoType(row.type)} className="flex items-center gap-2 text-left hover:text-[#4f70e7]">
                          {row.type} <List className="h-4 w-4 text-[#4f70e7]" />
                        </button>
                      </td>
                      <td className="border-b border-[#e1e5eb] px-2 py-3.5" />
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balance.sum} /></td>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balance.usd} /></td>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balance.eur} /></td>
                      {Array.from({ length: 15 }).map((_, cellIndex) => (
                        <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                      ))}
                    </tr>
                  ))
                : visibleClients.map((client, index) => (
                    <tr key={client.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5">
                        <div>{client.name}</div>
                        {client.taxId && <div className="text-[13px] text-[#586174]">({client.taxId})</div>}
                      </td>
                      <td className="border-b border-[#e1e5eb] px-2 py-3.5 text-center">
                        <input type="checkbox" checked={selected.has(client.id)} onChange={() => toggleOne(client.id)} className="h-4 w-4 accent-[#4f70e7]" />
                      </td>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={client.opening.sum} /></td>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={client.opening.usd} /></td>
                      <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={client.opening.eur} /></td>
                      {Array.from({ length: 15 }).map((_, cellIndex) => (
                        <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                      ))}
                    </tr>
                  ))}
              {!byType && visibleClients.length === 0 && (
                <tr><td colSpan={23} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <button
          aria-label="Прокрутить таблицу вправо"
          onClick={scrollTableToEnd}
          className="fixed right-0 top-1/2 z-10 flex h-14 w-9 -translate-y-1/2 items-center justify-center rounded-l-full bg-[#dfe4ea] text-[#586174] shadow-lg hover:bg-[#cfd6df]"
        >
          <ChevronsRight className="h-5 w-5" />
        </button>
      </div>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[1100px] max-w-[94vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-semibold text-[#586174]">Фильтр</h2>
              <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </header>

            <div className="grid grid-cols-1 gap-x-10 gap-y-7 px-8 py-7 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="mb-1 flex items-center justify-between text-[13px] font-medium text-[#586174]">
                  <span>Период создания транзакции</span>
                  <Calendar className="h-4 w-4 text-[#9aa3b6]" />
                </div>
                <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-2 text-[15px]">
                  <input type="date" value={transFrom} onChange={(event) => setTransFrom(event.target.value)} className="w-full bg-transparent outline-none" />
                  <span className="text-[#9aa3b6]">—</span>
                  <input type="date" value={transTo} onChange={(event) => setTransTo(event.target.value)} className="w-full bg-transparent outline-none" />
                </div>
              </div>

              <SelectField label="Филиалы" value={branch} setter={setBranch} options={["Все филиалы", "Центральный", "Ташкент", "Фаргона"]} />
              <SelectField label="Зона" value={zone} setter={setZone} options={["Все зоны", "Розничный", "Рабочий", "Не рабочий зона"]} />
              <SelectField label="Последнее посещение" value={lastVisit} setter={setLastVisit} options={["Не важно", "Сегодня", "Неделя", "Месяц"]} />

              <div>
                <div className="mb-1 flex items-center justify-between text-[13px] font-medium text-[#586174]">
                  <span>Период создания клиента</span>
                  <Calendar className="h-4 w-4 text-[#9aa3b6]" />
                </div>
                <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-2 text-[15px]">
                  <input type="date" value={clientFrom} onChange={(event) => setClientFrom(event.target.value)} placeholder="Укажите дату" className="w-full bg-transparent outline-none placeholder:text-[#9aa3b6]" />
                  <span className="text-[#9aa3b6]">—</span>
                  <input type="date" value={clientTo} onChange={(event) => setClientTo(event.target.value)} className="w-full bg-transparent outline-none" />
                </div>
              </div>

              <RangeField label="Прошло дней с последнего заказа" from={sinceOrderFrom} to={sinceOrderTo} setFrom={setSinceOrderFrom} setTo={setSinceOrderTo} />
              <RangeField label="Прошло дней с последней оплаты" from={sincePaymentFrom} to={sincePaymentTo} setFrom={setSincePaymentFrom} setTo={setSincePaymentTo} />
              <RangeField label="Прошло дней с последнего отказа" from={sinceRefusalFrom} to={sinceRefusalTo} setFrom={setSinceRefusalFrom} setTo={setSinceRefusalTo} />

              <RangeField label="Прошло дней с последнего визита" from={sinceVisitFrom} to={sinceVisitTo} setFrom={setSinceVisitFrom} setTo={setSinceVisitTo} />
              <SelectField label="Организация" value={organization} setter={setOrganization} options={["Все организации", ...new Set(clients.map(() => "Linko"))]} />
              <SelectField label="Тип клиента" value={typeFilter} setter={(value) => { setTypeFilter(value); setByType(false); setPage(1) }} options={types} />
              <SelectField label="Клиенты агента" value={agentClients} setter={setAgentClients} options={["Все агенты", "Admin Ritm", "Temur Raupov", "Samandar Abdurahmonov"]} />

              <SelectField label="Доставщик" value={supplier} setter={setSupplier} options={["Все поставщики", "Собственная доставка", "Партнёр"]} />
              <SelectField label="Тип баланса" value={balanceType} setter={setBalanceType} options={["Любой", "Дебитор", "Кредитор", "Нулевой"]} />
              <SelectField label="Ответственные доставщики" value={responsibleSupplier} setter={setResponsibleSupplier} options={["Не важно", "Admin Ritm", "Шохрух Туляганов"]} />
              <SelectField label="Ответственный инкасатор" value={responsibleCollector} setter={setResponsibleCollector} options={["Не важно", "Admin Ritm", "Тп 2 Алиса"]} />
            </div>

            <div className="flex flex-wrap gap-x-10 gap-y-3 border-t px-8 py-6 text-[14px] text-[#17233b]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyRealized} onChange={(event) => setOnlyRealized(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" /> Учитывать только реализованных заказов</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyDelivered} onChange={(event) => setOnlyDelivered(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" /> Только доставленные заказы</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={onlyInvoiced} onChange={(event) => setOnlyInvoiced(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" /> Только оплаты с счет фактурой</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={excludeClosed} onChange={(event) => setExcludeClosed(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" /> Исключить закрытие магазины</label>
            </div>

            <div className="px-8 pb-8">
              <button onClick={applyFilter} className="block w-full rounded-md bg-[#6fcf97] py-3.5 text-center font-semibold text-white hover:bg-[#5fbf87]">Применить</button>
            </div>
          </div>
        </div>
      )}

      {groupPaymentOpen && (
        <GroupPaymentModal count={selected.size} onClose={() => setGroupPaymentOpen(false)} />
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
                <button
                  type="button"
                  onClick={() => { setFavorite(true); setFavoritesOpen(false) }}
                  className="flex flex-1 items-center gap-3 text-left"
                >
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

function Info({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  )
}

function SelectField({ label, value, setter, options }: { label: string; value: string; setter: (value: string) => void; options: string[] }) {
  return (
    <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
      {label}
      <select value={value} onChange={(event) => setter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal text-[#17233b] outline-none">
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
    </label>
  )
}

function RangeField({ label, from, to, setFrom, setTo }: { label: string; from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-[#586174]">{label}</p>
      <div className="flex items-center gap-3">
        <input value={from} onChange={(event) => setFrom(event.target.value)} type="number" placeholder="От (дней)" className="w-full border-b border-[#dbe0e8] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#586174]" />
        <input value={to} onChange={(event) => setTo(event.target.value)} type="number" placeholder="До (дней)" className="w-full border-b border-[#dbe0e8] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#586174]" />
      </div>
    </div>
  )
}

function GroupPaymentModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [currency, setCurrency] = useState<"sum" | "usd" | "eur">("sum")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[600px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">Групповая оплата</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <p className="text-sm text-[#586174]">Будет применено к {count || "0"} {count === 1 ? "клиенту" : "клиентам"}</p>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as "sum" | "usd" | "eur")} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              <option value="sum">SUM</option>
              <option value="usd">USD</option>
              <option value="eur">Euro</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Сумма
            <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Дата создания
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            <input placeholder="Оставить комментарий..." value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] outline-none placeholder:text-[#586174]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button onClick={onClose} className="font-bold uppercase tracking-wide text-[#4f70e7]">Сохранить</button>
        </footer>
      </div>
    </div>
  )
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function formatDate(date: Date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
