"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
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
  toggleOrdering,
} from "@/components/analytics/settings-list-kit"
import { FilterLink } from "@/components/staff/staff-kit"
import { LinkoMultiField, LinkoSingleField, type LinkoOption } from "@/components/ref/linko-select-fields"
import { RI, RefAppliedFilter, RefFilterPanel, RefImportDialog } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Сотрудники" (Linko #/users, Settings → Персонал; API main/crud/): Активный / Удаленные tabs, "+ Добавить пользователя",
// Excel import, filter, grid № | Сотрудник | Логин | Права доступа (+ time restrictions in red) | Телефон | Должность | Статус
// on Linko's 12-column grid (1 2 2 2 2 1 1 + the ✎ / 🗑 column), the list-check icon switches to bulk selection
// (Изменить / Обновить с excel), the ⊖ icon blocks everyone («Заблокирован» under the status). Like Linko the state lives
// in the URL: ?isActive=false, page, pageSize, search, ordering, the filters (position, branch, border, price_list, job,
// division, supervisor: ids joined by "-"; hasSupervisor), openFilterDialog, showCheckboxes / select, openCreateDialog,
// id=<employee>&openUpdateDialog | openDeleteDialog, excelImportCreateDialog, excelImportDialog, openBulkUpdate and
// openLimitAccessDialog.

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

/** Linko's col-xs-1 / col-xs-2 row (8 columns: the last one holds ✎ / 🗑). */
const COLS = "1fr 2fr 2fr 2fr 2fr 1fr 1fr 1fr"
/** Linko pads the grid 30 px on both sides; with the checkboxes the header starts at 50 px and the rows at 55 px. */
const ROW_PAD = { normal: "pl-[30px] pr-[30px]", head: "pl-[50px] pr-[30px]", select: "pl-[55px] pr-[30px]" }

const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const EYE_OFF = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"
const MINUS_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"
const BOX_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const BOX_OFF = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"

/** The multi filters, by Linko's URL / API key. */
const MULTI_KEYS = ["position", "branch", "border", "price_list", "job", "division", "supervisor"] as const
type MultiKey = (typeof MULTI_KEYS)[number]
type Filters = Record<MultiKey, string[]> & { hasSupervisor: "" | "true" | "false" }
const NO_FILTERS: Filters = { position: [], branch: [], border: [], price_list: [], job: [], division: [], supervisor: [], hasSupervisor: "" }

type ListDialog = "import" | "update" | "bulk" | "block"
const LIST_DIALOG_PARAM: Record<ListDialog, string> = { import: "excelImportCreateDialog", update: "excelImportDialog", bulk: "openBulkUpdate", block: "openLimitAccessDialog" }
type RowDialog = { kind: "create" } | { kind: "update" | "delete"; id: number } | null

type ViewState = { active: boolean; search: string; page: number; pageSize: number; ordering: string[]; filters: Filters; filterOpen: boolean; selectMode: boolean; selected: number[] }

const positiveInt = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
const idsOf = (value: string | null) => (value ?? "").split("-").filter((id) => /^\d{1,9}$/.test(id))

function stateFromParams(params: URLSearchParams): ViewState {
  const filters = { ...NO_FILTERS }
  for (const key of MULTI_KEYS) filters[key] = idsOf(params.get(key))
  const has = params.get("hasSupervisor")
  filters.hasSupervisor = has === "true" || has === "false" ? has : ""
  return {
    active: params.get("isActive") !== "false",
    search: params.get("search") ?? "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
    ordering: (params.get("ordering") ?? "").split(",").filter((key) => /^-?(id|first_name)$/.test(key)),
    filters,
    filterOpen: params.get("openFilterDialog") === "true",
    selectMode: params.get("showCheckboxes") === "true",
    selected: idsOf(params.get("select")).map(Number),
  }
}

