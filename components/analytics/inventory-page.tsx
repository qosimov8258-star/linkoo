"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, MinusCircle, Pencil, Trash2, X } from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { ReportSelectField } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

type Status = "Подтвержденный" | "В ожидании" | "Отменен"
type Inventory = { id: number; warehouse: string; author: string; date: string; comment: string; status: Status; amount: string }

const warehouses = ["05,08,2025(1)", "Andijon skladi", "ПРОФРЕШ", "123 test", "878", "Herat", "Chinobod sklad"]

function makeRows(): Inventory[] {
  return []
}

const statusColor: Record<Status, string> = {
  "Подтвержденный": "bg-[#77c98b]",
  "В ожидании": "bg-[#f1aa42]",
  "Отменен": "bg-[#e96c70]",
}

export function InventoryPage() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Inventory[]>(makeRows)
  useEffect(() => {
    let cancelled = false
    fetch("/api/inventory-records")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Inventory[]
      })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) window.alert(t("Не удалось загрузить инвентаризации с сервера"))
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<number | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addComment, setAddComment] = useState("")
  const [warehouse, setWarehouse] = useState("Все склады")
  const [status, setStatus] = useState<Status | "Все статусы">("Все статусы")
  const [editRow, setEditRow] = useState<Inventory | null>(null)
  const [editComment, setEditComment] = useState("")

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = `${row.id} ${row.warehouse} ${row.author} ${row.comment} ${row.status}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (warehouse === "Все склады" || row.warehouse === warehouse) && (status === "Все статусы" || row.status === status)
  }), [rows, query, warehouse, status])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  function downloadExcel() {
    const header = [t("№"), t("Склад"), t("Создал"), t("Дата создания"), t("Комментарий"), t("Статус"), t("Сумма")]
    const body = filtered.map((r) => [r.id, r.warehouse, r.author, r.date, r.comment, t(r.status), r.amount])
    downloadExcelTable("inventory", [header, ...body])
  }

  async function cancelInventory(id: number) {
    try {
      const response = await fetch(`/api/inventory-records/${id}/cancel`, { method: "POST" })
      if (!response.ok) {
        window.alert(t("Не удалось отменить инвентаризацию"))
        return
      }
      const saved = (await response.json()) as Inventory
      setRows((current) => current.map((row) => (row.id === id ? saved : row)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function saveComment() {
    if (!editRow) return
    try {
      const response = await fetch(`/api/inventory-records/${editRow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: editComment }),
      })
      if (!response.ok) {
        window.alert(t("Не удалось сохранить комментарий"))
        return
      }
      const saved = (await response.json()) as Inventory
      setRows((current) => current.map((row) => (row.id === editRow.id ? saved : row)))
      setEditRow(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function addInventory() {
    try {
      const response = await fetch("/api/inventory-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse: warehouse === "Все склады" ? warehouses[0] : warehouse, comment: addComment }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось создать инвентаризацию"))
        return
      }
      const saved = (await response.json()) as Inventory
      setRows((current) => [saved, ...current])
      setAddOpen(false)
      setAddComment("")
      setPage(1)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function removeInventory(id: number) {
    try {
      const response = await fetch(`/api/inventory-records/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert(t("Не удалось удалить инвентаризацию"))
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
      setSelected(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const filterPanel = (
    <div className="w-[390px] bg-white p-6 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="mb-6 flex items-center justify-between text-[14px] font-semibold">{t("Фильтр")}<button onClick={() => setFilterOpen(false)}><X className="h-5 w-5" /></button></div>
      <div className="space-y-5">
        <ReportSelectField label="Склад" value={warehouse === "Все склады" ? "" : warehouse} onChange={(value) => setWarehouse(value || "Все склады")} options={warehouses} />
        <ReportSelectField label="Статус" value={status === "Все статусы" ? "" : status} onChange={(value) => setStatus((value || "Все статусы") as Status | "Все статусы")} options={["Подтвержденный", "В ожидании", "Отменен"]} />
        <button onClick={() => { setFilterOpen(false); setPage(1) }} className="h-9 rounded-[3px] bg-[#5d6474] px-5 text-[13px] font-semibold uppercase text-white shadow">{t("Применить")}</button>
      </div>
    </div>
  )

  return <RefPage>
    <RefHeader title={t("Инвентаризация")}>
      <RefButton icon={RI.checklist} green label={t("Добавить")} onClick={() => setAddOpen(true)} />
    </RefHeader>

    <RefCard>
      <RefToolbar
        linkFilter
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen(!filterOpen)}
        filterPanel={filterPanel}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        pageSize={pageSize}
        onPageSize={(size) => { setPageSize(size); setPage(1) }}
        from={filtered.length ? (page - 1) * pageSize + 1 : 0}
        to={Math.min(page * pageSize, filtered.length)}
        total={filtered.length}
        page={page}
        pageCount={pages}
        onPage={setPage}
        icons={<button onClick={downloadExcel} title={t("Скачать Excel")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={RI.download} /></svg></button>}
      />
      <RefTable
        cols="0.54fr repeat(6,minmax(0,1fr))"
        heads={["№", "Склад", "Создал", "Дата создания", "Комментарий", "Статус", "Сумма"].map((h) => t(h))}
        rows={visible}
        rowKey={(row) => row.id}
        onRowClick={(row) => setSelected(selected === row.id ? null : row.id)}
        empty={t("Ничего не найдено")}
        render={(row) => [row.id, row.warehouse, row.author, row.date, row.comment, <span key="s" className="flex items-center"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${statusColor[row.status]}`} />{t(row.status)}</span>, row.amount]}
        expanded={(row) => selected === row.id ? (
          <>
<div className="bg-[#f2f5f8] p-4"><div className="rounded bg-white shadow-lg">
            <div className="flex items-center border-b px-9 py-5"><strong className="text-xl">{row.author}</strong><div className="ml-auto flex gap-5"><button onClick={() => { setEditRow(row); setEditComment(row.comment) }} aria-label={t("Изменить")}><Pencil className="text-slate-400"/></button><button onClick={downloadExcel} className="flex items-center gap-2 rounded bg-[#67cc87] px-5 py-2 text-white"><Download size={18}/>{t("Скачать Excel")}</button><button disabled={row.status === "Отменен"} onClick={() => cancelInventory(row.id)} className="flex items-center gap-2 rounded bg-[#fa8077] px-5 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"><MinusCircle size={18}/>{t("Отменить")}</button><button onClick={() => removeInventory(row.id)} aria-label={t("Удалить")}><Trash2 className="text-slate-500"/></button></div></div>
            <div className="grid grid-cols-[420px_1fr]">
              <dl className="grid grid-cols-2 gap-y-3 border-r p-9 text-slate-600"><dt>{t("Тип:")}</dt><dd className="text-right font-semibold">{t("По факту проведения")}</dd><dt>{t("Склад:")}</dt><dd className="text-right font-semibold">{row.warehouse}</dd><dt>{t("Статус:")}</dt><dd className="text-right font-semibold">{t(row.status)}</dd><dt>{t("Дата создания:")}</dt><dd className="text-right font-semibold">{row.date}</dd><dt>{t("Время:")}</dt><dd className="text-right font-semibold">{t("На начало дня")}</dd><dt>{t("Комментарий:")}</dt><dd className="text-right font-semibold">{row.comment}</dd></dl>
              <div className="p-9"><div className="grid grid-cols-6 border-b pb-4 font-semibold"><span>{t("Наименование")}</span><span>{t("Серия")}</span><span>{t("Баланс (до)")}</span><span>{t("Баланс (после)")}</span><span>{t("Разница")}</span><span>{t("Сумма SUM")}</span></div><div className="grid grid-cols-6 border-b py-5"><span>sndwch</span><span>-</span><span>4 sht</span><span>1 sht</span><span>-3 sht</span><span>{row.amount}</span></div><div className="mt-5 text-right font-semibold">{t("Итого")}: <span className="ml-16">{row.amount}</span></div></div>
            </div>
          </div></div>
          </>
        ) : null}
      />
    </RefCard>

    {addOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"><div className="w-[620px] rounded bg-white p-8 shadow-2xl"><div className="mb-8 flex justify-between text-xl font-semibold">{t("ДОБАВИТЬ ИНВЕНТАРИЗАЦИЮ")}<button onClick={() => setAddOpen(false)}><X/></button></div><label className="block">{t("Склад")}<select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-2 w-full border-b py-3"><option>{t("Все склады")}</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></label><label className="mt-6 block">{t("Комментарий")}<input value={addComment} onChange={(e) => setAddComment(e.target.value)} className="mt-2 w-full border-b py-3" placeholder={t("Комментарий")}/></label><div className="mt-10 text-right"><button onClick={addInventory} className="rounded bg-[#67cc87] px-7 py-3 font-semibold text-white">{t("СОХРАНИТЬ")}</button></div></div></div>}

    {editRow && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"><div className="w-[620px] rounded bg-white p-8 shadow-2xl"><div className="mb-8 flex justify-between text-xl font-semibold">{t("ИЗМЕНИТЬ ИНВЕНТАРИЗАЦИЮ №")}{editRow.id}<button onClick={() => setEditRow(null)}><X/></button></div><label className="block">{t("Комментарий")}<input autoFocus value={editComment} onChange={(e) => setEditComment(e.target.value)} className="mt-2 w-full border-b py-3" placeholder={t("Комментарий")}/></label><div className="mt-10 text-right"><button onClick={saveComment} className="rounded bg-[#67cc87] px-7 py-3 font-semibold text-white">{t("СОХРАНИТЬ")}</button></div></div></div>}

  </RefPage>
}
