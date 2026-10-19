"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MapPinned,
  Route,
  Trash2,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { FilterCheck, FilterDate, FilterRange, FilterSelect, RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { AgentsSidebar } from "./agents-sidebar"
import { TerritoryPanel } from "./territory-panel"

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

function SelectLine({ label, value: controlled, onChange }: { label: string; value?: string; onChange?: (value: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [internal, setInternal] = useState("")
  const value = controlled ?? internal
  const setValue = (next: string) => (onChange ? onChange(next) : setInternal(next))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-[36px] w-full items-center border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black"
      >
        <span>{t(value) || t(label)}</span>
        <svg viewBox="0 0 10 7" className="absolute right-[14px] top-[14px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
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
              className="block w-full px-3 py-2.5 text-left text-[13px] font-semibold hover:bg-[#f2f5f8]"
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
    <label className="flex cursor-pointer items-center gap-[9px] text-[13px] font-medium text-[#333]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          setInternalChecked(event.target.checked)
          onChange?.(event.target.checked)
        }}
        className="h-[15px] w-[15px] accent-[#536fe1]"
      />
      <span>{t(label)}</span>
    </label>
  )
}

function ClientsFilterModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const empty = {
    createdBegin: "", createdEnd: "",
    lastOrderFrom: "", lastOrderTo: "", lastPaymentFrom: "", lastPaymentTo: "",
    lastRefusalFrom: "", lastRefusalTo: "", lastVisitFrom: "", lastVisitTo: "",
    agent: "", deliverer: "", branch: "", refusalType: "",
    frequency: "", agentRoute: "", client: "", clientType: "", clientClass: "", zone: "", lastVisit: "",
    noRoute: false, equipment: false, zoneUndefined: false, unlimitedDebt: false, wrongZones: false,
  }
  const [draft, setDraft] = useState(empty)
  const [days, setDays] = useState<string[]>([])
  const set = <K extends keyof typeof empty>(key: K) => (value: (typeof empty)[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const options = (label: string) => selectOptions[label] ?? []

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("Показать на карте")}
        onMouseDown={(event) => event.stopPropagation()}
        className="fixed left-1/2 top-4 flex max-h-[calc(100vh-32px)] w-[768px] max-w-full -translate-x-1/2 flex-col bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
      >
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <h2 className="text-[15px] font-medium uppercase text-[#333]">{t("Показать на карте")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[386px_1fr] overflow-y-auto">
          <div className="border-r border-[#efefef] pb-[23px] pl-[30px] pr-[26px]">
            <FilterDate
              className="-mt-[8px]"
              label={t("Период создания клиента")}
              begin={draft.createdBegin}
              end={draft.createdEnd}
              onChange={(begin, end) => setDraft((current) => ({ ...current, createdBegin: begin, createdEnd: end }))}
            />
            <div className="-mt-[3px]">
              <FilterRange caption={t("Прошло дней с последнего заказа")} from={draft.lastOrderFrom} to={draft.lastOrderTo} onFrom={set("lastOrderFrom")} onTo={set("lastOrderTo")} />
              <div className="h-[3px]" />
              <FilterRange caption={t("Прошло дней с последней оплаты")} from={draft.lastPaymentFrom} to={draft.lastPaymentTo} onFrom={set("lastPaymentFrom")} onTo={set("lastPaymentTo")} />
              <div className="h-[3px]" />
              <FilterRange caption={t("Прошло дней с последнего отказа")} from={draft.lastRefusalFrom} to={draft.lastRefusalTo} onFrom={set("lastRefusalFrom")} onTo={set("lastRefusalTo")} />
              <div className="h-[3px]" />
              <FilterRange caption={t("Прошло дней с последнего визита")} from={draft.lastVisitFrom} to={draft.lastVisitTo} onFrom={set("lastVisitFrom")} onTo={set("lastVisitTo")} />
            </div>
            <div className="-mt-[5px]">
              <FilterSelect label={t("Ответственный агент")} value={draft.agent} onChange={set("agent")} options={options("Ответственный агент")} className="mb-0" />
              <FilterSelect label={t("Ответственные доставщики")} value={draft.deliverer} onChange={set("deliverer")} options={options("Ответственные доставщики")} />
              <FilterSelect label={t("Филиалы")} value={draft.branch} onChange={set("branch")} options={options("Филиалы")} />
              <FilterSelect label={t("Тип отказа")} value={draft.refusalType} onChange={set("refusalType")} options={options("Тип отказа")} />
            </div>
            <div className="space-y-[6px]">
              <FilterCheck label={t("Маршрут не установлен")} checked={draft.noRoute} onChange={set("noRoute")} />
              <FilterCheck label={t("Показать оборудование")} checked={draft.equipment} onChange={set("equipment")} />
            </div>
          </div>
          <div className="pb-5 pl-[26px] pr-[24px]">
            <div className="pt-[18px]">
              <div className="text-[13px] font-medium text-[#333]">{t("Показывать по маршруту (дни)")}</div>
              <div className="mt-[10px] flex gap-[18px]">
                {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}
                    className={`h-8 w-8 text-[13px] ${days.includes(day) ? "bg-[#4f71dc] text-white" : "bg-[#eceff1] text-[#666]"}`}
                  >
                    {t(day)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-[18px]">
              <FilterSelect label={t("Частота посещения")} value={draft.frequency} onChange={set("frequency")} options={options("Частота посещения")} />
              <FilterSelect label={t("Маршрут агента")} value={draft.agentRoute} onChange={set("agentRoute")} options={options("Маршрут агента")} />
              <FilterSelect label={t("Клиент")} value={draft.client} onChange={set("client")} options={options("Клиент")} />
              <FilterSelect label={t("Тип клиента")} value={draft.clientType} onChange={set("clientType")} options={options("Тип клиента")} />
              <FilterSelect label={t("Класс клиента")} value={draft.clientClass} onChange={set("clientClass")} options={options("Класс клиента")} />
              <FilterSelect label={t("Зона")} value={draft.zone} onChange={set("zone")} options={options("Зона")} />
              <FilterSelect label={t("Последнее посещение")} value={draft.lastVisit} onChange={set("lastVisit")} options={options("Последнее посещение")} />
            </div>
            <div className="space-y-[6px]">
              <FilterCheck label={t("Зона не определена")} checked={draft.zoneUndefined} onChange={set("zoneUndefined")} />
              <FilterCheck label={t("Неограниченный долг")} checked={draft.unlimitedDebt} onChange={set("unlimitedDebt")} />
              <FilterCheck label={t("Неправильно присвоенные зоны(зона агента не совпадает с зоной клиента)")} checked={draft.wrongZones} onChange={set("wrongZones")} />
            </div>
          </div>
        </div>
        <footer className="flex h-[57px] shrink-0 items-center justify-end gap-[21px] border-t border-[#efefef] pr-[20px]">
          <button
            type="button"
            onClick={() => {
              setDraft(empty)
              setDays([])
            }}
            className="h-9 rounded-[3px] bg-[#fa6e65] px-[16px] text-[13px] font-bold uppercase tracking-wide text-white hover:brightness-95"
          >
            {t("Очистить")}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-bold uppercase tracking-wide text-white hover:brightness-95">
            {t("Применить")}
          </button>
        </footer>
      </section>
    </div>
  )
}

function VideoLessonDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <section onMouseDown={(event) => event.stopPropagation()} className="w-[500px] bg-white text-[13px] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b className="uppercase">{t("Видео урок")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </header>
        <div className="px-[30px] py-[40px]">
          <div className="h-[250px] w-full bg-black" />
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[26px]">
          <button type="button" onClick={onClose} className="font-semibold uppercase text-[#0a9ddb]">{t("Закрыть")}</button>
        </footer>
      </section>
    </div>
  )
}

function ZoneModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<"draw" | "select">("select")
  const [name, setName] = useState("")
  const [branch, setBranch] = useState("")
  const [parent, setParent] = useState("")
  const [reassign, setReassign] = useState(false)
  const [video, setVideo] = useState(false)
  return (
    <div className="absolute left-1/2 top-0 z-[700] w-[550px] -translate-x-1/2 bg-white pb-[10px] text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex items-center px-[30px] pt-[12px]">
        <label className="relative block h-[48px] w-[270px] border-b border-[#e0e0e0]">
          <span className={`pointer-events-none absolute left-0 font-semibold ${name ? "top-[3px] text-[10px]" : "top-[26px] text-[13px]"}`}>{t("Наименование зоны")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent font-semibold outline-none" />
        </label>
        <div className="ml-[22px] flex items-center gap-[10px]">
          <button type="button" onClick={() => setMode("draw")} aria-label={t("Рисовать")} className={`flex h-[48px] w-[48px] items-center justify-center ${mode === "draw" ? "bg-[#f0f0f0]" : ""}`}><Route className="h-6 w-6 text-[#333]" strokeWidth={1.5} /></button>
          <button type="button" onClick={() => setMode("select")} aria-label={t("Выбрать")} className={`flex h-[48px] w-[48px] items-center justify-center ${mode === "select" ? "bg-[#f0f0f0]" : ""}`}><MapPinned className="h-6 w-6 text-[#333]" strokeWidth={1.5} /></button>
          <button type="button" aria-label={t("Очистить зону")} onClick={() => { setName(""); setMode("select") }} className="flex h-[48px] w-[48px] items-center justify-center"><Trash2 className="h-6 w-6 text-[#333]" strokeWidth={1.5} /></button>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="ml-auto flex h-[48px] w-[48px] items-center justify-center"><X className="h-6 w-6 text-[#555]" /></button>
      </div>
      <div className="px-[30px]">
        <div className="mt-[10px] w-[270px]"><SelectLine label="Филиал" value={branch} onChange={setBranch} /></div>
        <div className="mt-[6px] flex items-end gap-[20px]">
          <div className="w-[270px]"><SelectLine label="Родительская зона" value={parent} onChange={setParent} /></div>
          <button type="button" onClick={() => setVideo(true)} className="pb-[10px] text-[13px] font-medium text-[#1b8fd6]">{t("Видеоурок по созданию зоны")}</button>
        </div>
        <label className="mt-[14px] flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
          <input type="checkbox" checked={reassign} onChange={(event) => setReassign(event.target.checked)} className="h-[18px] w-[18px] accent-[#536fe1]" />
          {t("Переназначить зоны клиентов")}
        </label>
        <div className="mt-[22px] text-right">
          <button type="button" onClick={onClose} className="font-semibold uppercase text-[#0a9ddb]">{t("Сохранить")}</button>
        </div>
      </div>
      {video && <VideoLessonDialog onClose={() => setVideo(false)} />}
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
  const [managePanel, setManagePanel] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [zoneOpen, setZoneOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(true)
  const [search, setSearch] = useState("")
  const [legendOpen, setLegendOpen] = useState(false)

  useEffect(() => {
    if (view !== "clients") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("openFilterDialog") === "true") setFilterOpen(true)
    if (params.get("openInfo") === "true") setManagePanel(true)
  }, [view])

  useEffect(() => {
    setShowAgents(view === "agents")
    setShowClients(true)
    setShowZones(view === "clients")
    setSidebarOpen(view === "agents")
  }, [view])

  if (view === "clients") {
    return (
      <main className="flex h-[calc(100vh-50px)] flex-col overflow-hidden bg-[#f2f5f8]">
        <div className="bg-[#f2f5f8] pl-[30px] pr-[38px]">
          <RefHeader title={t("Территория")}>
            <RefButton icon={RI.filter} label={t("Показать клиентов")} onClick={() => setFilterOpen(true)} />
            <RefButton icon={RI.trend} label={t("Установить маршрут")} onClick={() => setVideoOpen(true)} />
            <RefButton icon={RI.filter} label={t("Управлять территориями")} onClick={() => setManagePanel((open) => !open)} />
            <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => setZoneOpen(true)} />
          </RefHeader>
        </div>
        <div className="relative min-h-0 flex-1">
          <TrackingMap showAgents={false} showClients={showClients} showZones={showZones} />
          <div className="absolute right-[14px] top-[18px] z-[500] flex h-[48px] w-[264px] items-center bg-white shadow-[0_2px_6px_rgba(0,0,0,0.2)]">
            {searchOpen && (
              <label className="flex h-full flex-1 items-center px-[22px]">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full text-[15px] outline-none placeholder:text-[#999]" />
              </label>
            )}
            <button type="button" onClick={() => setSearchOpen((current) => !current)} className="h-full px-[18px] text-[#333]">
              {searchOpen ? <ChevronLeft className="h-4 w-4 fill-current" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="absolute bottom-0 right-0 z-[500] w-[230px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
            <button type="button" onClick={() => setFilterOpen(true)} className="flex h-[30px] w-full items-center gap-[10px] bg-[#4f71dc] px-[14px] text-[13px] font-semibold text-white"><svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>{t("Показать клиентов")}</button>
            <div className="space-y-[8px] px-[14px] pb-[8px] pt-[10px]">
              <CheckLine label="Скрыть ориентиры" />
              <CheckLine label="Режим спутника" />
              <CheckLine label="Выбор клиентов" />
            </div>
          </div>
          {zoneOpen && <ZoneModal onClose={() => setZoneOpen(false)} />}
          {managePanel && <TerritoryPanel onClose={() => setManagePanel(false)} />}
        </div>
        {filterOpen && <ClientsFilterModal onClose={() => setFilterOpen(false)} />}
        {videoOpen && <VideoLessonDialog onClose={() => setVideoOpen(false)} />}
      </main>
    )
  }

  return (
    <div className="flex h-[calc(100vh-50px)] w-full">
      <div className="relative flex-1">
        <TrackingMap showAgents={showAgents} showClients={showClients} showZones={showZones} />

        <div className="absolute left-[30px] top-[18px] z-[500] flex items-center gap-[11px]">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t("Отслеживание")}</span>
        </div>

        <div className="absolute left-[48px] top-[100px] z-[500]">
          <button
            type="button"
            onClick={() => setLegendOpen((current) => !current)}
            className="flex h-[46px] w-[200px] items-center justify-between bg-white px-[15px] text-[13px] text-[#333] shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
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

        <div className="absolute bottom-[10px] right-[24px] z-[500] bg-white/90 px-[12px] py-[8px]">
          <div className="space-y-[6px]">
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
