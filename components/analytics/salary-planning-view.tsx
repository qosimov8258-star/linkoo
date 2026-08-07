"use client"

import Image from "next/image"
import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Copy, Download, ListChecks, Pencil, PlusCircle, RefreshCw, Star, X } from "lucide-react"

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

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
  const [favorite, setFavorite] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [message, setMessage] = useState("")

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

  function setCredited(credited: boolean) {
    setRows((current) => current.map((row) => selected.includes(row.id) ? { ...row, credited } : row))
    setMessage(credited ? "Зарплата зачислена" : "Зачисление отменено")
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
      return { id: Date.now() + index, employee: employee || `Сотрудник ${index + 1}`, salary: Number(salary) || 0, bonus: Number(bonus) || 0, kpi: Number(kpi) || 0, credited: credited === "Да" }
    })
    setRows(imported)
    setMessage(`Импортировано сотрудников: ${imported.length}`)
    event.target.value = ""
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 py-4 sm:px-5">
        <button type="button" onClick={() => setFavorite((value) => !value)} className="flex items-center gap-2 text-2xl font-bold text-[#5470e8]"><Star className={`h-7 w-7 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />Избранные <span className="text-slate-500">|</span><span className="text-slate-600">Зарплата и установка планов</span></button>
        <div className="flex flex-wrap gap-4">
          <button type="button" onClick={() => { setRecalculating(true); window.setTimeout(() => { setRows((current) => current.map((row) => ({ ...row, bonus: Math.round(row.salary * row.kpi / 100) }))); setRecalculating(false); setMessage("KPI пересчитан") }, 600) }} className="rounded-md bg-[#6ccd8b] px-5 py-2.5 font-bold text-white"><RefreshCw className={`mr-2 inline h-5 w-5 ${recalculating ? "animate-spin" : ""}`} />Перерасчет KPI</button>
          <input ref={fileRef} type="file" accept=".csv" onChange={importCsv} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-md bg-[#5470e8] px-5 py-2.5 font-bold text-white"><RefreshCw className="mr-2 inline h-5 w-5" />Обновить с excel</button>
          <button type="button" onClick={exportCsv} className="rounded-md bg-[#6ccd8b] px-5 py-2.5 font-bold text-white"><Download className="mr-2 inline h-5 w-5" />Скачать EXCEL</button>
          <button type="button" onClick={() => setAddOpen(true)} className="rounded-md bg-[#6ccd8b] px-5 py-2.5 font-bold text-white"><PlusCircle className="mr-2 inline h-5 w-5" />Добавить зарплату</button>
        </div>
      </header>

      <section className="bg-white shadow">
        <div className="grid grid-cols-3">{["Не зачислено", "Зачислено", "Все"].map((item) => <button key={item} type="button" onClick={() => { setTab(item); setPage(1) }} className={`py-4 ${tab === item ? "border-b-4 border-[#5470e8]" : ""}`}>{item}</button>)}</div>
        <div className="flex flex-wrap items-end gap-5 border-t px-2 py-2">
          <label className="text-xs font-medium text-slate-500">
            Месяц
            <div className="mt-1 flex items-center gap-2 border-b py-1 pr-1">
              <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="bg-white text-base font-semibold text-slate-800 outline-none">
                {months.map((item, index) => <option key={item} value={index}>{item}</option>)}
              </select>
              <button type="button" aria-label="Очистить месяц" onClick={() => setMonth(today.getMonth())} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          </label>
          <label className="text-xs font-medium text-slate-500">Год<select value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block border-0 border-b py-2 text-base font-semibold text-slate-800">{[2025, 2026, 2027].map((item) => <option key={item}>{item}</option>)}</select></label>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="ml-auto w-80 border-0 border-b px-0 py-2" />
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option>10</option><option>25</option><option>50</option></select>
          <span>{filtered.length ? `${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, filtered.length)} из ${filtered.length}` : "0 из 0"}</span>
          <button type="button" aria-label="Назад" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-full border-2 p-1 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Вперед" disabled={page === pages} onClick={() => setPage((value) => value + 1)} className="rounded-full border-2 p-1 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          <ListChecks className="text-slate-500" />
          <button type="button" disabled={!selected.length} onClick={() => setCredited(true)} className="rounded bg-[#6ccd8b] px-5 py-2 font-bold text-white disabled:opacity-50">Зачислить</button>
          <button type="button" disabled={!selected.length} onClick={() => setCredited(false)} className="rounded bg-[#ff786e] px-5 py-2 font-bold text-white disabled:opacity-50">Отменить зачисление</button>
          <button type="button" disabled={!selected.length} onClick={() => setPlansOpen(true)} className="rounded bg-[#5470e8] px-5 py-2 font-bold text-white disabled:opacity-50"><Pencil className="mr-2 inline h-4 w-4" />Изменить планы</button>
          <button type="button" aria-label="Копировать выбранные" onClick={() => { if (selected.length) setRows((current) => [...current, ...current.filter((row) => selected.includes(row.id)).map((row, index) => ({ ...row, id: Date.now() + index, employee: `${row.employee} — копия` }))]); setMessage("Выбранные строки скопированы") }}><Copy /></button>
        </div>
        {message && <div className="flex justify-between bg-blue-50 px-5 py-2 text-blue-700">{message}<button type="button" onClick={() => setMessage("")}>×</button></div>}
        <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead className="bg-slate-600 text-white"><tr><th className="px-6 py-5"><input type="checkbox" checked={shown.length > 0 && shown.every((row) => selected.includes(row.id))} onChange={(event) => setSelected(event.target.checked ? shown.map((row) => row.id) : [])} /></th><th className="px-5 py-5 text-left">Сотрудник</th><th className="px-5 py-5 text-right">Зарплата</th><th className="px-5 py-5 text-right">Сумма бонусов</th><th className="px-5 py-5 text-right">Итоговая зарплата</th><th className="px-5 py-5 text-right">KPI</th></tr></thead><tbody>{shown.map((row) => <tr key={row.id} className="border-b"><td className="px-6 py-4"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleSelected(row.id)} /></td><td className="px-5 py-4">{row.employee}</td><td className="px-5 py-4 text-right">{row.salary.toLocaleString("ru-RU")}</td><td className="px-5 py-4 text-right">{row.bonus.toLocaleString("ru-RU")}</td><td className="px-5 py-4 text-right">{(row.salary + row.bonus).toLocaleString("ru-RU")}</td><td className="px-5 py-4 text-right">{row.kpi}%</td></tr>)}</tbody></table></div>
        {!shown.length && <div className="flex min-h-[345px] flex-col items-center justify-center"><Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority /><p className="mt-6 text-slate-400">По вашему запросу ничего не найдено</p></div>}
      </section>
      {addOpen && <SalaryModal title="Добавить зарплату" onClose={() => setAddOpen(false)} onSave={(employee, salary, kpi) => { setRows((current) => [...current, { id: Date.now(), employee, salary, bonus: 0, kpi, credited: false }]); setAddOpen(false); setMessage("Зарплата добавлена") }} />}
      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} onSave={(salary, kpi) => { setRows((current) => current.map((row) => selected.includes(row.id) ? { ...row, salary, kpi } : row)); setPlansOpen(false); setMessage("Планы обновлены") }} />}
    </main>
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
