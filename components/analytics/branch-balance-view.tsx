"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Expand, MinusCircle, PlusCircle, Search, Star, Trash2, X } from "lucide-react"

type Money = { sum: number; usd: number }
type Branch = { id: number; name: string; opening: Money }

const zero: Money = { sum: 0, usd: 0 }

const branches: Branch[] = [
  { id: 1, name: "Samarqand", opening: { sum: 515572, usd: 0 } },
  { id: 2, name: "Buxoro", opening: { sum: -1282800, usd: 9231 } },
  { id: 3, name: "Mirzo Ulugbek1", opening: { sum: -1200, usd: 0 } },
  { id: 4, name: "Samarqand filial", opening: { ...zero } },
  { id: 5, name: "Namangan", opening: { sum: 12000, usd: 0 } },
  { id: 6, name: "Farg'ona", opening: { ...zero } },
  { id: 7, name: "Xorazm", opening: { sum: 902000, usd: -62992 } },
  { id: 8, name: "Andijon", opening: { sum: 202230800, usd: 0 } },
  { id: 9, name: "Jizzax shahri", opening: { sum: -300120000, usd: 0 } },
  { id: 10, name: "Geoinnovatsiya markazi", opening: { ...zero } },
  { id: 11, name: "candycold", opening: { ...zero } },
  { id: 12, name: "tosh98", opening: { ...zero } },
  { id: 13, name: "Salohiddin Farg'ona Filial", opening: { sum: -5000, usd: 0 } },
  { id: 14, name: "Shakhrisabz", opening: { ...zero } },
  { id: 15, name: "Shayxontoxur", opening: { sum: -1300000, usd: 0 } },
  { id: 16, name: "Chinobod", opening: { sum: 260000, usd: 0 } },
  { id: 17, name: "Shayxontoxur 2", opening: { ...zero } },
  { id: 18, name: "Shayxontoxur 1", opening: { ...zero } },
  { id: 19, name: "novza", opening: { sum: -916370, usd: 0 } },
  { id: 20, name: "choshtepa", opening: { sum: -421630, usd: 0 } },
  { id: 21, name: "Филиал Чиланзар", opening: { sum: -45000, usd: 0 } },
  { id: 22, name: "Филиал Юнусабад", opening: { ...zero } },
  { id: 23, name: "toshkent filial", opening: { ...zero } },
  { id: 24, name: "samarqand filial", opening: { ...zero } },
  { id: 25, name: "Maftuna MCHJ", opening: { ...zero } },
]

const TOTAL_BRANCHES = 28
const FIXED_TOTALS = { sum: -100636628, usd: -53761 }
const favoriteItemsInitial = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

const groups = ["Баланс на начало периода", "Передача на склад", "Возврат передачи", "Оплата", "Прочие приходы", "Прочие расходы", "Баланс на конец"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

export function BranchBalanceView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteItems, setFavoriteItems] = useState(favoriteItemsInitial)
  const [hoveredFavorite, setHoveredFavorite] = useState<number | null>(null)
  const [rows, setRows] = useState(branches)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ type: "add" | "expense"; branchId: number } | null>(null)

  const filtered = useMemo(
    () => rows.filter((branch) => branch.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const totalLabel = isDefaultView ? TOTAL_BRANCHES : filtered.length

  const applyTransaction = (branchId: number, kind: "add" | "expense", currency: keyof Money, amount: number) => {
    setRows((current) =>
      current.map((branch) => {
        if (branch.id !== branchId) return branch
        const signedAmount = kind === "add" ? amount : -amount
        return { ...branch, opening: { ...branch.opening, [currency]: branch.opening[currency] + signedAmount } }
      }),
    )
  }

  const removeFavorite = (index: number) => {
    setFavoriteItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс филиалов</span>
        </button>
      </header>

      <section className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div>
          <p className="text-[#586174]">Баланс на начало периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Передача на склад</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие приходы</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[#586174]">Баланс на конец периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Принятие оплаты</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Возврат передачи</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие расходы</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-5 border-t border-[#e1e5eb] bg-white px-6 py-3 md:px-9">
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
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-3 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Филиал
            <input placeholder="Введите название..." className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" onChange={(event) => setSearch(event.target.value)} value={search} />
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1750px] w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-white text-[#253653]">
              <th className="border border-[#e1e5eb] px-4 py-2" colSpan={3} />
              {groups.map((group) => (
                <th key={group} colSpan={2} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
              ))}
            </tr>
            <tr className="bg-white text-[#17233b]">
              <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold" colSpan={3}>Филиал</th>
              {groups.map((group) =>
                ["SUM", "USD"].map((currency) => (
                  <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((branch, index) => (
              <tr key={branch.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5">{branch.name}</td>
                <td className="border-b border-[#e1e5eb] px-1 py-3.5">
                  <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", branchId: branch.id })} className="text-[#e5484d]"><MinusCircle className="h-6 w-6 fill-[#ff5d63] text-white" /></button>
                </td>
                <td className="border-b border-[#e1e5eb] px-1 py-3.5">
                  <button aria-label="Добавить" onClick={() => setModal({ type: "add", branchId: branch.id })} className="text-[#39ca79]"><PlusCircle className="h-6 w-6 fill-[#39ca79] text-white" /></button>
                </td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.usd} /></td>
                {Array.from({ length: 10 }).map((_, cellIndex) => (
                  <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                ))}
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.usd} /></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={17} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {modal && (
        <TransactionModal
          branch={rows.find((item) => item.id === modal.branchId)!}
          type={modal.type}
          onClose={() => setModal(null)}
          onSave={(currency, amount) => {
            applyTransaction(modal.branchId, modal.type, currency, amount)
            setModal(null)
          }}
        />
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

function TransactionModal({
  branch,
  type,
  onClose,
  onSave,
}: {
  branch: Branch
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
            Филиал
            <div className="mt-1 text-[16px] font-semibold text-[#17233b]">{branch.name}</div>
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as keyof Money)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              <option value="sum">SUM</option>
              <option value="usd">USD</option>
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
