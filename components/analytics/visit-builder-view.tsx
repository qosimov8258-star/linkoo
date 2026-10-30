"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
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
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import type { BuilderResult } from "@/lib/report-builder-repo"
import { useDirectoryNames } from "@/components/clients/use-directory"

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
  "Последная активность",
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
  "Колв. продуктов заказа", "Колв. продуктов возврата", "Колв. продуктов факт",
  "Колв. блоков заказа", "Колв. блоков возврата", "Колв. блоков факт",
  "Колв. бонусов заказа", "Колв. бонусов возврата", "Колв. бонусов факт",
  "Колв. оформленных заказов", "Колв. оформленных возвратов", "Прибыль от продаж",
  "Наценка Заказа (%)", "Сумма заказов", "Сумма возвратов", "Сумма факт",
  "Сумма заказов, SUM", "Сумма возвратов, SUM", "Сумма факт, SUM",
  "Сумма до переоценки заказов", "Сумма до переоценки возвратов",
  "Сумма до переоценки факт", "Себестоимость заказа", "Себестоимость возврата",
  "Cебестоимость факт", "Ассортимент",
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
  "Номер телефона", "Польное наименование", "Модель транспорта",
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

/** Money columns of the sales report (lib/report-builder-repo.ts): shown with 2 decimals and labelled with
 * their currency — the base currency (result.currency), or the row's / column's "Валюта" for the ones in
 * result.documentColumns. "…, SUM" is the reference's name of a base-currency column. */
const MONEY_COLUMNS = new Set([
  "Прибыль от продаж", "Сумма заказов", "Сумма возвратов", "Сумма факт",
  "Сумма заказов, SUM", "Сумма возвратов, SUM", "Сумма факт, SUM",
  "Сумма до переоценки заказов", "Сумма до переоценки возвратов", "Сумма до переоценки факт",
  "Себестоимость заказа", "Себестоимость возврата", "Cебестоимость факт",
])

/** The measure column of a result header ("<horizontal key> · <column>" or the column itself). */
function measureOf(header: string): { prefix: string; column: string } {
  const at = header.lastIndexOf(" · ")
  return at >= 0 ? { prefix: header.slice(0, at + 3), column: header.slice(at + 3) } : { prefix: "", column: header }
}

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

function monthEnd() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}


export const INFO_ITEMS = new Set([
  "Выполнение плана, %", "Strike Rate, %", "Отказано",
  "Вес продуктов заказа", "Вес продуктов возврата", "Вес продуктов факт",
  "Колв. бонусов заказа", "Колв. бонусов возврата", "Колв. бонусов факт",
  "Прибыль от продаж", "Наценка Заказа (%)",
  "Документ №", "Документ Тип", "Документ Отв.агент", "Документ Отв.агент (Имя)",
  "Документ Отв.агент (Фамилия)", "Документ Супервайзер", "Документ Аудиторы",
])

