"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { BlockAllDialog, BulkChangeDialog } from "@/components/analytics/employees-bulk-dialogs"
import { EmployeeDialog } from "@/components/analytics/employees-dialog"
import type { Employee, EmployeeOptions } from "@/components/analytics/employees-data"
import {
  ConfirmDeleteDialog,
  EmptyRows,
  PageSizeSelect,
  PagerArrow,
  RowActions,
  SortHead,
  kitHead,
  sortRows,
  toggleOrdering,
} from "@/components/analytics/settings-list-kit"
import { FilterPick, Check, FilterChip, FilterLink, type Option } from "@/components/staff/staff-kit"
import { RI, RefFilterPanel, RefImportDialog } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Сотрудники" (demo #/users, Settings → Персонал; API main/crud/): Активный / Удаленные tabs, "+ Добавить пользователя",
// Excel import, filter, grid № | Сотрудник | Логин | Права доступа (+ time restrictions in red) | Телефон | Должность | Статус,
// ✎ / 🗑 on hover, the list-check icon switches to bulk selection (Изменить / Обновить с excel), the ⊖ icon blocks everyone.

const IMPORT_ALIASES: Record<string, string> = {
  "№": "id", id: "id",
  "имя": "firstName", "first name": "firstName",
  "фамилия": "lastName", "last name": "lastName",
  "телефон": "phone", phone: "phone",
  "должность": "job", position: "job", job: "job",
  "филиал": "branch", "филиалы": "branch", branch: "branch",
  "код для интеграции": "integrationCode", "integration code": "integrationCode",
}
const TEMPLATE = ["Имя", "Фамилия", "Телефон", "Должность", "Филиал", "Код для интеграции"]

const COLS = "139px 203px 202px 202px 203px 101px 1fr"
const COLS_SELECT = "162px 199px 198px 198px 198px 99px 1fr"

const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const EYE_OFF = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"
const MINUS_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"

type Filters = { accessRight: string; branch: string; zone: string; priceList: string; job: string; organization: string; supervisor: string; hasSupervisor: string }
const NO_FILTERS: Filters = { accessRight: "", branch: "", zone: "", priceList: "", job: "", organization: "", supervisor: "", hasSupervisor: "" }

const named = (list: Array<{ id: number; name: string }>): Option[] => list.map((item) => ({ value: String(item.id), label: item.name }))

