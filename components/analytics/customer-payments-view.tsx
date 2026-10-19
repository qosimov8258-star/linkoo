"use client"

import { useEffect, useMemo, useState } from "react"
import { Clock, CreditCard, Info, Pencil, Reply, Trash2, Wallet } from "lucide-react"
import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { ReportSelectField } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"

import type { PaymentRow } from "./customer-payments-data"

const number = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value)

function PaymentIcon({ type }: { type: "cash" | "card" }) {
  if (type === "card") return <CreditCard className="inline h-4 w-4 text-[#4f71dc]" />
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] bg-[#4f71dc] text-[10px] font-bold text-white">S</span>
  )
}

export function CustomerPaymentsView() {
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<"pending" | "accepted" | "all">("all")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("")
  const [agentFilter, setAgentFilter] = useState("")
  const [kassaFilter, setKassaFilter] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [historyOpenId, setHistoryOpenId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingComment, setEditingComment] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/customer-payments")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить оплаты")
        return (await response.json()) as PaymentRow[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить оплаты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const organizations = [...new Set(rows.map((row) => row.organization))]
  const agents = [...new Set(rows.map((row) => row.agent))]
  const kassas = [...new Set(rows.map((row) => row.kassa).filter(Boolean))]

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab === "pending" && row.accepted) return false
      if (tab === "accepted" && !row.accepted) return false
      if (search.trim() && !row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (organizationFilter !== "" && row.organization !== organizationFilter) return false
      if (agentFilter !== "" && row.agent !== agentFilter) return false
      if (kassaFilter !== "" && row.kassa !== kassaFilter) return false
      return true
    })
  }, [agentFilter, kassaFilter, organizationFilter, rows, search, tab])

  const sorted = filtered

  const maxPage = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const pendingRows = rows.filter((row) => !row.accepted)
  const acceptedRows = rows.filter((row) => row.accepted)
  const isDefaultFilters = !search.trim() && organizationFilter === "" && agentFilter === "" && kassaFilter === ""
  const totalLabel = isDefaultFilters ? (tab === "pending" ? pendingRows.length : tab === "accepted" ? acceptedRows.length : rows.length) : filtered.length

  // Сводная шапка отражает реальные данные из базы (не только видимую выборку строк).
  function sumTotals(source: PaymentRow[]) {
    return source.reduce(
      (acc, row) => (row.currency === "SUM" ? { ...acc, sum: acc.sum + row.amount } : { ...acc, usd: acc.usd + row.amount }),
      { sum: 0, usd: 0, eur: 0 },
    )
  }
  const SUMMARY_TOTALS = sumTotals(tab === "pending" ? pendingRows : tab === "accepted" ? acceptedRows : rows)

  const acceptToCashbox = async () => {
    const now = new Date()
    const label = now.toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    const idsToAccept = rows.filter((row) => !row.accepted && filtered.some((f) => f.id === row.id)).map((row) => row.id)
    if (!idsToAccept.length) return

    setRows((current) =>
      current.map((row) => (idsToAccept.includes(row.id) ? { ...row, accepted: true, acceptedAt: label, kassa: "naqd" } : row)),
    )
    await Promise.all(
      idsToAccept.map((id) =>
        fetch(`/api/customer-payments/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accepted: true, acceptedAt: label, kassa: "naqd" }),
        }),
      ),
    )
  }

  const revertRow = async (id: number) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, accepted: false, acceptedAt: "", kassa: "" } : row)))
    await fetch(`/api/customer-payments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted: false, acceptedAt: "", kassa: "" }),
    })
  }

  const deleteRow = async (id: number) => {
    setRows((current) => current.filter((row) => row.id !== id))
    await fetch(`/api/customer-payments/${id}`, { method: "DELETE" })
  }

  const startEdit = (row: PaymentRow) => {
    setEditingId(row.id)
    setEditingComment(row.comment)
  }

  const saveEdit = async (id: number) => {
    const comment = editingComment || "Не указано"
    setRows((current) => current.map((row) => (row.id === id ? { ...row, comment } : row)))
    setEditingId(null)
    await fetch(`/api/customer-payments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    })
  }

  const downloadExcel = () => {
    const header = ["№", "Клиент", "Создал", "Дата оплаты", "Дата приемки", "Ответственный агент", "Организация", "Сумма", "Сумма в кассе", "Касса", "Комментарий"]
    const body = filtered.map((row) => [
      row.id,
      row.client,
      row.createdBy,
      row.paidAt,
      row.acceptedAt || "-",
      row.agent,
      row.organization,
      `${number(row.amount, row.currency === "USD" ? 0 : 0)} ${row.currency}`,
      `${number(row.cashAmount)} SUM`,
      row.kassa || "Не принято",
      row.comment,
    ])
    downloadExcelTable("customer-payments", [header, ...body])
  }

  const filterPanel = (
    <div className="grid w-[640px] grid-cols-3 gap-x-[12px] bg-white p-6 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <ReportSelectField label="Организация" value={organizationFilter} onChange={(value) => { setOrganizationFilter(value); setPage(1) }} options={organizations} />
      <ReportSelectField label="Ответственный агент" value={agentFilter} onChange={(value) => { setAgentFilter(value); setPage(1) }} options={agents} />
      <ReportSelectField label="Касса" value={kassaFilter} onChange={(value) => { setKassaFilter(value); setPage(1) }} options={kassas} />
    </div>
  )
  const ic = "h-6 w-6 fill-[#555]"
  const toolbarIcons = (
    <>
      <svg viewBox="0 0 24 24" className={ic} aria-hidden><path d={RI.checklist} /></svg>
      <button onClick={downloadExcel} aria-label="Скачать" className="ml-[22px]"><svg viewBox="0 0 24 24" className={ic}><path d={RI.download} /></svg></button>
      <svg viewBox="0 0 24 24" className={`${ic} ml-[22px]`} aria-hidden><path d="M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z" /></svg>
      <button onClick={() => setPage(1)} aria-label="Обновить" className="ml-[22px]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]"><path d={RI.sync} /></svg></button>
      <svg viewBox="0 0 24 24" className="ml-[22px] h-6 w-6 fill-[#bbb]" aria-hidden><path d={RI.edit} /></svg>
    </>
  )

  return (
    <RefPage>
      <RefHeader title="Оплаты от клиентов">
        <RefButton icon={RI.download} green label="Скачать Excel" onClick={downloadExcel} />
      </RefHeader>

      <div className="-mx-7 bg-[#5869f0] px-[33px] py-[4px] text-[13px] font-semibold leading-4 text-white">
        Оплаты от клиентов: {number(SUMMARY_TOTALS.sum, 2)} SUM , {number(SUMMARY_TOTALS.usd, 3)} USD , {number(SUMMARY_TOTALS.eur, 3)} Euro
      </div>

      <div className="mt-[1px]">
        <RefTabs labels={["Не принятые", "Принятые", "Все"]} value={tab === "pending" ? "Не принятые" : tab === "accepted" ? "Принятые" : "Все"} onChange={(label) => { setTab(label === "Не принятые" ? "pending" : label === "Принятые" ? "accepted" : "all"); setPage(1) }} />
      </div>

      <RefCard>
        <RefToolbar
          linkFilter
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          query={search}
          onQuery={(value) => { setSearch(value); setPage(1) }}
          pageSize={pageSize}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
          from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
          to={Math.min(safePage * pageSize, filtered.length)}
          total={totalLabel}
          page={safePage}
          pageCount={maxPage}
          onPage={setPage}
          icons={toolbarIcons}
          extra={<button onClick={acceptToCashbox} className="ml-[10px] flex h-[30px] items-center rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Wallet className="mr-2 h-[18px] w-[18px]" />Принять на кассу</button>}
        />
        <RefTable
          cols="36px 148px 124px 124px 124px 124px 124px 124px 123px 76px minmax(0,1fr)"
          minWidth={1300}
          heads={["№", "Клиент", "Создал", "Дата оплаты", "Дата приемки", "Ответственный агент", "Организация", "Сумма", "Сумма в кассе", "Касса", "Комментарий"]}
          rows={loading || loadError ? [] : visible}
          rowKey={(row) => row.id}
          rowClass={() => "group relative"}
          empty={loading ? "Загрузка оплат..." : loadError || "Ничего не найдено по заданным фильтрам"}
          render={(row) => [
            row.id,
            <div key="c"><div>{row.client}</div>{row.clientCode && <div className="text-[#4f71dc]">{row.clientCode}</div>}</div>,
            row.createdBy,
            row.paidAt,
            row.acceptedAt || "-",
            row.agent,
            row.organization,
            <div key="a">
              <div className="flex items-center gap-1.5 font-semibold text-[#71ce87]">{number(row.amount)} {row.currency} <PaymentIcon type={row.icon} />{row.currency === "USD" && <Info className="h-3.5 w-3.5 text-[#9aa3b6]" />}</div>
              {row.currency === "USD" && <div className="text-[12px] text-[#555]">{number(row.amountSumEquivalent ?? 0, 2)} SUM</div>}
            </div>,
            row.currency === "USD" ? <div key="k"><div className="flex items-center gap-1">{number(row.amount)} {row.currency} <Info className="h-3.5 w-3.5 text-[#4f71dc]" /></div><div className="text-[12px] text-[#555]">0 SUM</div></div> : `${number(row.cashAmount)} SUM`,
            <div key="x" className="relative">
              <div className="group-hover:invisible">{row.accepted ? <span className="text-[#4f71dc]">{row.kassa}</span> : <span>Не принято</span>}</div>
              <div className="invisible absolute inset-0 flex items-center gap-2 group-hover:visible">
                <button aria-label="История" onClick={() => setHistoryOpenId(row.id)} className="text-[#e0a83e]"><Clock className="h-4 w-4" /></button>
                <button aria-label="Вернуть" onClick={() => revertRow(row.id)} className="text-[#555]"><Reply className="h-4 w-4" /></button>
                <button aria-label="Редактировать" onClick={() => startEdit(row)} className="text-[#e5484d]"><Pencil className="h-4 w-4" /></button>
                <button aria-label="Удалить" onClick={() => deleteRow(row.id)} className="text-[#e5484d]"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>,
            editingId === row.id ? (
              <div key="e" className="flex items-center gap-2">
                <input autoFocus value={editingComment} onChange={(event) => setEditingComment(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveEdit(row.id)} className="w-full border-b border-[#4f71dc] bg-transparent outline-none" />
                <button onClick={() => saveEdit(row.id)} className="text-xs font-semibold text-[#4f71dc]">OK</button>
              </div>
            ) : row.comment,
          ]}
        />
      </RefCard>

      {historyOpenId !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={() => setHistoryOpenId(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[420px] rounded-md bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold">История платежа №{historyOpenId}</h3>
            <ul className="space-y-3 text-sm text-[#586174]">
              <li>Платёж создан — {rows.find((row) => row.id === historyOpenId)?.createdBy}</li>
              <li>Дата оплаты — {rows.find((row) => row.id === historyOpenId)?.paidAt}</li>
              <li>Статус — {rows.find((row) => row.id === historyOpenId)?.accepted ? "Принято на кассу" : "Ожидает принятия"}</li>
            </ul>
            <button onClick={() => setHistoryOpenId(null)} className="mt-6 w-full rounded-md bg-[#4f5fd9] py-2.5 font-semibold text-white">Закрыть</button>
          </div>
        </div>
      )}
    </RefPage>
  )
}
