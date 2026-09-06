"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { BarChart3, ChevronLeft, ChevronRight, FileText, ListChecks, MinusCircle, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { employeeBranches as branches, employeeOrganizations as organizations, employeePositions as positions, type Employee } from "./employees-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "имя": "firstName", "first name": "firstName",
  "фамилия": "lastName", "last name": "lastName",
  "телефон": "phone", "phone": "phone",
  "должность": "position", "position": "position",
  "филиал": "branch", "branch": "branch",
  "код для интеграции": "integrationCode", "integration code": "integrationCode",
}

type Draft = {
  firstName: string
  lastName: string
  phone: string
  integrationCode: string
  position: string
  branch: string
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  organizations: string[]
}

function emptyDraft(): Draft {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    integrationCode: "",
    position: positions[0],
    branch: branches[0],
    systemAccess: true,
    showInTracking: true,
    twoStepCheck: false,
    sessionLimit: false,
    gpsCheck: true,
    startPoint: false,
    organizations: [],
  }
}

function draftToInput(draft: Draft, active = true) {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    phone: draft.phone.trim(),
    integrationCode: draft.integrationCode,
    position: draft.position,
    branch: draft.branch,
    systemAccess: draft.systemAccess,
    showInTracking: draft.showInTracking,
    twoStepCheck: draft.twoStepCheck,
    sessionLimit: draft.sessionLimit,
    gpsCheck: draft.gpsCheck,
    startPoint: draft.startPoint,
    organizations: draft.organizations,
    active,
  }
}

