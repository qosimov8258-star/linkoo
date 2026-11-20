"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { Check, CircleStop, CircleUser, Loader2, Pencil, Trash2, Truck, X } from "lucide-react"

import { CashSnackbar, ConfirmDialog, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { PAGE_SIZES, PageSizeSelect, PagerArrow } from "@/components/analytics/settings-list-kit"
import { inventoryDateText } from "@/components/analytics/stock-inventory-shared"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { askDelete } from "@/lib/ask-confirm"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"
import { notify } from "@/lib/notify"
import type { StockInventoryListResult, StockInventoryRow } from "@/lib/stock-inventories-types"
import type { Recipe } from "./batch-detail"
import {
  api,
  Field,
  formatAmount,
  formatDate,
  formatDateTime,
  inputClass,
  ItemLinesEditor,
  ItemPicker,
  Modal,
  SaveButton,
  todayIso,
  useApiData,
  type CatalogItem,
  type DraftLine,
  type Stage,
  type StockItem,
} from "./production-ui"
import { PRODUCTION_WRITE, type Equipment, type StaffMember } from "./stage-tabs"

// Этапы производства → Активность (the reference's #/manufacture/shipment/:id): «Сверить» (the stage
// warehouse's inventory in Склад → Инвентаризация), «Добавить продукт» / «Добавить сырье» (shift entries),
// the period and the filter, and the sub-tabs Обзор / Записи / Смены / Инвентаризация. The period, the
// sub-tab, the filter and the pages live in the address, so a reload, a shared link or another stage
// keeps them. «Смены» lists the workers' shift sessions (the reference's staff/personal_rotation) with
// «Передать на склад»; a supervisor opens and closes them here («Открыть смену» / «Закрыть смену»: Linko's
// workers do it in its mobile app).

type LogRow = {
  id: number
  partyId: number | null
  direction: "made" | "raw"
  key: string
  name: string
  unit: string
  amount: number
  isDefect: boolean
  date: string
  createdAt: string
  shift: string
  worker: string
  equipmentId: number | null
  equipmentName: string
  userName: string
  sessionId: number | null
  /** Its shift session was handed over: no change any more («Уже передан»). */
  transferred: boolean
}
type Activity = {
  made: Array<{ key: string; name: string; unit: string; total: number; ok: number; defect: number }>
  raw: Array<{ key: string; name: string; unit: string; amount: number }>
  logs: LogRow[]
  options: { shifts: string[]; workers: string[] }
}
/** A worker's shift session (GET /api/production/sessions, lib/production-sessions-repo.ts). */
type Session = {
  id: number
  stageId: number
  employeeId: number
  workerName: string
  shiftId: number
  shiftName: string
  openedAt: string
  closedAt: string | null
  isTransferred: boolean
  fromWarehouse: string
}
type SessionList = { count: number; page: number; pageSize: number; results: Session[] }
type WarehouseOption = { id: number; name: string; active?: boolean }
type WorkShift = { id: number; name: string }
type LegacyInventory = {
  id: number
  date: string
  comment: string
  userName: string
  createdAt: string
  lines: Array<{ key: string; name: string; unit: string; expected: number; defects?: number; actual: number; difference: number }>
}
type SubTab = "overview" | "logs" | "shifts" | "inventory"
/** `type`: the reference's «Тип» (Продукт = made, Сырьё = raw). */
type Filters = { shifts: string[]; worker: string; type: "" | "made" | "raw"; equipmentId: string }
type Paging = { page: number; pageSize: number }
type PagerName = "logs" | "shifts" | "inventory"
/** `openShift`: the session whose «Передать на склад» is open (the reference's openShift=<id>, on «Смены» only). */
type ViewState = { from: string; to: string; view: SubTab; filters: Filters; paging: Record<PagerName, Paging>; openShift: number | null }

const EMPTY_FILTERS: Filters = { shifts: [], worker: "", type: "", equipmentId: "" }
const EMPTY_ACTIVITY: Activity = { made: [], raw: [], logs: [], options: { shifts: [], workers: [] } }
const NO_SESSIONS: SessionList = { count: 0, page: 1, pageSize: 25, results: [] }
const NO_WAREHOUSES: WarehouseOption[] = []
const NO_SHIFTS: WorkShift[] = []
const NO_RECIPES: Recipe[] = []
const NO_STOCK: StockItem[] = []
const NO_INVENTORIES: StockInventoryListResult = { count: 0, results: [] }
const NO_LEGACY: LegacyInventory[] = []
const QTY_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"

const SUB_TABS: Array<[SubTab, string, string]> = [
  ["overview", "Обзор", "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"],
  ["logs", "Записи", "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"],
  ["shifts", "Смены", "M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"],
  ["inventory", "Инвентаризация", "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"],
]

// The reference's period label in ru ("01 Окт. 2026"); the other UI languages use the shared formatter.
const MONTHS_CAP = ["Янв.", "Февр.", "Мар.", "Апр.", "Мая", "Июня", "Июля", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]
const capDate = (iso: string, language: LanguageCode) => {
  if (language !== "ru") return formatDate(iso, language)
  const [y, m, d] = iso.split("-")
  return `${d} ${MONTHS_CAP[Number(m) - 1] ?? m} ${y}`
}

// ---------------------------------------------------------------------------
// Address state
// ---------------------------------------------------------------------------

/** Query keys: the reference's beginDate / endDate / logsPage / logsPageSize, and own keys where the stage page
 * already uses the reference's name (`tab` is the stage tab here) or the reference has none. */
const KEY = { from: "beginDate", to: "endDate", view: "actTab", shift: "actShift", worker: "actStaff", type: "actType", equipment: "actEquipment", openShift: "openShift" } as const
const PAGER_KEYS: Record<PagerName, [page: string, size: string]> = {
  logs: ["logsPage", "logsPageSize"],
  shifts: ["shiftsPage", "shiftsPageSize"],
  inventory: ["invPage", "invPageSize"],
}
const DEFAULT_PAGE_SIZE = 25

function dayParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 2000 && year <= 2100 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null
}

/** A page or an id of the address: a positive integer the server accepts (≤ 2147483647, as every id and page there);
 * anything else (a page beyond it answered 400 and left «Смены» loading for ever) counts as absent. */
const MAX_INT = 2147483647
function positiveInt(value: string | null): number | null {
  const number = Number(value)
  return value && Number.isSafeInteger(number) && number > 0 && number <= MAX_INT ? number : null
}

/** The stage the tab showed last: moving to another stage keeps the period, the sub-tab and the filter (as the
 * reference keeps its query), but not the machine filter (machines are the stage's own) and the pages. */
let shownStageId: number | null = null

function readState(stageId: number): ViewState {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)
  const today = todayIso()
  let from = dayParam(params.get(KEY.from)) ?? today
  let to = dayParam(params.get(KEY.to)) ?? today
  if (from > to) [from, to] = [to, from]
  const view = (["logs", "shifts", "inventory"] as const).find((value) => value === params.get(KEY.view)) ?? "overview"
  const switched = shownStageId !== null && shownStageId !== stageId
  const type = params.get(KEY.type)
  const filters: Filters = {
    shifts: uniqueNames(params.getAll(KEY.shift)).slice(0, 50),
    worker: (params.get(KEY.worker) ?? "").trim().slice(0, 255),
    type: type === "made" || type === "raw" ? type : "",
    equipmentId: switched ? "" : String(positiveInt(params.get(KEY.equipment)) ?? ""),
  }
  const paging = {} as Record<PagerName, Paging>
  for (const name of Object.keys(PAGER_KEYS) as PagerName[]) {
    const [pageKey, sizeKey] = PAGER_KEYS[name]
    const size = Number(params.get(sizeKey))
    paging[name] = { page: switched ? 1 : (positiveInt(params.get(pageKey)) ?? 1), pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE }
  }
  // The open «Передать на склад» belongs to the stage and the sub-tab it was opened on.
  const openShift = view === "shifts" && !switched ? positiveInt(params.get(KEY.openShift)) : null
  return { from, to, view, filters, paging, openShift }
}

