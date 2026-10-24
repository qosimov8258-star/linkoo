"use client"

import Image from "next/image"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { Copy, FileText, X } from "lucide-react"
import { FilterSelect, RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefTabs } from "@/components/ref/list-kit"
import { RefPager } from "@/components/ref/pager-controls"
import { SalaryAddDialog } from "@/components/analytics/salary-add-dialog"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { notify } from "@/lib/notify"

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
  period?: string
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
  const [impMonth, setImpMonth] = useState(today.getMonth())
  const [impYear, setImpYear] = useState(today.getFullYear())
  const [impOrg, setImpOrg] = useState("")
  const [impCur, setImpCur] = useState("")
  const [orgOptions, setOrgOptions] = useState<string[]>([])
  const [curOptions, setCurOptions] = useState<string[]>([])
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!importOpen || orgOptions.length) return
    fetch("/api/organizations").then((response) => (response.ok ? response.json() : [])).then((data: Array<{ name?: string }>) => setOrgOptions([...new Set(data.map((item) => item.name ?? "").filter(Boolean))])).catch(() => {})
    fetch("/api/currencies").then((response) => (response.ok ? response.json() : [])).then((data: Array<{ name?: string }>) => setCurOptions(data.map((item) => item.name ?? "").filter(Boolean))).catch(() => {})
  }, [importOpen, orgOptions.length])

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
        if (!cancelled) notify("Не удалось загрузить зарплаты с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!row.period || row.period === `${year}-${String(month + 1).padStart(2, "0")}`) &&
          (tab === "Все" || (tab === "Зачислено" ? row.credited : !row.credited)) &&
          row.employee.toLowerCase().includes(query.toLowerCase()),
      ),
    [rows, tab, query, month, year],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  function toggleSelected(id: number) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function setCredited(credited: boolean) {
    const targets = rows.filter((row) => selected.includes(row.id))
    if (!targets.length) return
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
    if (failed) notify(`Не удалось обновить записей: ${failed}`)
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
      if (failed) notify(`Не удалось пересчитать записей: ${failed}`)
      setMessage("KPI пересчитан")
    } finally {
      setRecalculating(false)
    }
  }

  async function addSalaries(entries: Array<{ employee: string; salary: number }>) {
    const created: SalaryRow[] = []
    let failed = 0
    for (const entry of entries) {
      try {
        const response = await fetch("/api/salary-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee: entry.employee, salary: entry.salary, bonus: 0, kpi: 0, credited: false, period: `${year}-${String(month + 1).padStart(2, "0")}` }),
        })
        if (response.ok) created.push((await response.json()) as SalaryRow)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (created.length) setRows((current) => [...current, ...created])
    if (failed) notify(`Не удалось добавить записей: ${failed}`)
    else if (created.length) setMessage(`Добавлено сотрудников: ${created.length}`)
    setAddOpen(false)
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
    if (failed) notify(`Не удалось обновить записей: ${failed}`)
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
    if (failed) notify(`Не удалось скопировать записей: ${failed}`)
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
    if (failed) notify(`Не удалось импортировать записей: ${failed}`)
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
        notify("Не удалось найти данные для импорта в выбранном файле")
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
        notify("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: SalaryRow[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/salary-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee: item.employee, salary: item.salary, bonus: 0, kpi: item.kpi, credited: false, period: `${impYear}-${String(impMonth + 1).padStart(2, "0")}` }),
          })
          if (response.ok) created.push((await response.json()) as SalaryRow)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...current, ...created])
      setMessage(`Импортировано сотрудников: ${created.length}`)
      if (failed) notify(`Не удалось импортировать записей: ${failed}`)
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
        <div className="mr-[9px] flex items-center gap-[33px]">
          <RefButton exact green label="Перерасчет KPI" onClick={() => void recalcKpi()} />
          <RefButton exact icon={RI.sync} label="Обновить с excel" onClick={() => setImportOpen(true)} />
          <RefButton exact icon={RI.download} green label="Скачать EXCEL" onClick={exportCsv} />
          <RefButton exact icon={RI.add} green label="Добавить зарплату" onClick={() => setAddOpen(true)} />
        </div>
      </RefHeader>

      <RefCard className="bg-white">
        <RefTabs labels={["Не зачислено", "Зачислено", "Все"]} value={tab} onChange={(value) => { setTab(value); setPage(1) }} />
        <div className="relative flex h-[50px] items-center whitespace-nowrap px-[5px]">
          <label className="absolute left-[5px] top-0 block h-[50px] w-[200px]">
            <span className="absolute left-0 top-[5px] text-[10px] font-bold leading-[12px] text-black">Месяц</span>
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="absolute left-0 top-[27px] h-[26px] w-full appearance-none bg-transparent pr-[40px] text-[13px] text-black outline-none">
              {months.map((item, index) => <option key={item} value={index}>{item}</option>)}
            </select>
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[26px] top-[29px] h-5 w-5 fill-black/30"><path d={RI.close} /></svg>
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[27px] h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
          </label>
          <label className="absolute left-[205px] top-0 block h-[50px] w-[100px]">
            <span className="absolute left-0 top-[11px] text-[10px] font-bold leading-[12px] text-black">Год</span>
            <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="absolute left-0 top-[29px] h-[26px] w-full appearance-none bg-transparent text-[13px] text-black outline-none">
              {[2025, 2026, 2027].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="absolute left-[377.5px] top-0 flex h-12 w-[300px] items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder="Поиск"
              className="h-12 w-[262px] bg-transparent text-[13px] outline-none placeholder:text-black/30"
            />
            <svg viewBox="0 0 24 24" className="ml-[12px] h-6 w-6 shrink-0 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </div>
          <div className="relative z-10 ml-auto flex shrink-0 items-center text-[#5d6474]">
            <RefPager
              pageSize={pageSize}
              onPageSize={(size) => { setPageSize(size); setPage(1) }}
              from={filtered.length ? (page - 1) * pageSize + 1 : 1}
              to={Math.min(page * pageSize, filtered.length)}
              total={filtered.length}
              page={page}
              pageCount={pages}
              onPage={setPage}
            />
            <span className="ml-5 flex h-12 w-12 shrink-0 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.checklist} /></svg></span>
            <div className="flex shrink-0 items-center gap-[18px]">
              <RefButton exact green label="Зачислить" onClick={() => void setCredited(true)} />
              <RefButton exact red label="Отменить зачисление" onClick={() => void setCredited(false)} />
              <RefButton exact icon={RI.edit} label="Изменить планы" onClick={() => setPlansOpen(true)} />
              <button type="button" aria-label="Копировать выбранные" onClick={() => void duplicateSelected()} className="flex h-12 w-12 items-center justify-center text-[#5d6474]"><Copy className="h-6 w-6" /></button>
            </div>
          </div>
        </div>
        {message && <div className="flex justify-between bg-blue-50 px-5 py-2 text-blue-700">{message}<button type="button" onClick={() => setMessage("")}>×</button></div>}
        <RefTable
          cols="391px 193px 205px 141px minmax(0,1fr)"
          headPad={1}
          heads={["Сотрудник", "Зарплата", "Сумма бонусов", "Итоговая зарплата", "KPI"]}
          rows={shown}
          rowKey={(row) => row.id}
          empty={
            <div className="flex min-h-[276px] flex-col items-center justify-center gap-4">
              <Image src="/robot-empty.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
              <p className="text-[13px] text-[#666]">По вашему запросу ничего не найдено</p>
            </div>
          }
          render={(row) => [
            <label key="e" className="flex items-center gap-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleSelected(row.id)} />{row.employee}</label>,
            row.salary.toLocaleString("ru-RU"),
            row.bonus.toLocaleString("ru-RU"),
            (row.salary + row.bonus).toLocaleString("ru-RU"),
            `${row.kpi}%`,
          ]}
        />
      </RefCard>
      {addOpen && <SalaryAddDialog month={month} year={year} onClose={() => setAddOpen(false)} onSave={addSalaries} />}
      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} onSave={(salary, kpi) => void updatePlans(salary, kpi)} />}
      {importOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-[400px] rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с Excel</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <FilterSelect label="Месяц" value={months[impMonth]} onChange={(value) => setImpMonth(Math.max(0, months.indexOf(value)))} options={months} />
              <FilterSelect label="Год" value={String(impYear)} onChange={(value) => setImpYear(Number(value) || impYear)} options={["2025", "2026", "2027"]} />
              <FilterSelect label="Организация" value={impOrg} onChange={setImpOrg} options={orgOptions} />
              <FilterSelect label="Валюта" value={impCur} onChange={setImpCur} options={curOptions} />
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


function PlansModal({ onClose, onSave }: { onClose: () => void; onSave: (salary: number, kpi: number) => void }) {
  const [salary, setSalary] = useState("0")
  const [kpi, setKpi] = useState("0")
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"><form onSubmit={(event) => { event.preventDefault(); onSave(Number(salary), Number(kpi)) }} className="w-full max-w-lg bg-white"><header className="flex justify-between border-b px-7 py-5"><h2 className="font-bold">ИЗМЕНИТЬ ПЛАНЫ</h2><button type="button" onClick={onClose}><X /></button></header><div className="space-y-5 p-7"><input type="number" min="0" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="Зарплата" className="w-full border-b py-3" /><input type="number" min="0" max="100" value={kpi} onChange={(event) => setKpi(event.target.value)} placeholder="KPI, %" className="w-full border-b py-3" /></div><footer className="flex justify-end border-t px-7 py-5"><button className="font-bold uppercase text-sky-500">Сохранить</button></footer></form></div>
}
