"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useCanManage } from "@/components/analytics/cash-management-shared"
import { ExcelImportLink, ExcelRowImportDialog, type ExcelImportSpec } from "@/components/analytics/excel-row-import"
import { queryInt, useLinkoUrlState } from "@/components/orders/linko-url-state"
import { RefButton } from "@/components/ref/list-kit"
import { Check as StaffCheck } from "@/components/staff/staff-kit"
import { PageSizeSelect, PagerArrow, ROW_ICONS, RowIcon } from "@/components/analytics/settings-list-kit"
import { importKey, parseYesNo, postJson, repeatedInFile, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { compareCurrencyCodes, formatMoney, normCurrency } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
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

/** A branch plan as /api/branches/[id]/plans returns it: numbers, null = not set. */
type BranchPlan = { id: number; weight: number | null; amount: number | null; price: number | null }

/** A plan figure: weight / quantity with up to 3 decimals, the price as money (2 decimals); "" when not set. */
const planValue = (value: number | null, digits: number) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "" : formatMoney(Number(value), digits))

type Draft = { name: string; priceList: string; currency: string; debtTracking: boolean; isMain: boolean; lat: number | null; lng: number | null }

/** One row of "Импорт с Excel" (ours, not in the demo): created like the dialog does, never as the main branch. */
type BranchImport = { name: string; priceList: string; currency: string; debtTracking: boolean; isMain: false }

async function listJson<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("load")
  const body = (await response.json()) as unknown
  return Array.isArray(body) ? (body as T[]) : []
}

const emptyDraft: Draft = { name: "", priceList: "", currency: "", debtTracking: false, isMain: false, lat: null, lng: null }

const PLAN_ICON = "M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z"
const ROW = "group relative grid min-h-[50px] items-center after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8]"
// Linko's row: 30px side padding and a 12-column grid of 1 / 5 / 2 / 2 / 2; every column but № indents its text by 8px.
const GRID = "grid-cols-[minmax(0,1fr)_minmax(0,5fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)] px-[30px] [&>span:not(:first-child)]:pl-[8px]"
/** The opened branch (Linko #/branch/7 → /analytics/branches/7); the list state and the dialogs are query parameters. */
const BASE = "/analytics/branches"

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
  const { t } = useLanguage()
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
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("")} className="absolute right-[28.4px] top-[14.4px] h-6 text-[18px] font-normal leading-6 text-[#999]">×</button>
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

const draftOf = (branch: Branch): Draft => ({ name: branch.name, priceList: branch.priceList, currency: branch.currency, debtTracking: branch.debtTracking, isMain: branch.isMain, lat: branch.locationLat, lng: branch.locationLng })