function rowDialogFromParams(params: URLSearchParams): RowDialog {
  if (params.get("openCreateDialog") === "true") return { kind: "create" }
  const id = positiveInt(params.get("id"), 0)
  if (!id) return null
  if (params.get("openUpdateDialog") === "true") return { kind: "update", id }
  if (params.get("openDeleteDialog") === "true") return { kind: "delete", id }
  return null
}

function listDialogFromParams(params: URLSearchParams): ListDialog | null {
  return (Object.keys(LIST_DIALOG_PARAM) as ListDialog[]).find((key) => params.get(LIST_DIALOG_PARAM[key]) === "true") ?? null
}

function urlSearch(state: ViewState, dialog: RowDialog, listDialog: ListDialog | null): string {
  const params = new URLSearchParams()
  if (!state.active) params.set("isActive", "false")
  params.set("page", String(state.page))
  params.set("pageSize", String(state.pageSize))
  if (state.search) params.set("search", state.search)
  if (state.ordering.length) params.set("ordering", state.ordering.join(","))
  for (const key of MULTI_KEYS) if (state.filters[key].length) params.set(key, state.filters[key].join("-"))
  if (state.filters.hasSupervisor) params.set("hasSupervisor", state.filters.hasSupervisor)
  if (state.filterOpen) params.set("openFilterDialog", "true")
  if (state.selectMode) params.set("showCheckboxes", "true")
  if (state.selected.length) params.set("select", state.selected.join("-"))
  if (dialog?.kind === "create") params.set("openCreateDialog", "true")
  if (dialog && dialog.kind !== "create") {
    params.set("id", String(dialog.id))
    params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
  }
  if (listDialog) params.set(LIST_DIALOG_PARAM[listDialog], "true")
  return params.toString()
}

/** Linko's (Postgres) name order: case and spaces ignored; equal names by id, in both directions (its ordering=first_name). */
const nameCollator = new Intl.Collator("en", { ignorePunctuation: true })
function sortEmployees(rows: Employee[], ordering: string[]): Employee[] {
  if (!ordering.length) return rows
  return [...rows].sort((a, b) => {
    for (const key of ordering) {
      const desc = key.startsWith("-")
      const field = desc ? key.slice(1) : key
      const diff = field === "id" ? a.id - b.id : nameCollator.compare(a.firstName, b.firstName)
      if (diff) return desc ? -diff : diff
    }
    return a.id - b.id
  })
}

/** Linko's 24 px row checkbox of the selection mode. */
function RowCheck({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onChange} className="absolute left-[20px] top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={checked ? BOX_ON : BOX_OFF} /></svg>
    </button>
  )
}

const named = (list: Array<{ id: number; name: string }>): LinkoOption[] => list.map((item) => ({ value: String(item.id), label: item.name }))

