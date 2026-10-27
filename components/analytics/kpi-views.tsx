"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { ListFilter } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { KpiFormDialog, type KpiFormValue } from "@/components/analytics/kpi-form"
import { KpiActiveConfirm, KpiLockDialog } from "@/components/analytics/kpi-lock-dialog"
import { RefTip } from "@/components/ref/ref-tip"
import { FilterSelect, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"
import { KPI_ORDER_STATUSES, KPI_RETURN_STATUSES } from "@/lib/kpi-form-rules"

type KpiTask = {
  id: number
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
  system?: boolean
  tillDate?: string | null
  startDate?: string | null
  detail?: KpiDetail | null
}

type KpiDetail = {
  disable_change?: boolean
  visible_only_operator?: boolean
  operators?: Array<{ id: number; name: string }>
  levels?: Array<{ calculation_type: string; from_amount: string; to_amount: string; bonus_amount: string; exclude_low_level: boolean }>
  brands?: Array<{ name: string }>
  price_lists?: Array<{ name: string }>
  products?: Array<{ name: string }>
  product_types?: Array<{ name: string }>
  group_products?: Array<{ name: string }>
  order_status?: unknown[]
  order_return_status?: unknown[]
  is_order_return_status?: boolean
  calc_in_box?: boolean
  use_chosen?: boolean
  for_supervisor?: boolean
  is_paid_fully?: boolean
  paid_days_from?: number | null
  paid_days_to?: number | null
  only_for_system?: boolean
  is_mml?: boolean
  borders?: Array<{ name?: string; title?: string }>
  market_types?: Array<{ name: string }>
  branches?: Array<{ name: string }>
  transports?: Array<{ number?: string; name?: string }>
  attendance_type?: unknown[]
  division?: { name: string } | null
  bonus_fund?: string | number | null
  user_type?: { name: string } | null
  is_order_status?: boolean
  order_date_type?: string
  order_return_date_type?: string
  currency?: { name: string } | null
}

// The reference stores plan / client types as codes and translates them in the page.
const planTypeLabels: Record<string, string> = {
  sales_sum: "Сумма фактической продажи (продажа - возврат)",
  product_sales_amount: "Кол-во фактической продажи (продажа - возврат)",
  sales_sum_order: "Сумма продаж (продажа-возврат от продаж)",
  product_sales_amount_order: "Кол-во продаж (продажа-возврат от продаж)",
  active_client_count: "АКБ",
  active_client_count_by_day: "Дневной АКБ",
  payment_to_cashbox: "Оплата (принятые на кассу)",
  product_sales_weight: "Вес фактической продажи (продажа - возврат)",
  visit: "Визит",
  payed_market_count: "Количество оплативших клиентов",
  mml: "Индикатор ММЛ / АКБ",
  plan_visit_by_day: "Плановый Визит ПО ДНЯМ",
}
const clientTypeLabels: Record<string, string> = {
  all: "Для всех",
  choosen: "Выбранным клиентам",
  market_type: "Выбранным типам клиентов",
  branch: "Выбранным филиалам",
  border: "Выбранным зонам",
}
const planLabel = (code: string) => planTypeLabels[code] ?? code
const clientLabel = (code: string) => clientTypeLabels[code] ?? code
// The reference lists KPIs by name, ignoring case, spaces and punctuation.
const nameCollator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true })
// A KPI whose validity ended before today counts as inactive in the tabs (the reference's server filter).
// The "Активные" tab of the reference hides a KPI whose till date has passed, but its dot and detail card show the stored is_active flag as is.
const isCurrentlyActive = (task: KpiTask) => task.active && !(task.tillDate && task.tillDate < new Date().toISOString().slice(0, 10))

const initialTasks: KpiTask[] = []

