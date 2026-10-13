"use client"

import Image from "next/image"
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"
import { Copy, Download, ListFilter, Lock, Pencil, PlusCircle, RefreshCw, Search, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
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

  function downloadCsv() {
    const csv = `${t("Месяц")};${t("Год")};KPI;${t("Значение")}\n${month + 1};${year};${t("Общий объем во всех KPI")};0`
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "kpi-performance.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 py-4 sm:px-5">
        <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#5470e8]" />
        <div className="flex flex-wrap gap-7">
          <button type="button" onClick={() => router.push("/analytics/kpi-tasks")} className="rounded-md bg-[#71ce87] px-6 py-2.5 font-bold text-white">{t("KPI задачи")}</button>
          <button type="button" onClick={() => router.push("/analytics/salary-planning")} className="rounded-md bg-[#5470e8] px-6 py-2.5 font-bold text-white">{t("Зарплата и установка планов")}</button>
          <button type="button" onClick={() => router.push("/analytics/visits-by-day")} className="rounded-md bg-[#ff786e] px-6 py-2.5 font-bold text-white">{t("Посещения")}</button>
        </div>
      </header>
      <section className="grid gap-6 bg-white px-9 py-4 shadow md:grid-cols-2">
        <label className="text-xs">{t("Месяц")}<select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-1 block w-full border-0 border-b py-2 text-base"><option value={0}>{t("Январь")}</option><option value={1}>{t("Февраль")}</option><option value={2}>{t("Март")}</option><option value={3}>{t("Апрель")}</option><option value={4}>{t("Май")}</option><option value={5}>{t("Июнь")}</option><option value={6}>{t("Июль")}</option><option value={7}>{t("Август")}</option><option value={8}>{t("Сентябрь")}</option><option value={9}>{t("Октябрь")}</option><option value={10}>{t("Ноябрь")}</option><option value={11}>{t("Декабрь")}</option></select></label>
        <label className="text-xs">{t("Год")}<select value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block w-full border-0 border-b py-2 text-base">{[2024, 2025, 2026, 2027].map((item) => <option key={item}>{item}</option>)}</select></label>
      </section>
      <section className="mt-10 grid gap-8 md:grid-cols-[312px_1fr]">
        <div><h2 className="mb-3 font-semibold">KPI</h2><div className="min-h-[600px] bg-white shadow"><button type="button" aria-current="true" onClick={() => { setRecalculating(true); window.setTimeout(() => setRecalculating(false), 600) }} className="w-full bg-slate-100 px-5 py-4 text-left font-semibold text-[#17233b]">{t("Общий объем во всех KPI")}</button></div></div>
        <div>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{t("Общий объем")}</h2><div className="flex gap-7"><button type="button" onClick={downloadCsv} aria-label={t("Скачать")}><Download /></button><span>{t("данные за")}</span><button type="button" onClick={() => { setRecalculating(true); window.setTimeout(() => setRecalculating(false), 600) }} className="text-[#71ce87]"><RefreshCw className={`mr-2 inline h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />{t("Перерасчет")}</button></div></div>
          <div className="flex min-h-[370px] flex-col items-center justify-center bg-white shadow"><Image src="/robot-mascot.png" alt={t("Робот-помощник")} width={150} height={150} priority /><p className="mt-6 text-slate-400">{t("По вашему запросу ничего не найдено...")}</p></div>
        </div>
      </section>
    </main>
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
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-4 py-4 sm:px-5">
        <div className="flex items-center gap-2 text-2xl font-bold text-[#5470e8]"><FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#5470e8]" /> <span className="text-slate-500">|</span><span className="text-slate-600">{t("KPI задачи")}</span></div>
        <div className="flex gap-5"><button type="button" onClick={() => router.push("/analytics/salary-planning")} className="rounded-md bg-[#71ce87] px-6 py-2.5 font-bold text-white"><PlusCircle className="mr-2 inline h-5 w-5" />{t("Установить зарплату и планы")}</button><button type="button" onClick={() => setModalOpen(true)} className="rounded-md bg-[#5470e8] px-6 py-2.5 font-bold text-white"><PlusCircle className="mr-2 inline h-5 w-5" />{t("Добавить KPI")}</button></div>
      </header>
      <div className="grid grid-cols-4 bg-white shadow">{["Активные", "Не активный", "Системные", "Все"].map((item) => <button key={item} type="button" onClick={() => { setTab(item); setPage(1) }} className={`py-5 ${tab === item ? "border-b-4 border-[#5470e8]" : ""}`}>{t(item)}</button>)}</div>
      <section className="mt-6 bg-white shadow">
        <div className="flex flex-wrap items-center gap-5 px-2 py-4">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="text-[#5470e8]">{t("Показать фильтр")} <ListFilter className="inline h-4 w-4" /></button>
          <label className="relative mx-auto w-[370px]"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-0 border-b px-0 py-2 pr-9 outline-none" /><Search className="absolute right-1 top-2 h-5 w-5 text-slate-300" /></label>
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}><option>10</option><option>25</option><option>50</option></select>
          <span>{filtered.length ? `${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, filtered.length)} ${t("из")} ${filtered.length}` : `0 ${t("из")} 0`}</span>
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>◀</button><button type="button" disabled={page === pages} onClick={() => setPage((value) => value + 1)}>▶</button>
        </div>
        {filterOpen && <div className="border-t bg-slate-50 px-5 py-4"><select value={planFilter} onChange={(event) => { setPlanFilter(event.target.value); setPage(1) }} className="min-w-[340px] rounded border px-3 py-2"><option value="">{t("Все типы плана")}</option>{planTypes.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead className="bg-slate-600 text-white">
              <tr><th className="px-9 py-5 text-left">№</th><th className="px-5 py-5 text-left">{t("Наименование")}</th><th className="px-5 py-5 text-left">{t("Тип плана")}</th><th className="px-5 py-5 text-left">{t("Тип клиента")}</th><th className="px-5 py-5 text-left">{t("Комментарий")}</th><th className="px-5 py-5 text-center">{t("Активный")}</th></tr>
            </thead>
            <tbody>
              {shown.map((task) => (
                <Fragment key={task.id}>
                  <tr onClick={() => setSelectedId((current) => (current === task.id ? null : task.id))} className={`cursor-pointer border-b border-dashed hover:bg-slate-50 ${selectedId === task.id ? "bg-slate-50" : ""}`}>
                    <td className="px-9 py-4">{task.id}</td>
                    <td className="px-5 py-4 text-[#5470e8]">{task.name}</td>
                    <td className="px-5 py-4">{t(task.planType)}</td>
                    <td className="px-5 py-4">{t(task.clientType)}</td>
                    <td className="px-5 py-4">{task.comment}</td>
                    <td className="px-5 py-4 text-center">
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); void toggleTaskActive(task) }}
                        aria-label={t("Изменить активность")}
                        className={`h-3 w-3 rounded-full ${task.active ? "bg-green-400" : "bg-red-400"}`}
                      />
                    </td>
                  </tr>
                  {selectedId === task.id && (
                    <tr>
                      <td colSpan={6} className="border-b bg-white p-0">
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 py-10">
                      <Image src="/robot-mascot.png" alt={t("Робот-помощник")} width={150} height={150} priority className="h-36 w-36 object-contain" />
                      <p className="text-lg text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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
    </main>
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
    <div className="fixed inset-0 z-[100] bg-black/55 p-0"><form onSubmit={submit} className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center justify-between border-b px-9 py-6"><h2 className="font-bold uppercase">{editing ? t("Изменить KPI") : t("Добавление KPI")}</h2><button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-7 w-7" /></button></header>
      <div className="grid flex-1 overflow-y-auto lg:grid-cols-[570px_1fr]">
        <div className="border-r p-9">
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Название задачи *")} className="w-full border-0 border-b py-3 text-lg outline-none" />
          <div className="mt-8 grid grid-cols-2 gap-5"><label className="text-xs">{t("Дата начала")}<input type="month" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-b py-2" /></label><label className="text-xs">{t("Дата окончания")}<input type="month" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-b py-2" /></label></div>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-8 w-full border-b py-3"><option>SUM</option><option>USD</option></select>
          <input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder={t("Организация")} className="mt-8 w-full border-0 border-b py-3" />
          <h3 className="mt-3 font-bold">{t("Правила отбора")}</h3><div className="mt-3 space-y-3">{planTypes.map((item) => <label key={item} className="flex items-center gap-4"><input type="radio" name="plan-type" checked={planType === item} onChange={() => setPlanType(item)} className="h-6 w-6" />{t(item)}</label>)}</div>
          <h3 className="mt-5 font-bold">{t("Действует для клиентов:")}</h3>{["Фильтровать по клиентам", "Фильтровать по зонам", "Фильтровать по типам клиентов", "Фильтровать по филиалам"].map((item) => <CheckOption key={item} label={item} values={clientFilters} setValues={setClientFilters} />)}
          <hr className="my-5" /><CheckOption label="Активный" values={active ? ["Активный"] : []} setValues={() => setActive((value) => !value)} />
          {["Учитывать только оплаченные заказы", "Учитывать продажу своих агентов", "Фильтровать по брендам", "Фильтровать по продуктам", "Фильтровать по типам продуктов", "Фильтровать Группы товаров", "Фильтровать по транспортам"].map((item) => <CheckOption key={item} label={item} values={extraFlags} setValues={setExtraFlags} />)}
        </div>
        <div>
          <div className="grid gap-8 p-9 md:grid-cols-2"><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Комментарий")} className="border-b p-3" /><input value={bonus} onChange={(event) => setBonus(event.target.value)} placeholder={t("Бонусный фонд")} className="border-0 border-b" /></div>
          <label className="mx-9 flex items-center gap-3 font-semibold"><input type="checkbox" checked={mmlOnly} onChange={(event) => setMmlOnly(event.target.checked)} />{t("Учитывать только ММЛ продукты")}</label>
          <h3 className="mx-9 mt-5 font-bold">{t("Уровень вознаграждения")}</h3>
          <div className="mt-10 grid gap-5 bg-slate-100 px-12 py-8 md:grid-cols-5"><input type="number" min="0" placeholder={t("от 0 %")} className="border-b bg-transparent" /><input type="number" min="0" placeholder={t("до %")} className="border-b bg-transparent" /><input type="number" min="0" placeholder={t("Бонус")} className="border-b bg-transparent" /><select className="border-b bg-transparent"><option>{t("Фиксированный")}</option><option>{t("Процент")}</option></select><label className="flex items-center gap-3"><input type="checkbox" />{t("Обнулить предыдущие уровни")}</label></div>
        </div>
      </div>
      <footer className="flex justify-end border-t px-9 py-6"><button type="submit" className="font-semibold uppercase text-sky-500">{t("Сохранить")}</button></footer>
    </form></div>
  )
}

function CheckOption({ label, values, setValues }: { label: string; values: string[]; setValues: React.Dispatch<React.SetStateAction<string[]>> }) {
  const { t } = useLanguage()
  return <label className="mt-3 flex items-center gap-3 font-semibold"><input type="checkbox" checked={values.includes(label)} onChange={() => setValues((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label])} className="h-5 w-5" />{t(label)}</label>
}
