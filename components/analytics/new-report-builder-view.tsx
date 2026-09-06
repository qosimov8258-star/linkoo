"use client"

import { useEffect, useMemo, useState } from "react"
import { Bookmark, ChevronDown, ChevronUp, Download, FileText, FolderOpen, Pencil, Search, Trash2, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"
import type { NewReportBuilderSave } from "@/lib/new-report-builder-repo"

const reportTypes = ["ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ", "ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ СОЗДАНИЯ", "ПРОДУКТЫ ЗАКАЗОВ ПО ДАТЕ СОЗДАНИЯ", "ДРУГИЕ"]
const columns = ["АКБ заказа", "Вес продуктов заказа", "Вес продуктов возврата", "Вес продуктов факт", "Кол. продуктов заказа", "Кол. продуктов возврата", "Кол. продуктов факт", "Кол. блоков заказа", "Кол. блоков возврата", "Кол. блоков факт", "Кол. бонусов заказа", "Кол. бонусов возврата", "Кол. бонусов факт", "Кол. оформленных заказов", "Кол. оформленных возвратов", "Прибыль от продаж", "Наценка Заказа (%)", "Сумма заказов", "Сумма возвратов", "Сумма факт", "Сумма заказов, SUM", "Сумма возвратов, SUM", "Сумма факт, SUM", "Себестоимость заказа", "Себестоимость возврата", "Себестоимость факт", "Ассортимент"]
const groups = ["Дата по дням", "Дата по неделям", "Дата по месяцам", "Валюта", "Документ №", "Документ Тип", "Документ Отв.агент", "Документ Отв.агент (Имя)", "Документ Отв.агент (Фамилия)", "Документ Супервайзер", "Документ Аудиторы", "Документ Комментарий", "Доставщик", "Доставщик ID", "Сборщик", "Сборщик ID", "Организация", "Прайс-лист", "Продукт ИД", "Продукт Название", "Продукт Ед. изм", "Продукт Бренд", "Тип продукта", "Родительский тип продукта", "Продукт Артикул", "Продукт Код", "Продукт Штрих-код", "Магазин №", "Магазин Название", "Магазин Контактное лицо", "Магазин ИНН", "Магазин Тип магазина", "Магазин Категория магазина", "Себестоимость", "Склад", "Территория", "Тип оплаты", "Тип сделки", "Филиал", "Цена", "Цена до переоценки", "Код сотрудника", "Номер сервиса", "Марка", "Формат", "Группа портфель", "Группа ассортимент", "Группа продукт", "Группа марок"]
const filters = ["Бренд", "Документ Отв. агент", "Документ Аудиторы", "Доставщик", "Права доступа", "Магазин", "Организация", "Ответственный агент магазина", "Прайс-лист", "Продукт", "Склад", "Склад заказа", "Склад возврата", "Статус заказа", "Статус возврата", "Территория", "Тип продукта", "Родительский Тип продукта", "Тип оплаты", "Тип магазина", "Категория канала", "Филиал", "ММЛ продукт", "Марка", "Формат", "Группа портфель", "Группа ассортимент", "Группа продукт", "Группа марок", "Магазин ИНН"]
const dateRangePresets = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"]

function List({ title, items, selected, setSelected }: { title: string; items: string[]; selected: string[]; setSelected: (items: string[]) => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const visible = items.filter((item) => item.toLowerCase().includes(query.toLowerCase()))
  const toggle = (item: string) => setSelected(selected.includes(item) ? selected.filter((value) => value !== item) : [...selected, item])
  return <section className="min-w-0 border-r border-slate-200 px-6 last:border-0"><h2 className="mb-3 text-xl font-semibold">{t(title)}</h2><label className="relative mb-4 block"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${t("Поиск")} ${t(title).toLowerCase()}...`} className="w-full border border-slate-300 bg-slate-50 px-3 py-3 pr-10 outline-none focus:border-[#4f70e7]" /><Search className="absolute right-3 top-3 h-6 w-6 text-slate-600" /></label><div className="space-y-3">{visible.map((item) => <label key={item} className="flex cursor-pointer items-center gap-3 text-[16px] font-medium"><input type="checkbox" checked={selected.includes(item)} onChange={() => toggle(item)} className="h-5 w-5 accent-[#4f70e7]" />{t(item)}</label>)}{visible.length === 0 && <p className="text-slate-400">{t("Ничего не найдено")}</p>}</div></section>
}

export function NewReportBuilderView() {
  const { t } = useLanguage()
  const [type, setType] = useState(reportTypes[0])
  const [settings, setSettings] = useState(true)
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [vertical, setVertical] = useState<string[]>([])
  const [horizontal, setHorizontal] = useState<string[]>([])
  const [showTotals, setShowTotals] = useState(true)
  const [activeFilters, setActiveFilters] = useState<string[]>([])
  const [customFilters, setCustomFilters] = useState<string[]>([])
  const [generated, setGenerated] = useState(false)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState("")
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveDateRange, setSaveDateRange] = useState("СВОЯ")
  const [tableName, setTableName] = useState("")
  const [saving, setSaving] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportsLoading, setReportsLoading] = useState(false)
  const [savedReports, setSavedReports] = useState<NewReportBuilderSave[]>([])
  const [reportQuery, setReportQuery] = useState("")
  const displayColumns = useMemo(() => (selectedColumns.length ? selectedColumns : ["Сумма заказов", "Сумма возвратов", "Сумма факт"]), [selectedColumns])
  const displayGroups = vertical.length ? vertical : ["Документ Отв.агент"]
  const resultRows = useMemo(() => [] as { name: string; values: number[] }[], [displayColumns])
  const filteredReports = useMemo(() => savedReports.filter((report) => `${report.name} ${report.reportType}`.toLowerCase().includes(reportQuery.toLowerCase())), [savedReports, reportQuery])
  const generate = () => { setGenerated(true); setSettings(false) }
  const exportExcel = () => downloadExcelTable("new-report-builder.xls", [[...displayGroups.map((item) => t(item)), ...displayColumns.map((item) => t(item))], ...resultRows.map((row) => [row.name, ...row.values]), ...(showTotals ? [[t("Итого"), ...displayColumns.map((_, index) => resultRows.reduce((sum, row) => sum + row.values[index], 0))]] : [])])

  useEffect(() => {
    if (!saveModalOpen && !reportsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setSaveModalOpen(false)
      setReportsOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [saveModalOpen, reportsOpen])

  const openSaveModal = () => {
    setTableName("")
    setSaveDateRange("СВОЯ")
    setSaveModalOpen(true)
  }

  const confirmSaveReport = async () => {
    if (!tableName.trim()) return
    setSaving(true)
    try {
      const response = await fetch("/api/new-report-builder-saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tableName.trim(),
          reportType: type,
          config: { selectedColumns, vertical, horizontal, showTotals, activeFilters, customFilters, dateRange: saveDateRange },
        }),
      })
      if (response.ok) {
        setSaved(true)
        setSaveModalOpen(false)
        setMessage(t("Настройки отчета сохранены"))
      }
    } catch {
      // network error - keep the modal open so the user can retry
    } finally {
      setSaving(false)
    }
  }

  const openReports = async () => {
    setReportsOpen(true)
    setReportsLoading(true)
    try {
      const response = await fetch("/api/new-report-builder-saves")
      if (response.ok) setSavedReports(await response.json())
    } catch {
      // network error - keep whatever was loaded before
    } finally {
      setReportsLoading(false)
    }
  }

  const loadSavedReport = (report: NewReportBuilderSave) => {
    const config = report.config as Record<string, unknown>
    setType(reportTypes.includes(report.reportType) ? report.reportType : type)
    setSelectedColumns(Array.isArray(config.selectedColumns) ? (config.selectedColumns as string[]) : [])
    setVertical(Array.isArray(config.vertical) ? (config.vertical as string[]) : [])
    setHorizontal(Array.isArray(config.horizontal) ? (config.horizontal as string[]) : [])
    setShowTotals(typeof config.showTotals === "boolean" ? (config.showTotals as boolean) : true)
    setActiveFilters(Array.isArray(config.activeFilters) ? (config.activeFilters as string[]) : [])
    setCustomFilters(Array.isArray(config.customFilters) ? (config.customFilters as string[]) : [])
    setSettings(true)
    setGenerated(false)
    setReportsOpen(false)
    setMessage(`${t("Отчет «")}${report.name}${t("» загружен")}`)
  }

  const deleteReport = async (id: number) => {
    try {
      const response = await fetch(`/api/new-report-builder-saves/${id}`, { method: "DELETE" })
      if (response.ok) {
        setSavedReports((current) => current.filter((report) => report.id !== id))
        setMessage(t("Отчет удален"))
      }
    } catch {
      // network error - list stays as-is
    }
  }

  return <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] text-[#17233b]">
    <header className="flex flex-wrap items-center gap-5 border-b border-slate-200 px-9 py-4"><FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" /><span className="text-3xl text-slate-500">|</span><span className="text-2xl font-bold text-slate-600">{t("Конструктор")}</span><div className="ml-auto flex flex-wrap overflow-hidden rounded-md shadow-sm">{reportTypes.map((item) => <button type="button" key={item} onClick={() => { setType(item); setGenerated(false) }} className={`border border-slate-200 px-5 py-3 text-sm font-medium ${type === item ? "bg-[#27cd58] text-white" : "bg-white"}`}>{t(item)}</button>)}</div></header>
    <section className="flex flex-wrap items-center gap-4 border-b bg-white px-9 py-4"><button onClick={openSaveModal} className="flex items-center gap-2 rounded-md bg-[#5271df] px-5 py-3 font-semibold text-white"><Bookmark className="h-5 w-5" />{saved ? t("Сохранено ✓") : t("Сохранить")}</button><button onClick={openReports} className="flex items-center gap-2 rounded-md bg-[#ff8967] px-5 py-3 font-semibold text-white"><FolderOpen className="h-5 w-5" />{t("Отчеты")}</button><button onClick={exportExcel} className="flex items-center gap-2 rounded-md bg-[#4db6ac] px-5 py-3 font-semibold text-white"><Download className="h-5 w-5" />{t("Скачать")}</button><span className="ml-auto font-bold text-[#4f70e7]">{t("01 Авг. 2026 - 31 Авг. 2026")}</span><button onClick={() => setSettings((value) => !value)} className="flex items-center gap-2 rounded-md bg-[#5271df] px-5 py-3 font-semibold text-white">{settings ? t("СКРЫТЬ НАСТРОЙКИ") : t("ПОКАЗАТЬ НАСТРОЙКИ")}{settings ? <ChevronUp /> : <ChevronDown />}</button><button onClick={generate} className="rounded-md bg-[#27cd58] px-6 py-3 font-semibold text-white">{t("СФОРМИРОВАТЬ ОТЧЕТ")}</button></section>
    {message && <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-9 py-2 text-sm text-blue-700">{message}<button type="button" onClick={() => setMessage("")} aria-label={t("Закрыть сообщение")}>×</button></div>}
    {settings && <section className="grid grid-cols-1 bg-white py-3 xl:grid-cols-[1fr_1fr_1fr_1.05fr]"><List title="Колонки" items={columns} selected={selectedColumns} setSelected={setSelectedColumns} /><List title="Вертикальная группировка" items={groups} selected={vertical} setSelected={setVertical} /><List title="Горизонтальная группировка" items={groups} selected={horizontal} setSelected={setHorizontal} /><section className="px-8"><h2 className="mb-3 text-xl font-semibold">{t("Фильтр")}</h2><label className="mb-5 flex items-center gap-3 font-semibold"><input type="checkbox" checked={showTotals} onChange={(event) => setShowTotals(event.target.checked)} className="h-5 w-5 accent-[#4f70e7]" />{t("Показать итоги")}</label><div>{filters.map((filter) => <button type="button" key={filter} onClick={() => setActiveFilters((current) => current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter])} className={`flex w-full items-center justify-between border-b py-4 text-left ${activeFilters.includes(filter) ? "font-semibold text-[#4f70e7]" : ""}`}>{t(filter)}<ChevronDown className="h-4 w-4 text-slate-400" /></button>)}</div>{customFilters.map((filter, index) => <input key={`${filter}-${index}`} placeholder={t("Значение фильтра")} className="mt-3 w-full border-b p-2 outline-none" />)}<button onClick={() => setCustomFilters((current) => [...current, ""])} className="mt-5 w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">{t("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР")}</button></section></section>}
    {generated && <section className="m-8 overflow-x-auto rounded-md bg-white shadow-sm"><header className="flex items-center gap-2 border-b px-6 py-4 font-semibold"><FileText className="h-5 w-5 text-[#4f70e7]" />{t(type)}</header><table className="min-w-full border-collapse"><thead className="bg-slate-100"><tr>{displayGroups.map((item) => <th key={item} className="border px-4 py-3 text-left">{t(item)}</th>)}{displayColumns.map((item) => <th key={item} className="border px-4 py-3 text-right">{t(item)}</th>)}</tr></thead><tbody>{resultRows.map((row) => <tr key={row.name}><td className="border px-4 py-3">{row.name}</td>{row.values.map((value, index) => <td key={index} className="border px-4 py-3 text-right">{value.toLocaleString("ru-RU")}</td>)}</tr>)}{showTotals && <tr className="bg-slate-100 font-bold"><td className="border px-4 py-3">{t("Итого")}</td>{displayColumns.map((_, index) => <td key={index} className="border px-4 py-3 text-right">{resultRows.reduce((sum, row) => sum + row.values[index], 0).toLocaleString("ru-RU")}</td>)}</tr>}</tbody></table></section>}

    {saveModalOpen && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => setSaveModalOpen(false)}>
        <div role="dialog" aria-modal="true" aria-labelledby="save-table-title" onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-xl rounded bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-8 py-6">
            <h2 id="save-table-title" className="font-bold uppercase tracking-wide">{t("СОХРАНИТЬ ТАБЛИЦУ")}</h2>
            <button type="button" onClick={() => setSaveModalOpen(false)} aria-label={t("Закрыть")} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-6 w-6" />
            </button>
          </header>
          <div className="px-8 py-7">
            <div className="mb-8 flex overflow-hidden rounded border border-slate-300">
              {dateRangePresets.map((preset) => (
                <button key={preset} type="button" onClick={() => setSaveDateRange(preset)} className={`flex-1 border-r border-slate-300 py-3 text-sm font-semibold last:border-r-0 ${saveDateRange === preset ? "bg-brand-blue text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {t(preset)}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-2 block font-semibold text-slate-700">{t("Название таблицы")}</span>
              <input autoFocus value={tableName} onChange={(event) => setTableName(event.target.value)} className="w-full border-0 border-b border-slate-300 pb-2 outline-none focus:border-brand-blue" />
            </label>
          </div>
          <footer className="flex justify-end border-t border-slate-200 px-8 py-5">
            <button type="button" disabled={!tableName.trim() || saving} onClick={confirmSaveReport} className="font-semibold uppercase text-brand-blue disabled:text-slate-300">
              {saving ? t("Сохранение...") : t("Сохранить")}
            </button>
          </footer>
        </div>
      </div>
    )}

    {reportsOpen && (
      <aside role="dialog" aria-modal="true" aria-labelledby="new-report-builder-saves-title" className="fixed bottom-0 right-0 top-0 z-[100] flex w-[min(960px,calc(100vw-24px))] flex-col border-r-[7px] border-sky-500 bg-white shadow-2xl animate-in slide-in-from-right-full duration-200">
        <header className="flex items-center justify-between border-b border-slate-200 px-10 py-6">
          <h2 id="new-report-builder-saves-title" className="font-bold uppercase">{t("Отчеты")}</h2>
          <button type="button" onClick={() => setReportsOpen(false)} aria-label={t("Закрыть отчеты")} className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-7 w-7" />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-5 border-b border-slate-200 px-10 py-6">
          <label className="relative min-w-[260px] flex-1">
            <input value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} placeholder={t("Поиск таблицы...")} className="w-full border-0 border-b border-slate-300 px-0 py-3 pr-10 outline-none focus:border-brand-blue" />
            <Search className="absolute right-2 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          </label>
          <span className="ml-auto text-slate-500">{filteredReports.length ? `1 - ${filteredReports.length} ${t("из")} ${filteredReports.length}` : `0 ${t("из")} 0`}</span>
          <button type="button" disabled className="rounded-full border-2 border-slate-300 p-1 text-slate-300"><ChevronDown className="h-4 w-4 rotate-90" /></button>
          <button type="button" disabled className="rounded-full border-2 border-slate-300 p-1 text-slate-300"><ChevronDown className="h-4 w-4 -rotate-90" /></button>
        </div>

        <div className="grid grid-cols-[72px_minmax(180px,1fr)_minmax(230px,1.4fr)_100px] border-b border-dashed border-slate-300 px-10 py-5 font-bold">
          <span>{t("№")}</span><span>{t("Название")}</span><span>{t("Модель")}</span><span />
        </div>

        <div className="flex-1 overflow-y-auto">
          {reportsLoading && <p className="px-10 py-12 text-center text-slate-400">{t("Загрузка...")}</p>}
          {!reportsLoading && filteredReports.map((report) => (
            <div key={report.id} className="group grid min-h-16 grid-cols-[72px_minmax(180px,1fr)_minmax(230px,1.4fr)_100px] items-center border-b border-dashed border-slate-300 px-10 py-3 hover:bg-slate-100">
              <button type="button" onClick={() => loadSavedReport(report)} className="text-left">{report.id}</button>
              <button type="button" onClick={() => loadSavedReport(report)} className="pr-3 text-left">{report.name}</button>
              <button type="button" onClick={() => loadSavedReport(report)} className="pr-3 text-left">{t(report.reportType)}</button>
              <div className="flex gap-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button type="button" onClick={() => loadSavedReport(report)} aria-label={`${t("Изменить")} ${report.name}`}><Pencil className="h-5 w-5 text-slate-600" /></button>
                <button type="button" onClick={() => deleteReport(report.id)} aria-label={`${t("Удалить")} ${report.name}`}><Trash2 className="h-5 w-5 text-slate-600" /></button>
              </div>
            </div>
          ))}
          {!reportsLoading && filteredReports.length === 0 && <p className="px-10 py-12 text-center text-slate-400">{t("Отчеты не найдены")}</p>}
        </div>
      </aside>
    )}
  </main>
}