/** variant "page" is the standalone report of the analytics menu (#/widget-kpi); "tab" is the dashboard KPI tab. */
export function KpiPerformanceView({ variant = "page" }: { variant?: "page" | "tab" }) {
  const { t } = useLanguage()
  const router = useRouter()
  const today = new Date()
  const [month, setMonth] = useState(today.getMonth())
  const [year, setYear] = useState(today.getFullYear())
  const [recalculating, setRecalculating] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  // The reference keeps the filter dialog in the address: ?openKpiTabFilterDialog=true
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("openKpiTabFilterDialog") === "true") setShowFilter(true)
  }, [])
  const toggleFilter = (open: boolean) => {
    setShowFilter(open)
    const url = new URL(window.location.href)
    if (open) url.searchParams.set("openKpiTabFilterDialog", "true")
    else url.searchParams.delete("openKpiTabFilterDialog")
    window.history.replaceState(window.history.state, "", url.pathname + url.search)
  }

  function downloadCsv() {
    const csv = `${t("Месяц")};${t("Год")};KPI;${t("Значение")}\n${month + 1};${year};${t("Общий объем во всех KPI")};0`
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "kpi-performance.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
  const recalc = () => {
    setRecalculating(true)
    window.setTimeout(() => setRecalculating(false), 600)
  }

  const actionButtons = (
    <>
      <button type="button" onClick={() => router.push("/analytics/kpi-tasks")} className="h-[30px] rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("KPI задачи")}</button>
      <button type="button" onClick={() => router.push("/analytics/salary-planning")} className="h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Зарплата и установка планов")}</button>
      <button type="button" onClick={() => router.push("/analytics/visits-by-day")} className="h-[30px] rounded-[3px] bg-[#fa8072] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Посещения")}</button>
    </>
  )
  const standalone = variant === "page"

  return (
    <ReportPage>
      {standalone ? (
        <>
          <div className="pl-[30px] pr-[36px]">
            <RefHeader title="">
              <div className="flex gap-[22px]">{actionButtons}</div>
            </RefHeader>
          </div>
          <section className="mx-[28px] flex h-[77px] gap-[15px] bg-white px-[30px] pt-[12px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <div className="w-[269px] [&>label>span:first-child]:!top-px"><ReportSelectField label="Месяц" value={MONTHS[month]} onChange={(value) => value && setMonth(MONTHS.indexOf(value))} options={MONTHS} /></div>
            <div className="w-[269px] [&>label>span:first-child]:!top-px"><ReportSelectField label="Год" value={String(year)} onChange={(value) => value && setYear(Number(value))} options={["2024", "2025", "2026", "2027"]} /></div>
          </section>
        </>
      ) : (
        <>
          <WidgetHeader active="KPI" />
          <WidgetUserCard showPeriods={false}>
            <div className="ml-auto mr-[23px] flex gap-[18px]">
              {actionButtons}
              <button type="button" onClick={() => toggleFilter(true)} className="flex h-[30px] items-center gap-[6px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><ListFilter className="h-4 w-4" />{t("Показать фильтр")}</button>
            </div>
          </WidgetUserCard>
        </>
      )}
      {showFilter && !standalone && (
        <KpiFilterDialog
          months={MONTHS}
          onClose={() => toggleFilter(false)}
          onApply={(nextMonth, nextYear) => {
            if (nextMonth) setMonth(MONTHS.indexOf(nextMonth))
            if (nextYear) setYear(Number(nextYear))
            toggleFilter(false)
          }}
        />
      )}
      <section className={`${standalone ? "mx-[28px] mt-[27px]" : "mx-[30px] mt-[10px]"} grid gap-x-[28px] md:grid-cols-[250px_1fr]`}>
        <div>
          <div className={`${standalone ? "mb-[3px]" : "mb-[10px]"} flex h-[30px] items-center px-[5px]`}><h2 className="text-[13px] font-semibold leading-4">KPI</h2></div>
          <div className="min-h-[720px] bg-white p-px shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <button type="button" aria-current="true" onClick={recalc} className="h-[44.3px] w-full bg-[#f2f5f8] px-[17px] pt-[8px] text-left text-[13px] text-[#2c2c2c]">{t("Общий объем")} <span data-no-translate>во всех кпэ</span></button>
          </div>
        </div>
        <div>
          <div className={`${standalone ? "mb-[3px]" : "mb-[10px]"} flex h-[30px] items-center justify-between px-[5px]`}>
            <h2 className="text-[13px] font-semibold leading-4">{t("Общий объем")}</h2>
            <div className="-mr-[5px] flex items-center gap-[10px] text-[13px] font-semibold">
              {standalone ? (
                <button type="button" onClick={downloadCsv} aria-label={t("Скачать")} className="mr-[20px] flex h-6 w-6 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg></button>
              ) : (
                <button type="button" onClick={downloadCsv} className="flex h-[30px] items-center gap-[6px] rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95"><svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d={RI.chart ?? RI.download} /></svg>{t("Скачать")}</button>
              )}
              <span>{t("данные за")}</span>
              <button type="button" onClick={recalc} className={`ml-[5px] text-[#71ce87] ${recalculating ? "opacity-60" : ""}`}>{t("Перерасчет")}</button>
            </div>
          </div>
          <div className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"><ReportEmpty className="pb-[46px] pt-[54px]" text={t("По вашему запросу ничего не найдено...")} /></div>
        </div>
      </section>
    </ReportPage>
  )
}

