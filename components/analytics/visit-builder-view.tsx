"use client"

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import {
  Bookmark,
  ChevronDown,
  Download,
  FileBox,
  Info,
  Pencil,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

const columns = [
  "План визитов",
  "Посещено",
  "Посещено по плану",
  "Выполнение плана, %",
  "Посещено вне плана",
  "Не посещено",
  "Результативный визит",
  "Strike Rate, %",
  "Отказано",
  "Первая активность",
  "Последняя активность",
]

const groupings = [
  "Пользователь",
  "Зона",
  "Код магазина",
  "Дата плана",
  "Время выполнения",
  "Дата выполнения",
  "По дням",
  "Магазин",
  "ИД плана",
  "Время обслуживания (мин)",
  "Начало обслуживания",
  "Конец обслуживания",
  "Статус",
]

const salesColumns = [
  "АКБ заказа", "Вес продуктов заказа", "Вес продуктов возврата", "Вес продуктов факт",
  "Кол. продуктов заказа", "Кол. продуктов возврата", "Кол. продуктов факт",
  "Кол. блоков заказа", "Кол. блоков возврата", "Кол. блоков факт",
  "Кол. бонусов заказа", "Кол. бонусов возврата", "Кол. бонусов факт",
  "Кол. оформленных заказов", "Кол. оформленных возвратов", "Прибыль от продаж",
  "Наценка Заказа (%)", "Сумма заказов", "Сумма возвратов", "Сумма факт",
  "Сумма заказов, SUM", "Сумма возвратов, SUM", "Сумма факт, SUM",
  "Сумма до переоценки заказов", "Сумма до переоценки возвратов",
  "Сумма до переоценки факт", "Себестоимость заказа", "Себестоимость возврата",
  "Себестоимость факт", "Ассортимент",
]

const salesGroupings = [
  "Дата по дням", "Дата по неделям", "Дата по месяцам", "Валюта", "Документ №",
  "Документ Тип", "Документ Отв.агент", "Документ Отв.агент (Имя)",
  "Документ Отв.агент (Фамилия)", "Документ Супервайзер", "Документ Аудиторы",
  "Документ Комментарий", "Доставщик", "Доставщик ID", "Сборщик", "Сборщик ID",
  "Организация", "Прайс-лист", "Продукт ИД", "Продукт Название", "Продукт Ед. изм",
  "Продукт Бренд", "Тип продукта", "Родительский тип продукта",
  "Продукт Порядковый номер", "Продукт Артикул", "Продукт Код", "Продукт Штрих-код",
  "Магазин №", "Магазин Название", "Магазин Контактное лицо", "Магазин ИНН",
  "Магазин Тип магазина", "Магазин Категория магазина", "Магазин Категория канала",
  "Магазин Код", "Магазин Код интеграции", "Магазин Ответственный агент",
  "Магазин Ответственный агент ID", "Магазин активен", "Магазин Колв.инвентаря",
  "Магазин Список инвентаря", "Магазин {}", "Себестоимость", "Склад", "Территория",
  "Тип оплаты", "Тип сделки", "Филиал", "Цена", "Цена до переоценки",
  "Код сотрудника", "Номер сервиса", "Марка", "Формат", "Группа портфель",
  "Группа ассортимент", "Группа продукт", "Группа марк", "Группа родитель",
  "Номер телефона", "Полное наименование", "Модель транспорта",
  "Номер транспорта", "Водитель транспорта",
]

const salesFilters = [
  "Бренд", "Документ Отв. агент", "Документ Аудиторы", "Доставщик", "Права доступа",
  "Магазин", "Организация", "Ответственный агент магазина", "Прайс-лист", "Продукт",
  "Склад", "Склад заказа", "Склад возврата", "Статус заказа", "Статус возврата",
  "Территория", "Тип продукта", "Родительский Тип продукта", "Тип оплаты",
  "Тип магазина", "Категория канала", "Филиал", "ММЛ продукт", "Марка", "Формат",
  "Группа портфель", "Группа ассортимент", "Группа продукт", "Группа марк", "Магазин ИНН",
]

const statuses = ["В процессе", "Выполнено", "Невыполнено"]
const zones = ["Andijon shaharchasi", "Arslan", "Arslan", "chilonzor", "chilonzor", "Chilonzor zonasi 2"]

type SavedReport = {
  id: number
  name: string
  model: string
}

const initialReports: SavedReport[] = []

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function VisitBuilderView({ variant = "visits" }: { variant?: "visits" | "sales" }) {
  const { t } = useLanguage()
  const isSales = variant === "sales"
  const availableColumns = isSales ? salesColumns : columns
  const availableGroupings = isSales ? salesGroupings : groupings
  const today = useMemo(() => inputDate(new Date()), [])
  const [activeTab, setActiveTab] = useState(isSales ? "РЕАЛИЗАЦИЯ" : "ВИЗИТ")
  const [settingsVisible, setSettingsVisible] = useState(true)
  const [selectedColumns, setSelectedColumns] = useState<string[]>(isSales ? ["АКБ заказа", "Сумма заказов"] : ["План визитов", "Посещено"])
  const [verticalGroups, setVerticalGroups] = useState<string[]>(isSales ? ["Дата по дням"] : ["Пользователь"])
  const [horizontalGroups, setHorizontalGroups] = useState<string[]>([])
  const [columnQuery, setColumnQuery] = useState("")
  const [verticalQuery, setVerticalQuery] = useState("")
  const [horizontalQuery, setHorizontalQuery] = useState("")
  const [showTotals, setShowTotals] = useState(true)
  const [user, setUser] = useState("")
  const [status, setStatus] = useState("")
  const [zone, setZone] = useState("")
  const [extraFilters, setExtraFilters] = useState<string[]>([])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [reportReady, setReportReady] = useState(false)
  const [savedReports, setSavedReports] = useState<SavedReport[]>(initialReports)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportQuery, setReportQuery] = useState("")
  const [editingReportId, setEditingReportId] = useState<number | null>(null)
  const [message, setMessage] = useState("")
  const [users, setUsers] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setUsers(data.map((employee) => employee.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")))
      })
      .catch(() => {
        if (!cancelled) setUsers([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(isSales ? "sales-builder-reports" : "visit-builder-reports", JSON.stringify(savedReports))
  }, [savedReports, isSales])

  useEffect(() => {
    if (!reportsOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setReportsOpen(false)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [reportsOpen])

  function toggle(value: string, setter: Dispatch<SetStateAction<string[]>>) {
    setter((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
    setReportReady(false)
  }

  function saveReport() {
    const nextId = Math.max(...savedReports.map((report) => report.id), 0) + 1
    const savedReport = {
      id: nextId,
      name: `${activeTab.toLowerCase()} · ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
      model: activeTab === "ВИЗИТ" ? "Визит" : activeTab === "ЗАДАЧИ" ? "Задачи" : "Отказы",
    }
    const next = [...savedReports, savedReport]
    setSavedReports(next)
    window.localStorage.setItem(isSales ? "sales-builder-reports" : "visit-builder-reports", JSON.stringify(next))
    setMessage(t("Настройки отчета сохранены"))
  }

  function downloadReport() {
    const header = [...verticalGroups, ...horizontalGroups, ...selectedColumns].map((item) => t(item))
    const row = [
      ...verticalGroups.map(() => user || t("Все пользователи")),
      ...horizontalGroups.map(() => zone || t("Все зоны")),
      ...selectedColumns.map((_, index) => String(index === 0 ? 104 : 0)),
    ]
    downloadFile(isSales ? "sales-builder.csv" : "visit-builder.csv", `\uFEFF${header.join(";")}\n${row.join(";")}`, "text/csv;charset=utf-8")
  }

  const shownColumns = availableColumns.filter((item) => item.toLowerCase().includes(columnQuery.toLowerCase()))
  const shownVertical = availableGroupings.filter((item) => item.toLowerCase().includes(verticalQuery.toLowerCase()))
  const shownHorizontal = availableGroupings.filter((item) => item.toLowerCase().includes(horizontalQuery.toLowerCase()))
  const invalid = selectedColumns.length === 0 || from > to
  const filteredReports = savedReports.filter((report) =>
    `${report.name} ${report.model}`.toLocaleLowerCase("ru").includes(reportQuery.toLocaleLowerCase("ru")),
  )

  function loadSavedReport(report: SavedReport) {
    setActiveTab(
      report.model === "Визит" ? "ВИЗИТ" : report.model === "Задачи" ? "ЗАДАЧИ" : "ОТКАЗЫ",
    )
    setSelectedColumns(["План визитов", "Посещено", "Результативный визит"])
    setVerticalGroups(["Пользователь"])
    setReportReady(false)
    setReportsOpen(false)
    setMessage(`${t("Отчет «")}${report.name}${t("» загружен")}`)
  }

  function renameReport(id: number, name: string) {
    setSavedReports((current) =>
      current.map((report) => (report.id === id ? { ...report, name } : report)),
    )
  }

  function deleteReport(id: number) {
    setSavedReports((current) => current.filter((report) => report.id !== id))
    setMessage(t("Отчет удален"))
  }

  async function shareReport(report: SavedReport) {
    await navigator.clipboard?.writeText(`${report.name} — ${report.model}`)
    setMessage(`${t("Ссылка на «")}${report.name}${t("» скопирована")}`)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 py-4 sm:px-5">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">{t(isSales ? "Отчет по продажам" : "Конструктор")}</h1>
        </div>
        <div className="flex overflow-hidden rounded-md shadow">
          {(isSales ? ["ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ", "ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ СОЗДАНИЯ"] : ["ВИЗИТ", "ЗАДАЧИ", "ОТКАЗЫ"]).map((tab) => (
            <button key={tab} type="button" onClick={() => { setActiveTab(tab); setReportReady(false) }} className={`border-r border-slate-200 px-6 py-2.5 ${activeTab === tab ? "bg-green-500 text-white" : "bg-white hover:bg-slate-50"}`}>
              {t(tab)}
            </button>
          ))}
        </div>
      </header>

      <section className="bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 px-5 py-4">
          <button type="button" onClick={saveReport} className="inline-flex items-center gap-2 rounded-md bg-[#5470e8] px-5 py-3 font-semibold text-white">
            <Bookmark className="h-5 w-5 fill-white" /> {t("Сохранить")}
          </button>
          <button type="button" onClick={() => setReportsOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#ff806b] px-5 py-3 font-semibold text-white">
            <FileBox className="h-5 w-5 fill-white" /> {t("Отчеты")}
          </button>
          <button type="button" onClick={downloadReport} className="inline-flex items-center gap-2 rounded-md bg-[#4db7af] px-5 py-3 font-semibold text-white">
            <Download className="h-5 w-5" /> {t("Скачать")}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm font-semibold text-[#5470e8]">
              <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="border-0 bg-transparent" />
              -
              <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="border-0 bg-transparent" />
            </label>
            <button type="button" onClick={() => setSettingsVisible((value) => !value)} className="rounded-md bg-[#5470e8] px-7 py-3 font-medium text-white shadow">
              {t(settingsVisible ? "СКРЫТЬ НАСТРОЙКИ ▲" : "ПОКАЗАТЬ НАСТРОЙКИ ▼")}
            </button>
            <button type="button" disabled={invalid} onClick={() => { setReportReady(true); setMessage(t("Отчет успешно сформирован")) }} className="rounded-md bg-green-500 px-7 py-3 font-medium text-white shadow disabled:opacity-50">
              {t("СФОРМИРОВАТЬ ОТЧЕТ")}
            </button>
          </div>
        </div>

        {message && (
          <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-5 py-2 text-sm text-blue-700">
            {message}<button type="button" onClick={() => setMessage("")} aria-label={t("Закрыть сообщение")}>×</button>
          </div>
        )}

        {settingsVisible && (
          <div className="grid min-h-[640px] divide-y divide-slate-200 lg:grid-cols-[1fr_1fr_1fr_1fr] lg:divide-x lg:divide-y-0">
            <OptionColumn title="Колонки" placeholder="Поиск колонки..." query={columnQuery} onQuery={setColumnQuery} items={shownColumns} selected={selectedColumns} onToggle={(item) => toggle(item, setSelectedColumns)} info />
            <OptionColumn title="Вертикальная группировка" placeholder="Поиск вертикальных группировки..." query={verticalQuery} onQuery={setVerticalQuery} items={shownVertical} selected={verticalGroups} onToggle={(item) => toggle(item, setVerticalGroups)} />
            <OptionColumn title="Горизонтальная группировка" placeholder="Поиск горизонтальных группировки..." query={horizontalQuery} onQuery={setHorizontalQuery} items={shownHorizontal} selected={horizontalGroups} onToggle={(item) => toggle(item, setHorizontalGroups)} />
            <div className="p-6">
              <h2 className="text-xl font-bold">{t("Фильтр")}</h2>
              <label className="mt-3 flex items-center gap-3 font-semibold">
                <input type="checkbox" checked={showTotals} onChange={(event) => setShowTotals(event.target.checked)} className="h-5 w-5 accent-slate-500" />
                {t("Показать итоги")}
              </label>
              {isSales ? salesFilters.map((label) => <FilterSelect key={label} label={label} value="" onChange={() => undefined} options={["Все", "Выбрано"]} />) : <>
                <FilterSelect label="Пользователь" value={user} onChange={setUser} options={users} />
                <FilterSelect label="Статус" value={status} onChange={setStatus} options={statuses} />
                <FilterSelect label="Зона" value={zone} onChange={setZone} options={zones} />
              </>}
              {extraFilters.map((filter, index) => (
                <div key={index} className="mt-4 flex items-center gap-2">
                  <select value={filter} onChange={(event) => setExtraFilters((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="w-full border-b border-slate-300 bg-white py-2">
                    <option value="">{t("Индивидуальный фильтр")}</option><option value="Магазин">{t("Магазин")}</option><option value="Код магазина">{t("Код магазина")}</option><option value="Дата выполнения">{t("Дата выполнения")}</option>
                  </select>
                  <button type="button" onClick={() => setExtraFilters((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t("Удалить фильтр")}><span className="text-xl">×</span></button>
                </div>
              ))}
              <button type="button" onClick={() => setExtraFilters((current) => [...current, ""])} className="mt-5 w-full rounded-md bg-[#5470e8] px-4 py-3 font-medium text-white">
                {t("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР")}
              </button>
            </div>
          </div>
        )}

        {reportReady && (
          <div className="overflow-x-auto p-6">
            <h2 className="mb-4 text-xl font-bold">{t("Сформированный отчет")} · {t(activeTab)}</h2>
            <table className="w-full min-w-[720px] border-collapse">
              <thead><tr className="bg-navy text-white">{[...verticalGroups, ...horizontalGroups, ...selectedColumns].map((item) => <th key={item} className="border border-white/20 px-4 py-3 text-left">{t(item)}</th>)}</tr></thead>
              <tbody>
                <tr>{verticalGroups.map((item) => <td key={item} className="border px-4 py-3">{user || t("Все пользователи")}</td>)}{horizontalGroups.map((item) => <td key={item} className="border px-4 py-3">{zone || t("Все зоны")}</td>)}{selectedColumns.map((item, index) => <td key={item} className="border px-4 py-3 text-right">{index === 0 ? 104 : 0}</td>)}</tr>
                {showTotals && <tr className="bg-slate-100 font-bold"><td colSpan={verticalGroups.length + horizontalGroups.length || 1} className="border px-4 py-3">{t("Итого")}</td>{selectedColumns.map((item, index) => <td key={item} className="border px-4 py-3 text-right">{index === 0 ? 104 : 0}</td>)}</tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reportsOpen && (
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="saved-reports-title"
          className="fixed bottom-0 right-0 top-0 z-[100] flex w-[min(960px,calc(100vw-24px))] flex-col border-r-[7px] border-sky-500 bg-white shadow-2xl animate-in slide-in-from-right-full duration-200"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-10 py-6">
            <h2 id="saved-reports-title" className="font-bold uppercase">{t("Отчеты")}</h2>
            <button type="button" onClick={() => setReportsOpen(false)} aria-label={t("Закрыть отчеты")} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-7 w-7" />
            </button>
          </header>

          <div className="flex flex-wrap items-center gap-5 border-b border-slate-200 px-10 py-6">
            <label className="relative min-w-[260px] flex-1">
              <input
                value={reportQuery}
                onChange={(event) => setReportQuery(event.target.value)}
                placeholder={t("Поиск таблицы...")}
                className="w-full border-0 border-b border-slate-300 px-0 py-3 pr-10 outline-none focus:border-brand-blue"
              />
              <Search className="absolute right-2 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            </label>
            <span className="ml-auto text-slate-500">
              {filteredReports.length ? `1 - ${filteredReports.length} ${t("из")} ${filteredReports.length}` : `0 ${t("из")} 0`}
            </span>
            <button type="button" disabled className="rounded-full border-2 border-slate-300 p-1 text-slate-300"><ChevronDown className="h-4 w-4 rotate-90" /></button>
            <button type="button" disabled className="rounded-full border-2 border-slate-300 p-1 text-slate-300"><ChevronDown className="h-4 w-4 -rotate-90" /></button>
          </div>

          <div className="grid grid-cols-[72px_minmax(180px,1fr)_minmax(230px,1.4fr)_140px] border-b border-dashed border-slate-300 px-10 py-5 font-bold">
            <span>{t("№")}</span><span>{t("Название")}</span><span>{t("Модель")}</span><span />
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredReports.map((report) => (
              <div
                key={report.id}
                className="group grid min-h-16 grid-cols-[72px_minmax(180px,1fr)_minmax(230px,1.4fr)_140px] items-center border-b border-dashed border-slate-300 px-10 py-3 hover:bg-slate-100"
              >
                <button type="button" onClick={() => loadSavedReport(report)} className="text-left">{report.id}</button>
                {editingReportId === report.id ? (
                  <input
                    autoFocus
                    value={report.name}
                    onChange={(event) => renameReport(report.id, event.target.value)}
                    onBlur={() => setEditingReportId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") setEditingReportId(null)
                    }}
                    className="mr-3 rounded border border-brand-blue px-2 py-1"
                  />
                ) : (
                  <button type="button" onClick={() => loadSavedReport(report)} className="pr-3 text-left">{report.name}</button>
                )}
                <button type="button" onClick={() => loadSavedReport(report)} className="pr-3 text-left">{t(report.model)}</button>
                <div className="flex gap-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button type="button" onClick={() => setEditingReportId(report.id)} aria-label={`${t("Изменить")} ${report.name}`}><Pencil className="h-5 w-5 text-slate-600" /></button>
                  <button type="button" onClick={() => deleteReport(report.id)} aria-label={`${t("Удалить")} ${report.name}`}><Trash2 className="h-5 w-5 text-slate-600" /></button>
                  <button type="button" onClick={() => shareReport(report)} aria-label={`${t("Поделиться")} ${report.name}`}><Users className="h-5 w-5 text-slate-600" /></button>
                </div>
              </div>
            ))}
            {filteredReports.length === 0 && (
              <p className="px-10 py-12 text-center text-slate-400">{t("Отчеты не найдены")}</p>
            )}
          </div>
        </aside>
      )}
    </main>
  )
}

function OptionColumn({ title, placeholder, query, onQuery, items, selected, onToggle, info = false }: { title: string; placeholder: string; query: string; onQuery: (value: string) => void; items: string[]; selected: string[]; onToggle: (item: string) => void; info?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">{t(title)}</h2>
      <label className="relative mt-3 block">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t(placeholder)} className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-3 pr-10 outline-none focus:border-brand-blue" />
        <Search className="absolute right-3 top-1/2 h-6 w-6 -translate-y-1/2" />
      </label>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <label key={item} className="flex cursor-pointer items-center gap-3 font-semibold">
            <input type="checkbox" checked={selected.includes(item)} onChange={() => onToggle(item)} className="h-5 w-5 accent-[#5470e8]" />
            {t(item)}
            {info && ["Выполнение плана, %", "Strike Rate, %", "Отказано"].includes(item) && <Info className="h-5 w-5 text-slate-500" />}
          </label>
        ))}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const { t } = useLanguage()
  return (
    <label className="relative mt-9 block">
      <span className="sr-only">{t(label)}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full appearance-none border-0 border-b border-slate-300 bg-white py-3 pr-8 text-base outline-none">
        <option value="">{t(label)}</option>
        {options.map((option, index) => <option key={`${option}-${index}`} value={option}>{t(option)}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-3 h-5 w-5 text-slate-400" />
    </label>
  )
}
