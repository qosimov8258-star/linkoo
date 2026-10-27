"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  ActDialog,
  AttachDialog,
  DetachDialog,
  NoticeDialog,
  ProlongDialog,
  PurchaseDialog,
  sum,
  type LicenseGroup,
  type PricePeriod,
} from "@/components/analytics/subscriptions-dialogs"
import { PageSizeSelect, PagerArrow, RowIcon, ROW_ICONS } from "@/components/analytics/settings-list-kit"
import { RefFilterPanel, RI } from "@/components/ref/list-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { Check, FilterChip, FilterLink, FilterPick, StaffTabs, type Option } from "@/components/staff/staff-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"
import { notify } from "@/lib/notify"

// "Подписки" (demo #/billing, Settings → Персонал; API main/billing/*, main/crud/subscriptions/): employees with a
// license ("С подпиской") or without / expired ("Без подписки"), the balance card (АКТ сверки, Пополнить баланс),
// "Купить подписку" and the video lesson. Rows can be selected to Прикрепить / Открепить / Продлить подписку.

type Row = {
  id: number
  name: string
  accessRight: string
  license: { key: string | null; name: string }
  beginDate: string | null
  endDate: string | null
  price: number
  isEnding: boolean
}
type Meta = {
  summary: { balance: number; supportPhone: string; serverName: string; noSubscription: number; paymentDeadline: string | null }
  pricing: PricePeriod[]
  groups: LicenseGroup[]
  licenseTypes: Array<{ key: string; name: string }>
}
type NamedId = { id: number; name: string }
type Filters = { license: string; accessRight: string; branch: string; zone: string; priceList: string; job: string; organization: string; ending: boolean }
type FilterOptions = { accessRights: Option[]; branches: Option[]; zones: Option[]; priceLists: Option[]; jobs: Option[]; organizations: Option[] }

const NO_FILTERS: Filters = { license: "", accessRight: "", branch: "", zone: "", priceList: "", job: "", organization: "", ending: false }
const VIDEO = "https://www.youtube.com/embed/fUAfzRV-PdU?si=9sYemlyDNbvPZKQO"

const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const EYE_OFF = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"

function toOptions(list: NamedId[]): Option[] {
  return list.map((item) => ({ value: String(item.id), label: item.name }))
}

function Badge({ value, red, empty }: { value: string | null; red: boolean; empty: string }) {
  return (
    <span className={`inline-block h-[28px] rounded-[14px] px-[10px] text-[13px] font-semibold leading-[28px] text-white ${red ? "bg-[#fa8072]" : "bg-[#4f71dc]"}`}>
      {value ? refDate(value) : empty}
    </span>
  )
}

function Card({ title, children, className = "", headClass = "h-[59px]" }: { title: React.ReactNode; children: React.ReactNode; className?: string; headClass?: string }) {
  return (
    <section className={`bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] ${className}`}>
      <div className={`flex items-center bg-[#f0f3f7] px-[20px] text-[15px] font-bold text-[#333] ${headClass}`}>{title}</div>
      {children}
    </section>
  )
}

