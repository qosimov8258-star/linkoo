"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { ListFilter } from "lucide-react"
import { useRouter } from "next/navigation"
import { KpiFormDialog, type KpiFormValue } from "@/components/analytics/kpi-form"
import { FilterSelect, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

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
  levels?: Array<{ calculation_type: string; from_amount: string; to_amount: string; bonus_amount: string; exclude_low_level: boolean }>
  brands?: Array<{ name: string }>
  price_lists?: Array<{ name: string }>
  products?: Array<{ name: string }>
  product_types?: Array<{ name: string }>
  group_products?: Array<{ name: string }>
  order_status?: unknown[]
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
          <section className="mx-[30px] -mt-[2px] flex h-[84px] gap-[29px] bg-white px-[28px] pt-[5px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <div className="w-[255px]"><ReportSelectField label="Месяц" value={MONTHS[month]} onChange={(value) => value && setMonth(MONTHS.indexOf(value))} options={MONTHS} /></div>
            <div className="w-[255px]"><ReportSelectField label="Год" value={String(year)} onChange={(value) => value && setYear(Number(value))} options={["2024", "2025", "2026", "2027"]} /></div>
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
      <section className={`mx-[30px] ${standalone ? "mt-[18px]" : "mt-[10px]"} grid gap-x-[28px] md:grid-cols-[250px_1fr]`}>
        <div>
          <div className="mb-[10px] flex h-[30px] items-center px-[5px]"><h2 className="text-[13px] font-semibold leading-4">KPI</h2></div>
          <div className="min-h-[720px] bg-white p-px shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <button type="button" aria-current="true" onClick={recalc} className="h-[44.3px] w-full bg-[#f2f5f8] px-[17px] pt-[8px] text-left text-[13px] text-[#2c2c2c]">{t("Общий объем во всех кпэ")}</button>
          </div>
        </div>
        <div>
          <div className="mb-[10px] flex h-[30px] items-center justify-between px-[5px]">
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
          <div className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"><ReportEmpty className="pb-[46px] pt-[54px]" /></div>
        </div>
      </section>
    </ReportPage>
  )
}

