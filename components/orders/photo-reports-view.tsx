"use client"

import { Check, Download, Filter, Minus, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRefRecords } from "@/lib/use-ref-records"

type PhotoStatus = "pending" | "rejected" | "accepted"

export type PhotoReport = {
  id: number
  market: string
  user: string
  createdAt: string
  createdIso: string
  comment: string
  status: PhotoStatus
  groups: string[]
  beforeCount: number
  afterCount: number
}

const TABS = [
  ["Ожидает", "pending"],
  ["Не принят", "rejected"],
  ["Принят", "accepted"],
  ["Все", "all"],
] as const

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const COLUMNS = 6

const pad = (value: number) => String(value).padStart(2, "0")
const dotted = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "")

function currentMonth() {
  const now = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return { begin: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}` }
}

function Pair({ label, t }: { label?: string; t: (key: string) => string }) {
  return (
    <>
      {label ? <div className="pt-[4px] text-center text-[12px] text-[#777]">{label}</div> : null}
      <div className="mt-[8px] flex gap-[11px]">
        {(["до", "после"] as const).map((badge) => (
          <div key={badge} className="relative flex h-[200px] flex-1 items-center justify-center rounded-[6px] border border-[#d9dde3] px-[6px] text-center text-[12px] leading-[14px] text-[#777]">
            <span className="absolute left-[2px] top-[2px] rounded-full bg-[#555] px-[8px] py-[1px] text-[11px] font-semibold text-white">{t(badge)}</span>
            {t("Изображение не найдено")}
          </div>
        ))}
      </div>
    </>
  )
}

function Card({ report, onSet, t }: { report: PhotoReport; onSet: (status: PhotoStatus) => void; t: (key: string) => string }) {
  const pairs = Math.max(1, report.beforeCount, report.afterCount)
  const groups = report.groups
  return (
    <section className="mb-[20px] rounded-[2px] bg-white px-[10px] pb-[14px] pt-[12px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <h3 className="mb-[10px] text-center text-[15px] font-medium text-[#333]">{report.market}</h3>
      <div className="flex items-start gap-[8px]">
        <button type="button" aria-label={t("Принять")} onClick={() => onSet("accepted")} className={`flex h-[32px] w-[32px] items-center justify-center rounded-[4px] ${report.status === "accepted" ? "bg-[#48a34b]" : "bg-[#7d7d7d]"} text-white`}><Check className="h-[18px] w-[18px]" /></button>
        <div className="min-w-0 flex-1 text-center text-[12px] leading-[19px] text-[#777]">
          <div className="text-[14px] text-[#888]">{report.user}</div>
          <div>{report.createdAt}</div>
          {report.comment ? <div className="text-[#222]">{report.comment}</div> : null}
        </div>
        <button type="button" aria-label={t("Отклонить")} onClick={() => onSet("rejected")} className={`flex h-[32px] w-[32px] items-center justify-center rounded-[4px] ${report.status === "rejected" ? "bg-[#e57373]" : "bg-[#7d7d7d]"} text-white`}><Minus className="h-[18px] w-[18px]" /></button>
      </div>
      {Array.from({ length: pairs }).map((_, index) => {
        const above = index === 0 ? groups[0] : undefined
        const below = index < pairs - 1 ? groups[index + 1] : groups.slice(index + 1).join("\n")
        return (
          <div key={index} className="mt-[6px]">
            <Pair label={above} t={t} />
            {below ? <div className="whitespace-pre-line pt-[8px] text-center text-[12px] text-[#777]">{below}</div> : null}
          </div>
        )
      })}
    </section>
  )
}

export function PhotoReportsView() {
  const { t } = useLanguage()
  const { rows, update } = useRefRecords<PhotoReport>("photo")
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("Все")
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [period, setPeriod] = useState(currentMonth)
  const [draft, setDraft] = useState(period)
  const [user, setUser] = useState("")
  const [market, setMarket] = useState("")
  const [draftUser, setDraftUser] = useState("")
  const [draftMarket, setDraftMarket] = useState("")

  const status = TABS.find(([label]) => label === tab)?.[1] ?? "all"
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false
      if (period.begin && row.createdIso < period.begin) return false
      if (period.end && row.createdIso > period.end) return false
      if (user && row.user !== user) return false
      if (market && row.market !== market) return false
      return !term || `${row.market} ${row.user} ${row.comment}`.toLowerCase().includes(term)
    })
  }, [rows, status, period, user, market, query])

  const users = useMemo(() => [...new Set(rows.map((row) => row.user))].sort(), [rows])
  const markets = useMemo(() => [...new Set(rows.map((row) => row.market))].sort(), [rows])
  const columns = useMemo(() => {
    const result: PhotoReport[][] = Array.from({ length: COLUMNS }, () => [])
    visible.forEach((row, index) => result[index % COLUMNS].push(row))
    return result
  }, [visible])
  const activeFilters = 1 + (user ? 1 : 0) + (market ? 1 : 0)

  function exportCsv() {
    const csv = ["Магазин;Создал;Дата;Комментарий;Статус", ...visible.map((row) => [row.market, row.user, row.createdAt, row.comment, row.status].join(";"))].join("\n")
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "fotootchety.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <RefPage>
      <RefHeader title={t("Фотоотчеты")}>
        <button onClick={exportCsv} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Download className="h-4 w-4" />{t("Скачать Excel")}</button>
      </RefHeader>
      <section className="overflow-hidden bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefTabs labels={TABS.map(([label]) => label)} value={tab} onChange={(value) => setTab(value as typeof tab)} />
        <div className="flex h-[50px] items-center gap-5 px-[10px]">
          <button onClick={() => { setDraft(period); setDraftUser(user); setDraftMarket(market); setFilterOpen(true) }} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Filter className="h-4 w-4" />{t("Фильтр")} / {activeFilters}</button>
          <span className="text-[12px] font-bold text-[#4f71dc]">{dotted(period.begin)} - {dotted(period.end)}</span>
          <div className="relative mx-auto w-[260px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-[#d0d0d0] py-1 text-[13px] font-semibold outline-none placeholder:text-black" /><Search className="absolute right-1 top-1 hidden h-4 w-4 text-slate-400" /></div>
          <span className="text-[13px]">{t("Фотоотчеты")}: <b className="text-[16px] font-medium">{visible.length} {t("шт")}</b></span>
        </div>
      </section>
      <div className="mt-[10px] grid gap-[22px]" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
        {columns.map((column, index) => (
          <div key={index}>
            {column.map((report) => (
              <Card key={report.id} report={report} t={t} onSet={(next) => void update(report.id, { status: report.status === next ? "pending" : next })} />
            ))}
          </div>
        ))}
      </div>
      {filterOpen && (
        <div className="fixed inset-0 z-[100] bg-black/20 p-8 pt-20">
          <section className="mx-auto max-w-[1840px] bg-white p-10 shadow-2xl">
            <div className="mb-10 flex justify-between"><h2 className="text-xl font-semibold">{t("Фильтр")}</h2><button onClick={() => setFilterOpen(false)} aria-label={t("Закрыть")}><X className="h-7 w-7 text-slate-500" /></button></div>
            <div className="grid grid-cols-4 gap-x-6 gap-y-10">
              <div className="text-sm">{t("Дата создания")}
                <div className="mt-2 flex items-center gap-2 border-b">
                  <input type="date" value={draft.begin} onChange={(event) => setDraft((current) => ({ ...current, begin: event.target.value }))} className="p-2 text-base outline-none" />
                  <span>-</span>
                  <input type="date" value={draft.end} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} className="p-2 text-base outline-none" />
                </div>
              </div>
              <label className="pt-5 font-semibold">{t("Создал")}<select value={draftUser} onChange={(event) => setDraftUser(event.target.value)} className="mt-2 block w-full border-b bg-white p-2 font-normal outline-none"><option value="">{t("Все")}</option>{users.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="pt-5 font-semibold">{t("Магазин")}<select value={draftMarket} onChange={(event) => setDraftMarket(event.target.value)} className="mt-2 block w-full border-b bg-white p-2 font-normal outline-none"><option value="">{t("Все")}</option>{markets.map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <button onClick={() => { setPeriod(draft); setUser(draftUser); setMarket(draftMarket); setFilterOpen(false) }} className="mt-6 w-full rounded-md bg-[#71ce87] py-3 font-semibold text-white">{t("Применить")}</button>
          </section>
        </div>
      )}
    </RefPage>
  )
}
