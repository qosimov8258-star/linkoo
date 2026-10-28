"use client"

import { Search, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

const PIN_PATHS = [
  "M-243.3,395.8c1.5,0,2.7-1.2,2.7-2.7c0-1.5-1.2-2.7-2.7-2.7c-1.5,0-2.7,1.2-2.7,2.7C-246,394.6-244.8,395.8-243.3,395.8z M-243.3,391.1c1.1,0,2,0.9,2,2c0,1.1-0.9,2-2,2s-2-0.9-2-2C-245.2,392-244.4,391.1-243.3,391.1z",
  "M-235.7,400.2h-2.8l1.2-1.7c2.3-3,1.9-8-0.7-10.6c-1.4-1.4-3.3-2.2-5.3-2.2c-2,0-3.9,0.8-5.3,2.2c-2.6,2.6-3,7.6-0.7,10.6 l1.2,1.7h-2.9l-4.3,9h24L-235.7,400.2z M-248.7,398c-2-2.7-1.7-7.2,0.6-9.6c1.3-1.3,3-2,4.8-2s3.5,0.7,4.8,2 c2.4,2.4,2.7,6.8,0.6,9.6l-5.4,7.8l-3.9-5.6l0,0L-248.7,398z M-250.6,400.9h3l4.3,6.2l4.3-6.2h2.9l3.6,7.5h-21.5L-250.6,400.9z",
]
const CART_PATH = "M11 9h2V6h3V4h-3V1h-2v3H8v2h3v3zm-4 9c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-9.83-3.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 4h-.01l-1.1 2-2.76 5H8.53l-.13-.27L6.16 6l-.95-2-.94-2H1v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z"
const DOLLAR_PATH = "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"

/** Agent categories behind the five tabs of the right-hand drawer, in the reference's order. */
const AGENT_TABS = [
  { id: "all", group: "", label: "Все", icon: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" },
  { id: "agents", group: "agent", label: "Агенты", icon: "M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z" },
  { id: "merch", group: "merch", label: "Мерчендайзеры", icon: "M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7zm11.77 8.27L13 19.54l-4.27-4.27C8.28 14.81 8 14.19 8 13.5c0-1.38 1.12-2.5 2.5-2.5.69 0 1.32.28 1.77.74l.73.72.73-.73c.45-.45 1.08-.73 1.77-.73 1.38 0 2.5 1.12 2.5 2.5 0 .69-.28 1.32-.73 1.77z" },
  { id: "delivery", group: "delivery", label: "Доставщики", icon: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" },
  { id: "collectors", group: "collector", label: "Инкассаторы", icon: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12z" },
] as const

/** `groups` = the reference group tabs the employee is in (null while the agent plan is not loaded). */
type AgentRow = { name: string; position: string; groups: string[] | null }
type BoardAgent = {
  name: string
  firstVisit: string
  visited: number
  plan: number
  outside: number
  salesSum: number
  idleMinutes: number
  lastClient: string
  lastDurationSec: number
}
type Board = { problems: BoardAgent[]; active: BoardAgent[] }

const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "2026-10-22 10:30:00" → "22 окт. 2026, 10:30". */
function formatFirstVisit(stamp: string) {
  const [date, time = ""] = stamp.split(" ")
  const [y, m, d] = date.split("-").map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}, ${time.slice(0, 5)}`
}

const formatSum = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} SUM`

export function RoutesAnalysisView() {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState("")
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [agentTab, setAgentTab] = useState<(typeof AGENT_TABS)[number]["id"]>("all")
  const [tabTip, setTabTip] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [routeMenu, setRouteMenu] = useState(false)
  const router = useRouter()
  const [agentQuery, setAgentQuery] = useState("")
  const [board, setBoard] = useState<Board>({ problems: [], active: [] })
  // The tabs are the reference's server groups (agents_plans?group=agent|merch|delivery|collector; "Агенты" is empty
  // for this account). Until the agent plan is seeded a tab keeps the employees whose job names the singular of its label.
  const tab = AGENT_TABS.find((entry) => entry.id === agentTab)
  const tabMatch = agentTab === "all" ? "" : (tab?.label ?? "").slice(0, -1).toLowerCase()
  const inTab = (agent: AgentRow) => (!tab?.group ? true : agent.groups ? agent.groups.includes(tab.group) : agent.position.includes(tabMatch))
  const drawerAgents = agents.filter((agent) => agent.name.toLowerCase().includes(agentQuery.toLowerCase()) && inTab(agent))

  useEffect(() => {
    let cancelled = false
    type EmployeeRow = { id?: number; name?: string; firstName?: string; lastName?: string; first_name?: string; last_name?: string; position?: string; active?: boolean }
    const json = async <T,>(url: string): Promise<T[]> => {
      const response = await fetch(url)
      return response.ok ? ((await response.json()) as T[]) : []
    }
    // The list is the reference's agent plan (agents_plans): its active members. Until that table is seeded
    // every active employee is listed.
    Promise.all([json<EmployeeRow>("/api/employees"), json<{ employeeId: number; active: boolean; groups: string[]; position?: number }>("/api/agent-plan-members").catch(() => [])])
      .then(([data, members]) => {
        if (cancelled || !Array.isArray(data)) return
        const plan = Array.isArray(members) && members.length ? new Map(members.filter((member) => member.active).map((member) => [member.employeeId, { groups: member.groups, position: member.position ?? -1 }])) : null
        setAgents(
          data
            .filter((row) => (plan ? plan.has(Number(row.id)) : row.active !== false))
            // the reference lists the plan in its own order (unknown positions keep the employee order, after the known ones)
            .map((row, index) => ({ name: [row.firstName ?? row.first_name, row.lastName ?? row.last_name].filter(Boolean).join(" ") || row.name || "", position: (row.position ?? "").toLowerCase(), groups: plan ? (plan.get(Number(row.id))?.groups ?? []) : null, order: plan && (plan.get(Number(row.id))?.position ?? -1) >= 0 ? (plan.get(Number(row.id))?.position as number) : 1000 + index }))
            .filter((row) => row.name)
            .sort((a, b) => a.order - b.order),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    fetch(`/api/agent-visits?date=${date}`)
      .then(async (response) => (response.ok ? ((await response.json()) as Board) : null))
      .then((data) => {
        if (!cancelled && data) setBoard({ problems: data.problems ?? [], active: data.active ?? [] })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const working = new Set([...board.problems, ...board.active].map((agent) => agent.name))
  const notOut = agents.filter((agent) => !working.has(agent.name))
  const progress = new Map([...board.problems, ...board.active].map((agent) => [agent.name, agent]))

  async function saveRoute() {
    if (!selected) {
      notify(t("Выберите агента"))
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/agent-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: selected, routeDate }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        notify(data.error || t("Не удалось сохранить маршрут"))
        return
      }
      setNotice(`${t("Маршрут для")} «${selected}» ${t("установлен")}`)
      setIsOpen(false)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={`min-h-[calc(100vh-50px)] bg-[#f2f5f8] pb-10 pt-px text-[#333] transition-[padding] duration-200 ${drawerOpen ? "pr-[330px]" : ""}`}>
      <div className="pl-[28px] pr-[8px]">
        <RefHeader title={t("Анализ маршрутов")}>
          <div className="flex items-center gap-0">
            {!drawerOpen && <div className="relative">
              <RefButton green icon={RI.edit} label={t("Установить маршрут")} onClick={() => setRouteMenu((open) => !open)} />
              {routeMenu && (
                <>
                  <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-30 cursor-default" onClick={() => setRouteMenu(false)} />
                  <div role="menu" className="absolute right-[4px] top-[27px] z-40 w-[160px] rounded-[3px] bg-white py-[6px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
                    <button type="button" role="menuitem" onClick={() => { setRouteMenu(false); router.push("/clients") }} className="block h-[48px] w-full px-[16px] text-left text-[13px] hover:bg-[#f2f5f8]">{t("Через список")}</button>
                    <button type="button" role="menuitem" onClick={() => { setRouteMenu(false); router.push("/clients/territory?isSelectMarkets=true") }} className="block h-[48px] w-full px-[16px] text-left text-[13px] hover:bg-[#f2f5f8]">{t("Через карту")}</button>
                  </div>
                </>
              )}
            </div>}
            <button
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label={t("Агенты")}
              aria-expanded={drawerOpen}
              className={`flex items-center justify-center bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)] ${drawerOpen ? "fixed right-[330px] top-[62px] z-[61] h-[38px] w-[25px]" : "ml-0 h-[30px] w-[28px]"}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-black"><path d={drawerOpen ? "M9 6v12l8-6z" : "M15 6v12l-8-6z"} /></svg>
            </button>
          </div>
        </RefHeader>
      </div>

      <div className="-mt-px min-h-[calc(100vh-110px)] border-t border-[#e0e0e0] bg-[#f4f4f4] pt-[30px]">
        {notice && <div className="mx-[31px] mb-4 flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3 text-emerald-700"><span>{notice}</span><button onClick={() => setNotice("")}><X className="h-4 w-4" /></button></div>}
        {board.problems.length > 0 && (
          <BoardSection title={t("Проблемные")} count={board.problems.length} tone="problem" drawerOpen={drawerOpen}>
            {board.problems.map((agent) => <RouteCard key={agent.name} name={agent.name} data={agent} problem />)}
          </BoardSection>
        )}
        {board.active.length > 0 && (
          <BoardSection title={t("Вышли")} count={board.active.length} tone="active" drawerOpen={drawerOpen}>
            {board.active.map((agent) => <RouteCard key={agent.name} name={agent.name} data={agent} />)}
          </BoardSection>
        )}
        <BoardSection title={t("Не Вышли")} count={notOut.length} tone="notOut" drawerOpen={drawerOpen}>
          {notOut.map((agent, index) => <RouteCard key={`${agent.name}-${index}`} name={agent.name} />)}
        </BoardSection>
      </div>

      {drawerOpen && (
        <aside className="fixed right-0 top-0 z-[60] h-screen w-[330px] overflow-y-auto bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]">
          <div className="relative mt-5 flex h-10 items-center bg-[#c8c8c8] px-[15px]">
            {AGENT_TABS.map((tab) => (
              <div key={tab.id} className="relative" onMouseEnter={() => setTabTip(tab.id)} onMouseLeave={() => setTabTip((current) => (current === tab.id ? null : current))}>
                <button type="button" onClick={() => setAgentTab(tab.id)} aria-label={t(tab.label)} aria-pressed={agentTab === tab.id} className="relative flex h-10 w-[60px] items-center justify-center">
                  <svg viewBox="0 0 24 24" className={`h-[22px] w-[22px] ${agentTab === tab.id ? "fill-[#666]" : "fill-white"}`}><path d={tab.icon} /></svg>
                  {agentTab === tab.id && <span className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[5px] border-x-transparent border-b-white" />}
                </button>
                {tabTip === tab.id && (
                  <span className="pointer-events-none absolute left-1/2 top-[2px] z-10 -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[4px] text-[13px] font-bold leading-[17px] text-white opacity-90">{t(tab.label)}</span>
                )}
              </div>
            ))}
          </div>
          <div className="relative mx-[30px] mt-[10px] flex h-11 items-center border border-dashed border-[#ddd] px-3">
            <input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder={`${t("Поиск агентов")}...`} className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
            <Search className="h-5 w-5 text-[#555]" />
          </div>
          {drawerAgents.length === 0 ? (
            <div className="mt-[40px] flex flex-col items-center text-center text-[13px] text-[#555]">
              <img src="/robot-empty.png" alt="" className="w-[92px]" />
              <p className="mt-[10px] max-w-[190px]">{t("По вашему запросу ничего не найдено")}</p>
            </div>
          ) : (
            <ul className="mt-[10px] border-t border-[#efefef]">
              {drawerAgents.map((agent, index) => (
                <li key={`${agent.name}-${index}`} className="flex h-[45px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px] text-[13px]">
                  <span className="relative pl-[15px] before:absolute before:left-0 before:top-1/2 before:h-[30px] before:w-[3px] before:-translate-y-1/2 before:bg-[#999]">{agent.name}</span>
                  <span>{progress.get(agent.name)?.visited ?? 0} / {progress.get(agent.name)?.plan ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {isOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">{t("Установить маршрут")}</h2><button onClick={() => setIsOpen(false)}><X /></button></div>
          <label className="mb-2 block text-sm font-semibold">{t("Агент")}</label>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#5271de]">{agents.map((agent, index) => <option key={`${agent.name}-${index}`}>{agent.name}</option>)}</select>
          <label className="mb-2 mt-5 block text-sm font-semibold">{t("Дата маршрута")}</label>
          <input type="date" value={routeDate} onChange={(event) => setRouteDate(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2.5" />
          <div className="mt-6 flex justify-end gap-3"><button onClick={() => setIsOpen(false)} className="rounded-md border px-4 py-2">{t("Отмена")}</button><button onClick={saveRoute} disabled={saving} className="rounded-md bg-[#5271de] px-4 py-2 font-semibold text-white disabled:opacity-60">{saving ? t("Сохранение...") : t("Сохранить")}</button></div>
        </div>
      </div>}
    </main>
  )
}

const SECTION_TONE = {
  problem: { bar: "bg-[#ee667d]", count: "text-[#ee667d]" },
  active: { bar: "bg-[#3ac977]", count: "text-[#3ac977]" },
  notOut: { bar: "bg-[#4f71dc]", count: "text-[#4f71dc]" },
} as const

function BoardSection({ title, count, tone, drawerOpen, children }: { title: string; count: number; tone: keyof typeof SECTION_TONE; drawerOpen: boolean; children: React.ReactNode }) {
  const colors = SECTION_TONE[tone]
  return (
    <section className="mx-[31px] mb-[10px]">
      <div className={`flex h-[46px] items-center justify-between rounded-[3px] px-[10px] text-[15px] font-bold text-white ${colors.bar}`}>
        <span>{title}</span>
        <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white text-[14px] ${colors.count}`}>{count}</span>
      </div>
      <div className={`mt-[10px] grid grid-cols-1 gap-[20px] ${tone === "problem" ? "" : `md:grid-cols-2 ${drawerOpen ? "" : "xl:grid-cols-3"}`}`}>{children}</div>
    </section>
  )
}

function RouteCard({ name, data, problem = false }: { name: string; data?: BoardAgent; problem?: boolean }) {
  const { t } = useLanguage()
  const visited = data?.visited ?? 0
  const plan = data?.plan ?? 0
  const seconds = data?.lastDurationSec ?? 0
  const duration = seconds < 60 ? `${seconds} ${t("сек.")}` : `${Math.floor(seconds / 60)} ${t("мин")} ${seconds % 60} ${t("сек.")}`
  return (
    <article className="overflow-hidden bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
      <div className="relative bg-[#f2f5f8] px-[20px] pb-[20px] pt-[18px]">
        <div className="pr-[60px] text-[15px] font-bold leading-[20px]">{name}</div>
        <p className="mt-[3px] text-[13px] text-[#777]">{t("Первый визит")}: {data ? formatFirstVisit(data.firstVisit) : t("Не активный")}</p>
        {problem ? (
          <span className="absolute right-[20px] top-[20px] flex h-[46px] w-[46px] flex-col items-center justify-center rounded-full bg-[#ff0000] text-center text-[12px] font-bold leading-[13px] text-white">
            <span>{data?.idleMinutes}</span>
            <span>{t("мин")}</span>
          </span>
        ) : (
          <span className={`absolute right-[20px] top-[20px] flex h-[46px] w-[46px] items-center justify-center rounded-full px-[6px] text-center text-[10px] font-bold leading-[11px] text-white ${data ? "bg-[#3ac977]" : "bg-[#4f71dc]"}`}>{data ? t("На маршруте") : t("Не вышел")}</span>
        )}
        <div className="mt-[25px] grid grid-cols-[122px_122px_122px] justify-between gap-[6px]">
          <Metric
            icon={<svg viewBox="-255.4 385.6 24 23.5" className="h-6 w-6 fill-current">{PIN_PATHS.map((d) => <path key={d} d={d} />)}</svg>}
            text={<>{visited}/{plan}{(data?.outside ?? 0) > 0 && <span className="ml-[4px] text-[#ee667d]">+ {data?.outside}</span>}</>}
          />
          <Metric icon={<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d={CART_PATH} /></svg>} text={formatSum(data?.salesSum ?? 0)} />
          <Metric icon={<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d={DOLLAR_PATH} /></svg>} text={formatSum(0)} />
        </div>
      </div>
      <div className="relative min-h-[148px] px-[20px] py-[18px]">
        <span className={`absolute left-[30px] top-[38px] border-l-2 border-[#c8c8c8] h-[44px]`} />
        <div className="relative flex items-start gap-[20px]">
          <span className="relative z-10 h-[20px] w-[20px] shrink-0 rounded-full border-[3px] border-[#70c981] bg-white" />
          {data ? (
            <span className="flex flex-col"><span className="text-[14px] font-semibold leading-[20px]">{data.lastClient}</span><span className="mt-[3px] text-[13px] text-[#777]">{t("Обслуживание заняло")} {duration}</span></span>
          ) : (
            <span className="text-[14px] font-semibold">{t("Не посещал клиента")}</span>
          )}
        </div>
        <div className={`relative flex items-center gap-[20px] ${data ? "mt-[27px]" : "mt-[47px]"}`}><span className="relative z-10 h-[20px] w-[20px] shrink-0 rounded-full border-[3px] border-[#4f71dc] bg-white" /><span className="text-[14px] font-semibold">{t("Нет следующего клиента")}</span></div>
      </div>
    </article>
  )
}

function Metric({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return <div className="flex h-[40px] items-center justify-start gap-[5px] pl-[15px] rounded-[6px] bg-white text-[13px] font-semibold"><span className="text-[#4f71dc]">{icon}</span>{text}</div>
}