export function VisitBuilderView({ variant = "visits" }: { variant?: "visits" | "sales" }) {
  const { t, language } = useLanguage()
  const isSales = variant === "sales"
  const availableColumns = isSales ? salesColumns : columns
  const availableGroupings = isSales ? salesGroupings : groupings
  const [activeTab, setActiveTab] = useState(isSales ? "ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ" : "ВИЗИТ")
  const [settingsVisible, setSettingsVisible] = useState(true)
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [verticalGroups, setVerticalGroups] = useState<string[]>([])
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
  const [to, setTo] = useState(monthEnd)
  const [reportReady, setReportReady] = useState(false)
  const [result, setResult] = useState<BuilderResult | null>(null)
  const [running, setRunning] = useState(false)
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({})
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [savedReports, setSavedReports] = useState<SavedReport[]>(initialReports)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportQuery, setReportQuery] = useState("")
  const [editingReportId, setEditingReportId] = useState<number | null>(null)
  const [message, setMessage] = useState("")
  const [users, setUsers] = useState<string[]>([])
  // Zones of the factory's own clients (never another tenant's names).
  const zones = useDirectoryNames("zones")

  useEffect(() => {
    // Fallback names of the visits "Пользователь" filter: the employees of the reader's field scope
    // (an agent gets only themselves and their supervised agents), never the whole staff list.
    if (isSales) return
    let cancelled = false
    fetch("/api/field-activity/people")
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
  }, [isSales])

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

  useEffect(() => {
    let cancelled = false
    fetch(`/api/report-builder?kind=${isSales ? "sales" : "visits"}`)
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, string[]>>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setFilterOptions(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isSales])

  async function generate(): Promise<BuilderResult | null> {
    if (selectedColumns.length === 0) {
      setMessage(t("Выберите хотя бы одну колонку"))
      return null
    }
    setRunning(true)
    try {
      const filters = isSales ? filterValues : { "Пользователь": user, "Статус": status, "Зона": zone }
      const response = await fetch("/api/report-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: isSales ? "sales" : "visits", tab: activeTab, from, to, columns: selectedColumns, vertical: verticalGroups, horizontal: horizontalGroups, filters, showTotals }),
      })
      const data = (await response.json().catch(() => null)) as (BuilderResult & { error?: string }) | null
      if (!response.ok || !data || data.error) {
        setMessage(t(data?.error || "Не удалось сформировать отчет"))
        return null
      }
      setResult(data)
      setReportReady(true)
      const notes = [
        data.unsupported.length ? `${t("Нет данных для")}: ${data.unsupported.map((item) => t(item)).join(", ")}` : "",
        data.missingRates?.length ? `${t("Курс валюты не задан")}: ${data.missingRates.join(", ")}` : "",
      ].filter(Boolean)
      setMessage([t("Отчет успешно сформирован"), ...notes].join(". "))
      return data
    } finally {
      setRunning(false)
    }
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

  async function downloadReport() {
    const data = reportReady && result ? result : await generate()
    if (!data) return
    const totals = data.totals ? [data.totals.map((cell, index) => (index === 0 && cell === "Итого" ? t("Итого") : cell))] : []
    downloadExcelTable(t(isSales ? "Отчет по продажам" : "Конструктор"), [data.headers.map((item) => headerLabel(data, item)), ...data.rows, ...totals])
  }

  /** A header in the UI language; a money column carries its currency (never a hard-coded "SUM"). */
  function headerLabel(data: BuilderResult, header: string): string {
    const { prefix, column } = measureOf(header)
    if (!MONEY_COLUMNS.has(column) || !data.currency) return prefix + t(column)
    const name = t(column.endsWith(", SUM") ? column.slice(0, -", SUM".length) : column)
    // Columns in the document's own currency: each cell is in its row's / column's "Валюта".
    if (data.documentColumns?.includes(column)) return `${prefix}${name}, ${t("Валюта")}`
    return `${prefix}${name}, ${data.currency}`
  }

  function cellText(data: BuilderResult, cell: string | number, index: number): string | number {
    if (typeof cell !== "number") return cell
    return MONEY_COLUMNS.has(measureOf(data.headers[index] ?? "").column) ? formatMoney(cell, 2) : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(cell)
  }

  const shownColumns = availableColumns.filter((item) => item.toLowerCase().includes(columnQuery.toLowerCase()))
  const shownVertical = availableGroupings.filter((item) => item.toLowerCase().includes(verticalQuery.toLowerCase()))
  const shownHorizontal = availableGroupings.filter((item) => item.toLowerCase().includes(horizontalQuery.toLowerCase()))
  const invalid = from > to
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
    <ReportPage>
      <div className="pl-[28px] pr-[38px]">
        <RefHeader title={t(isSales ? "Отчет по продажам" : "Конструктор")}>
          <div className="flex overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {(isSales ? ["ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ", "ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ СОЗДАНИЯ"] : ["ВИЗИТ", "ЗАДАЧИ", "ОТКАЗЫ"]).map((tab) => (
              <button key={tab} type="button" onClick={() => { setActiveTab(tab); setReportReady(false) }} className={`h-[30px] px-4 text-[13px] font-medium uppercase transition-colors ${activeTab === tab ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}>
                <span>{t(tab)}</span>
              </button>
            ))}
          </div>
        </RefHeader>
      </div>

      <section className="mx-7 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex h-[60px] flex-wrap items-center gap-[15px] px-[30px]">
          <button type="button" onClick={saveReport} className="flex h-[36px] items-center rounded-[5px] bg-[#4f71dc] px-[15px] text-[13px] font-normal text-white hover:brightness-95">
            <Bookmark className="mr-[7px] h-[18px] w-[18px] fill-white" /> {t("Сохранить")}
          </button>
          <button type="button" onClick={() => setReportsOpen(true)} className="flex h-[36px] items-center rounded-[5px] bg-[#ff8a6f] px-[15px] text-[13px] font-normal text-white hover:brightness-95">
            <FileBox className="mr-[7px] h-[18px] w-[18px] fill-white" /> {t("Отчеты")}
          </button>
          <button type="button" onClick={downloadReport} className="flex h-[36px] items-center rounded-[5px] bg-[#4db6ac] px-[15px] text-[13px] font-normal text-white hover:brightness-95">
            <Download className="mr-[7px] h-[18px] w-[18px]" /> {t("Скачать")}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-[19px]">
            <span className="relative text-[12px] font-bold text-[#4f71dc]">
              {formatDateText(from, language, { withTime: false })} - {formatDateText(to, language, { withTime: false })}
              <input type="date" aria-label={t("Дата от")} value={from} max={to} onChange={(event) => event.target.value && setFrom(event.target.value)} className="absolute left-0 top-0 h-full w-[48%] cursor-pointer opacity-0" />
              <input type="date" aria-label={t("Дата до")} value={to} min={from} onChange={(event) => event.target.value && setTo(event.target.value)} className="absolute right-0 top-0 h-full w-[48%] cursor-pointer opacity-0" />
            </span>
            <button type="button" onClick={() => setSettingsVisible((value) => !value)} className="h-[38px] w-[215px] rounded-[3px] bg-[#4f71dc] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95">
              <span>{settingsVisible ? `${t("СКРЫТЬ НАСТРОЙКИ")} ▲` : `${t("ПОКАЗАТЬ НАСТРОЙКИ")} ▼`}</span>
            </button>
            <button type="button" disabled={invalid || running} onClick={() => void generate()} className="h-[38px] w-[195px] rounded-[3px] bg-[#2bcd53] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95 disabled:opacity-50">
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
          <div className="grid divide-y divide-[#ececec] border-t border-[#ececec] shadow-[0_2px_6px_rgba(0,0,0,0.12)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <OptionColumn title="Колонки" placeholder="Поиск колонки..." query={columnQuery} onQuery={setColumnQuery} items={shownColumns} selected={selectedColumns} onToggle={(item) => toggle(item, setSelectedColumns)} info />
            <OptionColumn title="Вертикальная группировка" placeholder="Поиск вертикальных группировки..." query={verticalQuery} onQuery={setVerticalQuery} items={shownVertical} selected={verticalGroups} onToggle={(item) => toggle(item, setVerticalGroups)} info />
            <OptionColumn title="Горизонтальная группировка" placeholder="Поиск горизонтальных группировки..." query={horizontalQuery} onQuery={setHorizontalQuery} items={shownHorizontal} selected={horizontalGroups} onToggle={(item) => toggle(item, setHorizontalGroups)} info />
            <div className="pb-[20px] pl-[23px] pr-[17px] pt-[20px]">
              <h2 className="text-[15px] font-semibold leading-[18.75px]">{t("Фильтр")}</h2>
              <label className="mt-[11px] flex cursor-pointer items-center gap-[9px] text-[13px] font-semibold leading-5 text-black">
                <input type="checkbox" checked={showTotals} onChange={(event) => setShowTotals(event.target.checked)} className={CHECKBOX} />
                {t("Показать итоги")}
              </label>
              {isSales ? salesFilters.map((label) => <FilterSelect key={label} label={label} value={filterValues[label] ?? ""} onChange={(value) => { setFilterValues((current) => ({ ...current, [label]: value })); setReportReady(false) }} options={filterOptions[label] ?? []} />) : <>
                <FilterSelect label="Пользователь" value={user} onChange={(value) => { setUser(value); setReportReady(false) }} options={filterOptions["Пользователь"]?.length ? filterOptions["Пользователь"] : users} />
                <FilterSelect label="Статус" value={status} onChange={(value) => { setStatus(value); setReportReady(false) }} options={statuses} />
                <FilterSelect label="Зона" value={zone} onChange={(value) => { setZone(value); setReportReady(false) }} options={filterOptions["Зона"]?.length ? filterOptions["Зона"] : zones} />
              </>}
              {extraFilters.map((filter, index) => (
                <div key={index} className="mt-4 flex items-center gap-2">
                  <select value={filter} onChange={(event) => setExtraFilters((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="w-full border-b border-slate-300 bg-white py-2">
                    <option value="">{t("Индивидуальный фильтр")}</option><option value="Магазин">{t("Магазин")}</option><option value="Код магазина">{t("Код магазина")}</option><option value="Дата выполнения">{t("Дата выполнения")}</option>
                  </select>
                  <button type="button" onClick={() => setExtraFilters((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t("Удалить фильтр")}><span className="text-xl">×</span></button>
                </div>
              ))}
              <button type="button" onClick={() => setExtraFilters((current) => [...current, ""])} className="mt-[18px] h-9 w-full rounded-[3px] bg-[#4f71dc] text-[13px] font-medium uppercase text-white hover:brightness-95">
                <span>{t("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР")}</span>
              </button>
            </div>
          </div>
        )}

        {reportReady && result && (
          <div className="overflow-x-auto p-6">
            <h2 className="mb-4 text-xl font-bold">{t("Сформированный отчет")} · {t(activeTab)}</h2>
            {result.rows.length === 0 ? (
              <p className="py-10 text-center text-slate-500">{t("По вашему запросу ничего не найдено")}</p>
            ) : (
              <table className="w-full min-w-[720px] border-collapse">
                <thead><tr className="bg-navy text-white">{result.headers.map((item, index) => <th key={`${item}-${index}`} className="border border-white/20 px-4 py-3 text-left">{headerLabel(result, item)}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className={`border px-4 py-3 ${typeof cell === "number" ? "text-right" : ""}`}>{cellText(result, cell, cellIndex)}</td>)}</tr>
                  ))}
                  {result.totals && <tr className="bg-slate-100 font-bold">{result.totals.map((cell, cellIndex) => <td key={cellIndex} className={`border px-4 py-3 ${typeof cell === "number" ? "text-right" : ""}`}>{typeof cell === "string" && cell === "Итого" ? t("Итого") : cellText(result, cell, cellIndex)}</td>)}</tr>}
                </tbody>
              </table>
            )}
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
    </ReportPage>
  )
}

export const CHECKBOX =
  "h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border-2 border-[#444] bg-white checked:border-[#444] checked:bg-[#444] checked:bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22><path%20fill=%22white%22%20d=%22M9%2016.2L4.8%2012l-1.4%201.4L9%2019%2021%207l-1.4-1.4z%22/></svg>')] checked:bg-[length:12px] checked:bg-center checked:bg-no-repeat"

function OptionColumn({ title, placeholder, query, onQuery, items, selected, onToggle, info = false }: { title: string; placeholder: string; query: string; onQuery: (value: string) => void; items: string[]; selected: string[]; onToggle: (item: string) => void; info?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="px-[20px] pb-[30px] pt-[18px]">
      <h2 className="text-[15px] font-semibold leading-[18.75px]">{t(title)}</h2>
      <label className="relative mt-[11px] block">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t(placeholder)} className="h-[42px] w-full rounded-[3px] bg-[#f2f5f8] px-[11px] pr-10 text-[12px] outline-none placeholder:text-[#999]" />
        <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />
      </label>
      <div className="mt-[11px]">
        {items.map((item) => (
          <label key={item} className={`flex ${info && INFO_ITEMS.has(item) ? "min-h-[34px]" : "min-h-[30px]"} cursor-pointer items-center gap-[9px] text-[13px] font-semibold`}>
            <input type="checkbox" checked={selected.includes(item)} onChange={() => onToggle(item)} className={`${CHECKBOX} ml-[3px]`} />
            {t(item)}
            {info && INFO_ITEMS.has(item) && <Info className="h-[18px] w-[18px] text-[#555]" />}
          </label>
        ))}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const { t } = useLanguage()
  return (
    <label className="relative mt-[22px] block h-[45px] border-b border-[#e0e0e0]">
      <span className="absolute inset-x-0 top-[18px] text-[13px] leading-[18px] text-black">{value ? t(value) : t(label)}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        <option value="">{t(label)}</option>
        {options.map((option, index) => <option key={`${option}-${index}`} value={option}>{t(option)}</option>)}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[4px] right-0 h-6 w-6 fill-[#999]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}