export function BranchesView({ initialId = null }: { initialId?: number | null }) {
  const { t, language } = useLanguage()
  // Linko keeps the list (page, pageSize, search), the opened branch and every dialog in its address; a closed dialog
  // stays as "=false" there.
  const { state: url, update: updateUrl } = useLinkoUrlState(BASE, { id: initialId ? String(initialId) : null, query: {} })
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [plans, setPlans] = useState<BranchPlan[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [mapOpen, setMapOpen] = useState(false)
  const [planDraft, setPlanDraft] = useState({ weight: "", amount: "", price: "" })
  const [alertMessage, setAlertMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [priceLists, setPriceLists] = useState<string[]>([])
  const [currencies, setCurrencies] = useState<string[]>([])
  /** The base currency (Валюты): a branch without its own currency works in it (plan prices). */
  const [baseCurrency, setBaseCurrency] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const canImport = useCanManage(["settings.manage"])

  const query = url.query.search ?? ""
  const pageSize = queryInt(url.query.pageSize, 25)
  const page = queryInt(url.query.page, 1, 1_000_000)
  const openId = url.id && /^[1-9]\d{0,9}$/.test(url.id) ? Number(url.id) : null
  const openBranch = openId === null ? undefined : branches?.find((branch) => branch.id === openId)
  const createOpen = url.query.openCreateDialog === "true"
  const updateOpen = !createOpen && url.query.openUpdateDialog === "true" && Boolean(openBranch)
  const planOpen = url.query.openAddPlanDialog === "true" && Boolean(openBranch)
  const deleting = url.query.openConfirmDialog === "true" ? openBranch : undefined
  const editing: Branch | { id: 0 } | null = createOpen ? { id: 0 } : updateOpen && openBranch ? openBranch : null

  // A dialog opened from the address (or a button) starts from the record it edits, once per opening.
  const draftFor = useRef<string | null>(null)
  const editKey = createOpen ? "0" : updateOpen && openBranch ? String(openBranch.id) : null
  useEffect(() => {
    if (draftFor.current === editKey) return
    draftFor.current = editKey
    if (editKey === "0") setDraft(emptyDraft)
    else if (editKey && openBranch) setDraft(draftOf(openBranch))
  }, [editKey, openBranch])
  const planFor = useRef(false)
  useEffect(() => {
    if (planOpen && !planFor.current) setPlanDraft({ weight: "", amount: "", price: "" })
    planFor.current = planOpen
  }, [planOpen])

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
    // Currencies come from "Валюты" in Linko's order (Euro, SUM, USD); the server accepts any of them (code or alias),
    // "" = none (the branch works in the base currency).
    fetch("/api/currencies")
      .then((response) => (response.ok ? (response.json() as Promise<{ code: string; isBase?: boolean }[]>) : []))
      .then((data) => {
        setCurrencies([...new Set(data.filter((item) => item.code?.trim()).map((item) => normCurrency(item.code)))].sort(compareCurrencyCodes))
        const base = data.find((item) => item.isBase && item.code?.trim())
        setBaseCurrency(base ? normCurrency(base.code) : "")
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (openId === null) return
    // A late answer for a branch closed in the meantime is dropped.
    let cancelled = false
    fetch(`/api/branches/${openId}/plans`)
      .then((response) => (response.ok ? (response.json() as Promise<BranchPlan[]>) : []))
      .then((data) => { if (!cancelled) setPlans(data) })
      .catch(() => { if (!cancelled) setPlans([]) })
    return () => {
      cancelled = true
    }
  }, [openId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = branches ?? []
    return needle ? list.filter((branch) => branch.name.toLowerCase().includes(needle)) : list
  }, [branches, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)
  const goPage = (next: number) => updateUrl({ query: { page: next > 1 ? next : null } })

  function openForm(branch?: Branch) {
    setDraft(branch ? draftOf(branch) : emptyDraft)
    draftFor.current = branch ? String(branch.id) : "0"
    updateUrl({ query: branch ? { openUpdateDialog: "true" } : { openCreateDialog: "true" } })
  }

  const closeForm = () => updateUrl({ query: editing && editing.id ? { openUpdateDialog: "false" } : { openCreateDialog: "false" } })

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
      closeForm()
      load()
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
        const usage = data.usage?.map((item) => `${t(item.label)}: ${item.count}`).join(", ")
        setAlertMessage(`${t(data.error || "Не удалось удалить филиал")}${usage ? ` (${usage})` : ""}`)
        return
      }
      updateUrl({ id: null, query: { openConfirmDialog: "false" } })
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
      updateUrl({ query: { openAddPlanDialog: "false" } })
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const importSpec: ExcelImportSpec<BranchImport> = {
    templateName: "branches-template",
    columns: [
      { field: "name", header: "Наименование", aliases: ["Название", "Название филиала", "Филиал", "Name"] },
      { field: "priceList", header: "Прайс лист", aliases: ["Прайс-лист", "Price list"] },
      { field: "currency", header: "Валюта", aliases: ["Currency"] },
      { field: "debtTracking", header: "Учет долга (да/нет)", aliases: ["Учет долга", "Учёт долга", "Debt tracking"] },
    ],
    keyField: "name",
    prepare: async (records) => {
      // Price lists (active, like the dialog's picker) and currencies of Валюты, read fresh: a reference is sent by its stored name / code.
      const [lists, codes] = await Promise.all([
        listJson<{ name: string; isActive?: boolean }>("/api/price-lists"),
        listJson<{ code: string }>("/api/currencies"),
      ])
      const listByKey = new Map(lists.filter((item) => item.isActive !== false && item.name).map((item) => [importKey(item.name), item.name]))
      const currencyCodes = new Set(codes.filter((item) => item.code?.trim()).map((item) => normCurrency(item.code)))
      const rows: PreparedRow<BranchImport>[] = []
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        if (!values.name) {
          errors.push({ line, label: t("Наименование"), message: "Обязательное поле" })
          continue
        }
        const priceList = values.priceList ? listByKey.get(importKey(values.priceList)) : ""
        const currency = values.currency ? normCurrency(values.currency) : ""
        const debtTracking = parseYesNo(values.debtTracking, false)
        if (priceList === undefined) errors.push({ line, label: `${values.name}, ${values.priceList}`, message: "Прайс-лист не найден" })
        else if (currency && !currencyCodes.has(currency)) errors.push({ line, label: `${values.name}, ${values.currency}`, message: "Валюта не найдена" })
        else if (debtTracking === null) errors.push({ line, label: `${values.name}, ${t("Учет долга")}`, message: "Укажите да или нет" })
        else rows.push({ line, label: values.name, item: { name: values.name, priceList, currency, debtTracking, isMain: false } })
      }
      return { rows, errors: [...errors, ...repeatedInFile(rows, (row) => importKey(row.item.name))] }
    },
    send: (item) => postJson("/api/branches", item),
    fallbackError: "Не удалось сохранить филиал",
  }

  const flag = (on: boolean, yes: string, no: string) => <span className={`font-semibold ${on ? "text-[#8acb8d]" : "text-[#e57373]"}`}>{on ? yes : no}</span>

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <div className="relative flex h-[50px] items-center pr-[5px] text-[13px]">
        <div className="absolute left-[5px] top-[7px] flex items-center">
          <button type="button" onClick={() => openForm()} className="flex h-[36px] items-center rounded-[5px] bg-white pl-[12px] pr-[16px] leading-[36px] text-[#1E4A9A]">
            <svg viewBox="0 0 24 24" className="relative top-[1.5px] h-[14px] w-[14px] shrink-0 fill-[#1E4A9A]"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
            <span className="relative top-[1.5px]">{t("Добавить филиал")}</span>
          </button>
          {canImport && <ExcelImportLink className="h-[36px] pl-0 pt-[3px] leading-[36px]" onClick={() => setImportOpen(true)} />}
        </div>
        {/* Linko's search sits at a quarter of the toolbar (17px side padding, 8px column padding), at most 300px wide. */}
        <label className="group/search absolute left-[calc(25px_+_(100%_-_34px)_/_4)] top-0 block h-[48px] w-[min(300px,calc((100%_-_34px)_/_4_-_16px))]">
          <input value={query} onChange={(event) => updateUrl({ query: { search: event.target.value, page: null } })} placeholder={t("Поиск")} className="relative h-full w-full bg-transparent pr-[35px] text-[13px] leading-[24px] outline-none placeholder:text-black/30" />
          <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-px bg-[#e0e0e0]" />
          <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-transform duration-[450ms] group-focus-within/search:scale-x-100" />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[2px] top-[12px] h-[24px] w-[24px] fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </label>
        <div className="ml-auto flex items-center">
          <PageSizeSelect numberClassName="text-[#333]" value={pageSize} onChange={(size) => updateUrl({ query: { pageSize: size, page: null } })} />
          <span className="ml-[27px] mr-[10px] leading-[16.25px] text-[#5d6474]">{filtered.length ? start + 1 : 1} - {Math.min(start + pageSize, filtered.length)} {t("из")} {filtered.length}</span>
          <span className="flex gap-[5px]">
            <PagerArrow dir="prev" onClick={safePage > 1 ? () => goPage(safePage - 1) : undefined} />
            <PagerArrow dir="next" onClick={safePage < pageCount ? () => goPage(safePage + 1) : undefined} />
          </span>
        </div>
      </div>
      <div className={`${grayHead} ${GRID} leading-[16.25px]`}>
        <span>№</span><span>{t("Наименование")}</span><span>{t("Дата")}</span><span>{t("Учет долга")}</span><span>{t("Основной филиал")}</span>
      </div>
      {visible.map((branch, index) =>
        openId === branch.id ? (
          <div key={branch.id} className="my-[20px] border-b border-dotted border-[#eee] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[15px] pr-[15px]">
              <h3 onClick={() => updateUrl({ id: null })} className="cursor-pointer text-[18px] font-semibold leading-[22.5px]">{branch.name}</h3>
              <div className="flex items-center">
                <span className="mr-[8px] flex"><RefButton icon={PLAN_ICON} label={t("Добавить план")} onClick={() => updateUrl({ query: { openAddPlanDialog: "true" } })} /></span>
                <span className="flex gap-[6px] px-[3px]">
                  <RowIcon path={ROW_ICONS.pencil} label={t("Изменить")} onClick={() => openForm(branch)} />
                  <RowIcon path={ROW_ICONS.trash} label={t("Удалить")} onClick={() => updateUrl({ query: { openConfirmDialog: "true" } })} />
                </span>
              </div>
            </div>
            <div className="flex">
              {/* Linko's left column: 35% of a card that reaches 15px under the side menu, 20px / 30px padding. */}
              <dl className="w-[calc((100%_+_30px)_*_0.35_-_15px)] shrink-0 border-r border-[#efefef] py-[20px] pl-[15px] pr-[30px] leading-[25px]">
                {[
                  [t("Дата создания:"), <span key="d" className="font-semibold">{formatDateText(branch.date, language)}</span>],
                  ...(branch.priceList ? [[t("Прайс лист:"), <span key="p" className="font-semibold">{branch.priceList}</span>]] : []),
                  ...(branch.currency ? [[t("Валюта:"), <span key="c" className="font-semibold">{branch.currency}</span>]] : []),
                  [t("Основной филиал:"), flag(branch.isMain, t("Включено"), t("Выключено"))],
                  [t("Учет долга:"), flag(branch.debtTracking, t("Включено"), t("Выключено"))],
                ].map(([label, value], row) => (
                  <div key={row} className="flex justify-between"><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              <div className="min-w-0 flex-1 px-[15px] py-[15px]">
                {plans.map((plan) => (
                  <div key={plan.id} className="flex gap-[40px] leading-[25px]">
                    <span>{t("Вес")}: <b>{planValue(plan.weight, 3)}</b></span><span>{t("Количество")}: <b>{planValue(plan.amount, 3)}</b></span><span>{t("Цена")}: <b>{plan.price === null ? "" : `${planValue(plan.price, 2)} ${branch.currency || baseCurrency}`.trim()}</b></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div key={branch.id} onClick={() => updateUrl({ id: String(branch.id) })} className={`${ROW} ${GRID} cursor-pointer leading-[16.25px]`}>
            <span>{start + index + 1}</span>
            <span>{branch.name}</span>
            <span>{formatDateText(branch.date, language)}</span>
            <span className={branch.debtTracking ? "text-[#8acb8d]" : "text-[#e57373]"}>{branch.debtTracking ? t("Включен") : t("Отключен")}</span>
            <span className={branch.isMain ? "text-[#8acb8d]" : "text-[#e57373]"}>{branch.isMain ? t("Да") : t("Нет")}</span>
          </div>
        ),
      )}
      {branches && visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить Филиал") : t("Добавить филиал")}
          onClose={closeForm}
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
                // Linko prints the stored point (0 0 included) and nothing for a branch without one.
                draft.lat !== null && draft.lng !== null ? <span className="ml-[5px] flex gap-[5px] text-[12px] text-[#333]"><span>{draft.lat}</span><span>{draft.lng}</span></span> : null
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
        <Modal title={t("Добавить план")} onClose={() => updateUrl({ query: { openAddPlanDialog: "false" } })} width={450} bodyClassName="min-h-[300px] px-[30px] pt-[43px]" footer={<SaveLink onClick={() => void savePlan()}>{t("Сохранить")}</SaveLink>}>
          <div className="space-y-[32px]">
            <LineField label={t("Вес")} value={planDraft.weight} onChange={(weight) => setPlanDraft({ ...planDraft, weight })} />
            <LineField label={t("Количество")} value={planDraft.amount} onChange={(amount) => setPlanDraft({ ...planDraft, amount })} />
            <LineField label={t("Цена")} value={planDraft.price} onChange={(price) => setPlanDraft({ ...planDraft, price })} />
          </div>
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onConfirm={() => void remove()} onClose={() => updateUrl({ query: { openConfirmDialog: "false" } })} />}
      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={load}
          onDone={(summary) => {
            setImportOpen(false)
            setAlertMessage(summary)
          }}
        />
      )}
      {alertMessage && <ErrorAlert message={alertMessage} onClose={() => setAlertMessage("")} />}
    </div>
  )
}
