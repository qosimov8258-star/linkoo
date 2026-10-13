"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  MapPinned,
  PlusCircle,
  Route,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"
import { AgentsSidebar } from "./agents-sidebar"

const TrackingMap = dynamic(() => import("./tracking-map").then((m) => m.TrackingMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-200" />,
})

type TrackingViewProps = {
  view?: "agents" | "clients"
}

const selectOptions: Record<string, string[]> = {
  "Частота посещения": ["Каждый день", "Раз в неделю", "Раз в месяц"],
  "Маршрут агента": ["Маршрут №1", "Маршрут №2", "Без маршрута"],
  Клиент: ["Doston market", "Pepsi Market", "Usman Dembele"],
  "Тип клиента": ["horeca", "market", "market100", "market101"],
  "Класс клиента": ["A", "B", "C"],
  Зона: ["Chilonzor", "Yunusobod", "Andijon shaharchasi"],
  "Последнее посещение": ["Сегодня", "Последние 7 дней", "Последние 30 дней"],
  "Ответственный агент": ["Admin Ritm", "Samandar Abdurahmonov"],
  "Ответственные доставщики": ["Хайрулло Доставщик", "Аббос Доставщик"],
  Филиалы: ["Andijon", "Tashkent", "AURUM samarqand"],
  "Тип отказа": ["Нет клиента", "Закрыто", "Отказ от заказа"],
}

