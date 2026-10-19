"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MinusCircle, Pencil, PlusCircle, Send } from "lucide-react"
import { RI, RefHeader } from "@/components/ref/list-kit"
import { ReportGridTable, ReportMoneyBox, ReportPage, ReportPager, ReportSearchField } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"

type Money = { euro: number; sum: number; usd: number }
type ClientRow = {
  id: number
  client: string
  connected: boolean
  debtTerm?: string
  daysAfterPayment: number
  daysAfterOrder: number
  amount: Money
  sumCash: number
  sumTransfer: number
  usdCash: number
  usdTransfer: number
  euroCash: number
  euroTransfer: number
  orders: number
  altSumTransfer?: number
  altAmountSum?: number
}

type ApiRow = {
  id: number
  client: string
  connected: boolean
  debtTerm: string
  daysAfterPayment: number
  daysAfterOrder: number
  amountSum: number
  amountEuro: number
  sumCash: number
  sumTransfer: number
  usdCash: number
  usdTransfer: number
  euroCash: number
  euroTransfer: number
  orders: number
  altSumTransfer: number
  altAmountSum: number
}

function apiRowToClientRow(row: ApiRow): ClientRow {
  return {
    id: row.id,
    client: row.client,
    connected: row.connected,
    debtTerm: row.debtTerm || undefined,
    daysAfterPayment: row.daysAfterPayment,
    daysAfterOrder: row.daysAfterOrder,
    amount: { sum: row.amountSum, euro: row.amountEuro, usd: 0 },
    sumCash: row.sumCash,
    sumTransfer: row.sumTransfer,
    usdCash: row.usdCash,
    usdTransfer: row.usdTransfer,
    euroCash: row.euroCash,
    euroTransfer: row.euroTransfer,
    orders: row.orders,
    altSumTransfer: row.altSumTransfer,
    altAmountSum: row.altAmountSum,
  }
}

function clientRowToApiInput(row: ClientRow) {
  return {
    client: row.client,
    connected: row.connected,
    debtTerm: row.debtTerm ?? "",
    daysAfterPayment: row.daysAfterPayment,
    daysAfterOrder: row.daysAfterOrder,
    amountSum: row.amount.sum,
    amountEuro: row.amount.euro,
    sumCash: row.sumCash,
    sumTransfer: row.sumTransfer,
    usdCash: row.usdCash,
    usdTransfer: row.usdTransfer,
    euroCash: row.euroCash,
    euroTransfer: row.euroTransfer,
    orders: row.orders,
    altSumTransfer: row.altSumTransfer ?? 0,
    altAmountSum: row.altAmountSum ?? 0,
  }
}

const TOTAL_CLIENTS = 0

