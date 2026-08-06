"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { ChevronRight, Download, PlusCircle, Star, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"

const productTypes = [
  "Все типы продуктов",
  `01, "OLIVIA" ТУАЛЕТНОЕ МЫЛО`,
  `02, "OLIVIA" ТВЕРДОЕ МЫЛО`,
  `03, "OLIVIA" ЖИДКОЕ МЫЛО`,
  `04, "OLIVIA" ШАМПУНЬ ДЛЯ ВОЛОС`,
  `06, "OLIVIA" "COTTON BUDS" ВАТНЫЕ ПАЛОЧКИ`,
]
const brands = ["Все бренды", "Alpen Gold", "Aple", "Apple", "Aqua de lux", "arbuz privet", "asus vivobook"]
const branches = ["Все филиалы", "777", "878", "agent", "Andijon", "AURUM samarqand", "baby still"]
const orderUsers = ["Все сотрудники", "05.08.2025 (1)", "Otaw Original3 Mardonov", "shohrux Avazhonov", "xodim1 1", "Suxrob Akramxodjaev", "Zaynillo Sadullayev"]

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

export function AbcAnalysisView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [productType, setProductType] = useState(productTypes[0])
  const [brand, setBrand] = useState(brands[0])
  const [branch, setBranch] = useState(branches[0])
  const [orderUser, setOrderUser] = useState(orderUsers[0])
  const [groupBy, setGroupBy] = useState("Продукт")
  const [applied, setApplied] = useState(0)
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
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [overlayOpen])

  const rowName =
    groupBy === "Бренд"
      ? brand === brands[0] ? "Apple" : brand
      : groupBy === "Филиал"
        ? branch === branches[0] ? "777" : branch
        : productType === productTypes[0] ? "sndwch" : productType
  const quantity = 22 + applied
  const sales = quantity * 10000
  const abcClass = sales >= 200000 ? "A" : sales >= 100000 ? "B" : "C"

  function apply(event: FormEvent) {
    event.preventDefault()
    if (from <= to) setApplied((value) => value + 1)
  }

  function downloadCsv() {
    downloadExcelTable("abc-analysis.xls", [
      ["Наименование", "Кол-во проданного товара", "Кол-во проданного товара в %", "Сумма продаж", "Сумма продаж в %", "Класс"],
      [rowName, quantity, 100, sales, 100, abcClass],
    ])
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <button type="button" onClick={() => setFavoritesOpen(true)} className="flex items-center gap-2 text-[#5470e8]"><Star className={`h-6 w-6 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />Избранные</button>
          <span className="text-slate-500">|</span><h1 className="text-slate-600">ABC анализ</h1>
        </div>
        <div className="flex gap-4"><button type="button" onClick={downloadCsv} className="rounded-md bg-[#6ccd8b] px-5 py-2.5 font-bold text-white"><Download className="mr-2 inline h-5 w-5" />Скачать Excel</button><button type="button" onClick={() => setDashboardOpen(true)} className="rounded-md bg-[#5470e8] px-5 py-2.5 font-bold text-white"><PlusCircle className="mr-2 inline h-5 w-5" />Добавить в дашборд</button></div>
      </header>
      <section className="bg-white px-4 py-3 sm:px-10">
        <form onSubmit={apply}>
          <div className="grid gap-x-5 gap-y-10 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs">Дата создания от<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-0 border-b py-2 text-base" /></label>
            <label className="text-xs">Дата создания до<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-0 border-b py-2 text-base" /></label>
            <SelectFilter label="Тип продукта" value={productType} setValue={setProductType} options={productTypes} />
            <SelectFilter label="Бренд" value={brand} setValue={setBrand} options={brands} />
            <SelectFilter label="Филиал" value={branch} setValue={setBranch} options={branches} />
            <SelectFilter label="Заказ оформил" value={orderUser} setValue={setOrderUser} options={orderUsers} />
            <SelectFilter label="Группировать по" value={groupBy} setValue={setGroupBy} options={["Продукт", "Бренд", "Филиал"]} />
          </div>
          <button type="submit" disabled={from > to} className="mt-3 w-full rounded-md bg-[#6ccd8b] py-3 font-bold text-white disabled:opacity-50">Применить</button>
        </form>
        <div className="mt-3 overflow-x-auto border visits-scrollbar">
          <table className="min-w-[1250px] w-full border-collapse">
            <thead className="bg-slate-50"><tr><th className="border px-4 py-5 text-left">ИД</th><th className="min-w-[600px] border px-4 py-5 text-center">Наименование</th><th className="border px-4 py-5 text-center">Кол-во проданного товара</th><th className="border px-4 py-5 text-center">Кол-во проданного товара в %</th><th className="border px-4 py-5 text-center">Сумма продаж</th><th className="border px-4 py-5 text-center">Сумма продаж в %</th><th className="border px-4 py-5 text-center">Класс</th></tr></thead>
            <tbody><tr><td className="border px-2 py-4">510</td><td className="border px-2 py-4">{rowName}</td><td className="border px-2 py-4 text-right">{quantity}</td><td className="border px-2 py-4 text-right">100</td><td className="border px-2 py-4 text-right">{sales.toLocaleString("ru-RU")}</td><td className="border px-2 py-4 text-right">100</td><td className={`border px-2 py-4 ${abcClass === "A" ? "bg-[#94f56f]" : abcClass === "B" ? "bg-yellow-300" : "bg-red-300"}`}>{abcClass}</td></tr><tr className="bg-slate-50"><td className="border" /><td className="border px-2 py-4">Итого</td><td className="border px-2 py-4 text-right">{quantity}</td><td className="border px-2 py-4 text-right">100</td><td className="border px-2 py-4 text-right">{sales.toLocaleString("ru-RU")}</td><td className="border px-2 py-4 text-right">100</td><td className="border" /></tr></tbody>
          </table>
        </div>
      </section>
      {overlayOpen && <button type="button" aria-label="Закрыть окно" onClick={() => { setFavoritesOpen(false); setDashboardOpen(false) }} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
      {dashboardOpen && <DashboardDialog visibility={visibility} setVisibility={setVisibility} dashboard={dashboard} setDashboard={setDashboard} onClose={() => setDashboardOpen(false)} />}
      {favoritesOpen && <FavoritesDrawer onClose={() => setFavoritesOpen(false)} onSelect={() => { setFavorite(true); setFavoritesOpen(false) }} />}
    </main>
  )
}

function SelectFilter({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) {
  return <label className="text-xs">{label}<select value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 block w-full border-0 border-b bg-white py-2 text-base font-semibold">{options.map((option, index) => <option key={`${option}-${index}`}>{option}</option>)}</select></label>
}

function DashboardDialog({ visibility, setVisibility, dashboard, setDashboard, onClose }: { visibility: string; setVisibility: (value: string) => void; dashboard: string; setDashboard: (value: string) => void; onClose: () => void }) {
  return <section role="dialog" aria-modal="true" className="fixed left-1/2 top-1/2 z-[100] flex h-[min(620px,calc(100vh-32px))] w-[min(750px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col bg-white"><header className="flex justify-between border-b px-9 py-7"><h2 className="font-bold uppercase">Добавить в дашборд</h2><button type="button" onClick={onClose}><X /></button></header><div className="flex-1 px-16 py-10"><fieldset className="space-y-5">{[["all", "Все"], ["employees", "Выбранным сотрудникам"], ["access", "Выбранным доступам"]].map(([value, label]) => <label key={value} className="flex gap-4 text-lg"><input type="radio" checked={visibility === value} onChange={() => setVisibility(value)} />{label}</label>)}</fieldset><label className="mt-12 block font-bold">Дашборд<select value={dashboard} onChange={(event) => setDashboard(event.target.value)} className="mt-2 block w-full border-b py-2 font-normal"><option>Основной дашборд</option><option>Продажи</option><option>Аналитика</option></select></label></div><footer className="flex justify-end border-t px-9 py-6"><button type="button" onClick={onClose} className="font-bold uppercase text-sky-500">Сохранить</button></footer></section>
}

function FavoritesDrawer({ onClose, onSelect }: { onClose: () => void; onSelect: () => void }) {
  return <aside className="fixed bottom-0 left-0 top-0 z-[100] w-[min(418px,calc(100vw-28px))] border-r-[10px] border-sky-500 bg-white"><header className="flex justify-between border-b px-9 py-7"><h2 className="text-xl">Избранные</h2><button type="button" onClick={onClose}><X /></button></header>{["Клиенты", "Заказы", "Виджеты", "Ограничение продуктов", "Продукты"].map((item) => <button key={item} type="button" onClick={onSelect} className="flex w-full justify-between border-b px-6 py-3.5 text-left">{item}<ChevronRight /></button>)}</aside>
}
