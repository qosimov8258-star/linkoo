"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Check, ListChecks, MoreVertical, Printer, X } from "lucide-react"
import { RI, RefCard, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { ReportSelectField } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"

type Tab = "receipt" | "transfer" | "movement" | "receiptHistory" | "transferHistory"

type ReceiptItem = { product: string; type: string; qty: string }
type ReceiptRow = { no: number; person: string; type: string; date: string; warehouse: string; items: ReceiptItem[]; creator: string; comment: string }
type ReceiptHistoryRow = { no: number; person: string; type: string; date: string; accepted: string; warehouse: string }
type TransferRow = { no: number; requestDate: string; warehouse: string; type: string; to: string; sender: string; transferDate: string }
type MovementRow = { dir: "up" | "down"; product: string; quantity: string; series: string; date: string; warehouse: string; type: string }

const tabs: { id: Tab; label: string }[] = [
  { id: "receipt", label: "Приемка" },
  { id: "transfer", label: "Передача" },
  { id: "movement", label: "Движение товаров" },
  { id: "receiptHistory", label: "История Приемки" },
  { id: "transferHistory", label: "История Передачи" },
]

function buildReceipts(): ReceiptRow[] {
  return []
}

function buildReceiptHistory(): ReceiptHistoryRow[] {
  return []
}

function buildTransfers(): TransferRow[] {
  return []
}

function buildTransferHistory(): TransferRow[] {
  return []
}

function buildMovements(): MovementRow[] {
  return []
}

type Row = ReceiptRow | ReceiptHistoryRow | TransferRow | MovementRow

export function GoodsMovementView({ initialTab = "receipt" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [expandedReceipt, setExpandedReceipt] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const [receipts, setReceipts] = useState<ReceiptRow[]>(buildReceipts)
  const [receiptHistory, setReceiptHistory] = useState<ReceiptHistoryRow[]>(buildReceiptHistory)
  const [transfers] = useState<TransferRow[]>(buildTransfers)
  const [transferHistory] = useState<TransferRow[]>(buildTransferHistory)
  const [movements] = useState<MovementRow[]>(buildMovements)

  const pageSize = 25

  const sourceRows: Row[] =
    tab === "receipt" ? receipts :
    tab === "receiptHistory" ? receiptHistory :
    tab === "transfer" ? transfers :
    tab === "transferHistory" ? transferHistory :
    movements

  const availableWarehouses = useMemo(() => Array.from(new Set(sourceRows.map((row) => row.warehouse))), [sourceRows])
  const availableTypes = useMemo(() => Array.from(new Set(sourceRows.map((row) => row.type))), [sourceRows])

  const filteredRows = useMemo(() => {
    return sourceRows.filter((row) => {
      if (query && !Object.values(row).join(" ").toLowerCase().includes(query.toLowerCase())) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      if (typeFilter !== "all" && row.type !== typeFilter) return false
      return true
    })
  }, [sourceRows, query, warehouseFilter, typeFilter])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changeTab(next: Tab) {
    setTab(next)
    setQuery("")
    setPage(1)
    setWarehouseFilter("all")
    setTypeFilter("all")
    setExpandedReceipt(null)
    setFilterOpen(false)
  }

  function acceptReceipt(row: ReceiptRow) {
    setReceipts((current) => current.filter((item) => item.no !== row.no))
    setReceiptHistory((current) => [
      { no: row.no, person: row.person, type: row.type, date: row.date, accepted: "Admin Ritm", warehouse: row.warehouse },
      ...current,
    ])
    setExpandedReceipt(null)
  }

  function downloadExcel() {
    const headers: Record<Tab, [string, string][]> = {
      receipt: [["no", "№"], ["person", "От кого"], ["type", "Тип"], ["date", "Дата приемки"], ["warehouse", "Склад"]],
      transfer: [["no", "№"], ["requestDate", "Дата запроса"], ["warehouse", "Склад"], ["type", "Тип"], ["to", "Кому"], ["sender", "Передал"], ["transferDate", "Дата передачи"]],
      movement: [["product", "Товар"], ["quantity", "Кол-во"], ["series", "Серия"], ["date", "Дата"], ["warehouse", "Склад"], ["type", "Тип"]],
      receiptHistory: [["no", "№ заказа"], ["person", "От кого"], ["type", "Тип"], ["date", "Дата приемки"], ["accepted", "Принял"], ["warehouse", "Склад"]],
      transferHistory: [["no", "№"], ["requestDate", "Дата запроса"], ["warehouse", "Склад"], ["type", "Тип"], ["to", "Кому"], ["sender", "Передал"], ["transferDate", "Дата передачи"]],
    }
    const config = headers[tab]
    const header = config.map(([, title]) => title)
    const body = filteredRows.map((row) => config.map(([key]) => String((row as Record<string, unknown>)[key] ?? "")))
    downloadExcelTable(`plan-priemok-peredach-${tab}`, [header, ...body])
  }

  const tabLabel = tabs.find((item) => item.id === tab)?.label ?? ""
  const filterPanel = (
    <div className="w-[390px] bg-white p-6 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="mb-6 flex items-center justify-between text-[14px] font-semibold">
        <span>Фильтр</span>
        <button type="button" onClick={() => setFilterOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-5">
        <ReportSelectField label="Склад" value={warehouseFilter === "all" ? "" : warehouseFilter} onChange={(value) => { setWarehouseFilter(value || "all"); setPage(1) }} options={availableWarehouses} />
        <ReportSelectField label="Тип" value={typeFilter === "all" ? "" : typeFilter} onChange={(value) => { setTypeFilter(value || "all"); setPage(1) }} options={availableTypes} />
        <button type="button" onClick={() => setFilterOpen(false)} className="h-9 rounded-[3px] bg-[#5d6474] px-5 text-[13px] font-semibold uppercase text-white shadow">Применить</button>
      </div>
    </div>
  )
  const actions = tab === "movement" ? (
    <div className="relative">
      <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Ещё" className="flex h-8 w-8 items-center justify-center text-[#555]">
        <MoreVertical className="h-5 w-5" />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-8 z-30 w-52 border border-[#e8e8e8] bg-white py-1 shadow-xl">
          <button type="button" onClick={() => { downloadExcel(); setMenuOpen(false) }} className="block w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8]">Скачать список</button>
          <button type="button" onClick={() => setMenuOpen(false)} className="block w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8]">Настройка колонок</button>
        </div>
      )}
    </div>
  ) : null
  const icons = (
    <>
      {tab === "movement" && <ListChecks className="mr-5 h-6 w-6 text-[#555]" />}
      <button type="button" onClick={downloadExcel} aria-label="Скачать Excel"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={RI.download} /></svg></button>
    </>
  )
  const link = (value: ReactNode) => <b className="font-semibold text-[#1ea1f2]">{value}</b>
  const emptyText = "По вашему запросу ничего не найдено"
  const transferCols = "minmax(0,0.6fr) repeat(6,minmax(0,1fr))"
  const transferHeads = ["№", "Дата запроса", "Склад", "Тип", "Кому", "Передал", "Дата передачи"]
  const transferRender = (row: TransferRow) => [<span key="n" className="text-[#4f71dc]">{row.no}</span>, row.requestDate, row.warehouse, row.type, row.to, row.sender, row.transferDate]

  return (
    <RefPage>
      <RefHeader title="План приемок и передач">{actions}</RefHeader>
      <div className="mb-[19px]">
        <RefTabs labels={tabs.map((item) => item.label)} value={tabLabel} onChange={(label) => { const next = tabs.find((item) => item.label === label); if (next) changeTab(next.id) }} />
      </div>
      <RefCard>
        <RefToolbar
          linkFilter
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          query={query}
          onQuery={(value) => { setQuery(value); setPage(1) }}
          pageSize={pageSize}
          onPageSize={() => undefined}
          from={filteredRows.length ? (safePage - 1) * pageSize + 1 : 0}
          to={Math.min(safePage * pageSize, filteredRows.length)}
          total={filteredRows.length}
          page={safePage}
          pageCount={pageCount}
          onPage={setPage}
          icons={icons}
        />

        {tab === "receipt" && (
          <div className="overflow-x-auto bg-white">
            <div style={{ minWidth: 900 }}>
              <div className="grid h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white" style={{ gridTemplateColumns: "minmax(0,0.6fr) repeat(4,minmax(0,1fr))" }}>
                {["№", "От кого", "Тип", "Дата приемки", "Склад"].map((head) => <div key={head} className="px-2">{head}</div>)}
              </div>
              {(visible as ReceiptRow[]).map((row) => (
                <Fragment key={row.no}>
                  <div onClick={() => setExpandedReceipt((current) => (current === row.no ? null : row.no))} className="grid min-h-[50px] cursor-pointer items-center border-b border-dotted border-[#d6d6d6] px-[30px] py-[7px] hover:bg-[#f2f5f8]" style={{ gridTemplateColumns: "minmax(0,0.6fr) repeat(4,minmax(0,1fr))" }}>
                    <div className="px-2 text-[#4f71dc]">{row.no}</div><div className="px-2">{row.person}</div><div className="px-2">{row.type}</div><div className="px-2">{row.date}</div><div className="px-2">{row.warehouse}</div>
                  </div>
                  {expandedReceipt === row.no && (
                    <div className="m-4 border border-[#e8e8e8] bg-white p-6 shadow-sm">
                      <div className="mb-5 flex items-center justify-end gap-4 text-[#555]">
                        <button type="button" onClick={() => window.print()} aria-label="Печать"><Printer className="h-5 w-5" /></button>
                        <button type="button" onClick={() => acceptReceipt(row)} aria-label="Принять" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4f71dc] text-white hover:brightness-95"><Check className="h-4 w-4" /></button>
                      </div>
                      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
                        <div>
                          <table className="w-full text-left text-[13px]">
                            <thead><tr className="text-[#555]"><th className="py-2 pr-4">Товар</th><th className="py-2 pr-4">Тип товара</th><th className="py-2 pr-4">Кол-во</th></tr></thead>
                            <tbody>{row.items.map((item) => <tr key={item.product} className="border-t border-dotted border-[#d6d6d6]"><td className="py-2 pr-4">{item.product}</td><td className="py-2 pr-4">{item.type}</td><td className="py-2 pr-4">{item.qty}</td></tr>)}</tbody>
                          </table>
                          <p className="mt-3 font-semibold">Общее количество {row.items[0]?.qty}</p>
                        </div>
                        <div>
                          <p className="text-[#555]">Создал:</p><p className="mb-4 font-semibold">{row.creator}</p>
                          <p className="text-[#555]">Комментарий:</p><p className="font-semibold">{row.comment}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
              {visible.length === 0 && <div className="px-4 py-16 text-center text-[#666]">{emptyText}</div>}
            </div>
          </div>
        )}
        {tab === "transfer" && <RefTable cols={transferCols} heads={transferHeads} rows={visible as TransferRow[]} rowKey={(row) => row.no} render={transferRender} empty={emptyText} />}
        {tab === "transferHistory" && <RefTable cols={transferCols} heads={transferHeads} rows={visible as TransferRow[]} rowKey={(row) => row.no} render={transferRender} empty={emptyText} />}
        {tab === "movement" && (
          <RefTable
            cols="minmax(0,1.3fr) repeat(5,minmax(0,1fr))"
            heads={["Товар", "Кол-во", "Серия", "Дата", "Склад", "Тип"]}
            rows={visible as MovementRow[]}
            rowKey={(row) => `${row.type}-${row.date}-${row.product}-${row.quantity}`}
            empty={emptyText}
            render={(row) => {
              const [word, docId] = row.type.split(" ")
              return [
                <span key="p" className="flex items-center gap-2">{row.dir === "up" ? <ArrowUp className="h-4 w-4 text-[#f06c6c]" /> : <ArrowDown className="h-4 w-4 text-[#71ce87]" />}{row.product}</span>,
                row.quantity,
                row.series,
                row.date,
                row.warehouse,
                docId ? <span key="t">{word} {link(docId)}</span> : word,
              ]
            }}
          />
        )}
        {tab === "receiptHistory" && (
          <RefTable
            cols="minmax(0,0.6fr) repeat(5,minmax(0,1fr))"
            heads={["№ заказа", "От кого", "Тип", "Дата приемки", "Принял", "Склад"]}
            rows={visible as ReceiptHistoryRow[]}
            rowKey={(row) => row.no}
            empty={emptyText}
            render={(row) => [<span key="n" className="text-[#4f71dc]">{row.no}</span>, row.person, row.type, row.date, row.accepted, row.warehouse]}
          />
        )}
      </RefCard>
    </RefPage>
  )
}
