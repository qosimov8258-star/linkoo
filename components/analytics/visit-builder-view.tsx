"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { Bookmark, Download, FileBox, Info, Search } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { appCurrencyColumn, useAppCurrency } from "@/lib/app-currency-context"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import type { BuilderResult } from "@/lib/report-builder-repo"
import { useDirectoryNames } from "@/components/clients/use-directory"
import type { NewReportBuilderSave } from "@/lib/new-report-builder-types"
import { BuilderPeriod } from "./builder-period"
import { modelName, savedList, savedPeriod, savedRecord, useBuilderSaves } from "./builder-saves"
import { BuilderNoData, BuilderTable } from "./builder-table"

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

export const salesColumns = [
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

export const salesGroupings = [
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

export const salesFilters = [
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

/** The models (tabs) of the two constructors of this view. */
const VISIT_TABS = ["ВИЗИТ", "ЗАДАЧИ", "ОТКАЗЫ"]
const SALES_TABS = ["ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ", "ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ СОЗДАНИЯ"]

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

/** Hints of the ⓘ icons (the reference's field descriptions). */
export const INFO_HINTS: Record<string, string> = {
  "Документ №": "ИД заказа или возврата",
  "Документ Тип": "Заказ или возврат",
  "Документ Отв.агент": "Ответственный агент заказа или возврата",
  "Документ Отв.агент (Имя)": "Имя ответственного агента заказа или возврата",
  "Документ Отв.агент (Фамилия)": "Фамилия ответственного агента заказа или возврата",
  "Документ Супервайзер": "Супервайзер ответственного агент заказа или возврата",
  "Документ Аудиторы": "Аудиторы агент заказа или возврата",
}

export function VisitBuilderView({ variant = "visits" }: { variant?: "visits" | "sales" }) {
  const { t } = useLanguage()
  const isSales = variant === "sales"
  const availableColumns = isSales ? salesColumns : columns
  const availableGroupings = isSales ? salesGroupings : groupings
  const tabs = isSales ? SALES_TABS : VISIT_TABS
  const [activeTab, setActiveTab] = useState(tabs[0])
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

  /** A saved report of this constructor back on screen: its model and every setting. */
  function loadSave(save: NewReportBuilderSave) {
    const config = save.config
    const savedTab = typeof config.activeTab === "string" ? config.activeTab : save.reportType.toUpperCase()
    setActiveTab(tabs.includes(savedTab) ? savedTab : tabs[0])
    setSelectedColumns(savedList(config.selectedColumns))
    setVerticalGroups(savedList(config.verticalGroups ?? config.vertical))
    setHorizontalGroups(savedList(config.horizontalGroups ?? config.horizontal))
    setShowTotals(typeof config.showTotals === "boolean" ? config.showTotals : true)
    setUser(typeof config.user === "string" ? config.user : "")
    setStatus(typeof config.status === "string" ? config.status : "")
    setZone(typeof config.zone === "string" ? config.zone : "")
    setFilterValues(savedRecord(config.filterValues))
    setExtraFilters(savedList(config.extraFilters))
    const period = savedPeriod(config)
    setFrom(period.from)
    setTo(period.to)
    setResult(null)
    setReportReady(false)
    setSettingsVisible(true)
  }

  const saves = useBuilderSaves({
    page: isSales ? "sales" : "visits",
    // The visit models are saved as "Визит" / "Задачи" / "Отказы", the sales ones by their tab.
    snapshot: () => ({
      reportType: isSales ? activeTab : modelName(activeTab),
      config: {
        activeTab,
        selectedColumns,
        verticalGroups,
        horizontalGroups,
        showTotals,
        ...(isSales ? { filterValues } : { user, status, zone }),
        extraFilters,
        from,
        to,
      },
    }),
    onLoad: loadSave,
    onMessage: setMessage,
  })

  async function downloadReport() {
    const data = reportReady && result ? result : await generate()
    if (!data) return
    const totals = data.totals ? [data.totals.map((cell, index) => (index === 0 && cell === "Итого" ? t("Итого") : cell))] : []
    downloadExcelTable(t(isSales ? "Отчет по продажам" : "Конструктор"), [data.headers.map((item) => headerLabel(data, item)), ...data.rows, ...totals])
  }

  /** A header in the UI language; a base-currency money column carries its currency (never a hard-coded "SUM"),
   * the plain "Сумма …" ones (the documents' own amounts, as the reference adds them up) their bare name. */
  function headerLabel(data: BuilderResult, header: string): string {
    const { prefix, column } = measureOf(header)
    if (!MONEY_COLUMNS.has(column) || !data.currency || data.documentColumns?.includes(column)) return prefix + t(column)
    const name = t(column.endsWith(", SUM") ? column.slice(0, -", SUM".length) : column)
    return `${prefix}${name}, ${currencyLabel(data.currency)}`
  }

  const shownColumns = availableColumns.filter((item) => item.toLowerCase().includes(columnQuery.toLowerCase()))
  const shownVertical = availableGroupings.filter((item) => item.toLowerCase().includes(verticalQuery.toLowerCase()))
  const shownHorizontal = availableGroupings.filter((item) => item.toLowerCase().includes(horizontalQuery.toLowerCase()))
  const invalid = from > to

  return (
    <ReportPage>
      <div className="pl-[28px] pr-[38px]">
        <RefHeader title={t(isSales ? "Отчет по продажам" : "Конструктор")}>
          <div className="flex overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {tabs.map((tab) => (
              <button key={tab} type="button" onClick={() => { setActiveTab(tab); setReportReady(false) }} className={`h-[30px] px-4 text-[13px] font-medium uppercase transition-colors ${activeTab === tab ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}>
                <span>{t(tab)}</span>
              </button>
            ))}
          </div>
        </RefHeader>
      </div>

      <section className="mx-7 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex h-[60px] flex-wrap items-center gap-[15px] px-[30px]">
          <button type="button" onClick={saves.openSave} className="flex h-[36px] items-center rounded-[5px] bg-[#1E4A9A] px-[15px] text-[13px] font-normal text-white hover:brightness-95">
            <Bookmark className="mr-[7px] h-[18px] w-[18px] fill-white" /> {t("Сохранить")}
          </button>
          <button type="button" onClick={saves.openReports} className="flex h-[36px] items-center rounded-[5px] bg-[#ff8a6f] px-[15px] text-[13px] font-normal text-white hover:brightness-95">
            <FileBox className="mr-[7px] h-[18px] w-[18px] fill-white" /> {t("Отчеты")}
          </button>
          <button type="button" onClick={downloadReport} className="flex h-[36px] items-center rounded-[5px] bg-[#4db6ac] px-[15px] text-[13px] font-normal text-white hover:brightness-95">
            <Download className="mr-[7px] h-[18px] w-[18px]" /> {t("Скачать")}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-[19px]">
            <BuilderPeriod from={from} to={to} onApply={(begin, end) => { setFrom(begin); setTo(end); setReportReady(false) }} />
            <button type="button" onClick={() => setSettingsVisible((value) => !value)} className="h-[38px] w-[215px] rounded-[3px] bg-[#1E4A9A] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95">
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
              <button type="button" onClick={() => setExtraFilters((current) => [...current, ""])} className="mt-[18px] h-9 w-full rounded-[3px] bg-[#1E4A9A] text-[13px] font-medium uppercase text-white hover:brightness-95">
                <span>{t("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР")}</span>
              </button>
            </div>
          </div>
        )}

      </section>

      {reportReady && result && (
        result.rows.length === 0 ? (
          <BuilderNoData className="mx-7 mt-[30px]" />
        ) : (
          <div className="mx-7 mt-[30px] overflow-x-auto rounded-[8px] bg-white">
            <BuilderTable result={result} />
          </div>
        )
      )}

      {saves.dialogs}
    </ReportPage>
  )
}

export const CHECKBOX =
  "h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border-2 border-[#444] bg-white checked:border-[#444] checked:bg-[#444] checked:bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22><path%20fill=%22white%22%20d=%22M9%2016.2L4.8%2012l-1.4%201.4L9%2019%2021%207l-1.4-1.4z%22/></svg>')] checked:bg-[length:12px] checked:bg-center checked:bg-no-repeat"

function OptionColumn({ title, placeholder, query, onQuery, items, selected, onToggle, info = false }: { title: string; placeholder: string; query: string; onQuery: (value: string) => void; items: string[]; selected: string[]; onToggle: (item: string) => void; info?: boolean }) {
  const { t } = useLanguage()
  // "…, SUM" names a base-currency column: with an app currency (Настройки → Валюта приложения) its amounts are in that one.
  const appCurrency = useAppCurrency()
  const itemTitle = (item: string) => appCurrencyColumn(item, t, appCurrency)
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
            {itemTitle(item)}
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

/** The visits model's measures and groupings (Конструктор отчетов, model "Визит"). */
export { columns as visitColumns, groupings as visitGroupings }