// The reference keeps the list state in the URL (#/kpi/<id>?page&pageSize&status&search&ordering).
const STATUS_BY_TAB: Record<string, string> = { "Активные": "active", "Не активный": "inactive", "Системные": "only_for_system", "Все": "all" }
const TAB_BY_STATUS = Object.fromEntries(Object.entries(STATUS_BY_TAB).map(([tab, status]) => [status, tab]))
const positive = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function KpiTasksView() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tasks, setTasks] = useState(initialTasks)
  // Coming from "KPI план филиалов" (?id=…, no status) the reference lists every KPI while the "Активные" tab is highlighted.
  const [status, setStatus] = useState<string | null>(() => {
    const value = searchParams.get("status")
    return value && TAB_BY_STATUS[value] ? value : null
  })
  const tab = TAB_BY_STATUS[status ?? "active"]
  const dataTab = status === null && searchParams.get("id") ? "Все" : tab
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [ordering, setOrdering] = useState<"" | "id" | "-id">(() => (["id", "-id"].includes(searchParams.get("ordering") ?? "") ? (searchParams.get("ordering") as "id" | "-id") : ""))
  const [filterOpen, setFilterOpen] = useState(false)
  // The reference filters KPIs by their linked products (kpi_task_details).
  const [productFilter, setProductFilter] = useState("")
  const [productNames, setProductNames] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(() => Math.min(100, positive(searchParams.get("pageSize"), 25)))
  const [page, setPage] = useState(() => positive(searchParams.get("page"), 1))
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<KpiTask | null>(null)
  const [copyingTask, setCopyingTask] = useState<KpiTask | null>(null)
  const [confirmTask, setConfirmTask] = useState<KpiTask | null>(null)
  const [lockTask, setLockTask] = useState<KpiTask | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(() => positive(searchParams.get("id"), 0) || null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (ordering) params.set("ordering", ordering)
    if (page > 1) params.set("page", String(page))
    params.set("pageSize", String(pageSize))
    if (status) params.set("status", status)
    if (query.trim()) params.set("search", query.trim())
    if (selectedId) params.set("id", String(selectedId))
    const next = params.toString()
    if (window.location.search.slice(1) !== next) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${next}`)
  }, [ordering, page, pageSize, status, query, selectedId])

  useEffect(() => {
    let cancelled = false
    fetch("/api/kpi-tasks")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить KPI задачи")
        return (await response.json()) as KpiTask[]
      })
      .then((data) => {
        if (!cancelled) setTasks([...data].sort((a, b) => nameCollator.compare(a.name, b.name)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!filterOpen || productNames.length) return
    fetch("/api/products")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Array<{ name?: string }>) => setProductNames([...new Set(data.map((item) => item.name ?? "").filter(Boolean))].sort((a, b) => nameCollator.compare(a, b)).slice(0, 300)))
      .catch(() => {})
  }, [filterOpen, productNames.length])

  async function createTask(input: Partial<KpiFormValue> & { name: string; planType: string; clientType: string; comment: string; active: boolean }) {
    try {
      const response = await fetch("/api/kpi-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!response.ok) return
      const saved = (await response.json()) as KpiTask
      setTasks((current) => [...current, saved].sort((a, b) => nameCollator.compare(a.name, b.name)))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function updateTask(id: number, input: Partial<KpiFormValue> & { name: string; planType: string; clientType: string; comment: string; active: boolean }) {
    try {
      const response = await fetch(`/api/kpi-tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        if (data.error) notify(t(data.error))
        return
      }
      const saved = (await response.json()) as KpiTask
      setTasks((current) => current.map((item) => (item.id === id ? saved : item)))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function toggleTaskActive(task: KpiTask) {
    try {
      const response = await fetch(`/api/kpi-tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !task.active }),
      })
      if (!response.ok) return
      const saved = (await response.json()) as KpiTask
      setTasks((current) => current.map((item) => (item.id === task.id ? saved : item)))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const filtered = useMemo(() => {
    // The reference searches the KPI name only: every word of the query must occur in it, ignoring case.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const list = tasks.filter((task) => {
      const tabMatch = dataTab === "Все" || (dataTab === "Активные" && isCurrentlyActive(task)) || (dataTab === "Не активный" && !isCurrentlyActive(task)) || (dataTab === "Системные" && task.system)
      const name = task.name.toLowerCase()
      return tabMatch && words.every((word) => name.includes(word)) && (!productFilter || Boolean(task.detail?.products?.some((product) => product.name === productFilter)))
    })
    return ordering ? [...list].sort((a, b) => (ordering === "id" ? a.id - b.id : b.id - a.id)) : list
  }, [tasks, dataTab, query, productFilter, ordering])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <RefPage>
      <RefHeader title={t("KPI задачи")} titleTop={0.8}>
        <div className="mr-[8px] flex items-center gap-[18px]">
          <RefButton exact icon={RI.add} green label={t("Установить зарплату и планы")} onClick={() => router.push("/analytics/salary-planning")} />
          <RefButton exact icon={RI.add} label={t("Добавить KPI")} onClick={() => setModalOpen(true)} />
        </div>
      </RefHeader>
      <RefTabs separate labels={["Активные", "Не активный", "Системные", "Все"]} value={tab} onChange={(value) => { setStatus(STATUS_BY_TAB[value]); setPage(1) }} />
      <RefCard className="mt-[20px] bg-white">
        <RefToolbar
          linkFilter="flush"
          thinChevron
          filterWidth={354.5}
          searchWidth={300}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <RefFilterPanel narrow className="mt-[10px]" onClose={() => setFilterOpen(false)} onApply={() => { setFilterOpen(false); setPage(1) }} applyClassName="mt-[22px]">
              <FilterSelect label={t("Продукт")} value={productFilter} onChange={setProductFilter} options={productNames} />
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => { setQuery(value); setPage(1) }}
          pageSize={pageSize}
          onPageSize={(value) => { setPageSize(value); setPage(1) }}
          from={filtered.length ? (page - 1) * pageSize + 1 : 0}
          to={Math.min(page * pageSize, filtered.length)}
          total={filtered.length}
          page={page}
          pageCount={pages}
          onPage={setPage}
        />
        <RefTable
          cols="110px 207px 411px 207px 205px minmax(0,1fr)"
          heads={[
            // Only "№" sorts in the reference (ordering=id → -id → off); a sort arrow follows the label.
            <button key="id" type="button" onClick={() => { setOrdering((current) => (current === "" ? "id" : current === "id" ? "-id" : "")); setPage(1) }} className="relative inline-block h-[36px] pr-[30px] text-left font-semibold leading-[36px] text-white focus:outline-none">
              <span>№</span>
              {ordering && (
                <svg viewBox="0 0 24 24" className="absolute left-[19.3px] top-[10px] block h-[15px] w-[24px] fill-white"><path d={ordering === "id" ? "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z" : "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z"} /></svg>
              )}
            </button>,
            <span key="n">{t("Наименование")}</span>,
            <span key="p">{t("Тип плана")}</span>,
            <span key="c">{t("Тип клиента")}</span>,
            <span key="m">{t("Комментарий")}</span>,
            <span key="a">{t("Активный")}</span>,
          ]}
          rows={shown}
          rowKey={(task) => task.id}
          onRowClick={(task) => setSelectedId((current) => (current === task.id ? null : task.id))}
          rowClass={(task) => (selectedId === task.id ? "!hidden" : "")}
          empty={
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-4">
              <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={150} height={150} priority className="h-36 w-36 object-contain" />
              <p className="text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
            </div>
          }
          render={(task) => [
            <span key="id" className="pl-2">{task.id}</span>,
            <span key="n">{task.name}</span>,
            t(planLabel(task.planType)),
            t(clientLabel(task.clientType)),
            task.comment,
            <span
              key="a"
              className={`relative -left-[3.5px] mx-auto block h-[10px] w-[10px] rounded-full ${task.active ? "bg-[#81c784]" : "bg-[#e57373]"}`}
            />,
          ]}
          expanded={(task) =>
            selectedId === task.id ? (
              <KpiTaskDetail
                task={task}
                onEdit={() => setEditingTask(task)}
                onCopy={() => setCopyingTask(task)}
                onSwitchActive={() => setConfirmTask(task)}
                onLock={() => setLockTask(task)}
                onClose={() => setSelectedId(null)}
              />
            ) : null
          }
        />
      </RefCard>
      {modalOpen && (
        <KpiFormDialog
          onClose={() => setModalOpen(false)}
          onSave={async (value) => {
            await createTask(value)
            setModalOpen(false)
            setStatus("active")
          }}
        />
      )}
      {copyingTask && (
        <KpiFormDialog
          editing={copyingTask}
          duplicate
          onClose={() => setCopyingTask(null)}
          onSave={async (value) => {
            await createTask(value)
            setCopyingTask(null)
          }}
        />
      )}
      {confirmTask && (
        <KpiActiveConfirm
          name={confirmTask.name}
          active={confirmTask.active}
          onClose={() => setConfirmTask(null)}
          onConfirm={() => {
            void toggleTaskActive(confirmTask)
            setConfirmTask(null)
          }}
        />
      )}
      {lockTask && (
        <KpiLockDialog
          initial={{
            disableChange: Boolean(lockTask.detail?.disable_change),
            onlyForSystem: Boolean(lockTask.system),
            visibleOnlyOperator: Boolean(lockTask.detail?.visible_only_operator),
            operators: Array.isArray(lockTask.detail?.operators) ? (lockTask.detail.operators as Array<{ id: number; name: string }>) : [],
          }}
          onClose={() => setLockTask(null)}
          onSave={async (value) => {
            const response = await fetch(`/api/kpi-tasks/${lockTask.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lock: value }) })
            if (response.ok) {
              const saved = (await response.json()) as KpiTask
              setTasks((current) => current.map((item) => (item.id === lockTask.id ? saved : item)))
              setLockTask(null)
            } else notify(t("Сервер недоступен, попробуйте ещё раз"))
          }}
        />
      )}
      {editingTask && (
        <KpiFormDialog
          editing={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={async (value) => {
            await updateTask(editingTask.id, value)
            setEditingTask(null)
          }}
        />
      )}
    </RefPage>
  )
}