function writeState(state: ViewState) {
  const params = new URLSearchParams(window.location.search)
  const set = (key: string, value: string) => (value ? params.set(key, value) : params.delete(key))
  // Today (the default) is not written: a link opened tomorrow shows tomorrow, as the reference does.
  const today = todayIso()
  const dated = state.from !== today || state.to !== today
  set(KEY.from, dated ? state.from : "")
  set(KEY.to, dated ? state.to : "")
  set(KEY.view, state.view === "overview" ? "" : state.view)
  params.delete(KEY.shift)
  for (const shift of state.filters.shifts) params.append(KEY.shift, shift)
  set(KEY.worker, state.filters.worker)
  set(KEY.type, state.filters.type)
  set(KEY.equipment, state.filters.equipmentId)
  for (const name of Object.keys(PAGER_KEYS) as PagerName[]) {
    const [pageKey, sizeKey] = PAGER_KEYS[name]
    set(pageKey, state.paging[name].page > 1 ? String(state.paging[name].page) : "")
    set(sizeKey, state.paging[name].pageSize !== DEFAULT_PAGE_SIZE ? String(state.paging[name].pageSize) : "")
  }
  set(KEY.openShift, state.openShift ? String(state.openShift) : "")
  const query = params.toString()
  if (query !== window.location.search.replace(/^\?/, "")) window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
}

const firstPages = (paging: Record<PagerName, Paging>): Record<PagerName, Paging> => ({
  logs: { ...paging.logs, page: 1 },
  shifts: { ...paging.shifts, page: 1 },
  inventory: { ...paging.inventory, page: 1 },
})

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const nameKey = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru")

/** Names without blanks and repeats (case and spacing ignored), in their first order. */
function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = String(value ?? "").trim()
    if (name && !seen.has(nameKey(name))) seen.set(nameKey(name), name)
  }
  return [...seen.values()]
}

/** A typed quantity: digits with one optional decimal point or comma (spaces ignored); NaN otherwise ("12abc", "1e3"). */
function parseQty(text: string): number {
  const value = text.replace(/[\s  ]/g, "").replace(",", ".")
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN
}

/** Escape closes the panel or dialog (app rule) — not while the item picker's open list takes it first. */
function useEscape(onEscape: () => void, active = true) {
  const handler = useRef(onEscape)
  useEffect(() => {
    handler.current = onEscape
  })
  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest(".top-full")) return
      handler.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active])
}

/** True once `useApiData` holds the answer to this very url. The hook raises `loading` only in its own effect, so
 * for one commit after the url changes `loading` is still false while the data is the previous url's: a page clamp
 * that trusted it sent the pager straight back to the page it came from. A failed load is not an answer. */
function useAnswered(url: string | null, loading: boolean, failed: boolean): boolean {
  const [answered, setAnswered] = useState<string | null>(null)
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (loading) asked.current = url
    else if (asked.current === url) setAnswered(url)
  }, [loading, url])
  return url !== null && !loading && !failed && answered === url
}