export function KpiTasksView() {
  const { t } = useLanguage()
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [tab, setTab] = useState("Активные")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  // The reference filters KPIs by their linked products (kpi_task_details).
  const [productFilter, setProductFilter] = useState("")
  const [productNames, setProductNames] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<KpiTask | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

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
      if (!response.ok) return
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

  async function deleteTask(id: number) {
    try {
      const response = await fetch(`/api/kpi-tasks/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setTasks((current) => current.filter((item) => item.id !== id))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function copyTask(task: KpiTask) {
    await createTask({ name: `${task.name} (${t("копия")})`, planType: task.planType, clientType: task.clientType, comment: task.comment, active: task.active, detail: task.detail ?? undefined, startDate: task.startDate, tillDate: task.tillDate })
  }

  const filtered = useMemo(() => tasks.filter((task) => {
    const tabMatch = tab === "Все" || (tab === "Активные" && isCurrentlyActive(task)) || (tab === "Не активный" && !isCurrentlyActive(task)) || (tab === "Системные" && task.system)
    const queryMatch = `${task.name} ${planLabel(task.planType)}`.toLowerCase().includes(query.toLowerCase())
    return tabMatch && queryMatch && (!productFilter || Boolean(task.detail?.products?.some((product) => product.name === productFilter)))
  }), [tasks, tab, query, productFilter])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <RefPage>
      <RefHeader title={t("KPI задачи")}>
        <div className="mr-[8px] flex items-center gap-[18px]">
          <RefButton exact icon={RI.add} green label={t("Установить зарплату и планы")} onClick={() => router.push("/analytics/salary-planning")} />
          <RefButton exact icon={RI.add} label={t("Добавить KPI")} onClick={() => setModalOpen(true)} />
        </div>
      </RefHeader>
      <RefTabs separate labels={["Активные", "Не активный", "Системные", "Все"]} value={tab} onChange={(value) => { setTab(value); setPage(1) }} />
      <RefCard className="mt-[20px] bg-white">
        <RefToolbar
          linkFilter="flush"
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
          heads={[t("№"), t("Наименование"), t("Тип плана"), t("Тип клиента"), t("Комментарий"), t("Активный")]}
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
            task.id,
            <span key="n">{task.name}</span>,
            t(planLabel(task.planType)),
            t(clientLabel(task.clientType)),
            task.comment,
            <button
              key="a"
              type="button"
              onClick={(event) => { event.stopPropagation(); void toggleTaskActive(task) }}
              aria-label={t("Изменить активность")}
              className={`mx-auto block h-[10px] w-[10px] rounded-full ${isCurrentlyActive(task) ? "bg-[#81c784]" : "bg-[#fa8072]"}`}
            />,
          ]}
          expanded={(task) =>
            selectedId === task.id ? (
              <KpiTaskDetail
                task={task}
                onEdit={() => setEditingTask(task)}
                onCopy={() => void copyTask(task)}
                onDelete={() => {
                  void deleteTask(task.id)
                  setSelectedId(null)
                }}
                onToggleActive={() => void toggleTaskActive(task)}
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
            setTab("Активные")
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
const amount = (value: string | number | null | undefined) => (value == null ? "" : Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 9 }))

function KpiTaskDetail({
  task,
  onEdit,
  onCopy,
  onDelete,
  onToggleActive,
}: {
  task: KpiTask
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  const { t } = useLanguage()
  const detail = task.detail ?? {}
  const active = isCurrentlyActive(task)
  const icon = "h-5 w-5 fill-[#5d6474]"
  const pills = (items: Array<{ name: string }> | undefined, empty: string) =>
    (items?.length ? items.map((item) => item.name) : [empty]).map((name, index) => (
      <span key={`${name}-${index}`} className="mr-[6px] inline-block rounded-[16px] bg-[#eceff1] px-[12px] py-[5px] text-[13px] leading-[18px] text-[#333]">{t(name)}</span>
    ))
  const row = "flex items-center border-b border-[#eceff1] py-[18px] text-[13px]"
  return (
    <div className="-mx-[15px] my-[20px] flex min-h-[566px] flex-col bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="flex h-[66px] items-center justify-between px-[30px]">
        <h2 className="text-[18px] font-normal text-[#333]">{task.name}</h2>
        <div className="mr-[12px] flex items-center gap-[28px]">
          <button type="button" onClick={onToggleActive} aria-label={t("Изменить статус")}><svg viewBox="0 0 24 24" className={icon}><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" /></svg></button>
          <button type="button" onClick={onEdit} aria-label={t("Изменить")}><svg viewBox="0 0 24 24" className={icon}><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
          <button type="button" onClick={onCopy} aria-label={t("Дублировать")}><svg viewBox="0 0 24 24" className={icon}><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg></button>
          <button type="button" onClick={onDelete} aria-label={t("Удалить")}><svg viewBox="0 0 24 24" className={icon}><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
        </div>
      </div>
      <div className="flex flex-1 border-t border-[#eceff1]">
        <div className="w-[441px] shrink-0 border-r border-[#eceff1]">
          <div className="space-y-[7px] px-[30px] py-[20px] text-[13px] leading-[18px] text-[#555]">
            <div className="flex justify-between gap-[20px]"><span>{t("Тип плана:")}</span><b className="max-w-[268px] text-right font-semibold text-[#333]">{t(planLabel(task.planType))}</b></div>
            <div className="flex justify-between gap-[8px] whitespace-nowrap"><span>{t("Дополнительные условия:")}</span><b className="font-semibold text-[#333]">{t(detail.is_order_status && detail.order_status?.length ? "Выбранные статусы заказов" : "Нет дополнительных условий")}</b></div>
            {detail.currency && (
              <div className="flex items-center justify-between"><span>{t("Валюта:")}</span><b className="flex items-center font-semibold text-[#333]">{detail.currency.name}<svg viewBox="0 0 24 24" className="ml-[6px] h-6 w-6 fill-[#4f71dc]"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg></b></div>
            )}
            <div className={`font-semibold ${active ? "text-[#43a047]" : "text-[#e57373]"}`}>{t(active ? "Активный" : "Не активный")}</div>
          </div>
          <div className={`${row} mx-0 px-[30px]`}><span className="flex-1 text-[#555]">{t("Заказы по дате:")}</span><b className="font-semibold text-[#333]">{t(dateLabels[detail.order_date_type ?? "created_date"] ?? "Создания")}</b></div>
          <div className={`${row} mx-0 px-[30px]`}><span className="flex-1 text-[#555]">{t("Возвраты по дате:")}</span><b className="font-semibold text-[#333]">{t(dateLabels[detail.order_return_date_type ?? "created_date"] ?? "Создания")}</b></div>
        </div>
        <div className="min-w-0 flex-1 px-[30px] py-[20px] text-[13px]">
          <p className="mb-[16px] font-bold text-[#333]">{t("Уровень вознаграждения")}</p>
          <div className="grid grid-cols-[209px_161px_140px_1fr_auto_246px] border-b border-dotted border-[#cfd8dc] pb-[14px] pl-[5px] font-semibold text-[#333]">
            <span>№</span><span>{t("От")}</span><span>{t("До")}</span><span>{t("Бонус")}</span><span className="text-right">{t("Тип расчета")}</span><span className="text-right">{t("Обнуление предыдущих уровней")}</span>
          </div>
          {(detail.levels ?? []).map((level, index) => (
            <div key={index} className="grid grid-cols-[209px_161px_140px_1fr_auto_246px] items-center border-b border-dotted border-[#cfd8dc] py-[22px] pl-[5px] text-[#333]">
              <span>{index + 1}</span><span>{amount(level.from_amount)} %</span><span>{amount(level.to_amount)} %</span><span>{amount(level.bonus_amount)}</span><span className="text-right">{t(calcLabels[level.calculation_type] ?? level.calculation_type)}</span>
              <b className="text-right font-semibold">{t(level.exclude_low_level ? "Включено" : "Отключено")}</b>
            </div>
          ))}
          <div className="mt-[10px]">
            {[
              ["Выбранные бренды", detail.brands, "Нет связанных бренд"],
              ["Прайс листы:", detail.price_lists, "Нет связанных прайс листов"],
              ["Выбранные продукты:", detail.products, "Нет связанных товаров"],
              ["Выбранные тип продукты:", detail.product_types, "Нет связанных товаров"],
              ["Выбранные группы товаров:", detail.group_products, "Нет связанных товаров"],
            ].map(([label, items, empty]) => (
              <div key={label as string} className="flex min-h-[67px] items-center border-b border-[#eceff1]">
                <b className="mr-[10px] font-semibold text-[#333]">{t(label as string)}</b>
                <div>{pills(items as Array<{ name: string }> | undefined, empty as string)}</div>
              </div>
            ))}
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
