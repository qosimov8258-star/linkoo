"use client"

import { DollarSign, MapPin, Pencil, ShoppingCart, Star, X } from "lucide-react"
import { useState } from "react"

const agents = [
  "05,08,2025 (1)", "xodim1 1", "Zaynillo Sadullayev", "Salohiddin Agent Tashkent", "Islom Toirjonov", "MayKI Jekson",
  "Аббос Доставщик", "Admin Ritm", "Bexruz Abdulazizov", "Samandar Abdurahmonov", "doston zavsklad Zavzalov", "beyn kim",
  "agent2 2", "agent 007", "Анвар Комилов", "krugagentbek agentov", "старший агент склада Apple", "ali aliyev",
  "bobur axmadov", "Bahodir Axmedov", "Азизхон Супервайзер", "Aziz Karimov", "Temurbek Sharipov", "ismoil boboyorov",
  "universal dostavshik", "Bahriddun tolaganov", "deliver man", "Dilmurod Madjidov", "доставщик доставщик",
]

export function RoutesAnalysisView() {
  const [isOpen, setIsOpen] = useState(false)
  const [selected, setSelected] = useState("Admin Ritm")
  const [notice, setNotice] = useState("")

  function saveRoute() {
    setNotice(`Маршрут для «${selected}» установлен`)
    setIsOpen(false)
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-10 text-slate-800">
      <div className="flex min-h-[74px] items-center justify-between border-b border-slate-200 bg-slate-50 px-10">
        <h1 className="flex items-center gap-3 text-[27px] font-bold text-slate-600"><Star className="h-7 w-7 fill-slate-500 text-slate-500" /> <span className="text-[#5171e3]">Избранные</span><span className="font-normal text-slate-500">|</span> Анализ маршрутов</h1>
        <button onClick={() => setIsOpen(true)} className="flex items-center gap-2 rounded-md bg-[#70cf84] px-5 py-2.5 text-lg font-semibold text-white shadow hover:bg-[#60be74]"><Pencil className="h-5 w-5" />Установить маршрут</button>
      </div>

      {notice && <div className="mx-10 mt-4 flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3 text-emerald-700"><span>{notice}</span><button onClick={() => setNotice("")}><X className="h-4 w-4" /></button></div>}

      <section className="mx-10 mt-9">
        <div className="flex h-[59px] items-center justify-between rounded-md bg-[#5271de] px-3 text-[21px] font-bold text-white shadow"><span>Не Вышли</span><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#5271de]">83</span></div>
        <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => <RouteCard key={agent} name={agent} />)}
        </div>
      </section>

      {isOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">Установить маршрут</h2><button onClick={() => setIsOpen(false)}><X /></button></div>
          <label className="mb-2 block text-sm font-semibold">Агент</label>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#5271de]">{agents.map((agent) => <option key={agent}>{agent}</option>)}</select>
          <label className="mb-2 mt-5 block text-sm font-semibold">Дата маршрута</label>
          <input type="date" defaultValue="2026-08-05" className="w-full rounded-md border border-slate-300 px-3 py-2.5" />
          <div className="mt-6 flex justify-end gap-3"><button onClick={() => setIsOpen(false)} className="rounded-md border px-4 py-2">Отмена</button><button onClick={saveRoute} className="rounded-md bg-[#5271de] px-4 py-2 font-semibold text-white">Сохранить</button></div>
        </div>
      </div>}
    </main>
  )
}

function RouteCard({ name }: { name: string }) {
  const isAdmin = name === "Admin Ritm"
  return <article className="overflow-hidden bg-white shadow-md">
    <div className="relative bg-slate-100 px-6 pb-6 pt-6">
      <div className="pr-20 text-[20px] font-bold leading-tight">{name}</div>
      <p className="mt-1 text-[17px] text-slate-400">Первый визит: Не активный</p>
      <span className="absolute right-6 top-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#5271de] text-center text-xs font-bold text-white">Не<br />вышел</span>
      <div className="mt-8 grid grid-cols-3 gap-7">
        <Metric icon={<MapPin />} text={isAdmin ? "0/6" : "0/0"} />
        <Metric icon={<ShoppingCart />} text="0 SUM" />
        <Metric icon={<DollarSign />} text="0 SUM" />
      </div>
    </div>
    <div className="min-h-[184px] px-7 py-6">
      <div className="relative flex gap-6 pb-12"><span className="relative z-10 h-6 w-6 rounded-full border-[3px] border-[#70c981] bg-white" /><span className="text-[18px]">Не посещал клиента</span><span className="absolute left-[11px] top-6 h-12 border-l-2 border-slate-300" /></div>
      <div className="relative flex gap-6"><span className="h-6 w-6 rounded-full border-[3px] border-[#5271de] bg-white" /><div><span className="text-[18px]">{isAdmin ? "Markus Vitinha" : "Нет следующего клиента"}</span>{isAdmin && <p className="text-sm text-slate-400">Следует посетить 5 Август 2026 года</p>}</div>{isAdmin && <span className="ml-auto rounded-full bg-[#6574df] px-4 py-1 text-sm font-semibold text-white">3.5 км.</span>}</div>
    </div>
  </article>
}

function Metric({ icon, text }: { icon: React.ReactNode, text: string }) {
  return <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 text-[17px] font-medium"><span className="text-[#5271de]">{icon}</span>{text}</div>
}