export function SubscriptionsView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<"with" | "without">("with")
  const [rows, setRows] = useState<{ count: number; results: Row[] } | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [options, setOptions] = useState<FilterOptions>({ accessRights: [], branches: [], zones: [], priceLists: [], jobs: [], organizations: [] })
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [ordering, setOrdering] = useState("subscription_end_date")
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(true)
  const [hint, setHint] = useState(false)
  const [selected, setSelected] = useState<Row[]>([])
  const [dialog, setDialog] = useState<null | "attach" | "prolong" | "purchase" | "act" | "detach" | "notice">(null)
  const [attachIds, setAttachIds] = useState<number[]>([])
  const [showPhone, setShowPhone] = useState(false)
  const [busy, setBusy] = useState(false)

  // The reference writes its list state into the URL: ?ordering=…&withSubscription=true|false&showCheckboxes=true&pageSize=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("withSubscription") === "false") setTab("without")
    const urlOrdering = params.get("ordering")
    if (urlOrdering && /^-?(subscription_end_date|subscription_begin_date|first_name|id)$/.test(urlOrdering)) setOrdering(urlOrdering)
    const urlPageSize = Number(params.get("pageSize"))
    if ([10, 25, 50, 100].includes(urlPageSize)) setPageSize(urlPageSize)
    if (params.get("showCheckboxes") === "false") setSelectMode(false)
  }, [])

  const loadMeta = useCallback(async () => {
    try {
      const response = await fetch("/api/subscriptions/meta", { cache: "no-store" })
      if (response.ok) setMeta((await response.json()) as Meta)
    } catch {
      /* keep the previous card */
    }
  }, [])
  useEffect(() => { void loadMeta() }, [loadMeta])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/employees/options", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { accessRights: NamedId[]; branches: NamedId[]; zones: NamedId[]; priceLists: NamedId[]; jobs: NamedId[]; organizations: NamedId[] } | null) => {
        if (cancelled || !data) return
        setOptions({
          accessRights: toOptions(data.accessRights),
          branches: toOptions(data.branches),
          zones: toOptions(data.zones),
          priceLists: toOptions(data.priceLists),
          jobs: toOptions(data.jobs),
          organizations: toOptions(data.organizations),
        })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    const params = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize), ordering })
    if (query.trim()) params.set("search", query.trim())
    for (const [key, value] of Object.entries(filters)) {
      if (key === "ending") { if (value) params.set("ending", "1") } else if (value) params.set(key, String(value))
    }
    try {
      const response = await fetch(`/api/subscriptions?${params}`, { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setRows((await response.json()) as { count: number; results: Row[] })
    } catch {
      setRows({ count: 0, results: [] })
    }
  }, [tab, page, pageSize, ordering, query, filters])
  useEffect(() => { void load() }, [load])

  const reloadAll = useCallback(() => {
    setSelected([])
    void load()
    void loadMeta()
  }, [load, loadMeta])

  const selectedIds = useMemo(() => new Set(selected.map((row) => row.id)), [selected])
  const monthTotal = selected.reduce((acc, row) => acc + row.price, 0)
  const total = rows?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(page * pageSize, total)
  const checkboxes = tab === "without" || selectMode
  const showPrice = tab === "with" && selectMode
  const filterCount = Object.values(filters).filter(Boolean).length

  const columns = showPrice
    ? "21% 15.4% 7.6% 15.4% 15.3% 1fr"
    : tab === "without"
      ? "28.7% 15.3% 15.4% 15.3% 1fr"
      : "27.2% 15.6% 15.7% 15.7% 1fr"

  function switchTab(label: string) {
    setTab(label === "С подпиской" ? "with" : "without")
    setSelected([])
    setSelectMode(false)
    setHint(false)
    setPage(1)
  }

  function toggleRow(row: Row) {
    setHint(false)
    setSelected((current) => (current.some((item) => item.id === row.id) ? current.filter((item) => item.id !== row.id) : [...current, row]))
  }
  function togglePage() {
    const visible = rows?.results ?? []
    const all = visible.length > 0 && visible.every((row) => selectedIds.has(row.id))
    setHint(false)
    setSelected((current) => (all ? current.filter((row) => !visible.some((item) => item.id === row.id)) : [...current, ...visible.filter((row) => !selectedIds.has(row.id))]))
  }
  /** Actions need a selection: the first press only switches the checkboxes on, the next one reports the missing choice. */
  function requireSelection(action: () => void) {
    if (selected.length) return action()
    if (checkboxes && selectMode) return setDialog("notice")
    if (tab === "without") return setDialog("notice")
    setSelectMode(true)
    setHint(true)
  }
  function openAttach(ids?: number[]) {
    if (ids) {
      setAttachIds(ids)
      return setDialog("attach")
    }
    requireSelection(() => { setAttachIds(selected.map((row) => row.id)); setDialog("attach") })
  }
  async function detach() {
    setBusy(true)
    try {
      const response = await fetch("/api/subscriptions/detach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selected.map((row) => row.id) }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(body.error || "Не удалось открепить подписку"))
        return
      }
      setDialog(null)
      reloadAll()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setBusy(false)
    }
  }
  function sortByEnd() {
    setOrdering((current) => (current === "subscription_end_date" ? "-subscription_end_date" : "subscription_end_date"))
    setPage(1)
  }
  function apply() {
    setFilters(draft)
    setFilterOpen(false)
    setPage(1)
  }

  const money = (value: number) => sum(value)
  const hasSelection = selected.length > 0

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] px-[28px] pb-[28px] pt-[10px] text-[13px] text-[#333]">
      <div className="flex items-start gap-[20px]">
        <div className="min-w-0 flex-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <div className="flex h-[62px] items-center justify-between bg-[#f0f3f7] pl-[10px] pr-[18px]">
            <span className="text-[15px] font-bold">{hasSelection && <>{t("Итого за месяц")}: <span className="text-[#71ce87]">{money(monthTotal)}</span></>}</span>
            <div className="flex items-center gap-[16px]">
              {hint && !hasSelection && <span className="flex h-[30px] items-center rounded-[3px] bg-[#4a4a4a] px-[20px] text-[13px] font-semibold text-white">{t("Выберите пользователя")}</span>}
              {/* reference: hovering the button without a selection shows "Выберите пользователя" to its left */}
              <RefTip text={hasSelection || hint ? "" : "Выберите пользователя"} raw side="left">
                <button
                  type="button"
                  onClick={() => (hasSelection ? setDialog("prolong") : requireSelection(() => undefined))}
                  className="flex h-[40px] items-center gap-[8px] rounded-[3px] bg-[#71ce87] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d={RI.sync} /></svg>
                  {t("Продлить подписку")}
                </button>
              </RefTip>
            </div>
          </div>
          <div className="bg-white">
            <StaffTabs labels={["С подпиской", "Без подписки"]} value={tab === "with" ? "С подпиской" : "Без подписки"} onChange={switchTab} />
            <div className="relative flex h-[51px] items-center bg-white pl-[5px] pr-[13px]">
              {hasSelection ? (
                <span className="w-[355px] pl-[5px] text-[13px] font-bold">{t("Выбрано")}: {selected.length}</span>
              ) : (
                <>
                  <div className="w-[263px] min-w-[120px] shrink">
                    {filterCount > 0 ? (
                      <FilterChip count={filterCount} onEdit={() => { setDraft(filters); setFilterOpen(true) }} onClear={() => { setFilters(NO_FILTERS); setDraft(NO_FILTERS); setPage(1) }} />
                    ) : (
                      <FilterLink onClick={() => { setDraft(filters); setFilterOpen((open) => !open) }} />
                    )}
                  </div>
                  <label className="relative w-[232px] min-w-0 shrink-[3] border-b border-[#e0e0e0]">
                    <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="h-[40px] w-full bg-transparent pr-8 text-[13px] outline-none placeholder:text-black/30" />
                    <svg viewBox="0 0 24 24" className="absolute right-0 top-[8px] h-6 w-6 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
                  </label>
                </>
              )}
              <div className="relative top-[2px] ml-auto flex shrink-0 items-center whitespace-nowrap">
                <PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setPage(1) }} />
                <span className="ml-[33px] mr-[10px]">{from} - {to} {t("из")} {total}</span>
                <PagerArrow dir="prev" onClick={page > 1 ? () => setPage(page - 1) : undefined} />
                <PagerArrow dir="next" onClick={page < pageCount ? () => setPage(page + 1) : undefined} />
                <RefTip text={checkboxes ? t("Спрятать флажки") : t("Выбрать из списка")} side="left" className="ml-[27px]">
                  <button
                    type="button"
                    aria-label={checkboxes ? t("Спрятать флажки") : t("Выбрать из списка")}
                    onClick={() => { setSelectMode((current) => !current); setHint(false); if (selectMode) setSelected([]) }}
                    className="flex h-6 w-6 items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={checkboxes ? EYE_OFF : RI.checklist} /></svg>
                  </button>
                </RefTip>
                <button type="button" onClick={() => openAttach()} className="ml-[22px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">{t("Прикрепить")}</button>
                {tab === "with" && selectMode && (
                  <RefTip text="Открепить все выделенные подписки" raw side="top" className="ml-[18px]">
                    <button type="button" onClick={() => requireSelection(() => setDialog("detach"))} className="h-[30px] rounded-[3px] bg-[#fa8072] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">{t("Открепить")}</button>
                  </RefTip>
                )}
                {hasSelection && (
                  <button type="button" onClick={() => setSelected([])} aria-label={t("Снять выделение")} title={t("Снять выделение")} className="ml-[22px] flex h-6 w-6 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={MINUS_BOX} /></svg>
                  </button>
                )}
              </div>
              {filterOpen && (
                <div className="absolute left-0 top-0 z-30">
                  <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={apply}>
                    <FilterPick label={t("Подписки")} value={draft.license} options={(meta?.licenseTypes ?? []).map((item) => ({ value: item.key, label: item.name }))} onChange={(license) => setDraft((d) => ({ ...d, license }))} />
                    <FilterPick label={t("Права доступа")} value={draft.accessRight} options={options.accessRights} onChange={(accessRight) => setDraft((d) => ({ ...d, accessRight }))} />
                    <FilterPick label={t("Филиалы")} value={draft.branch} options={options.branches} onChange={(branch) => setDraft((d) => ({ ...d, branch }))} />
                    <FilterPick label={t("Зона")} value={draft.zone} options={options.zones} onChange={(zone) => setDraft((d) => ({ ...d, zone }))} />
                    <FilterPick label={t("Прайс лист")} value={draft.priceList} options={options.priceLists} onChange={(priceList) => setDraft((d) => ({ ...d, priceList }))} />
                    <FilterPick label={t("Должность")} value={draft.job} options={options.jobs} onChange={(job) => setDraft((d) => ({ ...d, job }))} />
                    <FilterPick label={t("Организация")} value={draft.organization} options={options.organizations} onChange={(organization) => setDraft((d) => ({ ...d, organization }))} />
                    <Check className="mt-[2px] !gap-[4px]" label={t("Заканчиваюшиеся подписки")} checked={draft.ending} onChange={(ending) => setDraft((d) => ({ ...d, ending }))} />
                    <div className="h-[6px]" />
                  </RefFilterPanel>
                </div>
              )}
            </div>
            <div className="grid h-[50px] items-center bg-[#5d6474] font-semibold leading-[18px] text-white" style={{ gridTemplateColumns: columns }}>
              <span className={`flex items-center ${checkboxes ? "pl-[22px]" : "pl-[30px]"}`}>
                {checkboxes && (
                  <button type="button" onClick={togglePage} aria-label={t("Выбрать все")} className="mr-[6px] flex h-6 w-6 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={SELECT_ALL} /></svg>
                  </button>
                )}
                №. <span data-no-translate>Сотрудник</span>
              </span>
              <span>{t("Права доступа")}</span>
              <span className="pr-2">{t("Тип подписки")}</span>
              <span>{t("Дата начала")}</span>
              <button type="button" onClick={sortByEnd} className="flex items-center gap-[8px] text-left font-bold">
                {t("Дата окончания")}
                {ordering === "subscription_end_date" && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z" /></svg>}
                {ordering === "-subscription_end_date" && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" /></svg>}
              </button>
              {showPrice && <span className="pr-[100px]">{t("Цена за месяц без скидки")}</span>}
            </div>
            {rows?.results.map((row) => {
              const expired = tab === "without"
              return (
                <div key={row.id} className="group relative grid min-h-[50px] items-center border-b-2 border-dotted border-[#d9e0e5] py-[4px] hover:bg-[#f2f5f8]" style={{ gridTemplateColumns: columns }}>
                  <span className={`flex items-center pr-2 leading-[16px] ${checkboxes ? "pl-[22px]" : "pl-[30px]"}`}>
                    {checkboxes && <span className="mr-[6px] shrink-0"><Check checked={selectedIds.has(row.id)} onChange={() => toggleRow(row)} /></span>}
                    <span className="min-w-0 break-words">{row.id}. {row.name}</span>
                  </span>
                  <span className="min-w-0 break-words pr-2 leading-[16px]">{row.accessRight}</span>
                  <span className="min-w-0 break-words pr-2 leading-[16px]">{row.license.name === "Не указано" ? t("Не указано") : row.license.name}</span>
                  <span><Badge value={row.beginDate} red={expired || !row.beginDate} empty={t("Нет подписки")} /></span>
                  <span><Badge value={row.endDate} red={expired || !row.endDate} empty={t("Нет подписки")} /></span>
                  {showPrice && <span>{money(row.price)}</span>}
                  <span className="absolute right-[34px] top-1/2 hidden -translate-y-1/2 group-hover:flex">
                    <RowIcon path={ROW_ICONS.pencil} label={t("Изменить")} onClick={() => openAttach([row.id])} />
                  </span>
                </div>
              )
            })}
            {rows && rows.results.length === 0 && (
              <div className="flex h-[276px] flex-col items-center pt-[58px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/robot-empty.png" alt="" className="h-[162px] w-[162px] object-contain" />
                <p className="mt-[8px] text-[13px] text-[#6b7280]">{t("По вашему запросу ничего не найдено")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-[400px] shrink-0 space-y-[25px]">
          <Card title={t("Ваш баланс")}>
            <div className="px-[20px] pb-[19px] pt-[11px] text-center">
              <div className="py-[6px] text-[24px] font-bold text-[#71ce87]">{meta ? money(meta.summary.balance) : ""}</div>
              <p className="mt-[9px] text-left text-[15px] font-semibold leading-[19px]">{t("Крайний срок оплаты")}: {meta?.summary.paymentDeadline ? refDate(meta.summary.paymentDeadline) : ""}</p>
              <button type="button" onClick={() => setDialog("act")} className="mt-[8px] h-[30px] w-full rounded-[3px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95">{t("АКТ сверки")}</button>
              <button type="button" onClick={() => setShowPhone((open) => !open)} className="mt-[10px] h-[30px] w-full rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">{t("Пополнить баланс")}</button>
              {showPhone && meta && (
                <div className="px-[10px] pt-[20px] text-[18px] leading-[22px]">
                  {t("Для пополнения баланса, обращайтесь по номеру")}
                  <p className="mt-[20px] text-[16px]">{meta.summary.supportPhone}</p>
                </div>
              )}
            </div>
          </Card>
          <Card headClass="h-[64px]" title={<><svg viewBox="0 0 24 24" className="mr-[12px] h-[24px] w-[24px] fill-[#f5a623]"><path d={RI.warning} /></svg>{t("Пользователей без подписок")}:&nbsp;<span className="text-[#f00]">{meta?.summary.noSubscription ?? ""}</span></>}>
            <div className="px-[20px] pb-[20px] pt-[20px]">
              <button type="button" onClick={() => setDialog("purchase")} className="flex h-[45px] w-[352px] items-center justify-center gap-[10px] rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">
                <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-white"><path d={RI.add} /></svg>
                {t("Купить подписку")}
              </button>
            </div>
          </Card>
          <Card title={t("Видео урок")}>
            <div className="px-[20px] pb-[20px] pt-[20px]">
              <iframe title={t("Видео урок")} src={VIDEO} width="360" height="250" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen className="block border-0" />
            </div>
          </Card>
        </div>
      </div>

      {dialog === "notice" && <NoticeDialog text={t("Выберите одного пользователя !")} onClose={() => setDialog(null)} />}
      {dialog === "attach" && <AttachDialog ids={attachIds} groups={meta?.groups ?? []} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reloadAll() }} />}
      {dialog === "detach" && <DetachDialog count={selected.length} busy={busy} onConfirm={() => void detach()} onClose={() => setDialog(null)} />}
      {dialog === "prolong" && <ProlongDialog ids={selected.map((row) => row.id)} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll() }} />}
      {dialog === "purchase" && <PurchaseDialog pricing={meta?.pricing ?? []} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll() }} />}
      {dialog === "act" && <ActDialog onClose={() => setDialog(null)} />}
    </main>
  )
}
