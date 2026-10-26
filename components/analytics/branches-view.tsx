"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useState } from "react"

import { RefButton } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { CheckBox, ConfirmDelete, EmptyState, ErrorAlert, LineField, LineSelect, ListToolbar, Modal, SaveLink, grayHead, listRow } from "./catalog-ui"

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
const PIN_ICON = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zM7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 2.88-2.88 7.19-5 9.88C9.88 16.19 7 11.88 7 9zm2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0z"
const GRID = "grid-cols-[109px_507px_202px_203px_1fr]"

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
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setAlertMessage(t(data.error || "Не удалось удалить филиал"))
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

  const flag = (on: boolean, yes: string, no: string) => <b className={on ? "text-[#6ccd8b]" : "text-[#f07e7e]"}>{on ? yes : no}</b>

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        slim
        addLabel={t("Добавить филиал")}
        onAdd={() => openForm()}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        addPad={6}
        searchPos={{ left: 335, top: 9 }}
        pageSize={pageSize}
        onPageSize={(size) => { setPageSize(size); setPage(1) }}
        from={start + 1}
        to={Math.min(start + pageSize, filtered.length)}
        total={filtered.length}
        onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
        onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
      />
      <div className={`${grayHead} ${GRID}`}>
        <span>№</span><span>{t("Наименование")}</span><span>{t("Дата")}</span><span>{t("Учет долга")}</span><span>{t("Основной филиал")}</span>
      </div>
      {visible.map((branch, index) =>
        openId === branch.id ? (
          <div key={branch.id} className="my-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.22)]">
            <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[15px] pr-[20px]">
              <h3 onClick={() => setOpenId(null)} className="cursor-pointer text-[18px] font-normal">{branch.name}</h3>
              <div className="flex items-center gap-[12px]">
                <RefButton icon={PLAN_ICON} label={t("Добавить план")} onClick={() => { setPlanDraft({ weight: "", amount: "", price: "" }); setPlanOpen(true) }} />
                <button type="button" onClick={() => openForm(branch)} aria-label={t("Изменить")} className="text-[#555] hover:text-black"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
                <button type="button" onClick={() => setDeleting(branch)} aria-label={t("Удалить")} className="text-[#555] hover:text-black"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
              </div>
            </div>
            <div className="flex min-h-[166px]">
              <dl className="w-[441px] shrink-0 border-r border-[#efefef] pl-[15px] pr-[30px] py-[20px] leading-[25px]">
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
          <div key={branch.id} onClick={() => setOpenId(branch.id)} className={`${listRow} ${GRID} cursor-pointer`}>
            <span>{start + index + 1}</span>
            <span>{branch.name}</span>
            <span>{branch.date}</span>
            <span className={branch.debtTracking ? "text-[#6ccd8b]" : "text-[#f07e7e]"}>{branch.debtTracking ? t("Включен") : t("Отключен")}</span>
            <span className={branch.isMain ? "text-[#6ccd8b]" : "text-[#f07e7e]"}>{branch.isMain ? t("Да") : t("Нет")}</span>
          </div>
        ),
      )}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить филиал") : t("Добавить филиал")}
          onClose={() => setEditing(null)}
          width={450}
          bodyClassName="px-[30px] pt-[43px] pb-[34px]"
          footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="space-y-[26px]">
            <LineField label={t("Название филиала")} required value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
            <LineSelect label={t("Прайс лист")} value={draft.priceList} options={priceLists} onChange={(priceList) => setDraft({ ...draft, priceList })} onClear={editing.id ? () => setDraft({ ...draft, priceList: "" }) : undefined} />
            <LineSelect label={t("Валюта")} value={draft.currency} options={currencies} onChange={(currency) => setDraft({ ...draft, currency })} onClear={editing.id ? () => setDraft({ ...draft, currency: "" }) : undefined} />
          </div>
          <div className="mt-[20px] space-y-[22px]">
            <CheckBox checked={draft.debtTracking} onChange={(debtTracking) => setDraft({ ...draft, debtTracking })} label={t("Учет долга")} />
            <CheckBox checked={draft.isMain} onChange={(isMain) => setDraft({ ...draft, isMain })} label={t("Основной филиал")} />
          </div>
          <div className="mt-[20px] flex items-center justify-between text-[13px]">
            <button type="button" onClick={() => setMapOpen(true)} className="flex items-center gap-[4px] text-[#129fdd] hover:underline">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#9aa3b5]"><path d={PIN_ICON} /></svg>
              {editing.id ? (draft.lat !== null && draft.lng !== null ? <span className="text-[#333] no-underline">{draft.lat} {draft.lng}</span> : null) : t("отметить местоположение на карте")}
            </button>
            {editing.id ? <button type="button" onClick={() => setMapOpen(true)} className="mr-[-6px] text-[#129fdd] hover:underline">{t("Изменить")}</button> : null}
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
