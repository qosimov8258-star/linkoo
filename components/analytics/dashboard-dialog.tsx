"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { FileText, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { notify } from "@/lib/notify"

type NamedItem = { id: number; name: string }

const NAME_ALIASES: Record<string, string> = {
  "наименование": "name",
  "название": "name",
  "имя": "name",
  "фио": "name",
  "сотрудник": "name",
  "доступ": "name",
  "название доступа": "name",
}

export function DashboardDialog({
  reportSlug,
  reportLabel,
  visibility,
  setVisibility,
  dashboard,
  setDashboard,
  onClose,
  onSave,
}: {
  /** Stable identifier for the report this widget represents (e.g. the analytics slug) — used to persist and later restore its dashboard visibility assignment. */
  reportSlug: string
  reportLabel?: string
  visibility: string
  setVisibility: (value: string) => void
  dashboard: string
  setDashboard: (value: string) => void
  onClose: () => void
  onSave?: () => void
}) {
  const { t } = useLanguage()
  const [dashboards, setDashboards] = useState<string[]>([])
  const [employees, setEmployees] = useState<NamedItem[]>([])
  const [accessRights, setAccessRights] = useState<NamedItem[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])
  const [selectedAccessIds, setSelectedAccessIds] = useState<number[]>([])
  const [pickerType, setPickerType] = useState<"employees" | "access">("employees")
  const [search, setSearch] = useState("")
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  // The reference shows the select empty ("Дашборд" as the bold label) until a dashboard is picked.
  const [picked, setPicked] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Fetched once, up front, so the Excel-import button works immediately
  // regardless of which visibility radio is selected — the user shouldn't
  // have to pick "Выбранным сотрудникам"/"Выбранным доступам" first.
  useEffect(() => {
    fetch("/api/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { id: number; name: string }[]) => setEmployees(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setEmployees([]))
    fetch("/api/custom-dashboards")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name: string }[]) => setDashboards(rows.map((row) => row.name)))
      .catch(() => setDashboards([]))
    fetch("/api/access-rights")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { id: number; name: string }[]) => setAccessRights(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setAccessRights([]))
  }, [])

  // Restore a previously saved assignment for this report+dashboard, so
  // reopening the dialog shows what was actually saved last time instead
  // of resetting to blank.
  useEffect(() => {
    if (!reportSlug) return
    fetch(`/api/dashboard-widgets?reportSlug=${encodeURIComponent(reportSlug)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((widgets: { dashboard: string; visibility: string; employeeIds: number[]; accessRightIds: number[] }[]) => {
        const existing = widgets.find((widget) => widget.dashboard === dashboard)
        if (!existing) return
        setVisibility(existing.visibility)
        setSelectedEmployeeIds(existing.employeeIds)
        setSelectedAccessIds(existing.accessRightIds)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportSlug, dashboard])

  const list = pickerType === "employees" ? employees : accessRights
  const selectedIds = pickerType === "employees" ? selectedEmployeeIds : selectedAccessIds
  const setSelectedIds = pickerType === "employees" ? setSelectedEmployeeIds : setSelectedAccessIds

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? list.filter((item) => item.name.toLowerCase().includes(needle)) : list
  }, [list, search])

  function toggle(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  function toggleAll() {
    setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map((item) => item.id))
  }

  function downloadTemplate() {
    const label = pickerType === "employees" ? "Сотрудник" : "Название доступа"
    downloadExcelTable(pickerType === "employees" ? "shablon_sotrudnikov" : "shablon_dostupov", [[label]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) void importFromExcel(file)
  }

  async function importFromExcel(file: File) {
    setImporting(true)
    try {
      const rows = await readExcelRows(file)
      if (!rows.length) {
        notify("Не удалось найти данные в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], NAME_ALIASES)
      let nameIndex = 0
      let hasHeader = false
      for (const [index, field] of fieldByIndex) {
        if (field === "name") {
          nameIndex = index
          hasHeader = true
          break
        }
      }
      const dataRows = hasHeader ? rows.slice(1) : rows
      const names = dataRows.map((row) => (row[nameIndex] ?? "").trim()).filter(Boolean)
      if (!names.length) {
        notify("Не удалось найти данные в выбранном файле")
        return
      }
      const byName = new Map(list.map((item) => [item.name.trim().toLowerCase(), item.id]))
      const matchedIds: number[] = []
      let unmatched = 0
      for (const name of names) {
        const id = byName.get(name.toLowerCase())
        if (id !== undefined) matchedIds.push(id)
        else unmatched += 1
      }
      setSelectedIds((current) => Array.from(new Set([...current, ...matchedIds])))
      if (unmatched) notify(`Добавлено ${matchedIds.length} из ${names.length}. Не найдено: ${unmatched}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      className="fixed left-1/2 top-1/2 z-[100] flex max-h-[calc(100vh-32px)] min-h-[min(517px,calc(100vh-32px))] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col bg-white shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]"
    >
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e0e0e0] px-[30px]">
        <h2 className="text-[13px] font-bold uppercase text-[#333]"><span data-no-translate>Добавить в дашборд</span></h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555]">
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-[60px] pb-[30px] pt-[35px]">
        <fieldset>
          {[
            ["all", "Все"],
            ["employees", "Выбранным сотрудникам"],
            ["access", "Выбранным доступам"],
          ].map(([value, label]) => (
            <label key={value} className="flex h-[34px] cursor-pointer items-center text-[13px] text-[#333]">
              <span className={`mr-[18px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2 ${visibility === value ? "border-[#9aa0aa]" : "border-[#222]"}`}>
                {visibility === value && <span className="h-[10px] w-[10px] rounded-full bg-[#5d6474]" />}
              </span>
              <input type="radio" checked={visibility === value} onChange={() => setVisibility(value)} className="sr-only" />
              {/* The reference prints these radio labels in Russian whatever the language. */}
              <span data-no-translate>{label}</span>
            </label>
          ))}
        </fieldset>

        {visibility !== "all" && (
        <div className="mt-6 rounded border border-slate-200">
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => setPickerType("employees")}
              className={`flex-1 px-3 py-2 text-sm font-semibold ${pickerType === "employees" ? "bg-[#4f71dc] text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              Сотрудники
            </button>
            <button
              type="button"
              onClick={() => setPickerType("access")}
              className={`flex-1 px-3 py-2 text-sm font-semibold ${pickerType === "access" ? "bg-[#4f71dc] text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              Доступы
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск"
                className="min-w-[140px] flex-1 border-b border-slate-300 py-1.5 text-sm outline-none focus:border-[#4f71dc]"
              />
              <button type="button" onClick={toggleAll} className="text-sm font-semibold text-[#4f71dc] hover:underline">
                {selectedIds.length === filtered.length && filtered.length > 0 ? "Снять всё" : "Выбрать всё"}
              </button>
              <button type="button" onClick={downloadTemplate} className="text-sm font-semibold text-[#4f71dc] hover:underline">
                Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
              >
                <FileText className="h-4 w-4" /> {importing ? "Импорт..." : "Импорт с Excel"}
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.map((item) => (
                <label key={item.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0 hover:bg-slate-50">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />
                  {item.name}
                </label>
              ))}
              {filtered.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Ничего не найдено</p>}
            </div>
            {selectedIds.length > 0 && <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">Выбрано: {selectedIds.length}</p>}
        </div>
        )}

        <label className="relative mt-[27px] block h-[40px] border-b border-[#d5dae1]">
          <span className={`pointer-events-none absolute left-0 ${picked ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`} data-no-translate>Дашборд</span>
          <select
            value={dashboard}
            onChange={(event) => {
              setPicked(true)
              setDashboard(event.target.value)
            }}
            className={`absolute inset-x-0 bottom-0 h-[26px] w-full appearance-none bg-transparent text-[13px] outline-none ${picked ? "" : "text-transparent"}`}
          >
            {["Основной дашборд", ...dashboards.filter((name) => name !== "Основной дашборд")].map((name) => (
              <option key={name} data-no-translate className="text-black">{name}</option>
            ))}
          </select>
          <svg viewBox="0 0 10 5" className="pointer-events-none absolute bottom-[10px] right-[2px] h-[5px] w-[10px] fill-[#757575]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
        </label>
      </div>
      <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e0e0e0] px-[30px]">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true)
            fetch("/api/dashboard-widgets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reportSlug,
                reportLabel: reportLabel ?? reportSlug,
                dashboard,
                visibility,
                employeeIds: selectedEmployeeIds,
                accessRightIds: selectedAccessIds,
              }),
            })
              .then((response) => {
                if (!response.ok) throw new Error()
                onSave?.()
                onClose()
              })
              .catch(() => notify("Не удалось сохранить, попробуйте ещё раз"))
              .finally(() => setSaving(false))
          }}
          className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50"
        >
          {saving ? t("Сохранение...") : t("Сохранить")}
        </button>
      </footer>
    </section>
  )
}
