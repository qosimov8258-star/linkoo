"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { RefButton } from "@/components/ref/list-kit"
import { Check as StaffCheck } from "@/components/staff/staff-kit"
import { PageSizeSelect, PagerArrow } from "@/components/analytics/settings-list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { ConfirmDelete, EmptyState, ErrorAlert, LineField, Modal, SaveLink, grayHead } from "./catalog-ui"

const LocationPicker = dynamic(() => import("@/components/clients/location-picker").then((module) => module.LocationPicker), { ssr: false })

type Branch = {
  id: number
  name: string
  date: string
  debtTracking: boolean
  isMain: boolean
  priceList: string
  currency: string
  locationLat: number | null
  locationLng: number | null
}

type BranchPlan = { id: number; weight: string; amount: string; price: string }

type Draft = { name: string; priceList: string; currency: string; debtTracking: boolean; isMain: boolean; lat: number | null; lng: number | null }

const emptyDraft: Draft = { name: "", priceList: "", currency: "", debtTracking: false, isMain: false, lat: null, lng: null }

const PLAN_ICON = "M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z"
const ROW = "group relative grid min-h-[50px] items-center pl-[30px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8]"
const GRID = "grid-cols-[109.3px_506.2px_202.5px_202.5px_1fr]"

const BRANCH_PIN_PATHS = [
  "M-243.3,395.8c1.5,0,2.7-1.2,2.7-2.7c0-1.5-1.2-2.7-2.7-2.7c-1.5,0-2.7,1.2-2.7,2.7C-246,394.6-244.8,395.8-243.3,395.8z M-243.3,391.1c1.1,0,2,0.9,2,2c0,1.1-0.9,2-2,2s-2-0.9-2-2C-245.2,392-244.4,391.1-243.3,391.1z",
  "M-235.7,400.2h-2.8l1.2-1.7c2.3-3,1.9-8-0.7-10.6c-1.4-1.4-3.3-2.2-5.3-2.2c-2,0-3.9,0.8-5.3,2.2c-2.6,2.6-3,7.6-0.7,10.6 l1.2,1.7h-2.9l-4.3,9h24L-235.7,400.2z M-248.7,398c-2-2.7-1.7-7.2,0.6-9.6c1.3-1.3,3-2,4.8-2s3.5,0.7,4.8,2 c2.4,2.4,2.7,6.8,0.6,9.6l-5.4,7.8l-3.9-5.6l0,0L-248.7,398z M-250.6,400.9h3l4.3,6.2l4.3-6.2h2.9l3.6,7.5h-21.5L-250.6,400.9z",
]

