"use client"

import Image from "next/image"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { Copy, ListFilter, Lock, Pencil, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { csvText } from "@/lib/csv"
import { useLanguage } from "@/lib/i18n/language-context"

type KpiTask = {
  id: number
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
  system?: boolean
}

const planTypes = [
  "Сумма фактической продажи (продажа - возврат)",
  "Кол-во фактической продажи (продажа - возврат)",
  "Сумма продаж (продажа-возврат от продаж)",
  "Кол-во продаж (продажа-возврат от продаж)",
  "Активация неактивных",
  "АКБ",
  "Оплата (принятые на кассу)",
  "Вес фактической продажи (продажа - возврат)",
  "Визит",
  "Посещение",
  "Вес фактической доставки",
  "Кол-во доставленных продуктов",
  "Сумма доставки (продажа-возврат от продаж)",
  "Количество оплативших клиентов",
  "Индикатор ММЛ / АКБ",
  "Плановый Визит ПО ДНЯМ",
  "Perfect Store (% от визитов)",
  "Количество заказов",
]

const initialTasks: KpiTask[] = []

export function KpiPerformanceView() {
  const { t } = useLanguage()
  const router = useRouter()
  const today = new Date()
  const [month, setMonth] = useState(today.getMonth())
  const [year, setYear] = useState(today.getFullYear())
  const [recalculating, setRecalculating] = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  function downloadCsv() {
    const csv = csvText([[t("Месяц"), t("Год"), "KPI", t("Значение")], [month + 1, year, t("Общий объем во всех KPI"), 0]])
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

  return (
    <ReportPage>
      <WidgetHeader active="KPI" />
      <WidgetUserCard showPeriods={false}>
        <div className="ml-auto flex gap-[10px]">
          <button type="button" onClick={() => router.push("/analytics/kpi-tasks")} className="h-[30px] rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("KPI задачи")}</button>
          <button type="button" onClick={() => router.push("/analytics/salary-planning")} className="h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Зарплата и установка планов")}</button>
          <button type="button" onClick={() => router.push("/analytics/visits-by-day")} className="h-[30px] rounded-[3px] bg-[#fa8072] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Посещения")}</button>
          <button type="button" onClick={() => setShowFilter((value) => !value)} className="flex h-[30px] items-center gap-[6px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><ListFilter className="h-4 w-4" />{showFilter ? t("Скрыть фильтр") : t("Показать фильтр")}</button>
        </div>
      </WidgetUserCard>
      {showFilter && (
        <div className="mx-[30px] mt-[10px] grid h-[77px] grid-cols-[240px_240px] gap-[15px] bg-white px-[30px] pt-[8px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <ReportSelectField label="Месяц" value={MONTHS[month]} onChange={(value) => setMonth(value ? MONTHS.indexOf(value) : today.getMonth())} options={MONTHS} />
          <ReportSelectField label="Год" value={String(year)} onChange={(value) => setYear(value ? Number(value) : today.getFullYear())} options={["2024", "2025", "2026", "2027"]} />
        </div>
      )}
      <section className="mx-[30px] mt-[16px] grid gap-[16px] md:grid-cols-[249px_1fr]">
        <div>
          <h2 className="mb-[10px] text-[13px] font-semibold leading-4">KPI</h2>
          <div className="min-h-[631px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <button type="button" aria-current="true" onClick={recalc} className="h-11 w-full bg-[#f2f5f8] px-[18px] text-left text-[13px] text-[#333]">{t("Общий объем во всех кпэ")}</button>
          </div>
        </div>
        <div>
          <div className="mb-[2px] flex h-[16px] items-center justify-between">
            <h2 className="text-[13px] font-semibold leading-4">{t("Общий объем")}</h2>
            <div className="flex items-center gap-[10px] text-[13px] font-semibold">
              <button type="button" onClick={downloadCsv} className="flex h-[30px] items-center gap-[6px] rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95"><svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d={RI.chart ?? RI.download} /></svg>{t("Скачать")}</button>
              <span>{t("данные за")}</span>
              <button type="button" onClick={recalc} className={`text-[#71ce87] ${recalculating ? "opacity-60" : ""}`}>{t("Перерасчет")}</button>
            </div>
          </div>
          <div className="mt-[14px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"><ReportEmpty className="pb-[44px] pt-[56px]" /></div>
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
  const [planFilter, setPlanFilter] = useState("")
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
        if (!cancelled) setTasks(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function createTask(input: { name: string; planType: string; clientType: string; comment: string; active: boolean }) {
    try {
      const response = await fetch("/api/kpi-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!response.ok) return
      const saved = (await response.json()) as KpiTask
      setTasks((current) => [saved, ...current])
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function updateTask(id: number, input: { name: string; planType: string; clientType: string; comment: string; active: boolean }) {
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
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
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
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function deleteTask(id: number) {
    try {
      const response = await fetch(`/api/kpi-tasks/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setTasks((current) => current.filter((item) => item.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function copyTask(task: KpiTask) {
    await createTask({ name: `${task.name} (${t("копия")})`, planType: task.planType, clientType: task.clientType, comment: task.comment, active: task.active })
  }

  const filtered = useMemo(() => tasks.filter((task) => {
    const tabMatch = tab === "Все" || (tab === "Активные" && task.active) || (tab === "Не активный" && !task.active) || (tab === "Системные" && task.system)
    const queryMatch = `${task.name} ${task.planType}`.toLowerCase().includes(query.toLowerCase())
    return tabMatch && queryMatch && (!planFilter || task.planType === planFilter)
  }), [tasks, tab, query, planFilter])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <RefPage>
      <RefHeader title={t("KPI задачи")}>
        <RefButton icon={RI.add} green label={t("Установить зарплату и планы")} onClick={() => router.push("/analytics/salary-planning")} />
        <RefButton icon={RI.add} label={t("Добавить KPI")} onClick={() => setModalOpen(true)} />
      </RefHeader>
      <RefCard className="bg-white">
        <RefTabs labels={["Активные", "Не активный", "Системные", "Все"]} value={tab} onChange={(value) => { setTab(value); setPage(1) }} />
      </RefCard>
      <RefCard className="mt-[20px] bg-white">
        <RefToolbar
          linkFilter
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <div className="w-72 border border-slate-200 bg-white p-4 shadow-xl">
              <select value={planFilter} onChange={(event) => { setPlanFilter(event.target.value); setPage(1) }} className="w-full border-b border-[#e0e0e0] bg-white py-2 text-[13px] outline-none">
                <option value="">{t("Все типы плана")}</option>
                {planTypes.map((item) => <option key={item} value={item}>{t(item)}</option>)}
              </select>
            </div>
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
          empty={
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-4">
              <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={150} height={150} priority className="h-36 w-36 object-contain" />
              <p className="text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
            </div>
          }
          render={(task) => [
            task.id,
            <span key="n">{task.name}</span>,
            t(task.planType),
            t(task.clientType),
            task.comment,
            <button
              key="a"
              type="button"
              onClick={(event) => { event.stopPropagation(); void toggleTaskActive(task) }}
              aria-label={t("Изменить активность")}
              className={`ml-3 block h-[10px] w-[10px] rounded-full ${task.active ? "bg-[#71ce87]" : "bg-[#fa8072]"}`}
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
        <AddKpiModal
          onClose={() => setModalOpen(false)}
          onSave={(task) => {
            void createTask({ name: task.name, planType: task.planType, clientType: task.clientType, comment: task.comment, active: task.active })
            setModalOpen(false)
            setTab("Активные")
          }}
          nextId={Math.max(0, ...tasks.map((task) => task.id)) + 1}
        />
      )}
      {editingTask && (
        <AddKpiModal
          editing={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={(task) => {
            void updateTask(editingTask.id, { name: task.name, planType: task.planType, clientType: task.clientType, comment: task.comment, active: task.active })
            setEditingTask(null)
          }}
          nextId={editingTask.id}
        />
      )}
    </RefPage>
  )
}

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
  const bonusMatch = task.comment.match(/Бонус:\s*([\d\s,.]+)\s*(SUM|USD)/)
  const bonus = bonusMatch ? bonusMatch[1].trim() : "10 000"

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-slate-800">{task.name}</h2>
        <div className="flex items-center gap-4 text-slate-500">
          <button type="button" onClick={onToggleActive} aria-label={t("Изменить статус")} className="hover:text-[#5470e8]">
            <Lock className="h-5 w-5" />
          </button>
          <button type="button" onClick={onEdit} aria-label={t("Изменить")} className="hover:text-[#5470e8]">
            <Pencil className="h-5 w-5" />
          </button>
          <button type="button" onClick={onCopy} aria-label={t("Дублировать")} className="hover:text-[#5470e8]">
            <Copy className="h-5 w-5" />
          </button>
          <button type="button" onClick={onDelete} aria-label={t("Удалить")} className="hover:text-red-500">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="space-y-2 text-[15px] text-slate-700">
          <p>
            {t("Тип плана:")} <b className="ml-2 text-slate-900">{t(task.planType)}</b>
          </p>
          <p>
            {t("Дополнительные условия:")} <b className="ml-2 text-slate-900">{t("Нет дополнительных условий")}</b>
          </p>
          <p className={task.active ? "font-semibold text-[#71ce87]" : "font-semibold text-red-500"}>{task.active ? t("Активный") : t("Не активный")}</p>
          <p className="pt-3">
            {t("Заказы по дате:")} <b className="ml-2 text-slate-900">{t("Создания")}</b>
          </p>
          <p>
            {t("Возвраты по дате:")} <b className="ml-2 text-slate-900">{t("Создания")}</b>
          </p>
        </div>
        <div>
          <p className="mb-3 font-semibold text-slate-800">{t("Уровень вознаграждения")}</p>
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 pr-4 font-medium">№</th>
                <th className="pb-2 pr-4 font-medium">{t("От")}</th>
                <th className="pb-2 pr-4 font-medium">{t("До")}</th>
                <th className="pb-2 pr-4 font-medium">{t("Бонус")}</th>
                <th className="pb-2 pr-4 font-medium">{t("Тип расчета")}</th>
                <th className="pb-2 font-medium">{t("Обнуление предыдущих уровней")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-dashed border-slate-200">
                <td className="py-3 pr-4">1</td>
                <td className="py-3 pr-4">0 %</td>
                <td className="py-3 pr-4">100 %</td>
                <td className="py-3 pr-4">{bonus}</td>
                <td className="py-3 pr-4">{t("Бонус за каждую единицу")}</td>
                <td className="py-3 font-semibold">{t("Включено")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        <p>
          <span className="text-slate-800">{t("Выбранные бренды")}</span> <span className="ml-2 rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{t("Нет связанных бренд")}</span>
        </p>
        <p>
          <span className="text-slate-800">{t("Прайс листы:")}</span> <span className="ml-2 rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{t("Нет связанных прайс листов")}</span>
        </p>
        <p>
          <span className="text-slate-800">{t("Выбранные продукты:")}</span> <span className="ml-2 rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{t("Нет связанных товаров")}</span>
        </p>
        <p>
          <span className="text-slate-800">{t("Выбранные тип продукты:")}</span> <span className="ml-2 rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{t("Нет связанных товаров")}</span>
        </p>
        <p>
          <span className="text-slate-800">{t("Выбранные группы товаров:")}</span> <span className="ml-2 rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{t("Нет связанных товаров")}</span>
        </p>
      </div>
    </div>
  )
}

function AddKpiModal({ onClose, onSave, nextId, editing }: { onClose: () => void; onSave: (task: KpiTask) => void; nextId: number; editing?: KpiTask }) {
  const { t } = useLanguage()
  const [name, setName] = useState(editing?.name ?? "")
  const [comment, setComment] = useState(editing?.comment ?? "")
  const [bonus, setBonus] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [currency, setCurrency] = useState("SUM")
  const [organization, setOrganization] = useState("")
  const [planType, setPlanType] = useState(editing?.planType ?? planTypes[0])
  const [active, setActive] = useState(editing?.active ?? true)
  const [mmlOnly, setMmlOnly] = useState(false)
  const [clientFilters, setClientFilters] = useState<string[]>([])
  const [extraFlags, setExtraFlags] = useState<string[]>([])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    onSave({
      id: nextId,
      name: name.trim(),
      planType,
      clientType: clientFilters.length ? clientFilters.join(", ") : editing?.clientType ?? "Для всех",
      comment: `${comment}${bonus ? ` · Бонус: ${bonus} ${currency}` : ""}${organization ? ` · ${organization}` : ""}${from && to ? ` · ${from}—${to}` : ""}`,
      active,
      system: editing?.system,
    })
  }

  return (
    <div className="fixed inset-0 z-[100] bg-white text-[13px] p-0"><form onSubmit={submit} className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center justify-between border-b px-[14px] py-[16px]"><h2 className="font-bold uppercase">{editing ? t("Изменить KPI") : t("Добавление KPI")}</h2><button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-7 w-7" /></button></header>
      <div className="grid flex-1 overflow-y-auto lg:grid-cols-[405px_1fr]">
        <div className="border-r p-[14px]">
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Название задачи *")} className="w-full border-0 border-b py-2 text-[13px] font-semibold outline-none" />
          <div className="mt-[14px] grid grid-cols-2 gap-5"><label className="text-xs">{t("Дата начала")}<input type="month" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-b py-2" /></label><label className="text-xs">{t("Дата окончания")}<input type="month" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-b py-2" /></label></div>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-[14px] w-full border-b py-3"><option>SUM</option><option>USD</option></select>
          <input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder={t("Организация")} className="mt-[14px] w-full border-0 border-b py-3" />
          <h3 className="mt-3 font-bold">{t("Правила отбора")}</h3><div className="mt-3 space-y-[10px] text-[10px]">{planTypes.map((item) => <label key={item} className="flex items-center gap-4"><input type="radio" name="plan-type" checked={planType === item} onChange={() => setPlanType(item)} className="h-6 w-6" />{t(item)}</label>)}</div>
          <h3 className="mt-5 font-bold">{t("Действует для клиентов:")}</h3>{["Фильтровать по клиентам", "Фильтровать по зонам", "Фильтровать по типам клиентов", "Фильтровать по филиалам"].map((item) => <CheckOption key={item} label={item} values={clientFilters} setValues={setClientFilters} />)}
          <hr className="my-5" /><CheckOption label="Активный" values={active ? ["Активный"] : []} setValues={() => setActive((value) => !value)} />
          {["Учитывать только оплаченные заказы", "Учитывать продажу своих агентов", "Фильтровать по брендам", "Фильтровать по продуктам", "Фильтровать по типам продуктов", "Фильтровать Группы товаров", "Фильтровать по транспортам"].map((item) => <CheckOption key={item} label={item} values={extraFlags} setValues={setExtraFlags} />)}
        </div>
        <div>
          <div className="grid gap-8 p-[14px] md:grid-cols-2"><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Комментарий")} className="border-b p-3" /><input value={bonus} onChange={(event) => setBonus(event.target.value)} placeholder={t("Бонусный фонд")} className="border-0 border-b" /></div>
          <label className="mx-[14px] flex items-center gap-3 font-semibold"><input type="checkbox" checked={mmlOnly} onChange={(event) => setMmlOnly(event.target.checked)} />{t("Учитывать только ММЛ продукты")}</label>
          <h3 className="mx-[14px] mt-5 font-bold">{t("Уровень вознаграждения")}</h3>
          <div className="mt-10 grid gap-5 bg-slate-100 px-[20px] py-[14px] md:grid-cols-5"><input type="number" min="0" placeholder={t("от 0 %")} className="border-b bg-transparent" /><input type="number" min="0" placeholder={t("до %")} className="border-b bg-transparent" /><input type="number" min="0" placeholder={t("Бонус")} className="border-b bg-transparent" /><select className="border-b bg-transparent"><option>{t("Фиксированный")}</option><option>{t("Процент")}</option></select><label className="flex items-center gap-3"><input type="checkbox" />{t("Обнулить предыдущие уровни")}</label></div>
        </div>
      </div>
      <footer className="flex justify-end border-t px-[14px] py-[16px]"><button type="submit" className="text-[12px] font-bold uppercase text-[#0a9ddb]">{t("Сохранить")}</button></footer>
    </form></div>
  )
}

function CheckOption({ label, values, setValues }: { label: string; values: string[]; setValues: React.Dispatch<React.SetStateAction<string[]>> }) {
  const { t } = useLanguage()
  return <label className="mt-3 flex items-center gap-3 font-semibold"><input type="checkbox" checked={values.includes(label)} onChange={() => setValues((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])} className="h-5 w-5" />{t(label)}</label>
}