export function EmployeesView() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<"active" | "deleted">("active")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selectMode, setSelectMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [editing, setEditing] = useState<Employee | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/employees")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить сотрудников")
        return (await response.json()) as Employee[]
      })
      .then((data) => {
        if (cancelled) return
        setEmployees(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить сотрудников с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      employees
        .filter((employee) => (tab === "active" ? employee.active : !employee.active))
        .filter((employee) => `${employee.id} ${employee.name} ${employee.login} ${employee.phone}`.toLowerCase().includes(query.toLowerCase())),
    [employees, tab, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleChecked(id: number) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function patchEmployee(employee: Employee, patch: Partial<Employee>) {
    const merged = { ...employee, ...patch }
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: merged.firstName,
          lastName: merged.lastName,
          phone: merged.phone,
          integrationCode: merged.integrationCode,
          position: merged.position,
          branch: merged.branch,
          systemAccess: merged.systemAccess,
          showInTracking: merged.showInTracking,
          twoStepCheck: merged.twoStepCheck,
          sessionLimit: merged.sessionLimit,
          gpsCheck: merged.gpsCheck,
          startPoint: merged.startPoint,
          organizations: merged.organizations,
          active: merged.active,
        }),
      })
      if (!response.ok) return
      const saved = (await response.json()) as Employee
      setEmployees((current) => current.map((item) => (item.id === saved.id ? saved : item)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function bulkDeactivate() {
    if (!checkedIds.length) {
      setSelectMode((value) => !value)
      return
    }
    checkedIds.forEach((id) => {
      const employee = employees.find((item) => item.id === id)
      if (employee) void patchEmployee(employee, { active: false })
    })
    setCheckedIds([])
  }

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(employee: Employee) {
    setDraft({
      firstName: employee.firstName,
      lastName: employee.lastName,
      phone: employee.phone,
      integrationCode: employee.integrationCode,
      position: employee.position || positions[0],
      branch: employee.branch || branches[0],
      systemAccess: employee.systemAccess,
      showInTracking: employee.showInTracking,
      twoStepCheck: employee.twoStepCheck,
      sessionLimit: employee.sessionLimit,
      gpsCheck: employee.gpsCheck,
      startPoint: employee.startPoint,
      organizations: employee.organizations,
    })
    setEditing(employee)
  }

  function remove(id: number) {
    const employee = employees.find((item) => item.id === id)
    if (employee) void patchEmployee(employee, { active: false })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.phone.trim()) return
    setSaving(true)
    try {
      if (editing !== "new" && editing) {
        const response = await fetch(`/api/employees/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToInput(draft, editing.active)),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить сотрудника")
          return
        }
        const saved = (await response.json()) as Employee
        setEmployees((current) => current.map((employee) => (employee.id === editing.id ? saved : employee)))
      } else {
        const response = await fetch("/api/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToInput(draft)),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать сотрудника")
          return
        }
        const saved = (await response.json()) as Employee
        setEmployees((current) => [saved, ...current])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function toggleOrganization(org: string) {
    setDraft((current) => ({ ...current, organizations: current.organizations.includes(org) ? current.organizations.filter((item) => item !== org) : [...current.organizations, org] }))
  }

  function downloadTemplate() {
    downloadExcelTable("employees-template", [["Имя", "Фамилия", "Телефон", "Должность", "Филиал"]])
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
        window.alert("Не удалось найти сотрудников для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("firstName")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: Draft[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.firstName = row[0] ?? ""
          record.lastName = row[1] ?? ""
          record.phone = row[2] ?? ""
          record.position = row[3] ?? ""
          record.branch = row[4] ?? ""
        }
        if (!record.firstName || /^(имя|first name)$/i.test(record.firstName)) continue
        parsed.push({
          ...emptyDraft(),
          firstName: record.firstName,
          lastName: record.lastName || "",
          phone: record.phone || "",
          position: record.position || positions[0],
          branch: record.branch || branches[0],
          integrationCode: record.integrationCode || "",
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти сотрудников для импорта в выбранном файле")
        return
      }

      const created: Employee[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/employees", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draftToInput(item)),
          })
          if (response.ok) created.push((await response.json()) as Employee)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setEmployees((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
          <PlusCircle className="h-4 w-4" /> Добавить пользователя
        </button>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <BarChart3 className="h-4 w-4" /> Импортировать
          </button>
          <div className="flex overflow-hidden rounded border border-[#4f70e7]">
            <button type="button" onClick={() => { setTab("active"); setPage(1) }} className={`px-5 py-2.5 text-sm font-bold uppercase ${tab === "active" ? "bg-[#4f70e7] text-white" : "text-[#4f70e7]"}`}>
              Активный
            </button>
            <button type="button" onClick={() => { setTab("deleted"); setPage(1) }} className={`px-5 py-2.5 text-sm font-bold uppercase ${tab === "deleted" ? "bg-[#4f70e7] text-white" : "text-[#4f70e7]"}`}>
              Удаленные
            </button>
          </div>
          <button type="button" onClick={bulkDeactivate} aria-label="Деактивировать выбранных" title={selectMode ? "Деактивировать выбранных" : "Выбрать сотрудников"} className={`rounded-full p-1 ${selectMode ? "text-red-500" : "text-slate-400"} hover:text-red-500`}>
            <MinusCircle className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-3">
        <span className="text-[#4f70e7]">Показать фильтр⌄</span>
        <label className="relative w-64">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
          <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
        </label>
        <span className="ml-auto text-slate-500">25</span>
        <span className="text-slate-500">
          {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
        </span>
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
          <ChevronLeft className="h-5 w-5 text-slate-400" />
        </button>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>
        <ListChecks className="h-5 w-5 text-slate-400" />
      </div>

      {loadError && <p className="px-5 pb-3 text-sm text-red-500">{loadError}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {selectMode && <th className="w-10 px-5 py-5" />}
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Сотрудник</th>
              <th className="px-5 py-5">Логин</th>
              <th className="px-5 py-5">Права доступа</th>
              <th className="px-5 py-5">Телефон</th>
              <th className="px-5 py-5">Должность</th>
              <th className="px-5 py-5">Статус</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {visible.map((employee) => (
              <tr key={employee.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                {selectMode && (
                  <td className="px-5 py-4">
                    <input type="checkbox" checked={checkedIds.includes(employee.id)} onChange={() => toggleChecked(employee.id)} />
                  </td>
                )}
                <td className="px-9 py-4">{employee.id}</td>
                <td className="px-5 py-4">{employee.name}</td>
                <td className="px-5 py-4">{employee.login}</td>
                <td className="px-5 py-4">
                  {employee.role}
                  {employee.extraPermission && (
                    <>
                      <br />
                      <span className="text-red-500">{employee.extraPermission}</span>
                    </>
                  )}
                </td>
                <td className="px-5 py-4">{employee.phone}</td>
                <td className="px-5 py-4">{employee.position}</td>
                <td className="px-5 py-4">
                  <span className={employee.active ? "text-[#6ccd8b]" : "text-slate-400"}>{employee.active ? "Активный" : "Удален"}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(employee)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(employee.id)} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={selectMode ? 9 : 8} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить сотрудника" : "Изменить сотрудника"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid gap-6 md:grid-cols-[1fr_190px]">
                <div className="space-y-5">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Имя <span className="text-red-500">*</span>
                    <input required value={draft.firstName} onChange={(event) => setDraft((value) => ({ ...value, firstName: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Фамилия <span className="text-red-500">*</span>
                    <input required value={draft.lastName} onChange={(event) => setDraft((value) => ({ ...value, lastName: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Телефон <span className="text-red-500">*</span>
                    <input required value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Код для интеграции
                    <input value={draft.integrationCode} onChange={(event) => setDraft((value) => ({ ...value, integrationCode: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>
                <div className="flex h-[135px] flex-col items-center justify-center gap-2 self-start border-2 border-dashed border-slate-200 text-center text-sm text-slate-400">
                  <FileText className="h-6 w-6" />
                  Добавьте фото
                </div>
              </div>

              <div className="mt-5 grid gap-6 md:grid-cols-2">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Должность <span className="text-red-500">*</span>
                  <select value={draft.position} onChange={(event) => setDraft((value) => ({ ...value, position: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                    {positions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Филиалы <span className="text-red-500">*</span>
                  <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                    {branches.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-6 flex flex-wrap gap-8">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={draft.systemAccess} onChange={(event) => setDraft((value) => ({ ...value, systemAccess: event.target.checked }))} className="h-5 w-5" />
                  Доступ к системе
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={draft.showInTracking} onChange={(event) => setDraft((value) => ({ ...value, showInTracking: event.target.checked }))} className="h-5 w-5" />
                  Показывать в отслеживании
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={draft.twoStepCheck} onChange={(event) => setDraft((value) => ({ ...value, twoStepCheck: event.target.checked }))} className="h-5 w-5" />
                  Двухэтапная проверка
                </label>
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={draft.sessionLimit} onChange={(event) => setDraft((value) => ({ ...value, sessionLimit: event.target.checked }))} className="h-5 w-5" />
                Поставить ограничения на сессию (может работать только на одном устройстве)
              </label>

              <label className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDraft((value) => ({ ...value, gpsCheck: !value.gpsCheck }))}
                  className={`h-6 w-11 rounded-full transition-colors ${draft.gpsCheck ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                >
                  <span className={`block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform ${draft.gpsCheck ? "translate-x-[22px]" : ""}`} />
                </button>
                <span className={`text-sm font-semibold ${draft.gpsCheck ? "text-[#4f70e7]" : "text-slate-600"}`}>Проверка GPS включена</span>
              </label>

              <label className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDraft((value) => ({ ...value, startPoint: !value.startPoint }))}
                  className={`h-6 w-11 rounded-full transition-colors ${draft.startPoint ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                >
                  <span className={`block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform ${draft.startPoint ? "translate-x-[22px]" : ""}`} />
                </button>
                <span className="text-sm">
                  Указать исходную точку
                  <br />
                  <span className="text-xs text-slate-400">Для автоматического формирования маршрута</span>
                </span>
              </label>

              <p className="mb-3 mt-6 text-sm italic text-slate-500">
                Организации<span className="text-red-500">*</span>
              </p>
              <div className="grid max-h-64 gap-x-6 gap-y-2 overflow-y-auto border-t pt-3 sm:grid-cols-3">
                {organizations.map((org, index) => (
                  <label key={`${org}-${index}`} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.organizations.includes(org)} onChange={() => toggleOrganization(org)} />
                    <span className="truncate">{org}</span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с Excel</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