function pageOf<T>(items: T[], paging: Paging) {
  const pageCount = Math.max(1, Math.ceil(items.length / paging.pageSize))
  const page = Math.min(paging.page, pageCount)
  return { rows: items.slice((page - 1) * paging.pageSize, page * paging.pageSize), page }
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function ActivityTab({ stage, equipment, staff }: { stage: Stage; equipment: Equipment[]; staff: StaffMember[] }) {
  const { t, language } = useLanguage()
  const [state, setState] = useState<ViewState>(() => readState(stage.id))
  const { from, to, view, filters, paging } = state
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [dialog, setDialog] = useState<"made" | "raw" | null>(null)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canWrite = useCanManage(PRODUCTION_WRITE)

  useEffect(() => {
    shownStageId = stage.id
  }, [stage.id])
  useEffect(() => writeState(state), [state])
  useEscape(() => setPeriodOpen(false), periodOpen)

  const setPeriod = useCallback((begin: string, end: string) => setState((current) => ({ ...current, from: begin, to: end, paging: firstPages(current.paging) })), [])
  const setView = (next: SubTab) => setState((current) => ({ ...current, view: next, openShift: next === current.view ? current.openShift : null }))
  const setOpenShift = useCallback((id: number | null) => setState((current) => (current.openShift === id ? current : { ...current, openShift: id })), [])
  const applyFilters = (next: Filters) => setState((current) => ({ ...current, filters: next, paging: firstPages(current.paging) }))
  const setPaging = (name: PagerName, patch: Partial<Paging>) =>
    setState((current) => ({ ...current, paging: { ...current.paging, [name]: { ...current.paging[name], ...patch } } }))
  const closeNotice = useCallback(() => setNotice(null), [])
  const announce = useCallback((text: string) => setNotice({ text, tone: "success" }), [])

  const query = useMemo(() => {
    const params = new URLSearchParams({ stageId: String(stage.id), from, to })
    for (const shift of filters.shifts) params.append("shift", shift)
    if (filters.worker) params.set("worker", filters.worker)
    if (filters.type) params.set("type", filters.type)
    if (filters.equipmentId) params.set("equipmentId", filters.equipmentId)
    return params.toString()
  }, [filters, from, stage.id, to])
  const { data: activity, reload } = useApiData<Activity>(`/api/production/activity?${query}`, EMPTY_ACTIVITY)
  // The reference's «Смена» is a shift of the Смены directory (Настройки → Смены).
  const { data: directory } = useApiData<WorkShift[]>("/api/work-shifts", NO_SHIFTS, { quiet: true })

  const staffNames = useMemo(() => uniqueNames(staff.map((member) => member.employeeName)), [staff])
  const shiftOptions = useMemo(() => uniqueNames([...directory.map((entry) => entry.name), ...activity.options.shifts, ...filters.shifts]), [activity.options.shifts, directory, filters.shifts])
  // Former staff members stay selectable through the records that name them.
  const workerOptions = useMemo(() => uniqueNames([...staffNames, ...activity.options.workers, filters.worker]), [activity.options.workers, filters.worker, staffNames])
  const activeFilters = (filters.shifts.length ? 1 : 0) + (filters.worker ? 1 : 0) + (filters.type ? 1 : 0) + (filters.equipmentId ? 1 : 0)
  const reconcileHref = stage.warehouse.trim() ? `/analytics/inventory?${new URLSearchParams({ openInventoryCreateDialog: "true", pdStock: stage.warehouse.trim() })}` : null

  const logs = pageOf(activity.logs, paging.logs)

  return (
    <div className="font-sans text-[13px] text-[#333]">
      <div className="flex h-[56px] items-center justify-end gap-[10px]">
        {/* As the reference: a link (new browser tab) to Склад → Инвентаризация, the create dialog open for the stage's warehouse. */}
        <ColorLink color="bg-[#fa8072]" icon="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" label="Сверить" href={reconcileHref} />
        {canWrite && (
          <ColorButton color="bg-[#4db6ac]" icon="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" label="Добавить продукт" onClick={() => setDialog("made")} />
        )}
        {canWrite && (
          <ColorButton color="bg-[#1E4A9A]" icon="M10 17l5-5-5-5v10zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" label="Добавить сырье" onClick={() => setDialog("raw")} />
        )}
      </div>

      <div className="relative bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative flex h-[66px] items-center justify-between pl-[30px] pr-[30px]">
          <button type="button" onClick={() => setPeriodOpen((value) => !value)} title={t("Выберите период")} aria-expanded={periodOpen} className="text-[13px] font-bold text-[#1E4A9A]">
            {capDate(from, language)} - {capDate(to, language)}
          </button>
          {periodOpen && (
            // The reference's six presets; a preset (or a day) applies at once and the picker stays open, ✓ closes it.
            <DateRangePicker
              variant="builder"
              begin={from}
              end={to}
              onChange={setPeriod}
              onClose={() => setPeriodOpen(false)}
              onApply={(begin, end) => {
                setPeriod(begin, end)
                setPeriodOpen(false)
              }}
            />
          )}
          <div className="flex items-center gap-[8px]">
            <button type="button" onClick={() => setFilterOpen((value) => !value)} aria-expanded={filterOpen} className="flex h-[34px] items-center rounded-[3px] bg-[#1E4A9A] pl-[8px] pr-[12px] text-[13px] font-bold text-white">
              <svg viewBox="0 0 24 24" className="mr-[4px] h-6 w-6 fill-white" aria-hidden>
                <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
              </svg>
              {t("Фильтр")}
              {activeFilters > 0 && ` / ${activeFilters}`}
            </button>
            {activeFilters > 0 && (
              <button type="button" onClick={() => applyFilters(EMPTY_FILTERS)} aria-label={t("Очистить")} title={t("Очистить")} className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[#e0e0e0] text-[#333] hover:bg-[#d3d3d3]">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {filterOpen && (
          <FilterPanel
            value={filters}
            shiftOptions={shiftOptions}
            workerOptions={workerOptions}
            equipment={equipment}
            active={!dialog}
            onClose={() => setFilterOpen(false)}
            onApply={(next) => {
              applyFilters(next)
              setFilterOpen(false)
            }}
          />
        )}

        {/* The reference's 42 px tabs. Below lg the card is narrower than they are: they scroll inside the bar instead of
            widening the page, 46 px tall there so the scrolling bar does not clip the active tab's underline. */}
        <nav className="flex h-[48px] border-y border-[#efefef] max-lg:overflow-x-auto max-lg:overflow-y-hidden">
          {SUB_TABS.map(([value, label, path]) => (
            <button key={value} type="button" onClick={() => setView(value)} className={`flex h-[48px] shrink-0 items-center whitespace-nowrap border-b-2 px-[42px] text-[13px] max-lg:h-[46px] max-md:px-[20px] ${view === value ? "border-[#1E4A9A] text-[#1E4A9A]" : "border-transparent text-[#333]"}`}>
              <svg viewBox="0 0 24 24" className="mr-[12px] h-[18px] w-[18px]" style={{ fill: view === value ? "#1E4A9A" : "#5d6474" }} aria-hidden>
                <path d={path} />
              </svg>
              {t(label)}
            </button>
          ))}
        </nav>

        <div className="px-[30px] pb-[20px]">
          {view === "overview" && (
            <>
              <SimpleTable
                headers={["Произведено", "Всего", "Ок", "Брак"]}
                widths={["46%", "18%", "18%", "18%"]}
                rows={activity.made.map((line) => [line.name, formatAmount(line.total, line.unit), formatAmount(line.ok, line.unit), formatAmount(line.defect, line.unit)])}
                empty="Продукции еще не произведены"
              />
              <SimpleTable headers={["Затраченное сырье", "Кол-во"]} widths={["70%", "30%"]} rows={activity.raw.map((line) => [line.name, formatAmount(line.amount, line.unit)])} empty="Не затрачено сырья" />
            </>
          )}
          {view === "logs" &&
            (activity.logs.length ? (
              <>
                <Pager total={activity.logs.length} page={logs.page} pageSize={paging.logs.pageSize} onChange={(patch) => setPaging("logs", patch)} />
                <LogsTable rows={logs.rows} canWrite={canWrite} onChanged={reload} onNotice={announce} />
              </>
            ) : (
              <EmptyState text="Нет записей в данной смене" />
            ))}
          {view === "shifts" && (
            <SessionsTab
              stage={stage}
              staff={staff}
              directory={directory}
              from={from}
              to={to}
              filters={filters}
              paging={paging.shifts}
              onPaging={(patch) => setPaging("shifts", patch)}
              canWrite={canWrite}
              openShift={state.openShift}
              onOpenShift={setOpenShift}
              // The reference's row click: the list filtered to that worker and shift (it stays on «Смены», the period kept).
              onPick={(row) => applyFilters({ ...filters, shifts: row.shiftName ? [row.shiftName] : [], worker: row.workerName })}
              onChanged={reload}
              onNotice={announce}
            />
          )}
          {view === "inventory" && <InventoryTab stage={stage} from={from} to={to} paging={paging.inventory} onPaging={(patch) => setPaging("inventory", patch)} />}
        </div>
      </div>

      {dialog && (
        <ActivityDialog
          stage={stage}
          direction={dialog}
          equipment={equipment}
          directory={directory}
          workers={staffNames}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reload()
            announce("Успешно сохранено")
          }}
        />
      )}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </div>
  )
}

const BUTTON_CLASS = "flex h-[36px] items-center rounded-[3px] px-[14px] text-[13px] font-semibold text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

function ButtonIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="mr-[9px] h-[18px] w-[18px] fill-white" aria-hidden>
      <path d={path} />
    </svg>
  )
}

function ColorButton({ color, icon, label, onClick }: { color: string; icon: string; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" onClick={onClick} className={`${BUTTON_CLASS} hover:brightness-95 ${color}`}>
      <ButtonIcon path={icon} />
      {t(label)}
    </button>
  )
}