const calcLabels: Record<string, string> = {
  bonus: "Единоразовый бонус",
  for_each_unit: "Бонус за каждую единицу",
  for_each_unit_same_bonus_for_all: "Бонус за каждую единицу без учета предыдущих",
  percent_from_sales: "Процент от продаж",
  percent_from_sales_for_all: "Процент от продаж без учета предыдущих",
  percent_from_bonus_amount: "Процент от бонусные суммы",
  percent_from_bonus_amount_for_all: "Процент от бонуса без учета предыдущих",
  percent_from_bonus_fund: "Процент от бонусного фонда",
}
const dateLabels: Record<string, string> = { created_date: "Создания", delivered_date: "Доставки", accepted_date: "Принятия" }
// The reference resolves the two kinds against separate constants: an order date type "accepted_date" has no label (blank).
const orderDateLabels: Record<string, string> = { created_date: "Создания", delivered_date: "Доставки" }
const RU_MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const monthYear = (iso: string, t: (key: string) => string) => `${t(RU_MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? "")} ${iso.slice(0, 4)}`
const amount = (value: string | number | null | undefined) => (value == null ? "" : Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 9 }))

const GREEN_TEXT = "font-semibold leading-[25px] text-[#48a34b]"
const GREEN = GREEN_TEXT
const NO_EXTRA_PLANS = new Set(["sales_sum_order", "product_sales_amount_order", "activate_count", "active_client_count", "product_sales_weight", "visit", "attendance"])

