"use client"

import Image from "next/image"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Copy, Download, FileText, ListChecks, Pencil, PlusCircle, RefreshCw, X } from "lucide-react"
import { RI, RefButton, RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "сотрудник": "employee",
  "зарплата": "salary",
  "kpi": "kpi",
}

type SalaryRow = {
  id: number
  employee: string
  salary: number
  bonus: number
  kpi: number
  credited: boolean
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function SalaryPlanningView() {
  const today = new Date()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<SalaryRow[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [tab, setTab] = useState("Все")
  const [month, setMonth] = useState(today.getMonth())
  const [year, setYear] = useState(today.getFullYear())
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [message, setMessage] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/salary-plans")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить зарплаты")
        return (await response.json()) as SalaryRow[]
      })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить зарплаты с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (tab === "Все" || (tab === "Зачислено" ? row.credited : !row.credited)) &&
          row.employee.toLowerCase().includes(query.toLowerCase()),
      ),
    [rows, tab, query],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  function toggleSelected(id: number) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function setCredited(credited: boolean) {
    const targets = rows.filter((row) => selected.includes(row.id))
    const updated: SalaryRow[] = []
    let failed = 0
    for (const row of targets) {
      try {
        const response = await fetch(`/api/salary-plans/${row.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee: row.employee, salary: row.salary, bonus: row.bonus, kpi: row.kpi, credited }),
        })
        if (response.ok) updated.push((await response.json()) as SalaryRow)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (updated.length) setRows((current) => current.map((row) => updated.find((item) => item.id === row.id) ?? row))
    if (failed) window.alert(`Не удалось обновить записей: ${failed}`)
    setMessage(credited ? "Зарплата зачислена" : "Зачисление отменено")
  }

  async function recalcKpi() {
    setRecalculating(true)
    try {
      const updated: SalaryRow[] = []
      let failed = 0
      for (const row of rows) {
        const bonus = Math.round((row.salary * row.kpi) / 100)
        try {
          const response = await fetch(`/api/salary-plans/${row.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee: row.employee, salary: row.salary, bonus, kpi: row.kpi, credited: row.credited }),
          })
          if (response.ok) updated.push((await response.json()) as SalaryRow)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (updated.length) setRows((current) => current.map((row) => updated.find((item) => item.id === row.id) ?? row))
      if (failed) window.alert(`Не удалось пересчитать записей: ${failed}`)
      setMessage("KPI пересчитан")
    } finally {
      setRecalculating(false)
    }
  }

  async function addSalary(employee: string, salary: number, kpi: number) {
    try {
      const response = await fetch("/api/salary-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee, salary, bonus: 0, kpi, credited: false }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось добавить зарплату")
        return
      }
      const saved = (await response.json()) as SalaryRow
      setRows((current) => [...current, saved])
      setAddOpen(false)
      setMessage("Зарплата добавлена")
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function updatePlans(salary: number, kpi: number) {
    const targets = rows.filter((row) => selected.includes(row.id))
    const updated: SalaryRow[] = []
    let failed = 0
    for (const row of targets) {
      try {
        const response = await fetch(`/api/salary-plans/${row.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee: row.employee, salary, bonus: row.bonus, kpi, credited: row.credited }),
        })
        if (response.ok) updated.push((await response.json()) as SalaryRow)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (updated.length) setRows((current) => current.map((row) => updated.find((item) => item.id === row.id) ?? row))
    setPlansOpen(false)
    setMessage("Планы обновлены")
    if (failed) window.alert(`Не удалось обновить записей: ${failed}`)
  }

  async function duplicateSelected() {
    if (!selected.length) return
    const targets = rows.filter((row) => selected.includes(row.id))
    const created: SalaryRow[] = []
    let failed = 0
    for (const row of targets) {
      try {
        const response = await fetch("/api/salary-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee: `${row.employee} — копия`, salary: row.salary, bonus: row.bonus, kpi: row.kpi, credited: row.credited }),
        })
        if (response.ok) created.push((await response.json()) as SalaryRow)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (created.length) setRows((current) => [...current, ...created])
    setMessage("Выбранные строки скопированы")
    if (failed) window.alert(`Не удалось скопировать записей: ${failed}`)
  }

  function exportCsv() {
    const header = "Сотрудник;Зарплата;Сумма бонусов;Итоговая зарплата;KPI;Зачислено"
    const body = rows.map((row) => `${row.employee};${row.salary};${row.bonus};${row.salary + row.bonus};${row.kpi};${row.credited ? "Да" : "Нет"}`)
    download("salary-plans.csv", [header, ...body].join("\n"))
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const imported = text.split(/\r?\n/).slice(1).filter(Boolean).map((line, index) => {
      const [employee, salary, bonus, , kpi, credited] = line.split(";")
      return { employee: employee || `Сотрудник ${index + 1}`, salary: Number(salary) || 0, bonus: Number(bonus) || 0, kpi: Number(kpi) || 0, credited: credited === "Да" }
    })
    event.target.value = ""
    if (!imported.length) return

    // "Обновить с excel" replaces the whole plan list: clear existing rows, then recreate from the file
    for (const row of rows) {
      try {
        await fetch(`/api/salary-plans/${row.id}`, { method: "DELETE" })
      } catch {
        // best effort — continue even if one delete fails
      }
    }
    const created: SalaryRow[] = []
    let failed = 0
    for (const item of imported) {
      try {
        const response = await fetch("/api/salary-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        })
        if (response.ok) created.push((await response.json()) as SalaryRow)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    setRows(created)
    setMessage(`Импортировано сотрудников: ${created.length}`)
    if (failed) window.alert(`Не удалось импортировать записей: ${failed}`)
  }

  function downloadTemplate() {
    downloadExcelTable("salary-template", [["Сотрудник", "Зарплата", "KPI"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(importFile)
      if (!excelRows.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(excelRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("employee")
      const dataRows = hasHeader ? excelRows.slice(1) : excelRows

      const parsed: { employee: string; salary: number; kpi: number }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.employee = row[0] ?? ""
          record.salary = row[1] ?? ""
          record.kpi = row[2] ?? ""
        }
        if (!record.employee) continue
        parsed.push({ employee: record.employee.trim(), salary: Number(record.salary) || 0, kpi: Number(record.kpi) || 0 })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: SalaryRow[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/salary-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee: item.employee, salary: item.salary, bonus: 0, kpi: item.kpi, credited: false }),
          })
          if (response.ok) created.push((await response.json()) as SalaryRow)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...current, ...created])
      setMessage(`Импортировано сотрудников: ${created.length}`)
      if (failed) window.alert(`Не удалось импортировать записей: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <RefPage>
      <input ref={fileRef} type="file" accept=".csv" onChange={importCsv} className="hidden" />
      <RefHeader title="Зарплата и установка планов">
        <RefButton icon={RI.sync} green label="Перерасчет KPI" onClick={() => void recalcKpi()} />
        <RefButton icon={RI.sync} label="Обновить с excel" onClick={() => fileRef.current?.click()} />
        <RefButton icon={RI.download} green label="Скачать EXCEL" onClick={exportCsv} />
        <RefButton icon={RI.add} green label="Добавить зарплату" onClick={() => setAddOpen(true)} />
      </RefHeader>

      <section className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefTabs labels={["Не зачислено", "Зачислено", "Все"]} value={tab} onChange={(value) => { setTab(value); setPage(1) }} />
        <div className="flex flex-wrap items-end gap-[15px] px-[10px] py-[8px] text-[13px]">
          <label className="text-[10px] font-bold text-black">
            Месяц
            <div className="mt-1 flex items-center gap-2 border-b py-1 pr-1">
              <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="bg-white text-[13px] text-black outline-none">
                {months.map((item, index) => <option key={item} value={index}>{item}</option>)}
              </select>
              <button type="button" aria-label="Очистить месяц" onClick={() => setMonth(today.getMonth())} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          </label>
          <label className="text-[10px] font-bold text-black">Год<select value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block border-0 border-b py-1 text-[13px] font-normal text-black">{[2025, 2026, 2027].map((item) => <option key={item}>{item}</option>)}</select></label>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="ml-auto w-[248px] border-0 border-b px-0 py-1 text-[13px] outline-none" />
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option>10</option><option>25</option><option>50</option></select>
          <span>{filtered.length ? `${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, filtered.length)} из ${filtered.length}` : "0 из 0"}</span>
          <button type="button" aria-label="Назад" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-full border-2 p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Вперед" disabled={page === pages} onClick={() => setPage((value) => value + 1)} className="rounded-full border-2 p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          <ListChecks className="text-slate-500" />
          <button type="button" onClick={() => setCredited(true)} className="inline-flex h-[30px] items-center rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white disabled:opacity-50">Зачислить</button>
          <button type="button" onClick={() => setCredited(false)} className="inline-flex h-[30px] items-center rounded-[5px] bg-[#ff786e] px-4 text-[13px] font-semibold text-white disabled:opacity-50">Отменить зачисление</button>
          <button type="button" onClick={() => setPlansOpen(true)} className="inline-flex h-[30px] items-center rounded-[5px] bg-[#5470e8] px-4 text-[13px] font-semibold text-white disabled:opacity-50"><Pencil className="mr-2 inline h-4 w-4" />Изменить планы</button>
          <button type="button" aria-label="Копировать выбранные" onClick={() => void duplicateSelected()}><Copy /></button>
        </div>
        {message && <div className="flex justify-between bg-blue-50 px-5 py-2 text-blue-700">{message}<button type="button" onClick={() => setMessage("")}>×</button></div>}
        <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead className="bg-[#5d6474] text-white"><tr><th className="px-5 py-4 text-[13px] text-left">Сотрудник</th><th className="px-5 py-4 text-[13px] text-left">Зарплата</th><th className="px-5 py-4 text-[13px] text-left">Сумма бонусов</th><th className="px-5 py-4 text-[13px] text-left">Итоговая зарплата</th><th className="px-5 py-4 text-[13px] text-left">KPI</th></tr></thead><tbody>{shown.map((row) => <tr key={row.id} className="border-b"><td className="px-5 py-4"><label className="flex items-center gap-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleSelected(row.id)} />{row.employee}</label></td><td className="px-5 py-4 text-left">{row.salary.toLocaleString("ru-RU")}</td><td className="px-5 py-4 text-left">{row.bonus.toLocaleString("ru-RU")}</td><td className="px-5 py-4 text-left">{(row.salary + row.bonus).toLocaleString("ru-RU")}</td><td className="px-5 py-4 text-left">{row.kpi}%</td></tr>)}</tbody></table></div>
        {!shown.length && <div className="flex min-h-[345px] flex-col items-center justify-center"><Image src="/robot-empty.png" alt="Робот-помощник" width={150} height={150} priority /><p className="mt-6 text-slate-400">По вашему запросу ничего не найдено</p></div>}
      </section>
      {addOpen && <SalaryModal title="Добавить зарплату" onClose={() => setAddOpen(false)} onSave={(employee, salary, kpi) => void addSalary(employee, salary, kpi)} />}
      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} onSave={(salary, kpi) => void updatePlans(salary, kpi)} />}
      {importOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с Excel</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#5470e8] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#5470e8] hover:text-[#5470e8]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="inline-flex items-center h-[30px] rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </RefPage>
  )
}

function SalaryModal({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (employee: string, salary: number, kpi: number) => void }) {
  const [employee, setEmployee] = useState("")
  const [salary, setSalary] = useState("")
  const [kpi, setKpi] = useState("0")
  function submit(event: FormEvent) { event.preventDefault(); if (employee.trim() && Number(salary) >= 0) onSave(employee.trim(), Number(salary), Number(kpi)) }
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"><form onSubmit={submit} className="w-full max-w-xl bg-white shadow-2xl"><header className="flex justify-between border-b px-7 py-5"><h2 className="font-bold uppercase">{title}</h2><button type="button" onClick={onClose}><X /></button></header><div className="space-y-5 p-7"><input required value={employee} onChange={(event) => setEmployee(event.target.value)} placeholder="Сотрудник" className="w-full border-b py-3" /><input required type="number" min="0" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="Зарплата" className="w-full border-b py-3" /><input type="number" min="0" max="100" value={kpi} onChange={(event) => setKpi(event.target.value)} placeholder="KPI, %" className="w-full border-b py-3" /></div><footer className="flex justify-end border-t px-7 py-5"><button type="submit" className="font-bold uppercase text-sky-500">Сохранить</button></footer></form></div>
}

function PlansModal({ onClose, onSave }: { onClose: () => void; onSave: (salary: number, kpi: number) => void }) {
  const [salary, setSalary] = useState("0")
  const [kpi, setKpi] = useState("0")
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"><form onSubmit={(event) => { event.preventDefault(); onSave(Number(salary), Number(kpi)) }} className="w-full max-w-lg bg-white"><header className="flex justify-between border-b px-7 py-5"><h2 className="font-bold">ИЗМЕНИТЬ ПЛАНЫ</h2><button type="button" onClick={onClose}><X /></button></header><div className="space-y-5 p-7"><input type="number" min="0" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="Зарплата" className="w-full border-b py-3" /><input type="number" min="0" max="100" value={kpi} onChange={(event) => setKpi(event.target.value)} placeholder="KPI, %" className="w-full border-b py-3" /></div><footer className="flex justify-end border-t px-7 py-5"><button className="font-bold uppercase text-sky-500">Сохранить</button></footer></form></div>
}
