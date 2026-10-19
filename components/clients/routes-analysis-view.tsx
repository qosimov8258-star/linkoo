"use client"

import { DollarSign, MapPin, Search, ShoppingCart, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

export function RoutesAnalysisView() {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState("")
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const [agents, setAgents] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [routeMenu, setRouteMenu] = useState(false)
  const router = useRouter()
  const [agentQuery, setAgentQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then(async (response) => (response.ok ? ((await response.json()) as { firstName?: string; lastName?: string; first_name?: string; last_name?: string }[]) : []))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return
        setAgents(data.map((row) => [row.firstName ?? row.first_name, row.lastName ?? row.last_name].filter(Boolean).join(" ")).filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function saveRoute() {
    if (!selected) {
      window.alert(t("Выберите агента"))
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
        window.alert(data.error || t("Не удалось сохранить маршрут"))
        return
      }
      setNotice(`${t("Маршрут для")} «${selected}» ${t("установлен")}`)
      setIsOpen(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={`min-h-[calc(100vh-50px)] bg-[#f2f5f8] pb-10 pt-px text-[#333] transition-[padding] duration-200 ${drawerOpen ? "pr-[330px]" : ""}`}>
      <div className="pl-[30px] pr-[8px]">
        <RefHeader title={t("Анализ маршрутов")}>
          <div className="flex items-center gap-0">
            <div className="relative">
              <RefButton green icon={RI.edit} label={t("Установить маршрут")} onClick={() => setRouteMenu((open) => !open)} />
              {routeMenu && (
                <>
                  <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-30 cursor-default" onClick={() => setRouteMenu(false)} />
                  <div role="menu" className="absolute right-0 top-[30px] z-40 w-[168px] bg-white py-[6px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
                    <button type="button" role="menuitem" onClick={() => { setRouteMenu(false); router.push("/clients") }} className="block h-[48px] w-full px-[20px] text-left text-[13px] hover:bg-[#f2f5f8]">{t("Через список")}</button>
                    <button type="button" role="menuitem" onClick={() => { setRouteMenu(false); router.push("/clients/territory?isSelectMarkets=true") }} className="block h-[48px] w-full px-[20px] text-left text-[13px] hover:bg-[#f2f5f8]">{t("Через карту")}</button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label={t("Агенты")}
              aria-expanded={drawerOpen}
              className="ml-0 flex h-[30px] w-[28px] items-center justify-center bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-black"><path d={drawerOpen ? "M9 6v12l8-6z" : "M15 6v12l-8-6z"} /></svg>
            </button>
          </div>
        </RefHeader>
      </div>

      <div className="min-h-[calc(100vh-110px)] border-t border-[#e1e5eb] bg-[#f4f4f4] pt-[30px]">
        {notice && <div className="mx-[31px] mb-4 flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3 text-emerald-700"><span>{notice}</span><button onClick={() => setNotice("")}><X className="h-4 w-4" /></button></div>}
        <section className="mx-[31px]">
          <div className="flex h-[46px] items-center justify-between rounded-[3px] bg-[#4f71dc] px-[10px] text-[15px] font-bold text-white"><span>{t("Не Вышли")}</span><span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white text-[13px] text-[#4f71dc]">{agents.length}</span></div>
          <div className={`mt-[10px] grid grid-cols-1 gap-[20px] md:grid-cols-2 ${drawerOpen ? "" : "xl:grid-cols-3"}`}>
            {agents.map((agent, index) => <RouteCard key={`${agent}-${index}`} name={agent} />)}
          </div>
        </section>
      </div>

      {drawerOpen && (
        <aside className="fixed right-0 top-0 z-[60] h-screen w-[330px] overflow-y-auto bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]">
          <div className="mt-5 flex h-10 items-center justify-around bg-[#c8c8c8]">
            {[
              "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
              "M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z",
              "M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z",
              "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
              "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
            ].map((path, index) => (
              <span key={index} className={`flex h-10 w-1/5 items-center justify-center ${index === 0 ? "bg-[#e8e8e8]" : ""}`}>
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={path} /></svg>
              </span>
            ))}
          </div>
          <div className="relative mx-[30px] mt-[10px] flex h-11 items-center border border-dashed border-[#ddd] px-3">
            <input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder={`${t("Поиск агентов")}...`} className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
            <Search className="h-5 w-5 text-[#555]" />
          </div>
          <ul className="mt-[10px] border-t border-[#efefef]">
            {agents.filter((agent) => agent.toLowerCase().includes(agentQuery.toLowerCase())).map((agent, index) => (
              <li key={`${agent}-${index}`} className="flex h-[45px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px] text-[13px]">
                <span className="relative pl-[15px] before:absolute before:left-0 before:top-1/2 before:h-[30px] before:w-[2px] before:-translate-y-1/2 before:bg-[#555]">{agent}</span>
                <span>0 / 0</span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {isOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">{t("Установить маршрут")}</h2><button onClick={() => setIsOpen(false)}><X /></button></div>
          <label className="mb-2 block text-sm font-semibold">{t("Агент")}</label>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#5271de]">{agents.map((agent, index) => <option key={`${agent}-${index}`}>{agent}</option>)}</select>
          <label className="mb-2 mt-5 block text-sm font-semibold">{t("Дата маршрута")}</label>
          <input type="date" value={routeDate} onChange={(event) => setRouteDate(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2.5" />
          <div className="mt-6 flex justify-end gap-3"><button onClick={() => setIsOpen(false)} className="rounded-md border px-4 py-2">{t("Отмена")}</button><button onClick={saveRoute} disabled={saving} className="rounded-md bg-[#5271de] px-4 py-2 font-semibold text-white disabled:opacity-60">{saving ? t("Сохранение...") : t("Сохранить")}</button></div>
        </div>
      </div>}
    </main>
  )
}

function RouteCard({ name }: { name: string }) {
  const { t } = useLanguage()
  return (
    <article className="overflow-hidden bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
      <div className="relative bg-[#f1f4f8] px-[20px] pb-[20px] pt-[18px]">
        <div className="pr-[60px] text-[15px] font-bold leading-[20px]">{name}</div>
        <p className="mt-[3px] text-[13px] text-[#777]">{t("Первый визит")}: {t("Не активный")}</p>
        <span className="absolute right-[20px] top-[20px] flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[#4f71dc] px-[6px] text-center text-[10px] font-bold leading-[11px] text-white">{t("Не вышел")}</span>
        <div className="mt-[25px] grid grid-cols-[122px_122px_122px] justify-between gap-[6px]">
          <Metric icon={<MapPin className="h-6 w-6" strokeWidth={1.5} />} text="0/0" />
          <Metric icon={<ShoppingCart className="h-6 w-6" strokeWidth={1.5} />} text="0 SUM" />
          <Metric icon={<DollarSign className="h-6 w-6" strokeWidth={1.5} />} text="0 SUM" />
        </div>
      </div>
      <div className="relative min-h-[148px] px-[20px] py-[18px]">
        <span className="absolute left-[30px] top-[38px] h-[44px] border-l-2 border-[#c8c8c8]" />
        <div className="relative flex items-center gap-[20px]"><span className="relative z-10 h-[20px] w-[20px] rounded-full border-[3px] border-[#70c981] bg-white" /><span className="text-[14px] font-semibold">{t("Не посещал клиента")}</span></div>
        <div className="relative mt-[47px] flex items-center gap-[20px]"><span className="relative z-10 h-[20px] w-[20px] rounded-full border-[3px] border-[#4f71dc] bg-white" /><span className="text-[14px] font-semibold">{t("Нет следующего клиента")}</span></div>
      </div>
    </article>
  )
}

function Metric({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex h-[38px] items-center justify-center gap-[8px] rounded-[4px] bg-white text-[13px] font-semibold"><span className="text-[#4f71dc]">{icon}</span>{text}</div>
}