function SelectLine({ label }: { label: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between border-b border-slate-200 text-left text-[16px] font-semibold text-slate-900"
      >
        <span>{t(value) || t(label)}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[800] max-h-48 overflow-auto bg-white py-1 shadow-xl">
          {(selectOptions[label] ?? ["Да", "Нет"]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setValue(option)
                setOpen(false)
              }}
              className="block w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50"
            >
              {t(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CheckLine({
  label,
  defaultChecked = false,
  checked: controlledChecked,
  onChange,
}: {
  label: string
  defaultChecked?: boolean
  checked?: boolean
  onChange?: (checked: boolean) => void
}) {
  const { t } = useLanguage()
  const [internalChecked, setInternalChecked] = useState(defaultChecked)
  const checked = controlledChecked ?? internalChecked
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[15px] font-medium text-slate-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          setInternalChecked(event.target.checked)
          onChange?.(event.target.checked)
        }}
        className="mt-0.5 h-5 w-5 accent-[#536fe1]"
      />
      <span>{t(label)}</span>
    </label>
  )
}

function ClientsFilterModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [days, setDays] = useState<string[]>([])
  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("Показать на карте")}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[960px] flex-col overflow-hidden rounded-sm bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b px-9 py-6">
          <h2 className="text-xl font-bold">{t("ПОКАЗАТЬ НА КАРТЕ")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <X className="h-7 w-7 text-slate-600" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-2 overflow-y-auto px-8 py-5">
          <div className="space-y-4 border-r pr-8">
            <label className="block text-xs font-semibold">
              {t("Период создания клиента")}
              <input type="date" className="mt-2 h-10 w-full border-b border-slate-200 text-base font-normal outline-none" />
            </label>
            {[
              "Прошло дней с последнего заказа",
              "Прошло дней с последней оплаты",
              "Прошло дней с последнего отказа",
              "Прошло дней с последнего визита",
            ].map((label) => (
              <div key={label}>
                <p className="mb-1 text-sm text-slate-600">{t(label)}</p>
                <div className="grid grid-cols-2 gap-5">
                  <input type="number" placeholder={t("От (дней)")} className="h-10 border-b border-slate-200 font-semibold outline-none" />
                  <input type="number" placeholder={t("До (дней)")} className="h-10 border-b border-slate-200 font-semibold outline-none" />
                </div>
              </div>
            ))}
            {["Ответственный агент", "Ответственные доставщики", "Филиалы", "Тип отказа"].map((label) => (
              <SelectLine key={label} label={label} />
            ))}
            <CheckLine label="Маршрут не установлен" />
            <CheckLine label="Показать оборудование" />
          </div>
          <div className="space-y-4 pl-8">
            <div>
              <p className="mb-3 text-[16px] font-semibold">{t("Показывать по маршруту (дни)")}</p>
              <div className="flex gap-3">
                {weekdays.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])}
                    className={`h-10 w-10 ${days.includes(day) ? "bg-[#536fe1] text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {t(day)}
                  </button>
                ))}
              </div>
            </div>
            {["Частота посещения", "Маршрут агента", "Клиент", "Тип клиента", "Класс клиента", "Зона", "Последнее посещение"].map((label) => (
              <SelectLine key={label} label={label} />
            ))}
            <CheckLine label="Зона не определена" />
            <CheckLine label="Неограниченный долг" />
            <CheckLine label="Неправильно присвоенные зоны (зона агента не совпадает с зоной клиента)" />
          </div>
        </div>
        <footer className="flex justify-end gap-6 border-t px-16 py-3">
          <button type="button" onClick={() => setDays([])} className="rounded-md bg-[#ff6262] px-6 py-3 font-bold text-white">{t("ОЧИСТИТЬ")}</button>
          <button type="button" onClick={onClose} className="rounded-md bg-[#6bce87] px-6 py-3 font-bold text-white">{t("ПРИМЕНИТЬ")}</button>
        </footer>
      </section>
    </div>
  )
}

function ZoneModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<"draw" | "select">("select")
  const [name, setName] = useState("")
  return (
    <div className="absolute inset-0 z-[700] flex items-start justify-center bg-slate-950/25 pt-16" onMouseDown={onClose}>
      <section onMouseDown={(event) => event.stopPropagation()} className="w-[690px] bg-white p-9 shadow-2xl">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-5">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Наименование зоны")} className="h-11 border-b border-slate-200 text-base font-semibold outline-none" />
          <button type="button" onClick={() => setMode("draw")} className={`rounded-md p-3 ${mode === "draw" ? "bg-slate-100" : ""}`}><Route /></button>
          <button type="button" onClick={() => setMode("select")} className={`rounded-md p-3 ${mode === "select" ? "bg-slate-100" : ""}`}><MapPinned /></button>
          <button type="button" aria-label={t("Очистить зону")} onClick={() => { setName(""); setMode("select") }} className="p-3"><Trash2 /></button>
        </div>
        <button type="button" onClick={onClose} className="absolute ml-[595px] mt-[-48px]"><X /></button>
        <div className="mt-6 grid grid-cols-2 gap-6">
          <SelectLine label="Филиал" />
          <SelectLine label="Родительская зона" />
        </div>
        <div className="mt-6 flex items-center justify-between">
          <CheckLine label="Переназначить зоны клиентов" />
          <span className="text-sm text-sky-500">{t("Видеоурок по созданию зоны")}</span>
        </div>
        <div className="mt-9 text-right">
          <button type="button" onClick={onClose} className="font-semibold text-sky-500">{t("СОХРАНИТЬ")}</button>
        </div>
      </section>
    </div>
  )
}

export function TrackingView({ view = "agents" }: TrackingViewProps) {
  const { t } = useLanguage()
  const [showAgents, setShowAgents] = useState(view === "agents")
  const [showClients, setShowClients] = useState(true)
  const [showZones, setShowZones] = useState(view === "clients")
  const [sidebarOpen, setSidebarOpen] = useState(view === "agents")
  const [filterOpen, setFilterOpen] = useState(false)
  const [zoneOpen, setZoneOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(true)
  const [search, setSearch] = useState("")
  const [legendOpen, setLegendOpen] = useState(false)

  useEffect(() => {
    setShowAgents(view === "agents")
    setShowClients(true)
    setShowZones(view === "clients")
    setSidebarOpen(view === "agents")
  }, [view])

  if (view === "clients") {
    return (
      <main className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-slate-100">
        <header className="flex min-h-[74px] items-center justify-between border-b bg-slate-100 px-8">
          <div className="flex items-center gap-3">
            <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#526fe0]" />
            <span className="text-2xl text-slate-400">|</span>
            <span className="text-2xl font-bold text-slate-600">{t("Территория")}</span>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setFilterOpen(true)} className="flex items-center gap-3 rounded-md bg-[#526fe0] px-5 py-3 font-bold text-white"><Filter className="h-5 w-5" />{t("Показать клиентов")}</button>
            <button type="button" onClick={() => setShowZones(true)} className="flex items-center gap-3 rounded-md bg-[#526fe0] px-5 py-3 font-bold text-white"><Route className="h-5 w-5" />{t("Установить маршрут")}</button>
            <button type="button" onClick={() => setShowZones((current) => !current)} className="flex items-center gap-3 rounded-md bg-[#526fe0] px-5 py-3 font-bold text-white"><Filter className="h-5 w-5" />{t("Управлять территориями")}</button>
            <button type="button" onClick={() => setZoneOpen(true)} className="flex items-center gap-3 rounded-md bg-[#6bce87] px-5 py-3 font-bold text-white"><PlusCircle className="h-5 w-5" />{t("Добавить")}</button>
          </div>
        </header>
        <div className="relative min-h-0 flex-1 [&_.leaflet-tile-pane]:grayscale">
          <TrackingMap showAgents={false} showClients={showClients} showZones={showZones} />
          <div className="absolute right-0 top-6 z-[500] flex h-14 items-center bg-white shadow-xl">
            {searchOpen && (
              <label className="flex h-full w-80 items-center gap-2 px-6">
                <Search className="h-5 w-5 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full text-lg outline-none" />
              </label>
            )}
            <button type="button" onClick={() => setSearchOpen((current) => !current)} className="h-full px-5">
              {searchOpen ? <ChevronRight /> : <ChevronLeft />}
            </button>
          </div>
          <div className="absolute bottom-0 right-0 z-[500] w-72 bg-white shadow-2xl">
            <button type="button" onClick={() => setFilterOpen(true)} className="flex w-full items-center gap-3 bg-[#526fe0] px-5 py-3 font-bold text-white"><Filter />{t("Показать клиентов")}</button>
            <div className="space-y-3 p-4">
              <CheckLine label="Скрыть ориентиры" />
              <CheckLine label="Режим спутника" />
              <CheckLine label="Выбор клиентов" defaultChecked={showClients} />
            </div>
          </div>
          {zoneOpen && <ZoneModal onClose={() => setZoneOpen(false)} />}
        </div>
        {filterOpen && <ClientsFilterModal onClose={() => setFilterOpen(false)} />}
      </main>
    )
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full">
      <div className="relative flex-1">
        <TrackingMap showAgents={showAgents} showClients={showClients} showZones={showZones} />

        <div className="absolute left-20 top-5 z-[500] flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-xl font-bold text-[#4f71dc]" />
          <span className="text-2xl font-light text-slate-400">|</span>
          <span className="text-xl font-bold text-slate-700">{t("Отслеживание")}</span>
        </div>

        <div className="absolute left-6 top-[92px] z-[500]">
          <button
            type="button"
            onClick={() => setLegendOpen((current) => !current)}
            className="flex h-11 w-44 items-center justify-between rounded-md bg-white px-4 text-[15px] font-medium text-slate-700 shadow-lg"
          >
            {t("Легенда карты")}
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${legendOpen ? "rotate-180" : ""}`} />
          </button>
          {legendOpen && (
            <div className="mt-1 w-56 rounded-md bg-white p-3 text-sm shadow-xl">
              <p className="mb-2 flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full bg-[#f2b705]" />{t("Агент онлайн")}</p>
              <p className="mb-2 flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full bg-[#ff4d3d]" />{t("Агент офлайн")}</p>
              <p className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full bg-[#27ae60]" />{t("Клиент")}</p>
            </div>
          )}
        </div>

        <div className="absolute bottom-6 left-6 z-[500] rounded-md bg-white/95 px-5 py-4 shadow-lg">
          <div className="space-y-3">
            <CheckLine label="Клиенты" checked={showClients} onChange={setShowClients} />
            <CheckLine label="Зоны" checked={showZones} onChange={setShowZones} />
          </div>
        </div>

        <button type="button" onClick={() => setSidebarOpen((open) => !open)} className="absolute right-4 top-5 z-[500] rounded-full bg-white p-2 shadow">
          <ChevronRight className={`h-6 w-6 ${sidebarOpen ? "" : "rotate-180"}`} />
        </button>
      </div>
      {sidebarOpen && <AgentsSidebar />}
    </div>
  )
}