/** The branch dialog's underlined text field (reference metrics: scaled 13px caption, #e0e0e0 line). */
function BranchLine({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative h-[40px] border-b border-[#e0e0e0]">
      <span className={`pointer-events-none absolute left-0 origin-top-left font-semibold transition-all ${floating ? "-top-[6px] scale-75 text-[13px] leading-[18px]" : "top-[16.5px] text-[13px] leading-4"}`}>
        {label}{required && <span className="text-[#e57373]"> *</span>}
      </span>
      <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-px h-[26px] bg-transparent text-[13px] font-semibold outline-none" />
    </div>
  )
}

/** The branch dialog's select: caption / value / "×" / caret of the reference. */
function BranchPick({ label, value, options, onChange, clearable }: { label: string; value: string; options: string[]; onChange: (value: string) => void; clearable?: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="relative block h-[40px] w-full border-b border-[#e8e8e8] text-left">
        {value ? (
          <>
            <span className="absolute -top-[10.2px] left-0 origin-top-left scale-75 text-[13px] font-semibold leading-[18px] text-black">{label}</span>
            <span className="absolute inset-x-0 bottom-[4.5px] truncate pr-12 text-[13px] font-semibold leading-[18px] text-[#333]">{value}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[15.5px] text-[13px] font-semibold leading-4">{label}</span>
        )}
        <svg viewBox="0 0 10 5" className={`pointer-events-none absolute right-[10px] top-[27px] h-[5px] w-[10px] fill-[#999] ${open ? "rotate-180" : ""}`}><path d="M0 0l5 5 5-5z" /></svg>
      </button>
      {value && clearable && (
        <button type="button" aria-label="clear" onClick={() => onChange("")} className="absolute right-[28.4px] top-[14.4px] h-6 text-[18px] font-normal leading-6 text-[#999]">×</button>
      )}
      {open && (
        <ul className="absolute left-0 right-0 top-[40px] z-20 max-h-[240px] overflow-y-auto bg-white py-0 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.map((option, index) => (
            <li key={option}>
              <button type="button" onClick={() => { onChange(option); setOpen(false) }} className={`block h-[32px] w-full px-[10px] text-left text-[13px] font-semibold ${option === value || (!value && index === 0) ? "bg-[#e3effd] text-[#333]" : "text-[#666] hover:bg-[#f2f5f8]"}`}>{option}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function BranchesView() {
  const { t } = useLanguage()
  const [branches, setBranches] = useState<Branch[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [openId, setOpenId] = useState<number | null>(null)
  const [plans, setPlans] = useState<BranchPlan[]>([])
  const [editing, setEditing] = useState<Branch | { id: 0 } | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [mapOpen, setMapOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [planDraft, setPlanDraft] = useState({ weight: "", amount: "", price: "" })
  const [deleting, setDeleting] = useState<Branch | null>(null)
  const [alertMessage, setAlertMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [priceLists, setPriceLists] = useState<string[]>([])
  const [currencies, setCurrencies] = useState<string[]>([])

  const load = useCallback(() => {
    fetch("/api/branches")
      .then((response) => (response.ok ? (response.json() as Promise<Branch[]>) : []))
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    fetch("/api/price-lists")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string; isActive?: boolean }[]>) : []))
      .then((data) => setPriceLists(data.filter((item) => item.isActive !== false).map((item) => item.name).filter(Boolean)))
      .catch(() => undefined)
    fetch("/api/currencies")
      .then((response) => (response.ok ? (response.json() as Promise<{ code: string }[]>) : []))
      .then((data) => setCurrencies(data.map((item) => item.code).filter(Boolean)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (openId === null) return
    fetch(`/api/branches/${openId}/plans`)
      .then((response) => (response.ok ? (response.json() as Promise<BranchPlan[]>) : []))
      .then(setPlans)
      .catch(() => setPlans([]))
  }, [openId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? branches.filter((branch) => branch.name.toLowerCase().includes(needle)) : branches
  }, [branches, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)

  function openForm(branch?: Branch) {
    setEditing(branch ?? { id: 0 })
    setDraft(
      branch
        ? { name: branch.name, priceList: branch.priceList, currency: branch.currency, debtTracking: branch.debtTracking, isMain: branch.isMain, lat: branch.locationLat, lng: branch.locationLng }
        : emptyDraft,
    )
  }

  async function save() {
    if (!editing || saving) return
    if (!draft.name.trim()) {
      setAlertMessage(`name: ${t("Это поле обязательно к заполнению")}`)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(editing.id ? `/api/branches/${editing.id}` : "/api/branches", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          priceList: draft.priceList,
          currency: draft.currency,
          debtTracking: draft.debtTracking,
          isMain: draft.isMain,
          locationLat: draft.lat,
          locationLng: draft.lng,
        }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setAlertMessage(t(data.error || "Не удалось сохранить филиал"))
        return
      }
      const saved = (await response.json()) as Branch
      setEditing(null)
      load()
      if (editing.id) setOpenId(saved.id)
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!deleting) return
    try {
      const response = await fetch(`/api/branches/${deleting.id}`, { method: "DELETE" })
      if (!response.ok) {
        // 409 while other records use it: the usage list says where.
        const data = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
        const usage = data.usage?.map((item) => `${item.label}: ${item.count}`).join(", ")
        setAlertMessage(`${t(data.error || "Не удалось удалить филиал")}${usage ? ` (${usage})` : ""}`)
        return
      }
      setDeleting(null)
      setOpenId(null)
      load()
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function savePlan() {
    if (openId === null) return
    try {
      const response = await fetch(`/api/branches/${openId}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(planDraft),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setAlertMessage(t(data.error || "Не удалось сохранить план"))
        return
      }
      const saved = (await response.json()) as BranchPlan
      setPlans((list) => [...list, saved])
      setPlanOpen(false)
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const flag = (on: boolean, yes: string, no: string) => <b className={on ? "text-[#8acb8d]" : "text-[#e57373]"}>{on ? yes : no}</b>

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <div className="relative flex h-[50px] items-center pr-[5px] text-[13px]">
        <button type="button" onClick={() => openForm()} className="absolute left-[5px] top-[7px] flex h-[36px] items-center rounded-[5px] bg-white pl-[12px] pr-[16px] leading-[36px] text-[#4f71dc]">
          <svg viewBox="0 0 24 24" className="relative top-[1.5px] mr-[2px] h-[14px] w-[14px] shrink-0 fill-[#4f71dc]"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          <span className="relative top-[1.5px]">{t("Добавить филиал")}</span>
        </button>
        <label className="group/search absolute left-[335px] top-0 block h-[48px] w-[294.3px]">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="relative h-full w-full bg-transparent pr-[34px] text-[13px] leading-[24px] outline-none placeholder:text-black/30" />
          <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-px bg-[#e0e0e0]" />
          <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-transform duration-[450ms] group-focus-within/search:scale-x-100" />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[268.2px] top-[12px] h-[24px] w-[24px] fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </label>
        <div className="ml-auto flex items-center">
          <PageSizeSelect numberClassName="text-[#333]" value={pageSize} onChange={(size) => { setPageSize(size); setPage(1) }} />
          <span className="ml-[27px] mr-[10px] leading-[16.25px] text-[#5d6474]">{filtered.length ? start + 1 : 1} - {Math.min(start + pageSize, filtered.length)} {t("из")} {filtered.length}</span>
          <span className="flex gap-[5px]">
            <PagerArrow dir="prev" onClick={safePage > 1 ? () => setPage(safePage - 1) : undefined} />
            <PagerArrow dir="next" onClick={safePage < pageCount ? () => setPage(safePage + 1) : undefined} />
          </span>
        </div>
      </div>
      <div className={`${grayHead} ${GRID} leading-[16.25px]`}>
        <span>№</span><span>{t("Наименование")}</span><span>{t("Дата")}</span><span>{t("Учет долга")}</span><span>{t("Основной филиал")}</span>
      </div>
      {visible.map((branch, index) =>
        openId === branch.id ? (
          <div key={branch.id} className="my-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.22)]">
            <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[15px] pr-[20px]">
              <h3 onClick={() => setOpenId(null)} className="cursor-pointer text-[18px] font-normal">{branch.name}</h3>
              <div className="flex items-center">
                <span className="mr-[13px] flex"><RefButton icon={PLAN_ICON} label={t("Добавить план")} onClick={() => { setPlanDraft({ weight: "", amount: "", price: "" }); setPlanOpen(true) }} /></span>
                <button type="button" onClick={() => openForm(branch)} aria-label={t("Изменить")} className="mr-[10px] text-[#555] hover:text-black"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
                <button type="button" onClick={() => setDeleting(branch)} aria-label={t("Удалить")} className="text-[#555] hover:text-black"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
              </div>
            </div>
            <div className="flex min-h-[166px]">
              <dl className="w-[442px] shrink-0 border-r border-[#efefef] pl-[15px] pr-[30px] py-[20px] leading-[25px]">
                {[
                  [t("Дата создания:"), <b key="d">{branch.date}</b>],
                  ...(branch.priceList ? [[t("Прайс лист:"), <b key="p">{branch.priceList}</b>]] : []),
                  ...(branch.currency ? [[t("Валюта:"), <b key="c">{branch.currency}</b>]] : []),
                  [t("Основной филиал:"), flag(branch.isMain, t("Включено"), t("Выключено"))],
                  [t("Учет долга:"), flag(branch.debtTracking, t("Включено"), t("Выключено"))],
                ].map(([label, value], row) => (
                  <div key={row} className="flex justify-between"><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              <div className="min-w-0 flex-1 px-[15px] py-[15px]">
                {plans.map((plan) => (
                  <div key={plan.id} className="flex gap-[40px] leading-[25px]">
                    <span>{t("Вес")}: <b>{plan.weight}</b></span><span>{t("Количество")}: <b>{plan.amount}</b></span><span>{t("Цена")}: <b>{plan.price}</b></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div key={branch.id} onClick={() => setOpenId(branch.id)} className={`${ROW} ${GRID} cursor-pointer leading-[16.25px]`}>
            <span>{start + index + 1}</span>
            <span>{branch.name}</span>
            <span>{branch.date}</span>
            <span className={branch.debtTracking ? "text-[#8acb8d]" : "text-[#e57373]"}>{branch.debtTracking ? t("Включен") : t("Отключен")}</span>
            <span className={branch.isMain ? "text-[#8acb8d]" : "text-[#e57373]"}>{branch.isMain ? t("Да") : t("Нет")}</span>
          </div>
        ),
      )}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить Филиал") : t("Добавить филиал")}
          onClose={() => setEditing(null)}
          width={450}
          bodyClassName="px-[30px] pt-[43.8px] pb-[35.8px]"
          footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="space-y-[27px]">
            <BranchLine label={t("Название филиала")} required value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
            <BranchPick clearable={Boolean(editing.id)} label={t("Прайс лист")} value={draft.priceList} options={priceLists} onChange={(priceList) => setDraft({ ...draft, priceList })} />
            <BranchPick clearable={Boolean(editing.id)} label={t("Валюта")} value={draft.currency} options={currencies} onChange={(currency) => setDraft({ ...draft, currency })} />
          </div>
          <div className="mt-[17.5px] space-y-[20px]">
            <StaffCheck className="leading-[20px] text-black" checked={draft.debtTracking} onChange={(debtTracking) => setDraft({ ...draft, debtTracking })} label={t("Учет долга")} />
            <StaffCheck className="leading-[20px] text-black" checked={draft.isMain} onChange={(isMain) => setDraft({ ...draft, isMain })} label={t("Основной филиал")} />
          </div>
          <div className="relative mt-[15px] flex h-[24px] items-center text-[13px]">
            <button type="button" onClick={() => setMapOpen(true)} className="flex items-center text-[#129fdd]">
              <svg viewBox="-255.4 385.6 24 23.5" className="h-6 w-4 shrink-0 fill-[#999]">{BRANCH_PIN_PATHS.map((d) => <path key={d} d={d} />)}</svg>
              {editing.id ? (
                <span className="ml-[5px] flex gap-[5px] text-[12px] text-[#333]"><span>{draft.lat ?? 0}</span><span>{draft.lng ?? 0}</span></span>
              ) : (
                <span className="relative top-[0.7px] ml-[5px]">{t("отметить местоположение на карте")}</span>
              )}
            </button>
            {editing.id ? <button type="button" onClick={() => setMapOpen(true)} className="absolute -right-[24.3px] top-[3px] text-[#129fdd] hover:underline">{t("Изменить")}</button> : null}
          </div>
        </Modal>
      )}

      {mapOpen && (
        <LocationPicker
          initialLat={draft.lat ?? undefined}
          initialLng={draft.lng ?? undefined}
          onCancel={() => setMapOpen(false)}
          onConfirm={(lat, lng) => { setDraft((current) => ({ ...current, lat, lng })); setMapOpen(false) }}
        />
      )}

      {planOpen && (
        <Modal title={t("Добавить план")} onClose={() => setPlanOpen(false)} width={450} bodyClassName="min-h-[300px] px-[30px] pt-[43px]" footer={<SaveLink onClick={() => void savePlan()}>{t("Сохранить")}</SaveLink>}>
          <div className="space-y-[32px]">
            <LineField label={t("Вес")} value={planDraft.weight} onChange={(weight) => setPlanDraft({ ...planDraft, weight })} />
            <LineField label={t("Количество")} value={planDraft.amount} onChange={(amount) => setPlanDraft({ ...planDraft, amount })} />
            <LineField label={t("Цена")} value={planDraft.price} onChange={(price) => setPlanDraft({ ...planDraft, price })} />
          </div>
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />}
      {alertMessage && <ErrorAlert message={alertMessage} onClose={() => setAlertMessage("")} />}
    </div>
  )
}
