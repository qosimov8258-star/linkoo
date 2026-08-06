"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, ChevronsRight, DollarSign, Filter, MinusCircle, PlusCircle, Star, Trash2, X } from "lucide-react"

type Money = { sum: number; usd: number; eur: number }
type Supplier = {
  id: number
  name: string
  opening: Money
  pendingRequest: Money
}

const zero: Money = { sum: 0, usd: 0, eur: 0 }

const suppliers: Supplier[] = [
  { id: 1, name: "Инвентаризация", opening: { sum: 100000000, usd: 0, eur: 0 }, pendingRequest: { sum: 9000200000, usd: 0, eur: 110 } },
  { id: 2, name: "Kotta aka", opening: { sum: -8955504900, usd: 0, eur: 0 }, pendingRequest: { sum: 1000100000, usd: 0, eur: 0 } },
  { id: 3, name: "Corelion", opening: { sum: 199400456, usd: 555, eur: 0 }, pendingRequest: { ...zero } },
  { id: 4, name: "Corelion", opening: { sum: -693033, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 5, name: "Dji technology", opening: { sum: -4149880000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 6, name: "shaxlo sutlari", opening: { sum: 1085700000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 7, name: "laylo shirin", opening: { sum: 69734000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 8, name: "Robot postavchik", opening: { sum: -5056000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 9, name: "energetik postavchik", opening: { sum: -963636000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 10, name: "andijanskiy postavchik", opening: { sum: -410035000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 11, name: "Xoramskaya postavshik", opening: { sum: -1301502000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 12, name: "universal postavshik", opening: { sum: -27331482, usd: -2790100, eur: 0 }, pendingRequest: { ...zero } },
  { id: 13, name: "Demo", opening: { sum: -136594000, usd: -6000010, eur: 0 }, pendingRequest: { ...zero } },
  { id: 14, name: "zapas", opening: { sum: -56194000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 15, name: "YEPPOYO", opening: { sum: -3880000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 16, name: "ООО ПРОФРЕШ", opening: { sum: 6500000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 17, name: "Айти-Системс", opening: { sum: -135000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 18, name: "TEEDBOOM", opening: { sum: 75000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 19, name: "azamat1", opening: { sum: -6437200, usd: -3099.9, eur: 0 }, pendingRequest: { ...zero } },
  { id: 20, name: "PEPSI ХОЛДИНГ", opening: { sum: -2378000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 21, name: "Nestle Provider1", opening: { sum: 21645000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 22, name: "Ali olimov", opening: { sum: 10000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 23, name: "Доширак", opening: { sum: -480000, usd: 0, eur: 0 }, pendingRequest: { ...zero } },
  { id: 24, name: "Турецкий Айран", opening: { ...zero }, pendingRequest: { ...zero } },
  { id: 25, name: "Ali olimov", opening: { sum: -1773100000, usd: 2000, eur: 0 }, pendingRequest: { ...zero } },
]

const TOTAL_SUPPLIERS = 77
const FIXED_TOTALS = { opening: { eur: 0, sum: -114854713953.32, usd: -16425511.374 } }

const favoriteItemsInitial = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

const groups = ["Баланс на начало периода", "Поставки", "Возврат", "Оплачено", "Прочие приходы", "Прочие расходы", "Баланс на конец периода"] as const
const requestGroups = ["Баланс на конец периода", "Запас", "Остаток", "Запросы в ожидании"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

export function SupplierBalanceView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteItems, setFavoriteItems] = useState(favoriteItemsInitial)
  const [hoveredFavorite, setHoveredFavorite] = useState<number | null>(null)
  const [tab, setTab] = useState<"balance" | "requests">("balance")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organization, setOrganization] = useState("Все организации")
  const [paymentType, setPaymentType] = useState("Любой")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ type: "add" | "expense"; supplierId: number } | null>(null)
  const [requestModalId, setRequestModalId] = useState<number | null>(null)
  const [rows, setRows] = useState(suppliers)

  const today = useMemo(() => new Date(), [])
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])
  const monthEnd = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 0), [today])
  const toInputDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const [rangeFrom, setRangeFrom] = useState(() => toInputDate(monthStart))
  const [rangeTo, setRangeTo] = useState(() => toInputDate(monthEnd))

  const filtered = useMemo(
    () => rows.filter((supplier) => supplier.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const totalLabel = isDefaultView ? TOTAL_SUPPLIERS : filtered.length

  const applyTransaction = (supplierId: number, kind: "add" | "expense", currency: keyof Money, amount: number) => {
    setRows((current) =>
      current.map((supplier) => {
        if (supplier.id !== supplierId) return supplier
        const signedAmount = kind === "add" ? amount : -amount
        return { ...supplier, opening: { ...supplier.opening, [currency]: supplier.opening[currency] + signedAmount } }
      }),
    )
  }

  const applyFilter = () => {
    setFilterOpen(false)
  }

  const removeFavorite = (index: number) => {
    setFavoriteItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const downloadAll = () => {
    const activeGroups = tab === "balance" ? groups : requestGroups
    const header = ["Поставщик", ...activeGroups.flatMap((group) => [`${group} SUM`, `${group} USD`, `${group} Euro`])]
    const body = filtered.map((supplier) => {
      const cells = activeGroups.flatMap((group) => {
        if (group === "Баланс на начало периода" || group === "Баланс на конец периода" || group === "Остаток") {
          return [supplier.opening.sum, supplier.opening.usd, supplier.opening.eur]
        }
        if (group === "Запросы в ожидании") return [supplier.pendingRequest.sum, supplier.pendingRequest.usd, supplier.pendingRequest.eur]
        return [0, 0, 0]
      })
      return [supplier.name, ...cells]
    })
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "supplier-balance.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс поставщиков</span>
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> Фильтр
        </button>
        <span className="font-semibold text-[#4f70e7]">Во всей организации</span>
        <button onClick={downloadAll} className="ml-auto flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> Скачать
        </button>
      </section>

      <section className="grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div>
          <p className="text-[#586174]">Баланс на начало периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.eur} /></p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.sum} /></p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.usd} /></p>
        </div>
        <div>
          <p className="text-[#586174]">Возврат</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие приходы</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[#586174]">Баланс на конец периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.eur} /></p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.sum} /></p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.opening.usd} /></p>
        </div>
        <div className="sm:col-start-2 lg:col-start-2">
          <p className="text-[#586174]">Поставки</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
        </div>
        <div>
          <p className="text-[#586174]">Оплачено</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие расходы</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
          <p className="font-semibold">0</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-[#e1e5eb] px-6 py-4 md:px-9">
        <div className="flex overflow-hidden rounded-sm">
          <button
            onClick={() => setTab("balance")}
            className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${tab === "balance" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}
          >
            Баланс поставщиков
          </button>
          <button
            onClick={() => setTab("requests")}
            className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${tab === "requests" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}
          >
            Запрос средств
          </button>
        </div>

        <label className="relative mx-auto min-w-[220px] border-b border-[#dbe0e8] pb-1.5 text-center">
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1) }}
            placeholder="Поиск"
            className="w-full bg-transparent text-center text-[15px] font-medium outline-none placeholder:text-[#17233b]"
          />
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
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><ChevronsRight className="h-5 w-5 rotate-45" /></button>
      </section>

      <section className="overflow-x-auto pb-10">
        {tab === "balance" ? (
          <table className="min-w-[2300px] w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-[#edf2f7] text-[#253653]">
                <th className="border border-[#e1e5eb] px-4 py-2" colSpan={3} />
                {groups.map((group) => (
                  <th key={group} colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
                ))}
              </tr>
              <tr className="bg-white text-[#17233b]">
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold" colSpan={3}>Поставщик</th>
                {groups.map((group) =>
                  ["SUM", "USD", "Euro"].map((currency) => (
                    <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((supplier, index) => (
                <tr key={supplier.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5">{supplier.name}</td>
                  <td className="border-b border-[#e1e5eb] px-1 py-3.5">
                    <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", supplierId: supplier.id })} className="text-[#e5484d]"><MinusCircle className="h-6 w-6 fill-[#ff5d63] text-white" /></button>
                  </td>
                  <td className="border-b border-[#e1e5eb] px-1 py-3.5">
                    <button aria-label="Добавить" onClick={() => setModal({ type: "add", supplierId: supplier.id })} className="text-[#39ca79]"><PlusCircle className="h-6 w-6 fill-[#39ca79] text-white" /></button>
                  </td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.sum} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.usd} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.eur} /></td>
                  {Array.from({ length: 18 }).map((_, cellIndex) => (
                    <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                  ))}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={24} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="min-w-[1700px] w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-[#edf2f7] text-[#253653]">
                <th className="border border-[#e1e5eb] px-4 py-2" />
                {requestGroups.map((group) => (
                  <th key={group} colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
                ))}
              </tr>
              <tr className="bg-white text-[#17233b]">
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Поставщик</th>
                {requestGroups.map((group) =>
                  ["SUM", "USD", "Euro"].map((currency) => (
                    <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((supplier, index) => (
                <tr key={supplier.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5">
                    <button aria-label="Запросить средства" onClick={() => setRequestModalId(supplier.id)} className="flex items-center gap-2 text-left">
                      <DollarSign className="h-4 w-4 text-[#3aa76d]" /> {supplier.name}
                    </button>
                  </td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.sum} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.usd} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.eur} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.sum} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.usd} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.opening.eur} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.pendingRequest.sum} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.pendingRequest.usd} /></td>
                  <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={supplier.pendingRequest.eur} /></td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={13} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-24" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[900px] max-w-[94vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-semibold text-[#586174]">Фильтр</h2>
              <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </header>
            <div className="grid grid-cols-1 gap-8 px-8 py-7 sm:grid-cols-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-[13px] font-medium text-[#586174]">
                  <span>Диапазон дат</span>
                </div>
                <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-2 text-[15px]">
                  <input type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} className="w-full bg-transparent outline-none" />
                  <span className="text-[#9aa3b6]">—</span>
                  <input type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} className="w-full bg-transparent outline-none" />
                </div>
              </div>
              <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                Организация
                <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                  {["Все организации", "Linko"].map((option) => <option key={option}>{option}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
              </label>
              <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                Тип оплаты
                <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                  {["Любой", "Наличными", "Перечислением"].map((option) => <option key={option}>{option}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
              </label>
            </div>
            <div className="px-8 pb-8">
              <button onClick={applyFilter} className="block w-full rounded-md bg-[#6fcf97] py-3.5 text-center font-semibold text-white hover:bg-[#5fbf87]">Применить</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <TransactionModal
          supplier={rows.find((item) => item.id === modal.supplierId)!}
          type={modal.type}
          onClose={() => setModal(null)}
          onSave={(currency, amount) => {
            applyTransaction(modal.supplierId, modal.type, currency, amount)
            setModal(null)
          }}
        />
      )}

      {requestModalId !== null && (
        <RequestFundsModal supplier={rows.find((item) => item.id === requestModalId)!} onClose={() => setRequestModalId(null)} />
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

function BarChart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TransactionModal({
  supplier,
  type,
  onClose,
  onSave,
}: {
  supplier: Supplier
  type: "add" | "expense"
  onClose: () => void
  onSave: (currency: keyof Money, amount: number) => void
}) {
  const [currency, setCurrency] = useState<keyof Money>("sum")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[600px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">{type === "add" ? "Добавить" : "Добавить расход"}</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Поставщик
            <div className="mt-1 text-[16px] font-semibold text-[#17233b]">{supplier.name}</div>
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as keyof Money)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
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
          <button
            onClick={() => {
              const value = Number(amount)
              if (value > 0) onSave(currency, value)
            }}
            className="font-bold uppercase tracking-wide text-[#4f70e7]"
          >
            Сохранить
          </button>
        </footer>
      </div>
    </div>
  )
}

function RequestFundsModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [currency, setCurrency] = useState<keyof Money>("sum")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">Запрос средств</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Поставщик
            <div className="mt-1 text-[16px] font-semibold text-[#17233b]">{supplier.name}</div>
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as keyof Money)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
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
            <input placeholder="Оставить комментарий..." value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] outline-none placeholder:text-[#586174]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button onClick={onClose} className="font-bold uppercase tracking-wide text-[#4f70e7]">Отправить</button>
        </footer>
      </div>
    </div>
  )
}
