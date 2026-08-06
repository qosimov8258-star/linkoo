"use client"

import Image from "next/image"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { ChevronRight, Download, PlusCircle, Star, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"

const branches = ["Все филиалы", "777", "878", "agent", "Andijon", "AURUM samarqand", "baby still", "Buxoro"]
const contractors = [
  "Все контрагенты",
  "Markus Vitinha",
  "Usman Dembele",
  "Ashraf Hakimi",
  "Doston market",
  "3333333333333333333333333333",
  "Наталья Лина",
]
const creators = ["05,08,2025 (1)", "Otaw Original3 Mardonov", "shohrux Avazhonov", "xodim1 1", "Suxrob Akramxodjaev", "Zaynillo Sadullayev"]
const surveys = ["distr", "oprosnik taski", "so'rovnoma 1", "наблюдатель", "narxlar royxat", "obforfhbihf1"]
const productGroups = ["Наши продукты", "Продукты конкурентов"]

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

export function StoreTimeView({ storeCheckMode = false, productCheckMode = false }: { storeCheckMode?: boolean; productCheckMode?: boolean }) {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(storeCheckMode || productCheckMode ? monthStart : today)
  const [to, setTo] = useState(storeCheckMode || productCheckMode ? monthEnd : today)
  const [agent, setAgent] = useState("")
  const [branch, setBranch] = useState(branches[0])
  const [contractor, setContractor] = useState(contractors[0])
  const [planned, setPlanned] = useState("")
  const [creator, setCreator] = useState("")
  const [survey, setSurvey] = useState("")
  const [productGroup, setProductGroup] = useState("")
  const [applied, setApplied] = useState("")
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const overlayOpen = favoritesOpen || dashboardOpen

  useEffect(() => {
    if (!overlayOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFavoritesOpen(false)
        setDashboardOpen(false)
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [overlayOpen])

  function apply(event: FormEvent) {
    event.preventDefault()
    if (from <= to) {
      setApplied(
        [branch !== branches[0] && branch, contractor !== contractors[0] && contractor, planned, creator, survey, productGroup]
          .filter(Boolean)
          .join(" · "),
      )
    }
  }

  function downloadCsv() {
    const rows = productCheckMode
      ? [["Дата от", "Дата до", "Создал", "Опрос", "Продукты"], [from, to, creator || "Все", survey || "Все", productGroup || "Все"]]
      : [["Дата от", "Дата до", "Агент", "Филиал", "Контрагент", "По плану"], [from, to, agent || "Не найдено", branch, contractor, planned || "Все"]]
    downloadExcelTable(productCheckMode ? "product-store-check.xls" : storeCheckMode ? "store-check.xls" : "store-time.xls", rows)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <button type="button" onClick={() => setFavoritesOpen(true)} className="flex items-center gap-2 text-[#5470e8]">
            <Star className={`h-6 w-6 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />Избранные
          </button>
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">
            {productCheckMode ? "Store check по продуктам" : storeCheckMode ? "Выполнение Store Check" : "Время нахождения в магазинах"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-md bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white"><Download className="h-5 w-5" />Скачать Excel</button>
          <button type="button" onClick={() => setDashboardOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#5470e8] px-5 py-2.5 font-semibold text-white"><PlusCircle className="h-5 w-5" />Добавить в дашборд</button>
        </div>
      </header>

      <section className="bg-white px-4 py-3 sm:px-10">
        <form onSubmit={apply}>
          <div className={`grid gap-x-5 gap-y-14 md:grid-cols-2 ${storeCheckMode && !productCheckMode ? "xl:max-w-[920px]" : "xl:grid-cols-4"}`}>
            <label className="text-xs font-medium">Дата создания от
              <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue" />
            </label>
            <label className="text-xs font-medium">Дата создания до
              <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue" />
            </label>
            {productCheckMode && (
              <>
                <FilterSelect label="Создал" value={creator} onChange={setCreator} options={creators} emptyLabel="Все" />
                <FilterSelect label="Опрос" value={survey} onChange={setSurvey} options={surveys} emptyLabel="Все" />
                <FilterSelect label="Продукты" value={productGroup} onChange={setProductGroup} options={productGroups} emptyLabel="Все" />
              </>
            )}
            {!storeCheckMode && !productCheckMode && (
              <>
                <FilterSelect label="Агент" value={agent} onChange={setAgent} options={[]} emptyLabel="Не найдено" />
                <FilterSelect label="Филиал" value={branch} onChange={setBranch} options={branches} />
                <FilterSelect label="Контрагент" value={contractor} onChange={setContractor} options={contractors} />
                <FilterSelect label="По плану" value={planned} onChange={setPlanned} options={["", "Да", "Нет"]} />
              </>
            )}
          </div>
          <button type="submit" disabled={from > to} className="mt-3 w-full rounded-md bg-[#6ccd8b] py-3 font-bold text-white disabled:opacity-50">Применить</button>
        </form>

        <div className="flex min-h-[365px] flex-col items-center justify-center py-12">
          <Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
          <p className="mt-7 text-lg text-slate-400">По вашему запросу ничего не найдено...</p>
          {applied && <p className="mt-2 text-sm text-slate-400">{applied}</p>}
        </div>
      </section>

      {overlayOpen && <button type="button" aria-label="Закрыть окно" onClick={() => { setFavoritesOpen(false); setDashboardOpen(false) }} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
      {dashboardOpen && (
        <section role="dialog" aria-modal="true" aria-labelledby="store-dashboard-title" className="fixed left-1/2 top-1/2 z-[100] flex h-[min(646px,calc(100vh-32px))] w-[min(750px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b px-9 py-7"><h2 id="store-dashboard-title" className="text-lg font-bold uppercase">Добавить в дашборд</h2><button type="button" onClick={() => setDashboardOpen(false)} aria-label="Закрыть"><X className="h-7 w-7" /></button></header>
          <div className="flex-1 px-16 py-10">
            <fieldset className="space-y-5"><legend className="sr-only">Доступ</legend>{[["all", "Все"], ["employees", "Выбранным сотрудникам"], ["access", "Выбранным доступам"]].map(([value, label]) => <label key={value} className="flex items-center gap-5 text-lg"><input type="radio" name="store-visibility" checked={visibility === value} onChange={() => setVisibility(value)} className="h-6 w-6 accent-slate-500" />{label}</label>)}</fieldset>
            <label className="mt-12 block border-b pb-2 font-bold">Дашборд<select value={dashboard} onChange={(event) => setDashboard(event.target.value)} className="mt-2 block w-full border-0 bg-white py-2 font-normal"><option>Основной дашборд</option><option>Продажи</option><option>Контроль агентов</option></select></label>
          </div>
          <footer className="flex justify-end border-t px-9 py-6"><button type="button" onClick={() => setDashboardOpen(false)} className="font-semibold uppercase text-sky-500">Сохранить</button></footer>
        </section>
      )}
      {favoritesOpen && (
        <aside role="dialog" aria-modal="true" aria-labelledby="store-favorites-title" className="fixed bottom-0 left-0 top-0 z-[100] w-[min(418px,calc(100vw-28px))] border-r-[10px] border-sky-500 bg-white shadow-2xl animate-in slide-in-from-left-full duration-200">
          <header className="flex items-center justify-between border-b px-9 py-7"><h2 id="store-favorites-title" className="text-xl font-medium">Избранные</h2><button type="button" onClick={() => setFavoritesOpen(false)} aria-label="Закрыть"><X className="h-7 w-7" /></button></header>
          <nav>{["Клиенты", "Заказы", "Виджеты", "Ограничение продуктов", "Продукты"].map((item) => <button key={item} type="button" onClick={() => { setFavorite(true); setFavoritesOpen(false) }} className="flex w-full items-center justify-between border-b px-6 py-3.5 text-left text-[17px] font-medium hover:bg-slate-50">{item}<ChevronRight className="h-5 w-5 text-slate-500" /></button>)}</nav>
        </aside>
      )}
    </main>
  )
}

export function StoreCheckView() {
  return <StoreTimeView storeCheckMode />
}

export function ProductStoreCheckView() {
  return <StoreTimeView productCheckMode />
}

function FilterSelect({ label, value, onChange, options, emptyLabel }: { label: string; value: string; onChange: (value: string) => void; options: string[]; emptyLabel?: string }) {
  return (
    <label className="text-xs font-medium">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-white px-0 py-2 text-base font-semibold outline-none">
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option, index) => <option key={`${option}-${index}`} value={option}>{option || label}</option>)}
      </select>
    </label>
  )
}