function KpiTaskDetail({
  task,
  onEdit,
  onCopy,
  onSwitchActive,
  onLock,
  onClose,
}: {
  task: KpiTask
  onEdit: () => void
  onCopy: () => void
  onSwitchActive: () => void
  onLock: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const detail = task.detail ?? {}
  const active = task.active
  const extraCondition =
    task.planType === "attendance" && detail.attendance_type?.length
      ? "Выбранным статусам посещения"
      : detail.is_order_status && task.planType !== "attendance" && task.planType !== "visit"
        ? "Выбранные статусы заказов"
        : detail.is_order_return_status && !NO_EXTRA_PLANS.has(task.planType)
          ? "Выбранные статусы возвратов"
          : "Нет дополнительных условий"
  const icon = "h-5 w-5 fill-[#666]"
  const pills = (items: Array<{ name: string }> | undefined, empty: string) =>
    (items?.length ? items.map((item) => item.name) : [empty]).map((name, index) => (
      <span key={`${name}-${index}`} className="mr-[6px] inline-block rounded-[16px] bg-[#e9ecef] px-[5px] py-[5px] text-[13px] leading-[16.3px] text-[#333]">{t(name)}</span>
    ))
  const row = "flex items-center border-t border-[#eceff1] pb-[14.5px] pt-[15.5px] text-[13px] leading-[25px]"
  const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"
  const levelCols = "grid-cols-[163.8px_81.9px_163.8px_163.8px_163.8px_1fr]"
  return (
    <div className="bg-[#f2f5f8] py-[20px]">
    <div className="-mx-[15px] flex min-h-[566px] flex-col bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex h-[65px] cursor-pointer items-center justify-between px-[30px] pb-[1px]" onClick={onClose}>
        <h2 className="text-[18px] font-semibold leading-[22.5px] text-[#333]">{task.name}</h2>
        <div className="relative -top-[2px] flex cursor-default items-center" onClick={(event) => event.stopPropagation()}>
          <RefTip text={t("Изменить блокировку")} side="bottom" gap={11.5}><button type="button" onClick={onLock} aria-label={t("Изменить блокировку")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className={icon}><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" /></svg></button></RefTip>
          <RefTip text={t("Изменить")} side="bottom" gap={11.5}><button type="button" onClick={onEdit} aria-label={t("Изменение KPI")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className={icon}><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button></RefTip>
          <RefTip text={t("Дублируйте этот KPI")} side="left" gap={12}><button type="button" onClick={onCopy} aria-label={t("Дублируйте этот KPI")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className={icon}><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg></button></RefTip>
          <RefTip text={t(active ? "Сделать не активный" : "Сделать активный")} side="left" gap={12}><button type="button" onClick={onSwitchActive} aria-label={t(active ? "Сделать не активный" : "Сделать активный")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className={icon}><path d={active ? "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"} /></svg></button></RefTip>
        </div>
      </div>
      <div className="flex flex-1 border-t border-[#eceff1]">
        <div className="w-[442.2px] shrink-0 border-r border-[#eceff1]">
          <div className="space-y-0 px-[30px] pb-[14.5px] pt-[14px] text-[13px] leading-[25px] text-[#333]">
            <div className="flex justify-between gap-[20px]"><span>{t("Тип плана:")}</span><b className="max-w-[268px] text-right font-semibold text-[#333]">{t(planLabel(task.planType))}</b></div>
            {detail.division?.name && <div className="flex justify-between gap-[8px]"><span>{t("Организация:")}</span><b className="font-semibold text-[#333]">{detail.division.name}</b></div>}
            {detail.calc_in_box && <div className={GREEN}>{t("В блоках")}</div>}
            {detail.use_chosen && (
              <div className="flex items-start justify-between gap-[8px]"><span>{t("Действует для:")}</span><b className="flex items-start font-semibold text-[#333]">{t("Для выбранных клиентов")}<RefTip text={t('Для того что бы KPI заработал нужно привязать задачу к выбранным клиентам через модуль "Клиенты"')} side="right"><svg viewBox="0 0 24 24" className="ml-[3.4px] h-6 w-6 fill-[#4f71dc]"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg></RefTip></b></div>
            )}
            <div className="flex justify-between gap-[8px] whitespace-nowrap"><span>{t("Дополнительные условия:")}</span><b className="font-semibold text-[#333]">{t(extraCondition)}</b></div>
            {detail.currency && (
              <div className="flex items-start justify-between"><span>{t("Валюта:")}</span><b className="flex items-start font-semibold text-[#333]">{detail.currency.name}<svg viewBox="0 0 24 24" className="ml-[3.4px] h-6 w-6 fill-[#4f71dc]"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg></b></div>
            )}
            {detail.bonus_fund != null && Number(detail.bonus_fund) !== 0 && <div className="flex justify-between gap-[8px]"><span>{t("Бонусный фонд:")}</span><b className="font-semibold text-[#333]">{amount(detail.bonus_fund)}</b></div>}
            {task.comment && (task.comment.length > 28 ? <div><span>{t("Комментарий:")}</span><b className="block font-semibold text-[#333]">{task.comment}</b></div> : <div className="flex justify-between gap-[8px]"><span>{t("Комментарий:")}</span><b className="font-semibold text-[#333]">{task.comment}</b></div>)}
            {detail.for_supervisor && <div className={GREEN}>{t("Учитывать продажу своих агентов")}</div>}
            {detail.is_paid_fully && <div className="flex justify-between gap-[8px]"><span>{t("Период закрытия")}</span><b className="font-semibold text-[#333]">{` ${t("от")} ${amount(detail.paid_days_from)} ${t("до")} ${amount(detail.paid_days_to)} ${t("дней")}`}</b></div>}
            {active && (
              <div className={GREEN_TEXT}>
                {t("Активный")}
                {(task.startDate || task.tillDate) && (
                  <span className="ml-[5px] font-normal text-[#333]">
                    {"("}{task.startDate ? `${t("с")} ${monthYear(task.startDate, t)}` : ""} {task.tillDate ? `${t("до")} ${monthYear(task.tillDate, t)}` : ""} {")"}
                  </span>
                )}
              </div>
            )}
            {(detail.only_for_system || task.system) && <div className={GREEN}>{t("Системный")}</div>}
            {detail.is_mml && <div className={GREEN}>{t("ММЛ продукты")}</div>}
            {detail.is_mml && <div className={GREEN}>{t("Продавать эти продукты в одном заказе")}</div>}
          </div>
          <div className={`${row} mx-0 flex-col items-stretch px-[30px]`}>
            {detail.user_type?.name && <div className="flex justify-between"><span>{t("Действует для:")}</span><b className="font-semibold text-[#333]">{t(detail.user_type.name)}</b></div>}
            <div className="flex justify-between"><span>{t("Заказы по дате:")}</span><b className="font-semibold text-[#333]">{orderDateLabels[detail.order_date_type ?? "created_date"] ? t(orderDateLabels[detail.order_date_type ?? "created_date"]) : ""}</b></div>
            {detail.is_order_status && detail.order_status?.length ? (
              <div className="flex justify-between"><span>{t("Выбранные статусы заказов:")}</span><span className="text-right">{detail.order_status.map((code) => <b key={String(code)} className="block font-semibold text-[#333]">{t(KPI_ORDER_STATUSES.find((item) => item.value === String(code))?.label ?? String(code))}</b>)}</span></div>
            ) : null}
          </div>
          <div className={`${row} mx-0 flex-col items-stretch px-[30px]`}>
            <div className="flex justify-between"><span>{t("Возвраты по дате:")}</span><b className="font-semibold text-[#333]">{t(dateLabels[detail.order_return_date_type ?? "created_date"] ?? "Создания")}</b></div>
            {detail.is_order_return_status && detail.order_return_status?.length ? (
              <div><span className="block">{t("Выбранные статусы возвратов:")}</span>{detail.order_return_status.map((code) => <b key={String(code)} className="block font-semibold text-[#333]">{t(KPI_RETURN_STATUSES.find((item) => item.value === String(code))?.label ?? String(code))}</b>)}</div>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 flex-1 pl-[27px] pr-[30px] pt-[19px] text-[13px]">
          <p className="ml-[3px] font-bold leading-[16.3px] text-[#333]">{t("Уровень вознаграждения")}</p>
          <div className={`relative -ml-[5px] mt-[5px] grid h-[50px] grid-cols-[161.1px_80.6px_161.1px_161.1px_161.1px_241.7px] items-center pl-[5px] font-semibold leading-[16.3px] text-[#333] ${DOTTED}`}>
            <span className="px-2">№</span><span className="px-2 text-right">{t("От")}</span><span className="px-2 text-right">{t("До")}</span><span className="px-2 text-right">{t("Бонус")}</span><span className="px-2 text-right">{t("Тип расчета")}</span><span className="px-2 text-right">{t("Обнуление предыдущих уровней")}</span>
          </div>
          {(detail.levels ?? []).map((level, index) => (
            <div key={index} className={`relative -ml-[5px] grid h-[60px] ${levelCols} items-center pl-[5px] leading-[16.3px] text-[#333] ${DOTTED}`}>
              <span className="px-2">{index + 1}</span><span className="px-2 text-right">{amount(level.from_amount)} %</span><span className="px-2 text-right">{amount(level.to_amount)} %</span><span className="px-2 text-right">{amount(level.bonus_amount)}</span><span className="px-2 text-right">{t(calcLabels[level.calculation_type] ?? level.calculation_type)}</span>
              <b className="pl-2 text-right font-bold leading-[18px]">{t(level.exclude_low_level ? "Включено" : "Отключено")}</b>
            </div>
          ))}
          <div className="ml-[3px]">
            {[
              ["Выбранные бренды", detail.brands, "Нет связанных бренд"],
              ["Прайс листы:", detail.price_lists, "Нет связанных прайс листов"],
              ["Выбранные продукты:", detail.products, "Нет связанных товаров"],
              ["Выбранные тип продукты:", detail.product_types, "Нет связанных товаров"],
              ["Выбранные группы товаров:", detail.group_products, "Нет связанных товаров"],
            ].map(([label, items, empty]) => (
              <div key={label as string} className="flex h-[67px] items-center border-t border-[#efefef]">
                <b className="mr-[10px] font-semibold leading-[26px] text-[#333]">{t(label as string)}</b>
                <div>{pills(items as Array<{ name: string }> | undefined, empty as string)}</div>
              </div>
            ))}
            {([
              ["Выбранные зоны:", detail.borders?.map((item) => ({ name: item.name ?? item.title ?? "" }))],
              ["Выбранные типы клиентов:", detail.market_types],
              ["Выбранные филиалы:", detail.branches],
              ["Выбранные транспорты:", detail.transports?.map((item) => ({ name: item.number ?? item.name ?? "" }))],
            ] as Array<[string, Array<{ name: string }> | undefined]>).map(([label, items]) =>
              items?.length ? (
                <div key={label} className="flex h-[67px] items-center border-t border-[#efefef]">
                  <b className="mr-[10px] font-semibold leading-[26px] text-[#333]">{t(label)}</b>
                  <div>{pills(items, "")}</div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

// "Фильтр" of the KPI tab: the reference lays it over the user card with four underlined selects and "ПРИМЕНИТЬ".
function KpiFilterDialog({ months, onClose, onApply }: { months: string[]; onClose: () => void; onApply: (month: string, year: string) => void }) {
  const { t } = useLanguage()
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")
  const [organization, setOrganization] = useState("")
  const [branch, setBranch] = useState("")
  const [organizations, setOrganizations] = useState<string[]>([])
  const [branches, setBranches] = useState<string[]>([])

  useEffect(() => {
    const names = (url: string, set: (list: string[]) => void) =>
      fetch(url)
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: Array<{ name?: string }>) => set([...new Set(rows.map((row) => row.name ?? "").filter(Boolean))]))
        .catch(() => {})
    void names("/api/organizations", setOrganizations)
    void names("/api/branches", setBranches)
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="absolute left-[30px] top-[110px] z-[60] h-[186px] w-[1440px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="absolute left-[20px] top-[25px] text-[15px] leading-[18px] text-[#666]">{t("Фильтр")}</div>
      <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[20px] top-[22px] h-6 w-6">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.59-13L12 10.59 8.41 7 7 8.41 10.59 12 7 15.59 8.41 17 12 13.41 15.59 17 17 15.59 13.41 12 17 8.41z" /></svg>
      </button>
      <div className="absolute left-[20px] right-[20px] top-[65px] grid grid-cols-4 gap-x-[13px]">
        <ReportSelectField label="Месяц" value={month} onChange={setMonth} options={months} />
        <ReportSelectField label="Год" value={year} onChange={setYear} options={["2024", "2025", "2026", "2027"]} />
        <ReportSelectField label="Организации" value={organization} onChange={setOrganization} options={organizations} />
        <ReportSelectField label="Филиал" value={branch} onChange={setBranch} options={branches} />
      </div>
      <button type="button" onClick={() => onApply(month, year)} className="absolute left-[20px] top-[140px] h-[36px] rounded-[4px] bg-[#5d6474] px-4 text-[13px] font-semibold uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-110">
        {t("Применить")}
      </button>
    </div>
  )
}
