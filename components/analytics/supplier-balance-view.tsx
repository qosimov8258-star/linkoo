"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, DollarSign, MinusCircle, PlusCircle, X } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportAmount, ReportBalanceBoxes, ReportBalanceToolbar, ReportFilterPanel, ReportGridTable, ReportModeButtons, ReportPage, ReportPager, ReportRangeField, ReportSelectField, ReportTopRow, type BalanceTone } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"

type Money = { sum: number; usd: number; eur: number }
type Supplier = {
  id: number
  name: string
  opening: Money
  pendingRequest: Money
}
type ApiSupplier = { id: number; name: string }
type BalanceTransaction = {
  id: number
  supplierId: number
  kind: "add" | "expense" | "fund_request"
  currency: keyof Money
  amount: number
  date: string
  comment: string
}

const zero: Money = { sum: 0, usd: 0, eur: 0 }

const groups = ["Баланс на начало периода", "Поставки", "Возврат", "Оплачено", "Прочие приходы", "Прочие расходы", "Баланс на конец периода"] as const
const requestGroups = ["Баланс на конец периода", "Запас", "Остаток", "Запросы в ожидании"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}

export function SupplierBalanceView() {
  const [tab, setTab] = useState<"balance" | "requests">("balance")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organization, setOrganization] = useState("")
  const [paymentType, setPaymentType] = useState("")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ type: "add" | "expense"; supplierId: number } | null>(null)
  const [requestModalId, setRequestModalId] = useState<number | null>(null)
  const [suppliersList, setSuppliersList] = useState<ApiSupplier[]>([])
  const [transactions, setTransactions] = useState<BalanceTransaction[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/suppliers").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/supplier-balance-transactions").then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([suppliersData, transactionsData]) => {
        if (cancelled) return
        setSuppliersList(Array.isArray(suppliersData) ? suppliersData : [])
        setTransactions(Array.isArray(transactionsData) ? transactionsData : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<Supplier[]>(
    () =>
      suppliersList.map((supplier) => {
        const opening = { ...zero }
        const pendingRequest = { ...zero }
        transactions
          .filter((transaction) => transaction.supplierId === supplier.id)
          .forEach((transaction) => {
            if (transaction.kind === "fund_request") {
              pendingRequest[transaction.currency] += transaction.amount
            } else {
              const signed = transaction.kind === "add" ? transaction.amount : -transaction.amount
              opening[transaction.currency] += signed
            }
          })
        return { id: supplier.id, name: supplier.name, opening, pendingRequest }
      }),
    [suppliersList, transactions],
  )

  const TOTAL_SUPPLIERS = rows.length
  const FIXED_TOTALS = useMemo(
    () => ({
      opening: rows.reduce(
        (totals, supplier) => ({
          sum: totals.sum + supplier.opening.sum,
          usd: totals.usd + supplier.opening.usd,
          eur: totals.eur + supplier.opening.eur,
        }),
        { sum: 0, usd: 0, eur: 0 },
      ),
    }),
    [rows],
  )

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

  const saveTransaction = async (
    supplierId: number,
    kind: "add" | "expense" | "fund_request",
    currency: keyof Money,
    amount: number,
    date: string,
    comment: string,
  ) => {
    setSaving(true)
    try {
      const response = await fetch("/api/supplier-balance-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, kind, currency, amount, date, comment }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить транзакцию")
        return false
      }
      const saved = (await response.json()) as BalanceTransaction
      setTransactions((current) => [saved, ...current])
      return true
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
      return false
    } finally {
      setSaving(false)
    }
  }

  const applyFilter = () => {
    setFilterOpen(false)
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
    downloadExcelTable("supplier-balance.xls", [header, ...body])
  }

  const eur = (value: number): { text: string; tone: BalanceTone } => ({ text: new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value), tone: value > 0 ? "plus" : value < 0 ? "minus" : "default" })
  const zeros = [{ text: "0" }, { text: "0" }, { text: "0" }]
  const openingLines = [eur(FIXED_TOTALS.opening.eur), eur(FIXED_TOTALS.opening.sum), eur(FIXED_TOTALS.opening.usd)]
  const activeGroups = tab === "balance" ? groups : requestGroups
  const cur = ["SUM", "USD", "Euro"]
  const triple = (m: Money) => [m.sum, m.usd, m.eur].map((value, index) => <ReportAmount key={index} value={value} />)

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Баланс поставщиков" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]">
        <div className="px-[30px]"><ReportTopRow filterLabel="Фильтр" scope="Во всей организации" onFilter={() => setFilterOpen(true)} onDownload={downloadAll} /></div>
        <div className="mt-[15px]">
          <ReportBalanceBoxes
            className="mx-[30px]"
            columns={[
              { blocks: [{ title: "Баланс на начало периода", lines: openingLines }, { title: "Поставки", lines: zeros }] },
              { blocks: [{ title: "Возврат", lines: zeros }, { title: "Оплачено", lines: zeros }] },
              { blocks: [{ title: "Прочие приходы", lines: zeros }, { title: "Прочие расходы", lines: zeros }] },
              { right: true, blocks: [{ title: "Баланс на конец периода", lines: openingLines }] },
            ]}
          />
        </div>

        <ReportBalanceToolbar
          search={search}
          onSearch={(value) => { setSearch(value); setPage(1) }}
          searchLeft={560}
          left={<ReportModeButtons labels={["БАЛАНС ПОСТАВЩИКОВ", "ЗАПРОС СРЕДСТВ"]} value={tab === "balance" ? "БАЛАНС ПОСТАВЩИКОВ" : "ЗАПРОС СРЕДСТВ"} onChange={(label) => setTab(label === "БАЛАНС ПОСТАВЩИКОВ" ? "balance" : "requests")} />}
          pager={
            <div className="flex items-center gap-[20px]">
              <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${totalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
              <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
            </div>
          }
        >
        </ReportBalanceToolbar>
        <ReportGridTable
          minWidth={tab === "balance" ? 2300 : 1700}
          colWidths={["220px", ...Array.from({ length: activeGroups.length * 3 }, () => "")]}
          groups={[{ title: "", span: 1 }, ...activeGroups.map((group) => ({ title: group, span: 3 }))]}
          heads={["Поставщик", ...activeGroups.flatMap(() => cur)]}
          rows={visible.map((supplier) => {
            const first = tab === "balance" ? (
              <div key="n" className="flex items-center gap-[10px]">
                <span className="w-[130px] truncate">{supplier.name}</span>
                <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", supplierId: supplier.id })}><MinusCircle className="h-[22px] w-[22px] fill-[#ff5d63] text-white" /></button>
                <button aria-label="Добавить" onClick={() => setModal({ type: "add", supplierId: supplier.id })}><PlusCircle className="h-[22px] w-[22px] fill-[#71ce87] text-white" /></button>
              </div>
            ) : (
              <button key="n" aria-label="Запросить средства" onClick={() => setRequestModalId(supplier.id)} className="flex items-center gap-2 text-left"><DollarSign className="h-4 w-4 text-[#71ce87]" /> {supplier.name}</button>
            )
            const cells =
              tab === "balance"
                ? [...triple(supplier.opening), ...Array.from({ length: 18 }, () => 0)]
                : [...triple(supplier.opening), 0, 0, 0, ...triple(supplier.opening), ...triple(supplier.pendingRequest)]
            return [first, ...cells]
          })}
        />
      </section>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={applyFilter}>
          <ReportRangeField label="Диапазон дат" from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />
          <ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={["Linko"]} />
          <ReportSelectField label="Тип оплаты" value={paymentType} onChange={setPaymentType} options={["Наличными", "Перечислением"]} />
        </ReportFilterPanel>
      )}

      {modal && (
        <TransactionModal
          supplier={rows.find((item) => item.id === modal.supplierId)!}
          type={modal.type}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={async (currency, amount, date, comment) => {
            const ok = await saveTransaction(modal.supplierId, modal.type, currency, amount, date, comment)
            if (ok) setModal(null)
          }}
        />
      )}

      {requestModalId !== null && (
        <RequestFundsModal
          supplier={rows.find((item) => item.id === requestModalId)!}
          saving={saving}
          onClose={() => setRequestModalId(null)}
          onSend={async (currency, amount, comment) => {
            const ok = await saveTransaction(requestModalId, "fund_request", currency, amount, new Date().toISOString().slice(0, 10), comment)
            if (ok) setRequestModalId(null)
          }}
        />
      )}
    </ReportPage>
  )
}


function TransactionModal({
  supplier,
  type,
  saving,
  onClose,
  onSave,
}: {
  supplier: Supplier
  type: "add" | "expense"
  saving: boolean
  onClose: () => void
  onSave: (currency: keyof Money, amount: number, date: string, comment: string) => void
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
            disabled={saving}
            onClick={() => {
              const value = Number(amount)
              if (value > 0) onSave(currency, value, date, comment)
            }}
            className="font-bold uppercase tracking-wide text-[#4f71dc] disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  )
}

function RequestFundsModal({
  supplier,
  saving,
  onClose,
  onSend,
}: {
  supplier: Supplier
  saving: boolean
  onClose: () => void
  onSend: (currency: keyof Money, amount: number, comment: string) => void
}) {
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
          <button
            disabled={saving}
            onClick={() => {
              const value = Number(amount)
              if (value > 0) onSend(currency, value, comment)
            }}
            className="font-bold uppercase tracking-wide text-[#4f71dc] disabled:opacity-50"
          >
            {saving ? "Отправка..." : "Отправить"}
          </button>
        </footer>
      </div>
    </div>
  )
}