export function EmployeesView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [options, setOptions] = useState<EmployeeOptions | null>(null)
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [dialog, setDialog] = useState<RowDialog>(() => rowDialogFromParams(searchParams))
  const [dialogs, setDialogs] = useState<ListDialog | null>(() => listDialogFromParams(searchParams))
  const [draft, setDraft] = useState<Filters>(state.filters)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  // What the signed-in user may do (buttons they cannot use are hidden; the API checks again):
  // changes need settings.manage; blocking everyone and setting logins / passwords an administrator.
  const [access, setAccess] = useState<{ manage: boolean; admin: boolean; employeeId: number | null }>({ manage: false, admin: false, employeeId: null })
  const update = useCallback((patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch })), [])
  const closeNotice = useCallback(() => setNotice(null), [])

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/employees", { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setEmployees((await response.json()) as Employee[])
    } catch {
      setEmployees([])
    }
  }, [])
  const loadOptions = useCallback(() => {
    void fetch("/api/employees/options", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<EmployeeOptions>) : null))
      .then((data) => data && setOptions(data))
      .catch(() => undefined)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { loadOptions() }, [loadOptions])
  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string; permissions?: string[] | null; employeeId?: number | null }>) : null))
      .then((me) => {
        if (!me) return
        const admin = me.role === "admin"
        setAccess({ admin, manage: admin || (me.role === "manager" && (me.permissions == null || me.permissions.includes("settings.manage"))), employeeId: me.employeeId ?? null })
      })
      .catch(() => undefined)
  }, [])

  // Linko keeps the list, its filter and the open dialog in the URL.
  useEffect(() => {
    const search = urlSearch(state, dialog, dialogs)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state, dialog, dialogs])

  const { filters, ordering, pageSize, selectMode } = state
  const filtered = useMemo(() => {
    const needle = state.search.trim().toLowerCase()
    const any = (ids: number[], wanted: string[]) => wanted.length === 0 || ids.some((id) => wanted.includes(String(id)))
    const one = (id: number | null, wanted: string[]) => wanted.length === 0 || (id !== null && wanted.includes(String(id)))
    const rows = (employees ?? []).filter((employee) => {
      if (employee.active !== state.active) return false
      if (needle && !`${employee.id} ${employee.name} ${employee.login ?? ""} ${employee.phone}`.toLowerCase().includes(needle)) return false
      if (!one(employee.accessRightId, filters.position)) return false
      if (!any(employee.branchIds, filters.branch)) return false
      if (!any(employee.zoneIds ?? [], filters.border)) return false
      if (!any(employee.priceListIds, filters.price_list)) return false
      if (!one(employee.jobId, filters.job)) return false
      if (!any(employee.organizationIds, filters.division)) return false
      if (!one(employee.supervisorId, filters.supervisor)) return false
      if (filters.hasSupervisor === "true" && !employee.supervisorId) return false
      if (filters.hasSupervisor === "false" && employee.supervisorId) return false
      return true
    })
    return sortEmployees(rows, ordering)
  }, [employees, state.active, state.search, filters, ordering])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(state.page, pageCount)
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize)
  const from = filtered.length ? (page - 1) * pageSize + 1 : 1
  const to = Math.min(page * pageSize, filtered.length)
  const filterCount = MULTI_KEYS.filter((key) => filters[key].length > 0).length + (filters.hasSupervisor ? 1 : 0)
  const selected = state.selected
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const hasSelection = selected.length > 0
  const byId = useMemo(() => new Map((employees ?? []).map((employee) => [employee.id, employee])), [employees])
  const editing = dialog && dialog.kind !== "create" ? (byId.get(dialog.id) ?? null) : null

  // The filter's «Организация» lists the organizations of the signed-in user's own employee card, as Linko does.
  const ownOrganizations = access.employeeId ? byId.get(access.employeeId)?.organizationIds : undefined
  const filterOptions = useMemo(() => {
    if (!options) return null
    const ownOrgs = new Set(ownOrganizations ?? [])
    return {
      position: named(options.accessRights),
      branch: named(options.branches),
      border: named(options.zones),
      price_list: named([...options.priceLists].sort((a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id)),
      job: named(options.jobs),
      division: named(ownOrgs.size ? options.organizations.filter((item) => ownOrgs.has(item.id)) : options.organizations),
      supervisor: named(options.employees),
    } satisfies Record<MultiKey, LinkoOption[]>
  }, [options, ownOrganizations])

  function openFilter() {
    setDraft(filters)
    update({ filterOpen: true })
  }
  function applyFilters() {
    update({ filters: draft, filterOpen: false, page: 1 })
  }
  function toggleSelected(id: number) {
    update({ selected: selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id] })
  }
  function togglePage() {
    const ids = rows.map((employee) => employee.id)
    const all = ids.length > 0 && ids.every((id) => selectedSet.has(id))
    update({ selected: all ? selected.filter((id) => !ids.includes(id)) : [...selected, ...ids.filter((id) => !selectedSet.has(id))] })
  }
  function switchTab(active: boolean) {
    update({ active, page: 1, selected: [] })
  }

  async function remove(employee: Employee) {
    try {
      const response = await fetch(`/api/employees/${employee.id}${employee.active ? "" : "?permanent=1"}`, { method: "DELETE" })
      if (!response.ok) {
        // 409 with the usage list while documents still reference the employee (labels are i18n keys).
        const body = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
        const usage = body.usage?.map((item) => `${t(item.label)}: ${item.count}`).join(", ")
        notify(`${t(body.error || "Не удалось удалить сотрудника")}${usage ? ` (${usage})` : ""}`)
        return
      }
      setDialog(null)
      setNotice({ text: "Успешно удалено", tone: "success" })
      await load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
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
          // Only a whole positive № names an employee (a stray cell would otherwise fail the whole file).
          return { ...(/^\d{1,9}$/.test(record.id ?? "") && Number(record.id) > 0 ? { id: Number(record.id) } : {}), firstName: record.firstName ?? "", lastName: record.lastName ?? "", phone: record.phone ?? "", job: record.job ?? "", branch: record.branch ?? "", integrationCode: record.integrationCode ?? "" }
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

  const sort = (field: string) => update({ ordering: toggleOrdering(ordering, field), page: 1 })
  const tabClass = (on: boolean) =>
    `h-[32px] overflow-hidden rounded-[5px] px-[16px] text-[13px] uppercase leading-[28px] ${on ? "bg-[#1E4A9A] text-white [box-shadow:0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : "bg-white text-black [box-shadow:inset_0_0_2px_rgba(0,0,0,0.12),inset_0_0_2px_rgba(0,0,0,0.12)]"}`

  return (
    <div className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <div className="relative flex h-[73px] items-center justify-between border-b border-[#efefef] pl-[20px] pr-[60px]">
        {access.manage ? (
          <button type="button" onClick={() => setDialog({ kind: "create" })} className="flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] pl-[12px] leading-[30px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="relative top-[1.5px] mr-[8px] h-[24px] w-[24px] shrink-0 fill-white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
            {t("Добавить пользователя")}
          </button>
        ) : <span />}
        <div className="flex items-center gap-[18px]">
          {access.manage && (
            <button type="button" onClick={() => setDialogs("import")} className="flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] pl-[12px] leading-[30px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95">
              <svg viewBox="0 0 24 24" className="relative top-[1.5px] mr-[8px] h-[24px] w-[24px] shrink-0 fill-white"><path d={RI.chart} /></svg>
              {t("Импортировать")}
            </button>
          )}
          <div className="flex h-[32px]">
            <button type="button" onClick={() => switchTab(true)} className={tabClass(state.active)}>{t("Активный")}</button>
            <button type="button" onClick={() => switchTab(false)} className={tabClass(!state.active)}>{t("Удаленные")}</button>
          </div>
          {access.admin && (
            <button type="button" onClick={() => setDialogs("block")} aria-label={t("Ограничить доступ")} title={t("Ограничить доступ")} data-tip-side="left" className="absolute right-[20px] top-[23.5px] flex h-[25px] w-[30px] items-start justify-center">
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]"><path d={MINUS_CIRCLE} /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="relative h-[60px] pt-[10px]">
        <div className={`flex h-[50px] items-center pr-[18px] ${hasSelection ? "bg-[#f2f5f8]" : ""}`}>
          {hasSelection ? (
            <span className="w-[360.25px] pl-[5px] text-[13px] font-bold">{t("Выбрано")}: {selected.length}</span>
          ) : (
            <>
              <div className="w-[360.25px]">
                {filterCount > 0 ? (
                  <RefAppliedFilter width={263.4} pad={10} count={filterCount} onEdit={openFilter} onClear={() => { setDraft(NO_FILTERS); update({ filters: NO_FILTERS, page: 1 }) }} />
                ) : (
                  <span className="block pl-[5px]"><FilterLink onClick={() => (state.filterOpen ? update({ filterOpen: false }) : openFilter())} /></span>
                )}
              </div>
              <label className="group/search relative -mt-[2px] block h-[48px] w-[300px]">
                <input value={state.search} onChange={(event) => update({ search: event.target.value, page: 1 })} placeholder={t("Поиск")} className="relative h-full w-full bg-transparent pr-[34px] text-[13px] leading-[24px] outline-none placeholder:text-black/30" />
                <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-px bg-[#e0e0e0]" />
                <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-transform duration-[450ms] group-focus-within/search:scale-x-100" />
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[273.9px] top-[12px] h-[24px] w-[24px] fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
              </label>
            </>
          )}
          <div className="ml-auto flex items-center">
            <PageSizeSelect numberClassName="text-[#333]" value={pageSize} onChange={(size) => update({ pageSize: size, page: 1 })} />
            {selectMode && !hasSelection ? (
              <span className="ml-[40px] flex h-[34px] items-center rounded-[3px] bg-[#4a4a4a] px-[20px] text-[13px] font-semibold text-white">{t("Выбрать из списка")}</span>
            ) : (
              <>
                <span className="ml-[27px] mr-[10px] leading-[16.25px] text-[#5d6474]">{from} - {to} {t("из")} {filtered.length}</span>
                <span className="flex gap-[5px]"><PagerArrow dir="prev" onClick={page > 1 ? () => update({ page: page - 1 }) : undefined} />
                <PagerArrow dir="next" onClick={page < pageCount ? () => update({ page: page + 1 }) : undefined} /></span>
              </>
            )}
            {hasSelection && (
              <>
                <button type="button" onClick={() => setDialogs("update")} className="ml-[29px] h-[30px] rounded-[3px] bg-[#1E4A9A] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">{t("Обновить с excel")}</button>
                <button type="button" onClick={() => setDialogs("bulk")} className="ml-[9px] flex h-[30px] items-center rounded-[3px] bg-[#1E4A9A] pl-[14px] pr-[18px] text-[13px] font-semibold text-white hover:brightness-95">
                  <svg viewBox="0 0 24 24" className="mr-[8px] h-[16px] w-[16px] fill-white"><path d={RI.edit} /></svg>
                  {t("Изменить")}
                </button>
              </>
            )}
            {access.manage && (
              <button
                type="button"
                onClick={() => (hasSelection ? update({ selected: [] }) : update({ selectMode: !selectMode, selected: [] }))}
                aria-label={hasSelection ? t("Снять выделение") : t("Выбрать из списка")}
                className="ml-[32px] flex h-6 w-6 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={hasSelection ? MINUS_BOX : selectMode ? EYE_OFF : RI.checklist} /></svg>
              </button>
            )}
          </div>
        </div>
        {state.filterOpen && filterOptions && (
          <div className="absolute left-0 top-[11px] z-30">
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => update({ filterOpen: false })} onApply={applyFilters}>
              {([
                ["position", "Права доступа"],
                ["branch", "Филиалы"],
                ["border", "Зона"],
                ["price_list", "Прайс лист"],
                ["job", "Должность"],
                ["division", "Организация"],
                ["supervisor", "Супервайзер"],
              ] as const).map(([key, label]) => (
                <LinkoMultiField key={key} label={label} options={filterOptions[key]} value={draft[key]} onChange={(next) => setDraft((current) => ({ ...current, [key]: next }))} />
              ))}
              <LinkoSingleField label="Есть супервайзер" options={[{ value: "true", label: t("Да") }, { value: "false", label: t("Нет") }]} value={draft.hasSupervisor} onChange={(next) => setDraft((current) => ({ ...current, hasSupervisor: next === "true" || next === "false" ? next : "" }))} />
              <div className="h-[6px]" />
            </RefFilterPanel>
          </div>
        )}
      </div>

      <div className={`${kitHead} relative !bg-[#5d6474] ${selectMode ? ROW_PAD.head : ROW_PAD.normal}`} style={{ gridTemplateColumns: COLS }}>
        {selectMode && (
          <button type="button" onClick={togglePage} aria-label={t("Выбрать все")} className="absolute left-[20px] top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={SELECT_ALL} /></svg>
          </button>
        )}
        <SortHead className="!font-semibold" label="№" field="id" ordering={ordering} onSort={sort} />
        <span className="px-[8px]"><SortHead className="!font-semibold" label={t("Сотрудник")} field="first_name" ordering={ordering} onSort={sort} /></span>
        <span className="px-[8px]">{t("Логин")}</span>
        <span className="px-[8px]">{t("Права доступа")}</span>
        <span className="px-[8px]">{t("Телефон")}</span>
        <span className="px-[8px]">{t("Должность")}</span>
        <span className="px-[8px]">{t("Статус")}</span>
      </div>
      {rows.map((employee) => {
        const login = employee.active ? employee.login : t("Не указано")
        const checked = selectedSet.has(employee.id)
        return (
          <div key={employee.id} className={`group relative grid min-h-[50px] items-center py-px after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8] ${checked ? "bg-[#f2f5f8]" : ""} ${selectMode ? ROW_PAD.select : ROW_PAD.normal}`} style={{ gridTemplateColumns: COLS }}>
            {selectMode && <RowCheck checked={checked} onChange={() => toggleSelected(employee.id)} label={`${t("Выбрать")} ${employee.id}`} />}
            <span className="pr-[8px] leading-[16px]">{employee.id}</span>
            <span className="min-w-0 break-words px-[8px] leading-[16px]">{employee.name}</span>
            {/* A login that signs in nobody (older rows, or saved without a password) shows the login alone, as Linko does;
                the hover says so. */}
            <span className="min-w-0 break-words px-[8px] leading-[16px]" title={employee.active && employee.login && !employee.account ? t("Нет учетной записи") : login}>{login}</span>
            <span className="flex min-w-0 flex-col px-[8px] leading-[16px]">
              <span>{employee.accessRight || t("Не выбрано")}</span>
              {(employee.accesses ?? []).length > 0 && (
                <span className="block">
                  {(employee.accesses ?? []).map((name) => <span key={name} className="mr-[5px] text-[#f00]">{name}</span>)}
                </span>
              )}
            </span>
            <span className="min-w-0 break-words px-[8px] leading-[16px]">{employee.phone || "-"}</span>
            <span className="min-w-0 truncate px-[8px] leading-[16px]" title={employee.job || undefined}>{employee.job || t("Не указана")}</span>
            <span className="px-[8px] leading-[16px]">
              {employee.active ? (
                <>
                  {t("Активный")}
                  {/* «Ограничить доступ сотрудника» blocked the employee (Linko's is_blocked). */}
                  {!employee.systemAccess && <span className="block text-[11px] text-[#e57373]">{t("Заблокирован")}</span>}
                </>
              ) : t("Неактивный")}
            </span>
            <span />
            {access.manage && <RowActions right={75} gap={6} onEdit={() => setDialog({ kind: "update", id: employee.id })} onDelete={() => setDialog({ kind: "delete", id: employee.id })} />}
          </div>
        )
      })}
      {employees && rows.length === 0 && <EmptyRows />}

      {(dialog?.kind === "create" || (dialog?.kind === "update" && editing)) && options && (
        <EmployeeDialog
          key={editing?.id ?? "new"}
          employee={dialog.kind === "update" ? editing : null}
          options={options}
          canManageAccounts={access.admin}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); setNotice({ text: "Успешно сохранено", tone: "success" }); void load(); loadOptions() }}
        />
      )}
      {dialog?.kind === "delete" && editing && <ConfirmDeleteDialog name={editing.name} onConfirm={() => void remove(editing)} onClose={() => setDialog(null)} />}
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
      {dialogs === "bulk" && options && <BulkChangeDialog ids={selected} options={options} onClose={() => setDialogs(null)} onDone={() => { setDialogs(null); update({ selected: [] }); void load() }} />}
      {dialogs === "block" && <BlockAllDialog onClose={() => setDialogs(null)} onDone={() => { setDialogs(null); setNotice({ text: "Успешно сохранено", tone: "success" }); void load() }} />}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </div>
  )
}