function ColorLink({ color, icon, label, href }: { color: string; icon: string; label: string; href: string | null }) {
  const { t } = useLanguage()
  if (!href) {
    return (
      <span aria-disabled="true" className={`${BUTTON_CLASS} cursor-not-allowed opacity-60 ${color}`}>
        <ButtonIcon path={icon} />
        {t(label)}
      </span>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${BUTTON_CLASS} hover:brightness-95 ${color}`}>
      <ButtonIcon path={icon} />
      {t(label)}
    </a>
  )
}

function EmptyState({ text }: { text: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center pb-[30px] pt-[30px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[150px]" />
      <p className="-mt-[30px] text-[13px] text-[#666]">{t(text)}</p>
    </div>
  )
}

/** The reference's pager above a list: page size (10 … 2000), "1 - 25 из N" and the arrows. */
function Pager({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (patch: Partial<Paging>) => void }) {
  const { t } = useLanguage()
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = total ? (page - 1) * pageSize + 1 : 0
  const last = Math.min(page * pageSize, total)
  return (
    <div className="flex h-[50px] items-center justify-end gap-[12px] text-[13px] text-[#5d6474]">
      <PageSizeSelect value={pageSize} onChange={(size) => onChange({ page: 1, pageSize: size })} />
      <span className="whitespace-nowrap">
        {first} - {last} {t("из")} {total}
      </span>
      <PagerArrow dir="prev" onClick={page > 1 ? () => onChange({ page: page - 1 }) : undefined} />
      <PagerArrow dir="next" onClick={page < pageCount ? () => onChange({ page: page + 1 }) : undefined} />
    </div>
  )
}

/** Обзор tables. Column widths are shares of the card, so every column fits at any width. */
function SimpleTable({ headers, widths, rows, empty }: { headers: string[]; widths: string[]; rows: string[][]; empty: string }) {
  const { t } = useLanguage()
  const lastIndex = headers.length - 1
  // The reference keeps the first column wide, the middle ones left-aligned and the last one at the right edge.
  const align = (index: number) => (index > 0 && index === lastIndex ? "text-right" : "text-left")
  return (
    <div className="-mx-[30px] border-[#efefef] px-[30px] pb-[10px] [&:not(:last-child)]:border-b">
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={header} className={`h-[50px] font-semibold ${align(index)}`}>
                {t(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-dashed border-[#d9e0e5]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} data-no-translate className={`h-[50px] break-words ${cellIndex < lastIndex ? "pr-3" : ""} ${align(cellIndex)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="relative flex flex-col items-center pb-[30px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[150px]" />
          <p className="-mt-[30px] text-[13px] text-[#666]">{t(empty)}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

function FilterPanel({
  value,
  shiftOptions,
  workerOptions,
  equipment,
  active,
  onApply,
  onClose,
}: {
  value: Filters
  shiftOptions: string[]
  workerOptions: string[]
  equipment: Equipment[]
  active: boolean
  onApply: (filters: Filters) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<Filters>(value)
  useEscape(onClose, active)
  const hasShift = (name: string) => draft.shifts.some((entry) => nameKey(entry) === nameKey(name))
  const toggleShift = (name: string) =>
    setDraft((current) => ({ ...current, shifts: hasShift(name) ? current.shifts.filter((entry) => nameKey(entry) !== nameKey(name)) : [...current.shifts, name] }))
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft)
      }}
      aria-label={t("Фильтр")}
      className="absolute right-4 top-16 z-20 w-80 bg-white p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-black">{t("Фильтр")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-8 w-8 items-center justify-center text-[#333]">
          <X className="h-5 w-5" strokeWidth={1.6} />
        </button>
      </div>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1 block text-[13px] font-semibold text-black">{t("Смена")}</legend>
          {shiftOptions.length ? (
            <div className="max-h-40 overflow-y-auto">
              {shiftOptions.map((name) => (
                <label key={name} className="flex items-center gap-2 py-[3px] text-[13px]">
                  <input type="checkbox" checked={hasShift(name)} onChange={() => toggleShift(name)} />
                  <span data-no-translate className="break-words">{name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[#999]">—</p>
          )}
        </fieldset>
        <Field label="Работник">
          <select value={draft.worker} onChange={(event) => setDraft({ ...draft, worker: event.target.value })} className={inputClass}>
            <option value="">{t("Все")}</option>
            {workerOptions.map((worker) => (
              <option key={worker} value={worker} data-no-translate>
                {worker}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Тип">
          <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value === "made" || event.target.value === "raw" ? event.target.value : "" })} className={inputClass}>
            <option value="">{t("Все")}</option>
            <option value="made">{t("Продукт")}</option>
            <option value="raw">{t("Сырьё")}</option>
          </select>
        </Field>
        {/* Not in the reference: shift entries record their machine, so the records can be narrowed to one. */}
        <Field label="Оборудование">
          <select value={draft.equipmentId} onChange={(event) => setDraft({ ...draft, equipmentId: event.target.value })} className={inputClass}>
            <option value="">{t("Все")}</option>
            {equipment.map((entry) => (
              <option key={entry.id} value={entry.id} data-no-translate>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <button type="submit" className="rounded bg-[#5b7ce6] px-5 py-2 text-sm font-semibold uppercase text-white">
          {t("Применить")}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Записи
// ---------------------------------------------------------------------------

/** The reference's «Тип»: a made line is a «Продукт» (a material: «Материал»), a raw line «Сырье». */
const typeLabel = (row: LogRow) => (row.direction === "raw" ? "Сырье" : row.key.startsWith("raw_material:") ? "Материал" : "Продукт")

const LOG_HEADERS = ["Продукт / сырье", "Тип", "Кол-во", "Партия", "Дата, время"]
const LOG_WIDTHS = ["30%", "12%", "17%", "11%", "20%", "10%"]

function LogsTable({ rows, canWrite, onChanged, onNotice }: { rows: LogRow[]; canWrite: boolean; onChanged: () => void; onNotice: (text: string) => void }) {
  const { t, language } = useLanguage()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  async function save(row: LogRow) {
    const amount = parseQty(draft)
    if (!(amount > 0 && amount <= 1e9)) {
      notify(QTY_ERROR)
      return
    }
    setBusy(true)
    try {
      await api(`/api/production/activity/${row.id}`, { method: "PUT", body: { amount } })
      setEditing(null)
      onChanged()
      onNotice("Успешно сохранено")
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: LogRow) {
    if (!(await askDelete(`${row.name} ${formatAmount(row.amount, row.unit)}`))) return
    try {
      await api(`/api/production/activity/${row.id}`, { method: "DELETE" })
      onChanged()
      onNotice("Успешно удалено")
    } catch (error) {
      notify((error as Error).message)
    }
  }

  function onEditKey(event: ReactKeyboardEvent<HTMLInputElement>, row: LogRow) {
    if (event.key === "Enter") {
      event.preventDefault()
      void save(row)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setEditing(null)
    }
  }

  return (
    <table className="w-full table-fixed text-[13px]">
      <colgroup>
        {LOG_WIDTHS.map((width, index) => (
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {LOG_HEADERS.map((header) => (
            <th key={header} className="h-[50px] pr-3 text-left font-semibold">
              {t(header)}
            </th>
          ))}
          <th aria-hidden />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          // The usage day is what the period filters on; the booking time is shown when it is that same day.
          const moment = parseAnyDate(row.createdAt)
          const sameDay = moment !== null && moment.slice(0, 10) === row.date
          const when = sameDay ? formatDateTime(row.createdAt, language) : formatDate(row.date, language)
          const bookedHint = !sameDay && row.createdAt ? `${t("Дата создания")}: ${formatDateTime(row.createdAt, language)}` : undefined
          // A shift entry is changed here; a batch line in its batch. An entry of a handed-over session stays as it was
          // handed over: the reference disables its «Изменить» / «Удалить» with «Уже передан».
          const editable = canWrite && row.partyId === null
          const locked = row.transferred
          return (
            <tr key={row.id} title={row.isDefect ? t("Брак") : undefined} className={`group border-t border-dashed border-[#d9e0e5] ${row.isDefect ? "bg-[#ffebee]" : ""}`}>
              <td data-no-translate className="h-[50px] break-words pr-3">{row.name}</td>
              <td className="pr-3">{t(typeLabel(row))}</td>
              <td className="pr-3">
                {editing === row.id ? (
                  <span className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => onEditKey(event, row)}
                      placeholder={formatAmount(row.amount, row.unit)}
                      data-no-translate
                      inputMode="decimal"
                      aria-label={t("Кол-во")}
                      className="w-full min-w-0 border-b border-[#1E4A9A] bg-transparent py-1 outline-none"
                    />
                    <button type="button" disabled={busy} onClick={() => void save(row)} aria-label={t("Сохранить")} className="shrink-0 text-[#1E4A9A] disabled:opacity-40">
                      <Check className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => setEditing(null)} aria-label={t("Отмена")} className="shrink-0 text-[#5d6474]">
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                ) : (
                  <span data-no-translate>{formatAmount(row.amount, row.unit)}</span>
                )}
              </td>
              <td className="pr-3">
                {row.partyId ? (
                  <a href={`/analytics/production-batches?party=${row.partyId}`} className="text-[#1E4A9A] hover:underline">
                    № {row.partyId}
                  </a>
                ) : (
                  "-"
                )}
              </td>
              <td className="break-words pr-3" title={bookedHint}>
                {when}
              </td>
              <td>
                <div className="flex items-center justify-end gap-[10px]">
                  {editable && editing !== row.id && (
                    <span className="flex items-center gap-[10px] opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          setEditing(row.id)
                          setDraft("")
                        }}
                        aria-label={t(locked ? "Уже передан" : "Изменить")}
                        title={t(locked ? "Уже передан" : "Изменить")}
                        className="text-[#5d6474] hover:text-[#1E4A9A] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[#5d6474]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => void remove(row)}
                        aria-label={t(locked ? "Уже передан" : "Удалить")}
                        title={t(locked ? "Уже передан" : "Удалить")}
                        className="text-[#5d6474] hover:text-[#e57373] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[#5d6474]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                  {row.userName && (
                    <span role="img" data-no-translate aria-label={`${t("Создал")}: ${row.userName}`} title={`${t("Создал")}: ${row.userName}`} className="text-[#9aa1ae]">
                      <CircleUser className="h-[18px] w-[18px]" />
                    </span>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Смены (the workers' shift sessions)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DDTHH:mm" of now in the business time zone (the datetime-local fields). */
const nowMinute = () => nowLocalIso().slice(0, 16)

/** The reference's «Смены»: Работник | Смена | Начало смены | Конец смены («Не закончилась») | «Передать на склад»,
 * newest first, the pager above, a loader while loading, «В этом периоде не найдено смен» when there is none. A row
 * filters the list to its worker and shift. «Открыть смену» / «Закрыть смену» are Mezon's own (Linko's workers open
 * and close their sessions in its mobile app). */
function SessionsTab({
  stage,
  staff,
  directory,
  from,
  to,
  filters,
  paging,
  onPaging,
  canWrite,
  openShift,
  onOpenShift,
  onPick,
  onChanged,
  onNotice,
}: {
  stage: Stage
  staff: StaffMember[]
  directory: WorkShift[]
  from: string
  to: string
  filters: Filters
  paging: Paging
  onPaging: (patch: Partial<Paging>) => void
  canWrite: boolean
  /** The session whose «Передать на склад» is open (in the address, so a reload or a shared link reopens it). */
  openShift: number | null
  onOpenShift: (id: number | null) => void
  onPick: (row: Session) => void
  /** Entries changed their state (a hand-over locks them): the activity reloads. */
  onChanged: () => void
  onNotice: (text: string) => void
}) {
  const { t, language } = useLanguage()
  // «Передать на склад» moves stock: the production and the stock right (the server's rule).
  const canGive = useCanManage([...PRODUCTION_WRITE, "stock.manage"])
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState<Session | null>(null)
  const url = useMemo(() => {
    const params = new URLSearchParams({ stageId: String(stage.id), from, to, page: String(paging.page), pageSize: String(paging.pageSize) })
    for (const shift of filters.shifts) params.append("shift", shift)
    if (filters.worker) params.set("worker", filters.worker)
    return `/api/production/sessions?${params}`
  }, [filters.shifts, filters.worker, from, paging.page, paging.pageSize, stage.id, to])
  const { data, loading, error, reload } = useApiData<SessionList>(url, NO_SESSIONS)
  const loaded = data !== NO_SESSIONS && !loading
  // `data` is this url's answer (not the previous page's, still shown while the next one loads).
  const answered = useAnswered(url, loading, Boolean(error)) && data !== NO_SESSIONS
  // «Передать на склад» of the address: the row of the shown page, else the session fetched by its id (a link to
  // a session of another page or period). One of another stage, unknown or already handed over closes it.
  const listed = openShift ? data.results.find((row) => row.id === openShift) : undefined
  const fetchId = openShift && loaded && !listed ? openShift : null
  const { data: fetched, loading: fetching, error: fetchError } = useApiData<Session | null>(fetchId ? `/api/production/sessions/${fetchId}` : null, null, { quiet: true })
  const single = fetchId && !fetching && fetched?.id === fetchId ? fetched : undefined
  const giving = listed ?? single ?? null
  useEffect(() => {
    if (!openShift) return
    const stale = giving && (giving.stageId !== stage.id || giving.isTransferred)
    if (stale || (fetchId && !fetching && fetchError)) onOpenShift(null)
  }, [fetchError, fetchId, fetching, giving, onOpenShift, openShift, stage.id])

  // A page past the end (sessions of another filter, an old link) goes to the last one: the server answers such a
  // page with its last page. Only this url's answer counts; the previous page's data is still in `data` while the
  // next page loads, and comparing with it sent «Вперед» / «Назад» back to where they started.
  useEffect(() => {
    if (answered && data.pageSize === paging.pageSize && data.page < paging.page) onPaging({ page: data.page })
  }, [answered, data.page, data.pageSize, onPaging, paging.page, paging.pageSize])

  const changed = (text?: string) => {
    reload()
    onChanged()
    if (text) onNotice(text)
  }

  return (
    <>
      <div className="flex min-h-[50px] items-center justify-between gap-3">
        {canWrite ? (
          <button type="button" onClick={() => setOpening(true)} className="text-[13px] font-semibold text-[#1E4A9A] hover:underline">
            + {t("Открыть смену")}
          </button>
        ) : (
          <span />
        )}
        {data.count > 0 && <Pager total={data.count} page={data.page} pageSize={paging.pageSize} onChange={onPaging} />}
      </div>
      {/* A failed load is not «loading»: its message is shown (useApiData's notice) and the list is empty. */}
      {!loaded && !error && data.count === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[#586174]">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
        </div>
      ) : data.count === 0 ? (
        <EmptyState text="В этом периоде не найдено смен" />
      ) : (
        <table className={`w-full table-fixed text-[13px] ${loading ? "opacity-60" : ""}`}>
          <colgroup>
            {["25%", "17%", "24%", "24%", "10%"].map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {["Работник", "Смена", "Начало смены", "Конец смены"].map((header) => (
                <th key={header} className="h-[50px] pr-3 text-left font-semibold">
                  {t(header)}
                </th>
              ))}
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {data.results.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => onPick(row)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
                  event.preventDefault()
                  onPick(row)
                }}
                className="cursor-pointer border-t border-dashed border-[#d9e0e5] hover:bg-[#f2f5f8] focus:bg-[#f2f5f8] focus:outline-none"
              >
                <td data-no-translate className="h-[50px] break-words pr-3">{row.workerName || "-"}</td>
                <td data-no-translate className="break-words pr-3">{row.shiftName || "-"}</td>
                <td className="pr-3">{formatDateTime(row.openedAt, language)}</td>
                <td className="pr-3">{row.closedAt ? formatDateTime(row.closedAt, language) : t("Не закончилась")}</td>
                <td>
                  <div className="flex items-center justify-end gap-[10px]">
                    {canWrite && !row.closedAt && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setClosing(row)
                        }}
                        aria-label={t("Закрыть смену")}
                        title={t("Закрыть смену")}
                        className="text-[#5d6474] hover:text-[#e57373]"
                      >
                        <CircleStop className="h-[18px] w-[18px]" />
                      </button>
                    )}
                    {canGive && (
                      // Enabled on an open session too, as the reference's: handing it over ends it.
                      <button
                        type="button"
                        disabled={row.isTransferred}
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenShift(row.id)
                        }}
                        aria-label={t(row.isTransferred ? "Уже передан на склад" : "Передать на склад")}
                        title={t(row.isTransferred ? "Уже передан на склад" : "Передать на склад")}
                        className="text-[#5d6474] hover:text-[#1E4A9A] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[#5d6474]"
                      >
                        <Truck className="h-[18px] w-[18px]" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {opening && (
        <OpenSessionDialog
          stage={stage}
          staff={staff}
          directory={directory}
          onClose={() => setOpening(false)}
          onSaved={() => {
            setOpening(false)
            changed("Успешно сохранено")
          }}
        />
      )}
      {closing && (
        <CloseSessionDialog
          session={closing}
          onClose={() => setClosing(null)}
          onSaved={() => {
            setClosing(null)
            changed("Успешно сохранено")
          }}
        />
      )}
      {canGive && giving && giving.stageId === stage.id && !giving.isTransferred && (
        <GiveDialog
          key={giving.id}
          session={giving}
          onClose={() => onOpenShift(null)}
          // As the reference: the list is fetched again and the dialog closes (openShift cleared), without a snackbar.
          onDone={() => {
            onOpenShift(null)
            changed()
          }}
        />
      )}
    </>
  )
}

/** A refusal's message as the dialogs show it. */
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить запрос")

/** «Открыть смену»: a worker of the stage's Персонал (no preselect), one of their shifts there (picked when there is
 * only one) and «Начало смены» (now unless changed). */
function OpenSessionDialog({ stage, staff, directory, onClose, onSaved }: { stage: Stage; staff: StaffMember[]; directory: WorkShift[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const workers = useMemo(() => {
    const seen = new Map<number, string>()
    for (const member of staff) if (member.employeeId && !seen.has(member.employeeId)) seen.set(member.employeeId, member.employeeName)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }, [staff])
  const [employeeId, setEmployeeId] = useState("")
  const shifts = useMemo(() => {
    const seen = new Map<number, string>()
    for (const member of staff) {
      if (String(member.employeeId ?? "") !== employeeId || !member.shiftId || seen.has(member.shiftId)) continue
      seen.set(member.shiftId, directory.find((entry) => entry.id === member.shiftId)?.name ?? member.shift)
    }
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [directory, employeeId, staff])
  const [shiftId, setShiftId] = useState("")
  const [initial] = useState(nowMinute)
  const [openedAt, setOpenedAt] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function save(event: FormEvent) {
    event.preventDefault()
    const shift = shiftId || (shifts.length === 1 ? String(shifts[0].id) : "")
    if (!employeeId || !shift || !openedAt) {
      setError(t("Это поле обязательно к заполнению"))
      return
    }
    setSaving(true)
    setError("")
    try {
      // Unchanged, the start is the server's now (the browser clock may be off).
      await api("/api/production/sessions", { method: "POST", body: { stageId: stage.id, employeeId: Number(employeeId), shiftId: Number(shift), ...(openedAt !== initial ? { openedAt } : {}) } })
      onSaved()
    } catch (reason) {
      setError(t(errorText(reason)))
    } finally {
      setSaving(false)
    }
  }

  const chosenShift = shiftId || (shifts.length === 1 ? String(shifts[0].id) : "")
  return (
    <Modal title={t("Открыть смену")} onClose={onClose} onSubmit={save} closeOnEscape footer={<SaveButton saving={saving} />}>
      <div className="space-y-[20px] pt-[10px]">
        <Field label="Работник" required>
          <select
            value={employeeId}
            onChange={(event) => {
              setEmployeeId(event.target.value)
              setShiftId("")
              setError("")
            }}
            className={inputClass}
          >
            <option value="">—</option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id} data-no-translate>
                {worker.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Смена" required>
          <select
            value={chosenShift}
            onChange={(event) => {
              setShiftId(event.target.value)
              setError("")
            }}
            disabled={!employeeId}
            className={inputClass}
          >
            <option value="">—</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id} data-no-translate>
                {shift.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Начало смены" required>
          <input
            required
            type="datetime-local"
            value={openedAt}
            max={nowMinute()}
            onChange={(event) => {
              setOpenedAt(event.target.value)
              setError("")
            }}
            className={inputClass}
          />
        </Field>
        {error && <p className="text-[12px] text-[#f44336]">{error}</p>}
      </div>
    </Modal>
  )
}

/** «Закрыть смену»: «Конец смены» (now unless changed). */
function CloseSessionDialog({ session, onClose, onSaved }: { session: Session; onClose: () => void; onSaved: () => void }) {
  const { t, language } = useLanguage()
  const [initial] = useState(nowMinute)
  const [closedAt, setClosedAt] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!closedAt) {
      setError(t("Это поле обязательно к заполнению"))
      return
    }
    setSaving(true)
    setError("")
    try {
      await api(`/api/production/sessions/${session.id}/close`, { method: "POST", body: closedAt !== initial ? { closedAt } : {} })
      onSaved()
    } catch (reason) {
      setError(t(errorText(reason)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Закрыть смену")} onClose={onClose} onSubmit={save} closeOnEscape footer={<SaveButton saving={saving} />}>
      <div className="space-y-[20px] pt-[10px]">
        <p data-no-translate className="-mx-[30px] bg-[#f2f5f8] px-[30px] py-[16px] font-semibold">
          {session.workerName} · {session.shiftName} · {formatDateTime(session.openedAt, language)}
        </p>
        <Field label="Конец смены" required>
          <input
            required
            type="datetime-local"
            value={closedAt}
            min={session.openedAt.slice(0, 16)}
            max={nowMinute()}
            onChange={(event) => {
              setClosedAt(event.target.value)
              setError("")
            }}
            className={inputClass}
          />
        </Field>
        {error && <p className="text-[12px] text-[#f44336]">{error}</p>}
      </div>
    </Modal>
  )
}

/** The reference's «Передать на склад» confirmation: «Выполнить», «Подтверждение запроса», the worker, «Выберите склад»
 * (every active warehouse but the one the output is in, none preselected) and «Да». A refusal stays in the dialog. */
function GiveDialog({ session, onClose, onDone }: { session: Session; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const { data: warehouses } = useApiData<WarehouseOption[]>("/api/warehouses", NO_WAREHOUSES)
  const options = useMemo(
    () =>
      warehouses
        .filter((warehouse) => warehouse.active !== false && nameKey(warehouse.name) !== nameKey(session.fromWarehouse))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    [session.fromWarehouse, warehouses],
  )
  const [warehouseId, setWarehouseId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function run() {
    if (busy) return
    if (!warehouseId) {
      setError(t("Выберите склад"))
      return
    }
    setBusy(true)
    setError("")
    try {
      await api(`/api/production/sessions/${session.id}/give`, { method: "POST", body: { warehouseId: Number(warehouseId) } })
      onDone()
    } catch (reason) {
      setError(t(errorText(reason)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog kind="request" title={t("Выполнить")} text={<span data-no-translate>{session.workerName}</span>} confirmLabel="Да" tone="blue" busy={busy} error={error} onConfirm={() => void run()} onClose={onClose}>
      <div className="mt-[20px]">
        <Field label="Выберите склад" required>
          <select
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value)
              setError("")
            }}
            className={inputClass}
          >
            <option value="">—</option>
            {options.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id} data-no-translate>
                {warehouse.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </ConfirmDialog>
  )
}

// ---------------------------------------------------------------------------
// Инвентаризация
// ---------------------------------------------------------------------------

/** The stage warehouse's inventories (Склад → Инвентаризация) of the period, in every status, newest first; a row
 * opens the inventory there. The stage's own reconciliations of earlier versions follow, read only. */
function InventoryTab({ stage, from, to, paging, onPaging }: { stage: Stage; from: string; to: string; paging: Paging; onPaging: (patch: Partial<Paging>) => void }) {
  const { t, language } = useLanguage()
  const router = useRouter()
  const warehouse = stage.warehouse.trim()
  const listUrl = warehouse
    ? `/api/stock/inventories?${new URLSearchParams({ warehouse, fromDate: from, toDate: to, ordering: "-created_date", page: String(paging.page), pageSize: String(paging.pageSize) })}`
    : null
  const { data, loading } = useApiData<StockInventoryListResult>(listUrl, NO_INVENTORIES)
  const { data: legacy } = useApiData<LegacyInventory[]>(`/api/production/inventories?stageId=${stage.id}&from=${from}&to=${to}`, NO_LEGACY)
  const loaded = !warehouse || (data !== NO_INVENTORIES && !loading)
  const total = warehouse ? data.count : 0

  // A page past the end (rows removed, an old link) goes to the last one.
  useEffect(() => {
    if (loaded && paging.page > 1 && (paging.page - 1) * paging.pageSize >= total) onPaging({ page: Math.max(1, Math.ceil(total / paging.pageSize)) })
  }, [loaded, onPaging, paging.page, paging.pageSize, total])

  const href = (row: StockInventoryRow) => `/analytics/inventory?${new URLSearchParams({ stock: row.warehouse, fromDate: row.invDate, toDate: row.invDate, id: String(row.id) })}`
  return (
    <>
      {total > 0 ? (
        <>
          <Pager total={total} page={paging.page} pageSize={paging.pageSize} onChange={onPaging} />
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              {["25%", "25%", "20%", "30%"].map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {["Склад", "Создал", "Дата создания", "Комментарий"].map((header) => (
                  <th key={header} className="h-[50px] pr-3 text-left font-semibold">
                    {t(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.results.map((row) => (
                <tr key={row.id} onClick={() => router.push(href(row))} className="cursor-pointer border-t border-dashed border-[#d9e0e5] hover:bg-[#f2f5f8]">
                  <td data-no-translate className="h-[50px] break-words pr-3">
                    <a href={href(row)} onClick={(event) => event.stopPropagation()} className="hover:underline">
                      {row.warehouse}
                    </a>
                  </td>
                  <td data-no-translate className="break-words pr-3">{row.createdBy || "—"}</td>
                  <td className="pr-3">{inventoryDateText(row, language)}</td>
                  <td className="break-words">{row.comment ? <span data-no-translate>{row.comment}</span> : t("Без комментариев")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : loaded ? (
        <EmptyState text="В этом периоде не найдено инвентаризаций" />
      ) : null}
      {legacy.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-1 text-[13px] font-bold">{t("Сверки этапа")}</h3>
          <LegacyInventoryList inventories={legacy} />
        </section>
      )}
    </>
  )
}

function LegacyInventoryList({ inventories }: { inventories: LegacyInventory[] }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState<number | null>(null)
  return (
    <ul>
      {inventories.map((inventory) => {
        const changed = inventory.lines.filter((line) => line.difference !== 0).length
        return (
          <li key={inventory.id} className="border-b border-dashed border-slate-200">
            <button type="button" onClick={() => setOpen(open === inventory.id ? null : inventory.id)} aria-expanded={open === inventory.id} className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left text-sm">
              <span className="font-semibold">
                № {inventory.id} · {formatDate(inventory.date, language)}
              </span>
              <span data-no-translate className="text-slate-500">{inventory.userName}</span>
              <span>
                {t("Позиций")}: {inventory.lines.length}
              </span>
              <span className={changed ? "text-red-500" : "text-emerald-600"}>
                {t("Расхождений")}: {changed}
              </span>
            </button>
            {open === inventory.id && (
              <table className="mb-3 w-full bg-slate-50 text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2">{t("Наименование")}</th>
                    <th className="px-3 py-2 text-right">{t("Ожидалось")}</th>
                    <th className="px-3 py-2 text-right">{t("в т.ч. брак")}</th>
                    <th className="px-3 py-2 text-right">{t("Фактически")}</th>
                    <th className="px-3 py-2 text-right">{t("Разница")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.lines.map((line) => (
                    <tr key={line.key} data-no-translate className="border-t border-slate-200">
                      <td className="px-3 py-2">{line.name}</td>
                      <td className="px-3 py-2 text-right">{formatAmount(line.expected, line.unit)}</td>
                      <td className="px-3 py-2 text-right">{line.defects === undefined ? "-" : formatAmount(line.defects, line.unit)}</td>
                      <td className="px-3 py-2 text-right">{formatAmount(line.actual, line.unit)}</td>
                      <td className={`px-3 py-2 text-right ${line.difference < 0 ? "text-red-500" : line.difference > 0 ? "text-emerald-600" : ""}`}>{formatAmount(line.difference, line.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {open === inventory.id && inventory.comment && <p data-no-translate className="mb-3 text-sm text-slate-500">{inventory.comment}</p>}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// «Добавить продукт» / «Добавить сырье»
// ---------------------------------------------------------------------------

/** A product line of «Добавить продукт»: its good (Ок) and defective (Брак) amounts, as the reference counts them. */
type MadeLine = { key: string; ok: number; brak: number }

function ActivityDialog({
  stage,
  direction,
  equipment,
  directory,
  workers,
  onClose,
  onSaved,
}: {
  stage: Stage
  direction: "made" | "raw"
  equipment: Equipment[]
  directory: WorkShift[]
  workers: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [date, setDate] = useState(todayIso())
  // The stage's products (made), and the ingredients of its products (raw: offered first among the stock).
  const { data: recipes } = useApiData<Recipe[]>(`/api/production/recipes?stageId=${stage.id}`, NO_RECIPES)
  const { data: stock } = useApiData<StockItem[]>(direction === "raw" && date ? `/api/production/items?stageId=${stage.id}&date=${date}` : null, NO_STOCK)
  // The reference's shift field picks the directory's only shift by itself.
  const [shiftId, setShiftId] = useState(() => (directory.length === 1 ? String(directory[0].id) : ""))
  const shiftTouched = useRef(false)
  const [equipmentId, setEquipmentId] = useState("")
  const [worker, setWorker] = useState("")
  const [made, setMade] = useState<MadeLine[]>([])
  const [raw, setRaw] = useState<DraftLine[]>([])
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  useEscape(onClose)

  useEffect(() => {
    if (!shiftTouched.current && directory.length === 1) setShiftId(String(directory[0].id))
  }, [directory])

  // Raw use must fit the stock: the items there, and the stage's ingredients (to show what is missing).
  const rawItems = useMemo(() => {
    const ingredients = new Set(recipes.flatMap((recipe) => recipe.components.filter((component) => component.role === "raw").map((component) => component.key)))
    const chosen = new Set(raw.map((line) => line.key))
    return stock
      .filter((item) => item.available > 0 || item.onHand > 0 || ingredients.has(item.key) || chosen.has(item.key))
      .sort((a, b) => Number(ingredients.has(b.key)) - Number(ingredients.has(a.key)))
  }, [raw, recipes, stock])
  const count = direction === "made" ? made.length : raw.length

  async function save(event: FormEvent) {
    event.preventDefault()
    const items =
      direction === "made"
        ? made.flatMap((line) => [
            ...(line.ok > 0 ? [{ key: line.key, amount: line.ok, isDefect: false }] : []),
            ...(line.brak > 0 ? [{ key: line.key, amount: line.brak, isDefect: true }] : []),
          ])
        : raw.map((line) => ({ key: line.key, amount: line.amount, isDefect: false }))
    if (!items.length) return
    setSaving(true)
    try {
      await api("/api/production/activity", {
        method: "POST",
        body: { stageId: stage.id, direction, date, shiftId: shiftId ? Number(shiftId) : null, equipmentId: equipmentId ? Number(equipmentId) : null, worker, items },
      })
      onSaved()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(direction === "made" ? "Добавление продукта" : "Добавление сырья")} tall onClose={onClose} onSubmit={save} width="max-w-[1000px]" footer={<SaveButton saving={saving} disabled={!count} />}>
      <div className="-mx-[30px] -mb-[20px] -mt-[16px] flex min-h-[400px]">
        <div className="w-[250px] shrink-0 space-y-[20px] border-r border-[#efefef] px-[30px] pt-[30px]">
          <Field label="Дата использования" required>
            <input required type="date" value={date} min="2000-01-01" max={todayIso()} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Смена">
            <select
              value={shiftId}
              onChange={(event) => {
                shiftTouched.current = true
                setShiftId(event.target.value)
              }}
              className={inputClass}
            >
              <option value="">—</option>
              {directory.map((entry) => (
                <option key={entry.id} value={entry.id} data-no-translate>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          {/* Every machine of the stage, as the reference offers them (its status does not matter here). */}
          <Field label="Оборудование">
            <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
              <option value="">—</option>
              {equipment.map((entry) => (
                <option key={entry.id} value={entry.id} data-no-translate>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          {/* Not in the reference: who of the stage staff did the work (Смены groups the entries by it). */}
          <Field label="Работник">
            <select value={worker} onChange={(event) => setWorker(event.target.value)} className={inputClass}>
              <option value="">—</option>
              {workers.map((value) => (
                <option key={value} value={value} data-no-translate>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="min-w-0 flex-1 px-[30px] pt-[24px]">
          <div className="mb-[14px] flex items-center justify-between">
            <p className="text-[13px] font-semibold">{t("Список товаров")}</p>
            <button type="button" onClick={() => setPicking((value) => !value)} className="text-[13px] text-[#333] hover:underline">
              {t("добавить товары")}
            </button>
          </div>
          {direction === "made" && recipes !== NO_RECIPES && !recipes.length && <p className="mb-3 text-[13px] text-[#e58a00]">{t("У этапа нет продуктов. Добавьте их во вкладке «Продукция».")}</p>}
          {direction === "made" ? (
            <MadeLinesEditor items={recipes} lines={made} onChange={setMade} hideInput={!picking} />
          ) : (
            <div data-no-translate className="contents">
              {/* Stored item names and units: kept from the page translator (the editor's own texts go through t()). */}
              <ItemLinesEditor<CatalogItem> items={rawItems} lines={raw} onChange={setRaw} showStock hideInput={!picking} emptyText="Вы еще не выбрали ни одного товара..." />
            </div>
          )}
          {!count && !picking && (
            <button type="button" onClick={() => setPicking(true)} className="mx-auto mt-[-8px] block text-[13px] text-[#129fdd] hover:underline">
              {t("добавить товары?")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Product lines with separate Ок and Брак amounts (one save records both, as the reference's product list). */
function MadeLinesEditor({ items, lines, onChange, hideInput }: { items: CatalogItem[]; lines: MadeLine[]; onChange: (lines: MadeLine[]) => void; hideInput: boolean }) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [ok, setOk] = useState("")
  const [brak, setBrak] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const [editOk, setEditOk] = useState("")
  const [editBrak, setEditBrak] = useState("")
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])

  /** Both amounts ≥ 0 (blank = 0), at least one of them above 0. */
  function amounts(okText: string, brakText: string): [number, number] | null {
    const good = okText.trim() ? parseQty(okText) : 0
    const defect = brakText.trim() ? parseQty(brakText) : 0
    if (!Number.isFinite(good) || !Number.isFinite(defect) || good > 1e9 || defect > 1e9 || good + defect <= 0) return null
    return [good, defect]
  }

  function add() {
    if (!key) return
    const parsed = amounts(ok, brak)
    if (!parsed) {
      notify(QTY_ERROR)
      return
    }
    const existing = lines.findIndex((line) => line.key === key)
    if (existing >= 0) onChange(lines.map((line, index) => (index === existing ? { ...line, ok: line.ok + parsed[0], brak: line.brak + parsed[1] } : line)))
    else onChange([{ key, ok: parsed[0], brak: parsed[1] }, ...lines])
    setKey("")
    setOk("")
    setBrak("")
  }

  function saveEdit(index: number) {
    const parsed = amounts(editOk, editBrak)
    if (!parsed) {
      notify(QTY_ERROR)
      return
    }
    onChange(lines.map((line, position) => (position === index ? { ...line, ok: parsed[0], brak: parsed[1] } : line)))
    setEditing(null)
  }

  const onEnter = (action: () => void) => (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    action()
  }
  const unit = byKey.get(key)?.unit ?? ""
  const amountInput = "w-24 border-b border-slate-300 bg-transparent py-2 outline-none focus:border-blue-600"

  return (
    <div>
      <div className={`-mx-[30px] flex items-end gap-4 bg-[#eef2f8] px-[30px] py-3 ${hideInput ? "hidden" : ""}`}>
        <div data-no-translate className="min-w-0 flex-1">
          <ItemPicker items={items} value={key} onChange={setKey} />
        </div>
        <input value={ok} onChange={(event) => setOk(event.target.value)} onKeyDown={onEnter(add)} inputMode="decimal" placeholder={t("Ок")} aria-label={t("Ок")} className={amountInput} />
        <input value={brak} onChange={(event) => setBrak(event.target.value)} onKeyDown={onEnter(add)} inputMode="decimal" placeholder={t("Брак")} aria-label={t("Брак")} className={amountInput} />
        <span data-no-translate className="w-10 pb-2 text-sm text-slate-500">{unit}</span>
        <button type="button" onClick={add} aria-label={t("Добавить")} className="pb-2 text-blue-600">
          <Check className="h-6 w-6" />
        </button>
      </div>
      {lines.length ? (
        <table className="mt-2 w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr className="text-left text-[13px]">
              <th className="py-2 pr-2 font-semibold">{t("Наименование")}</th>
              <th className="py-2 pr-2 font-semibold">{t("Тип")}</th>
              <th className="py-2 pr-2 text-right font-semibold">{t("Ок")}</th>
              <th className="py-2 pr-2 text-right font-semibold">{t("Брак")}</th>
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const item = byKey.get(line.key)
              return (
                <tr key={line.key} className="border-t border-dashed border-slate-200">
                  <td data-no-translate className="break-words py-2.5 pr-2">
                    {index + 1}. {item?.name ?? line.key}
                  </td>
                  {/* The product type is the catalog's own (Типы товаров: «напитки», «Syn Heon» …), stored data too. */}
                  <td data-no-translate className="break-words py-2.5 pr-2">{item?.type ?? ""}</td>
                  {editing === index ? (
                    <>
                      <td className="py-1 pr-2 text-right">
                        <input autoFocus value={editOk} onChange={(event) => setEditOk(event.target.value)} onKeyDown={onEnter(() => saveEdit(index))} inputMode="decimal" aria-label={t("Ок")} className="w-full border-b border-blue-500 py-1 text-right outline-none" />
                      </td>
                      <td className="py-1 pr-2 text-right">
                        <input value={editBrak} onChange={(event) => setEditBrak(event.target.value)} onKeyDown={onEnter(() => saveEdit(index))} inputMode="decimal" aria-label={t("Брак")} className="w-full border-b border-blue-500 py-1 text-right outline-none" />
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={() => saveEdit(index)} className="text-blue-600" aria-label={t("Сохранить")}>
                          <Check className="h-5 w-5" />
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td data-no-translate className="py-2.5 pr-2 text-right">{formatAmount(line.ok, item?.unit ?? "")}</td>
                      <td data-no-translate className="py-2.5 pr-2 text-right">{formatAmount(line.brak, item?.unit ?? "")}</td>
                      <td>
                        <span className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(index)
                              setEditOk(String(line.ok))
                              setEditBrak(String(line.brak))
                            }}
                            className="text-slate-500 hover:text-blue-600"
                            aria-label={t("Изменить")}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => onChange(lines.filter((_, position) => position !== index))} className="text-slate-500 hover:text-red-500" aria-label={t("Удалить")}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col items-center py-8 text-center text-[13px] text-[#999]">
          <svg viewBox="0 0 24 24" className="mb-3 h-[70px] w-[70px] fill-none stroke-[#d9dde3]" strokeWidth={0.8} aria-hidden>
            <path d="M6 7h12l1 13H5L6 7z" strokeLinejoin="round" />
            <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
            <path d="M8 13h8M8 16h5" strokeLinecap="round" />
          </svg>
          {t("Вы еще не выбрали ни одного товара...")}
        </div>
      )}
    </div>
  )
}