export function EmployeesView() {
  const { t } = useLanguage()
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [options, setOptions] = useState<EmployeeOptions | null>(null)
  const [tab, setTab] = useState<"active" | "deleted">("active")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [ordering, setOrdering] = useState<string[]>([])
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<{ employee: Employee | null } | null>(null)
  const [deleting, setDeleting] = useState<Employee | null>(null)
  const [dialogs, setDialogs] = useState<null | "import" | "update" | "bulk" | "block">(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/employees", { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setEmployees((await response.json()) as Employee[])
    } catch {
      setEmployees([])
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void fetch("/api/employees/options", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<EmployeeOptions>) : null))
      .then(setOptions)
      .catch(() => undefined)
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = (employees ?? []).filter((employee) => {
      if (employee.active !== (tab === "active")) return false
      if (needle && !`${employee.id} ${employee.name} ${employee.login} ${employee.phone}`.toLowerCase().includes(needle)) return false
      if (filters.accessRight && String(employee.accessRightId) !== filters.accessRight) return false
      if (filters.branch && !employee.branchIds.includes(Number(filters.branch))) return false
      if (filters.priceList && !employee.priceListIds.includes(Number(filters.priceList))) return false
      if (filters.job && String(employee.jobId) !== filters.job) return false
      if (filters.organization && !employee.organizationIds.includes(Number(filters.organization))) return false
      if (filters.supervisor && String(employee.supervisorId) !== filters.supervisor) return false
      if (filters.hasSupervisor === "yes" && !employee.supervisorId) return false
      if (filters.hasSupervisor === "no" && employee.supervisorId) return false
      if (filters.zone) return false
      return true
    })
    return sortRows(rows, ordering, { id: (employee) => employee.id, first_name: (employee) => employee.firstName.toLowerCase() })
  }, [employees, tab, query, filters, ordering])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const from = filtered.length ? (safePage - 1) * pageSize + 1 : 1
  const to = Math.min(safePage * pageSize, filtered.length)
  const filterCount = Object.values(filters).filter(Boolean).length
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const hasSelection = selected.length > 0

  function applyFilters() {
    setFilters(draft)
    setFilterOpen(false)
    setPage(1)
  }
  function toggleSelected(id: number) {
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }
  function togglePage() {
    const ids = rows.map((employee) => employee.id)
    const all = ids.length > 0 && ids.every((id) => selectedSet.has(id))
    setSelected((current) => (all ? current.filter((id) => !ids.includes(id)) : [...current, ...ids.filter((id) => !selectedSet.has(id))]))
  }
  function switchTab(next: "active" | "deleted") {
    setTab(next)
    setPage(1)
    setSelected([])
  }

  async function remove(employee: Employee) {
    const response = await fetch(`/api/employees/${employee.id}${employee.active ? "" : "?permanent=1"}`, { method: "DELETE" })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      notify(t(body.error || "Не удалось удалить сотрудника"))
      return
    }
    setDeleting(null)
    await load()
  }

  async function runImport(mode: "create" | "update") {
    if (!importFile) return
    setImporting(true)
    try {
      const sheet = await readExcelRows(importFile)
      if (!sheet.length) return notify(t("Не удалось найти сотрудников для импорта в выбранном файле"))
      const fieldByIndex = mapHeaderColumns(sheet[0], IMPORT_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("firstName")
      const body = (hasHeader ? sheet.slice(1) : sheet)
        .map((row) => {
          const record: Record<string, string> = {}
          row.forEach((cell, index) => {
            const field = hasHeader ? fieldByIndex.get(index) : (["firstName", "lastName", "phone", "job", "branch", "integrationCode"] as const)[index]
            if (field) record[field] = String(cell ?? "").trim()
          })
          return { ...(record.id ? { id: Number(record.id) } : {}), firstName: record.firstName ?? "", lastName: record.lastName ?? "", phone: record.phone ?? "", job: record.job ?? "", branch: record.branch ?? "", integrationCode: record.integrationCode ?? "" }
        })
        .filter((row) => row.firstName || row.id)
      if (!body.length) return notify(t("Не удалось найти сотрудников для импорта в выбранном файле"))
      const response = await fetch("/api/employees/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, rows: body }) })
      const result = (await response.json().catch(() => ({}))) as { saved?: number; errors?: Array<{ row: number; message: string }>; error?: string }
      if (!response.ok) return notify(t(result.error || "Не удалось импортировать сотрудников"))
      if (result.errors?.length) notify(`${t("Сохранено")}: ${result.saved ?? 0} ${t("из")} ${body.length}\n${result.errors.slice(0, 10).map((item) => `${item.row}: ${t(item.message)}`).join("\n")}`)
      setDialogs(null)
      setImportFile(null)
      await load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setImporting(false)
    }
  }

  const cols = selectMode ? COLS_SELECT : COLS
  const head = (label: string) => <span>{t(label)}</span>

  return (
    <div className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <div className="flex h-[72px] items-center justify-between border-b border-[#efefef] pl-[20px] pr-[61px] pt-[3px]">
        <button type="button" onClick={() => setDialog({ employee: null })} className="flex h-[30px] items-center rounded-[3px] bg-[#4f71dc] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="mr-[12px] h-[18px] w-[18px] fill-white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          {t("Добавить пользователя")}
        </button>
        <div className="flex items-center gap-[18px]">
          <button type="button" onClick={() => setDialogs("import")} className="flex h-[30px] items-center rounded-[3px] bg-[#4f71dc] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="mr-[12px] h-[18px] w-[18px] fill-white"><path d={RI.chart} /></svg>
            {t("Импортировать")}
          </button>
          <div className="flex h-[32px] overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.15)]">
            <button type="button" onClick={() => switchTab("active")} className={`w-[104px] text-[13px] font-medium uppercase ${tab === "active" ? "bg-[#4f71dc] text-white" : "bg-white text-black"}`}>{t("Активный")}</button>
            <button type="button" onClick={() => switchTab("deleted")} className={`w-[109px] text-[13px] font-medium uppercase ${tab === "deleted" ? "bg-[#4f71dc] text-white" : "bg-white text-black"}`}>{t("Удаленные")}</button>
          </div>
          <button type="button" onClick={() => setDialogs("block")} aria-label={t("Ограничить доступ")} title={t("Ограничить доступ")} className="absolute right-[24px]">
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#555]"><path d={MINUS_CIRCLE} /></svg>
          </button>
        </div>
      </div>

      <div className="relative flex h-[61px] items-center pr-[18px] pt-[10px]">
        {hasSelection ? (
          <span className="pl-[5px] text-[13px] font-bold">{t("Выбрано")}: {selected.length}</span>
        ) : selectMode ? null : (
          <>
            <div className="w-[335px] pl-[5px]">
              {filterCount > 0 ? (
                <FilterChip count={filterCount} onEdit={() => { setDraft(filters); setFilterOpen(true) }} onClear={() => { setFilters(NO_FILTERS); setDraft(NO_FILTERS); setPage(1) }} />
              ) : (
                <FilterLink onClick={() => { setDraft(filters); setFilterOpen((open) => !open) }} />
              )}
            </div>
            <label className="relative w-[295px] border-b border-[#e0e0e0] focus-within:border-[#5d6474] focus-within:shadow-[0_1px_0_#5d6474]">
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="h-[30px] w-full bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc]" />
              <svg viewBox="0 0 24 24" className="absolute right-1 top-[4px] h-[20px] w-[20px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            </label>
          </>
        )}
        <div className="ml-auto flex items-center">
          <PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setPage(1) }} />
          {selectMode && !hasSelection ? (
            <span className="ml-[40px] flex h-[34px] items-center rounded-[3px] bg-[#4a4a4a] px-[20px] text-[13px] font-semibold text-white">{t("Выбрать из списка")}</span>
          ) : (
            <>
              <span className="ml-[33px] mr-[10px]">{from} - {to} {t("из")} {filtered.length}</span>
              <span className="flex gap-[5px]"><PagerArrow dir="prev" onClick={safePage > 1 ? () => setPage(safePage - 1) : undefined} />
              <PagerArrow dir="next" onClick={safePage < pageCount ? () => setPage(safePage + 1) : undefined} /></span>
            </>
          )}
          {hasSelection && (
            <>
              <button type="button" onClick={() => setDialogs("update")} className="ml-[29px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">{t("Обновить с excel")}</button>
              <button type="button" onClick={() => setDialogs("bulk")} className="ml-[9px] flex h-[30px] items-center rounded-[3px] bg-[#4f71dc] pl-[14px] pr-[18px] text-[13px] font-semibold text-white hover:brightness-95">
                <svg viewBox="0 0 24 24" className="mr-[8px] h-[16px] w-[16px] fill-white"><path d={RI.edit} /></svg>
                {t("Изменить")}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => { if (hasSelection) setSelected([]); else { setSelectMode((current) => !current); setSelected([]) } }}
            aria-label={t("Выбрать из списка")}
            title={hasSelection ? t("Снять выделение") : t("Выбрать из списка")}
            className="ml-[31px] flex h-6 w-6 items-center justify-center"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={hasSelection ? MINUS_BOX : selectMode ? EYE_OFF : RI.checklist} /></svg>
          </button>
        </div>
        {filterOpen && (
          <div className="absolute left-0 top-[11px] z-30">
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={applyFilters}>
              <FilterPick label={t("Права доступа")} value={draft.accessRight} options={named(options?.accessRights ?? [])} onChange={(accessRight) => setDraft((d) => ({ ...d, accessRight }))} />
              <FilterPick label={t("Филиалы")} value={draft.branch} options={named(options?.branches ?? [])} onChange={(branch) => setDraft((d) => ({ ...d, branch }))} />
              <FilterPick label={t("Зона")} value={draft.zone} options={named(options?.zones ?? [])} onChange={(zone) => setDraft((d) => ({ ...d, zone }))} />
              <FilterPick label={t("Прайс лист")} value={draft.priceList} options={named(options?.priceLists ?? [])} onChange={(priceList) => setDraft((d) => ({ ...d, priceList }))} />
              <FilterPick label={t("Должность")} value={draft.job} options={named(options?.jobs ?? [])} onChange={(job) => setDraft((d) => ({ ...d, job }))} />
              <FilterPick label={t("Организация")} value={draft.organization} options={named(options?.organizations ?? [])} onChange={(organization) => setDraft((d) => ({ ...d, organization }))} />
              <FilterPick label={t("Супервайзер")} value={draft.supervisor} options={named(options?.employees ?? [])} onChange={(supervisor) => setDraft((d) => ({ ...d, supervisor }))} />
              <FilterPick label={t("Есть супервайзер")} value={draft.hasSupervisor} options={[{ value: "yes", label: t("Да") }, { value: "no", label: t("Нет") }]} onChange={(hasSupervisor) => setDraft((d) => ({ ...d, hasSupervisor }))} />
              <div className="h-[6px]" />
            </RefFilterPanel>
          </div>
        )}
      </div>

      <div className={`${kitHead} !bg-[#5d6474]`} style={{ gridTemplateColumns: cols }}>
        <span className="flex items-center pl-[22px]">
          {selectMode && (
            <button type="button" onClick={togglePage} aria-label={t("Выбрать все")} className="mr-[6px] flex h-6 w-6 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={SELECT_ALL} /></svg>
            </button>
          )}
          <span className={selectMode ? "" : "pl-[8px]"}><SortHead label="№" field="id" ordering={ordering} onSort={(field) => setOrdering(toggleOrdering(ordering, field))} /></span>
        </span>
        <SortHead label={t("Сотрудник")} field="first_name" ordering={ordering} onSort={(field) => setOrdering(toggleOrdering(ordering, field))} />
        {head("Логин")}
        {head("Права доступа")}
        {head("Телефон")}
        {head("Должность")}
        {head("Статус")}
      </div>
      {rows.map((employee) => (
        <div key={employee.id} className="group relative grid min-h-[50px] items-center py-px after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8]" style={{ gridTemplateColumns: cols }}>
          <span className="flex items-center pl-[22px]">
            {selectMode && <span className="mr-[6px] shrink-0"><Check checked={selectedSet.has(employee.id)} onChange={() => toggleSelected(employee.id)} /></span>}
            <span className={selectMode ? "" : "pl-[8px]"}>{employee.id}</span>
          </span>
          <span className="min-w-0 break-words pr-3 leading-[16px]">{employee.name}</span>
          <span className="min-w-0 break-words pr-3 leading-[16px]">{employee.active ? employee.login : t("Не указано")}</span>
          <span className="min-w-0 pr-6 leading-[16px]">
            {employee.accessRight || t("Не выбрано")}
            {employee.accesses.length > 0 && (
              <span className="flex items-end text-[#f00]">
                {employee.accesses.map((name, index) => <span key={name} className={index === 0 ? "min-w-0 pr-[4px]" : "shrink-0 whitespace-nowrap"}>{name}</span>)}
              </span>
            )}
          </span>
          <span className="min-w-0 break-words pr-3 leading-[16px]">{employee.phone || "-"}</span>
          <span className="min-w-0 truncate pr-2" title={employee.job}>{employee.job}</span>
          <span>{employee.active ? t("Активный") : t("Неактивный")}</span>
          <RowActions right={64} gap={8} onEdit={() => setDialog({ employee })} onDelete={() => setDeleting(employee)} />
        </div>
      ))}
      {employees && rows.length === 0 && <EmptyRows />}

      {dialog && options && (
        <EmployeeDialog
          key={dialog.employee?.id ?? "new"}
          employee={dialog.employee}
          options={options}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load(); void fetch("/api/employees/options", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((data) => data && setOptions(data)) }}
        />
      )}
      {deleting && <ConfirmDeleteDialog name={`${t("Сотрудник")}: ${deleting.name}`} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
      {dialogs === "import" && (
        <RefImportDialog
          file={importFile}
          onFile={setImportFile}
          onTemplate={() => downloadExcelTable("employees-template", [TEMPLATE.map((label) => t(label))])}
          onSave={() => void runImport("create")}
          onClose={() => { setDialogs(null); setImportFile(null) }}
          saving={importing}
        />
      )}
      {dialogs === "update" && (
        <RefImportDialog
          file={importFile}
          onFile={setImportFile}
          onTemplate={() => downloadExcelTable("employees-update", [["№", ...TEMPLATE].map((label) => t(label)), ...(employees ?? []).filter((employee) => selectedSet.has(employee.id)).map((employee) => [String(employee.id), employee.firstName, employee.lastName, employee.phone, employee.job, "", employee.integrationCode])])}
          onSave={() => void runImport("update")}
          onClose={() => { setDialogs(null); setImportFile(null) }}
          saving={importing}
        />
      )}
      {dialogs === "bulk" && options && <BulkChangeDialog ids={selected} options={options} onClose={() => setDialogs(null)} onDone={() => { setDialogs(null); setSelected([]); void load() }} />}
      {dialogs === "block" && <BlockAllDialog onClose={() => setDialogs(null)} onDone={() => { setDialogs(null); void load() }} />}
    </div>
  )
}
