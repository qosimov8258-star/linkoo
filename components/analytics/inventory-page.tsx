"use client"

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, FileText, MinusCircle, Pencil, Plus, Search, Trash2, X } from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

type Status = "Подтвержденный" | "В ожидании" | "Отменен"
type Inventory = { id: number; warehouse: string; author: string; date: string; comment: string; status: Status; amount: string }

const warehouses = ["05,08,2025(1)", "Andijon skladi", "ПРОФРЕШ", "123 test", "878", "Herat", "Chinobod sklad"]

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "склад": "warehouse", "warehouse": "warehouse",
  "комментарий": "comment", "comment": "comment",
}

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
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

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

  function downloadTemplate() {
    downloadExcelTable("inventory-template", [[t("Склад"), t("Комментарий")]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("warehouse")
      const dataRows = hasHeader ? rows.slice(1) : rows

      type ParsedInventory = { warehouse: string; comment: string }
      const parsed: ParsedInventory[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.warehouse = row[0] ?? ""
          record.comment = row[1] ?? ""
        }
        if (!record.warehouse) continue
        const matched = warehouses.find((item) => item.toLowerCase() === record.warehouse.trim().toLowerCase())
        parsed.push({ warehouse: matched ?? record.warehouse.trim(), comment: record.comment?.trim() || "Комментариев нет" })
      }

      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      const created: Inventory[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/inventory-records", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Inventory)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
      setPage(1)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return <div className="min-h-[calc(100vh-64px)] bg-[#f1f4f8] text-[#17233d]">
    <div className="flex items-center justify-between border-b border-slate-200 px-9 py-4">
      <h1 className="flex items-center text-[26px] font-semibold text-[#586174]"><FavoritesButton className="flex items-center gap-2 text-[#4e70e7]" /><span className="mx-3 text-[#596275]">|</span>{t("Инвентаризация")}</h1>
      <div className="flex items-center gap-3">
        <button onClick={() => setImportOpen(true)} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white shadow"><FileText size={18}/>{t("Импорт с Excel")}</button>
        <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-md bg-[#6dce8b] px-5 py-2.5 font-semibold text-white shadow"><Plus size={20}/>{t("Добавить")}</button>
      </div>
    </div>

    <div className="m-9 mt-0 overflow-hidden rounded-sm bg-white shadow">
      <div className="flex items-center gap-6 px-2 py-3">
        <button onClick={() => setFilterOpen(!filterOpen)} className="text-[#4f70e7]">{t("Показать фильтр")}⌄</button>
        <label className="relative ml-auto mr-auto w-96"><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 px-1 py-2 outline-none"/><Search className="absolute right-1 top-2 text-slate-300"/></label>
        <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="bg-transparent outline-none"><option>25</option><option>50</option><option>100</option></select>
        <span className="text-slate-500">{filtered.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filtered.length)} {t("из")} {filtered.length}</span>
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="text-slate-400"/></button>
        <button disabled={page === pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="text-slate-500"/></button>
        <button onClick={downloadExcel} title={t("Скачать Excel")}><Download className="text-slate-600"/></button>
      </div>

      {filterOpen && <div className="absolute z-30 ml-2 w-[390px] rounded bg-white p-6 shadow-2xl">
        <div className="mb-7 flex justify-between text-xl text-slate-500">{t("Фильтр")}<button onClick={() => setFilterOpen(false)}><X/></button></div>
        <label className="mb-5 block font-medium">{t("Склад")}<select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-2 w-full border-b py-2 font-normal"><option>{t("Все склады")}</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></label>
        <label className="mb-7 block font-medium">{t("Статус")}<select value={status} onChange={(e) => setStatus(e.target.value as Status | "Все статусы")} className="mt-2 w-full border-b py-2 font-normal"><option>{t("Все статусы")}</option><option>{t("Подтвержденный")}</option><option>{t("В ожидании")}</option><option>{t("Отменен")}</option></select></label>
        <button onClick={() => { setFilterOpen(false); setPage(1) }} className="rounded bg-[#626d82] px-6 py-3 text-white shadow">{t("ПРИМЕНИТЬ")}</button>
      </div>}

      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] border-collapse text-left">
        <thead className="bg-[#626b7e] text-white"><tr>{["№", "Склад", "Создал", "Дата создания", "Комментарий", "Статус", "Сумма"].map((h) => <th key={h} className="px-9 py-5 font-semibold">{t(h)}</th>)}</tr></thead>
        <tbody>{visible.map((row) => <Fragment key={row.id}>
          <tr onClick={() => setSelected(selected === row.id ? null : row.id)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-blue-50">
            <td className="px-9 py-5">{row.id}</td><td className="px-9 py-5">{row.warehouse}</td><td className="px-9 py-5">{row.author}</td><td className="px-9 py-5">{row.date}</td><td className="px-9 py-5">{row.comment}</td>
            <td className="px-9 py-5"><span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${statusColor[row.status]}`}/>{t(row.status)}</td><td className="px-9 py-5">{row.amount}</td>
          </tr>
          {selected === row.id && <tr><td colSpan={7} className="bg-[#f2f5f8] p-4"><div className="rounded bg-white shadow-lg">
            <div className="flex items-center border-b px-9 py-5"><strong className="text-xl">{row.author}</strong><div className="ml-auto flex gap-5"><button onClick={() => { setEditRow(row); setEditComment(row.comment) }} aria-label={t("Изменить")}><Pencil className="text-slate-400"/></button><button onClick={downloadExcel} className="flex items-center gap-2 rounded bg-[#67cc87] px-5 py-2 text-white"><Download size={18}/>{t("Скачать Excel")}</button><button disabled={row.status === "Отменен"} onClick={() => cancelInventory(row.id)} className="flex items-center gap-2 rounded bg-[#fa8077] px-5 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"><MinusCircle size={18}/>{t("Отменить")}</button><button onClick={() => removeInventory(row.id)} aria-label={t("Удалить")}><Trash2 className="text-slate-500"/></button></div></div>
            <div className="grid grid-cols-[420px_1fr]">
              <dl className="grid grid-cols-2 gap-y-3 border-r p-9 text-slate-600"><dt>{t("Тип:")}</dt><dd className="text-right font-semibold">{t("По факту проведения")}</dd><dt>{t("Склад:")}</dt><dd className="text-right font-semibold">{row.warehouse}</dd><dt>{t("Статус:")}</dt><dd className="text-right font-semibold">{t(row.status)}</dd><dt>{t("Дата создания:")}</dt><dd className="text-right font-semibold">{row.date}</dd><dt>{t("Время:")}</dt><dd className="text-right font-semibold">{t("На начало дня")}</dd><dt>{t("Комментарий:")}</dt><dd className="text-right font-semibold">{row.comment}</dd></dl>
              <div className="p-9"><div className="grid grid-cols-6 border-b pb-4 font-semibold"><span>{t("Наименование")}</span><span>{t("Серия")}</span><span>{t("Баланс (до)")}</span><span>{t("Баланс (после)")}</span><span>{t("Разница")}</span><span>{t("Сумма SUM")}</span></div><div className="grid grid-cols-6 border-b py-5"><span>sndwch</span><span>-</span><span>4 sht</span><span>1 sht</span><span>-3 sht</span><span>{row.amount}</span></div><div className="mt-5 text-right font-semibold">{t("Итого")}: <span className="ml-16">{row.amount}</span></div></div>
            </div>
          </div></td></tr>}
        </Fragment>)}</tbody>
      </table></div>
    </div>

    {addOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"><div className="w-[620px] rounded bg-white p-8 shadow-2xl"><div className="mb-8 flex justify-between text-xl font-semibold">{t("ДОБАВИТЬ ИНВЕНТАРИЗАЦИЮ")}<button onClick={() => setAddOpen(false)}><X/></button></div><label className="block">{t("Склад")}<select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-2 w-full border-b py-3"><option>{t("Все склады")}</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></label><label className="mt-6 block">{t("Комментарий")}<input value={addComment} onChange={(e) => setAddComment(e.target.value)} className="mt-2 w-full border-b py-3" placeholder={t("Комментарий")}/></label><div className="mt-10 text-right"><button onClick={addInventory} className="rounded bg-[#67cc87] px-7 py-3 font-semibold text-white">{t("СОХРАНИТЬ")}</button></div></div></div>}

    {editRow && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"><div className="w-[620px] rounded bg-white p-8 shadow-2xl"><div className="mb-8 flex justify-between text-xl font-semibold">{t("ИЗМЕНИТЬ ИНВЕНТАРИЗАЦИЮ №")}{editRow.id}<button onClick={() => setEditRow(null)}><X/></button></div><label className="block">{t("Комментарий")}<input autoFocus value={editComment} onChange={(e) => setEditComment(e.target.value)} className="mt-2 w-full border-b py-3" placeholder={t("Комментарий")}/></label><div className="mt-10 text-right"><button onClick={saveComment} className="rounded bg-[#67cc87] px-7 py-3 font-semibold text-white">{t("СОХРАНИТЬ")}</button></div></div></div>}

    {importOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-md rounded bg-white">
          <header className="flex items-center justify-between border-b p-6">
            <b className="uppercase">{t("Импорт с Excel")}</b>
            <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}>
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="p-8">
            <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
              {t("1. Скачать шаблон")}
            </button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
            >
              <FileText className="h-8 w-8" />
              {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
            </button>
          </div>
          <footer className="flex justify-end border-t p-5">
            <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
              {importSaving ? t("Импорт...") : t("Сохранить")}
            </button>
          </footer>
        </div>
      </div>
    )}
  </div>
}