const TOTALS_BY_MODE = {
  created: {
    cash: { euro: 0, sum: 0, usd: 0 },
    transfer: { euro: 0, sum: 0, usd: 0 },
    total: { euro: 0, sum: 0, usd: 0 },
  },
  realized: {
    cash: { euro: 0, sum: 0, usd: 0 },
    transfer: { euro: 0, sum: 0, usd: 0 },
    total: { euro: 0, sum: 0, usd: 0 },
  },
} as const

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountText({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  return <span className={value > 0 ? "text-[#71ce87]" : "text-[#e57373]"}>{number(value)}</span>
}

export function StoreReconciliationBotView() {
  const importRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ClientRow[]>([])
  const [mode, setMode] = useState<"created" | "realized">("created")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [connectTarget, setConnectTarget] = useState<ClientRow | null>(null)
  const [editTarget, setEditTarget] = useState<ClientRow | null>(null)
  const [editName, setEditName] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/store-reconciliation-rows")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: ApiRow[]) => {
        if (cancelled) return
        setRows(Array.isArray(data) ? data.map(apiRowToClientRow) : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () => rows.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const totalLabel = isDefaultView ? TOTAL_CLIENTS : filtered.length
  const totals = TOTALS_BY_MODE[mode]

  const toggleConnection = async (id: number) => {
    const target = rows.find((row) => row.id === id)
    if (!target) return
    try {
      const response = await fetch(`/api/store-reconciliation-rows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connected: !target.connected }),
      })
      if (!response.ok) {
        window.alert("Не удалось изменить подключение")
        return
      }
      const saved = (await response.json()) as ApiRow
      setRows((current) => current.map((row) => (row.id === id ? apiRowToClientRow(saved) : row)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setConnectTarget(null)
    }
  }

  const removeRow = async (id: number) => {
    try {
      const response = await fetch(`/api/store-reconciliation-rows/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert("Не удалось удалить строку")
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  const duplicateRow = async (row: ClientRow) => {
    const copy: ClientRow = { ...row, client: `${row.client} (копия)`, connected: false }
    try {
      const response = await fetch("/api/store-reconciliation-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientRowToApiInput(copy)),
      })
      if (!response.ok) {
        window.alert("Не удалось дублировать строку")
        return
      }
      const saved = (await response.json()) as ApiRow
      setRows((current) => {
        const index = current.findIndex((item) => item.id === row.id)
        const inserted = apiRowToClientRow(saved)
        return [...current.slice(0, index + 1), inserted, ...current.slice(index + 1)]
      })
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  const startEdit = (row: ClientRow) => {
    setEditTarget(row)
    setEditName(row.client)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    try {
      const response = await fetch(`/api/store-reconciliation-rows/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: editName || editTarget.client }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить клиента")
        return
      }
      const saved = (await response.json()) as ApiRow
      setRows((current) => current.map((row) => (row.id === editTarget.id ? apiRowToClientRow(saved) : row)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setEditTarget(null)
    }
  }

  const downloadAll = () => {
    const header = ["Клиент", "Статус сверки", "Срок долга", "Прошло дней после оплаты", "Прошло дней после заказа", "Сумма", "Euro нал.", "Euro переч.", "SUM нал.", "SUM переч.", "USD нал.", "USD переч.", "Кол-во заказов"]
    const body = filtered.map((row) => {
      const sumTransfer = mode === "realized" && row.altSumTransfer !== undefined ? row.altSumTransfer : row.sumTransfer
      const amountSum = mode === "realized" && row.altAmountSum !== undefined ? row.altAmountSum : row.amount.sum
      return [
        row.client,
        row.connected ? "Подключен" : "Не подключен",
        row.debtTerm ?? "Не указано",
        row.daysAfterPayment,
        row.daysAfterOrder,
        amountSum,
        row.amount.euro,
        row.euroTransfer,
        row.sumCash,
        sumTransfer,
        row.usdCash,
        row.usdTransfer,
        row.orders,
      ]
    })
    downloadExcelTable("store-reconciliation.xls", [header, ...body])
  }

  const tone = (value: number): "plus" | "minus" | "default" => (value > 0 ? "plus" : value < 0 ? "minus" : "default")
  const lines = (group: { euro: number; sum: number; usd: number }) => [
    { text: `${number(group.euro)} Euro`, tone: tone(group.euro) },
    { text: `${number(group.sum)} SUM`, tone: tone(group.sum) },
    { text: `${number(group.usd)} USD`, tone: tone(group.usd) },
  ]

  return (
    <ReportPage>
      <input ref={importRef} type="file" accept=".xls,.xlsx,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) window.alert(file.name); event.target.value = "" }} />
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title="Сверка счетов">
          <div className="flex overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {([["created", "По дате создания"], ["realized", "По дате реализации"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setMode(key)} className={`h-[30px] w-[173px] text-[13px] font-medium transition-colors ${mode === key ? "bg-[#71ce87] text-white" : "bg-white text-black"}`}>{label}</button>
            ))}
          </div>
        </RefHeader>
      </div>

      <div className="mx-[30px] mt-[14px] grid grid-cols-1 gap-[2px] sm:grid-cols-3">
        <ReportMoneyBox title="Наличными" lines={lines(totals.cash)} className="pb-[14px]" />
        <ReportMoneyBox title="Перечисления" lines={lines(totals.transfer)} className="pb-[14px]" />
        <ReportMoneyBox title="Общий" right lines={lines(totals.total)} className="pb-[14px]" />
      </div>

      <section className="mx-[28px] mt-[16px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative flex h-[55px] items-center px-[5px]">
          <button onClick={() => setFilterOpen((value) => !value)} className="ml-[25px] text-[13px] text-[#4f71dc]">Показать фильтр ⌄</button>
          <div className="absolute left-[440px]"><ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={255} /></div>
          <div className="ml-auto flex items-center gap-[20px] pr-[20px]">
            <button onClick={() => importRef.current?.click()} className="flex h-[34px] items-center rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden><path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z" /></svg>Установить долг с Excel</button>
            <button onClick={downloadAll} className="flex h-[34px] items-center rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95"><svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.chart} /></svg>Скачать</button>
            <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${totalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
            <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
          </div>
        </div>
        {filterOpen && (
          <div className="mx-[25px] mb-3 w-[300px] bg-white p-5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={260} label="Клиент" />
          </div>
        )}

        <ReportGridTable
          minWidth={1750}
          align="left"
          colWidths={["300px", "100px", "100px", "100px", "100px", "", "", "", "", "", "", "", ""]}
          emptyText="Нет данных"
          heads={["Клиент", "Статус сверки", "Срок долга", "Прошло дней после оплаты", "Прошло дней после заказа", "Сумма", "Euro нал.", "Euro переч.", "SUM нал.", "SUM переч.", "USD нал.", "USD переч.", "Кол-во заказов"]}
          rows={visible.map((row) => {
            const sumTransfer = mode === "realized" && row.altSumTransfer !== undefined ? row.altSumTransfer : row.sumTransfer
            const amountSum = mode === "realized" && row.altAmountSum !== undefined ? row.altAmountSum : row.amount.sum
            return [
              <div key="c" className="group relative">
                <div className="group-hover:invisible">{row.client}</div>
                <div className="invisible absolute inset-0 flex items-center gap-3 group-hover:visible">
                  <button aria-label="Редактировать" onClick={() => startEdit(row)} className="text-[#555]"><Pencil className="h-4 w-4" /></button>
                  <button aria-label="Телеграм" title="Телеграм" onClick={() => setConnectTarget(row)} className="text-[#4f71dc]"><Send className="h-4 w-4" /></button>
                  <button aria-label="Удалить" onClick={() => removeRow(row.id)} className="text-[#e5484d]"><MinusCircle className="h-4 w-4" /></button>
                  <button aria-label="Добавить" title="Дублировать" onClick={() => duplicateRow(row)} className="text-[#3aa76d]"><PlusCircle className="h-4 w-4" /></button>
                </div>
              </div>,
              <button key="s" onClick={() => setConnectTarget(row)} className={`text-left font-bold ${row.connected ? "text-[#3aa76d]" : "text-[#4f71dc]"}`}>{row.connected ? "Подключен" : "Не подключен"}</button>,
              <span key="t" className={row.debtTerm ? "font-bold text-[#f06c6c]" : ""}>{row.debtTerm ?? "Не указано"}</span>,
              <span key="p" className={row.daysAfterPayment > 0 ? "font-bold text-[#f06c6c]" : ""}>{row.daysAfterPayment} дня</span>,
              `${row.daysAfterOrder} дня`,
              <AmountText key="a" value={amountSum} />,
              <AmountText key="e" value={row.amount.euro} />,
              <AmountText key="et" value={row.euroTransfer} />,
              <AmountText key="sc" value={row.sumCash} />,
              <AmountText key="st" value={sumTransfer} />,
              <AmountText key="uc" value={row.usdCash} />,
              <AmountText key="ut" value={row.usdTransfer} />,
              row.orders,
            ]
          })}
        />
      </section>

      {connectTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setConnectTarget(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Send className="h-5 w-5 text-[#4f71dc]" /> Подключение через Telegram-бот</h2>
            <p className="mb-6 text-[#586174]">
              {connectTarget.connected
                ? <>Клиент <b>{connectTarget.client}</b> подключен к боту сверки. Отключить?</>
                : <>Отправить клиенту <b>{connectTarget.client}</b> приглашение подключиться к боту сверки в Telegram?</>}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConnectTarget(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">Отмена</button>
              <button onClick={() => toggleConnection(connectTarget.id)} className="rounded-md bg-[#4f71dc] px-5 py-2.5 font-semibold text-white">
                {connectTarget.connected ? "Отключить" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setEditTarget(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold">Редактировать клиента</h2>
            <label className="mb-6 block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
              Название
              <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
            </label>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditTarget(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">Отмена</button>
              <button onClick={saveEdit} className="rounded-md bg-[#4f71dc] px-5 py-2.5 font-semibold text-white">Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </ReportPage>
  )
}
