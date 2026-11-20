"use client"

import { Download } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useCanManage } from "@/components/analytics/cash-management-shared"
import { ClientDrawer } from "@/components/clients/clients-view"
import { keepShopDrawerParams } from "@/components/clients/shop-drawer-url"
import { KitMultiSelect, KitRangeField, KitSingleSelect, type KitOption } from "@/components/orders/field-filter-kit"
import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { csvText } from "@/lib/csv"
import {
  PHOTO_REPORT_STATUSES,
  type FieldOption,
  type FieldRecordFacets,
  type FieldRecordPage,
  type FieldRecordRow,
  type PhotoReportReview,
  type PhotoReportStatus,
} from "@/lib/field-activity/record-list-types"
import type { FieldPhoto } from "@/lib/field-activity/types"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Фотоотчеты" (Продажи): the photo reports the agents send from the mobile app with their before / after photos —
// the field data of Активность / Отслеживание (lib/field-activity, GET /api/field-activity/photo-reports). It follows
// the reference's page (#/reports):
//   * its state lives in the link with the reference's names (fromDate, toDate, status, search, initiator, supervisor,
//     brand, merchType, branch, channelCategory, marketTypeParent, market, marketInn, withGear, pageSize,
//     openFilterDialog, imageReport / report / openShop), so a reload, Back and a shared link keep it;
//   * 25 reports per request, the next ones load by themselves when the list is scrolled to its end;
//   * the cards stand in the reference's masonry columns (6, 4 from 1300 px, 3 from 700 px, 1 from 500 px): the store
//     and the employee are links that show only that store's / employee's reports, Принять / Отклонить always set that
//     status ("Успешно изменено"), a photo opens the viewer next to the store card;
//   * every filter select picks several values and searches as you type; «Поиск» searches the store and employee
//     names when Enter is pressed.
// A field employee sees their own reports (and their supervised agents'); a scoped reader's own reports only show
// their state: an agent never reviews their own report.

type Status = "pending" | "rejected" | "approved" | "all"

const TABS: ReadonlyArray<readonly [string, Status]> = [
  ["Ожидает", "pending"],
  ["Не принят", "rejected"],
  ["Принят", "approved"],
  ["Все", "all"],
]

/** The reference's status words in the link → the review states of the field data. */
const API_STATUS: Record<Exclude<Status, "all">, PhotoReportStatus> = { pending: "pending", rejected: "rejected", approved: "accepted" }

/** Reports per request (the reference's pageSize). */
const PAGE_SIZE = 25
/** Reports per request of the Excel export (it walks every page of the filter). */
const EXPORT_PAGE_SIZE = 500

/** Link state of the page (the reference's query of #/reports). Empty dates: no period. */
type PageState = {
  fromDate: string
  toDate: string
  status: Status
  search: string
  initiator: number[]
  initiatorName: string
  supervisor: number[]
  brand: number[]
  merchType: string[]
  branch: number[]
  channelCategory: string[]
  marketTypeParent: number[]
  market: number[]
  marketName: string
  marketInn: string[]
  withGear: "" | "true" | "false"
  pageSize: number
  openFilterDialog: boolean
  imageReport: number
  report: number
  openShop: number
}

/** The filter's own part of the state (what the «Фильтр» card edits). */
type FilterValues = Pick<
  PageState,
  "fromDate" | "toDate" | "initiator" | "supervisor" | "brand" | "merchType" | "branch" | "channelCategory" | "marketTypeParent" | "market" | "marketInn" | "withGear"
>

/** Keys the reference counts on «Фильтр / N» (every filter key but fromDate and search). */
const COUNTED: ReadonlyArray<keyof PageState> = ["toDate", "initiator", "supervisor", "brand", "merchType", "branch", "channelCategory", "marketTypeParent", "market", "marketInn", "withGear"]

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function idList(value: string | null): number[] {
  return [...new Set((value ?? "").split("-").map((part) => Number(part.trim())).filter((id) => Number.isSafeInteger(id) && id > 0))]
}
const idText = (ids: number[]) => ids.join("-")
const positive = (value: string | null) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function defaultPeriod() {
  const today = todayIso()
  return { fromDate: monthStartIso(today), toDate: monthEndIso(today) }
}

/** The link → the page state. A link with no state at all is the menu's: the current month, 25 per page. */
function readState(search: string): PageState {
  const params = new URLSearchParams(search)
  const bare = ![...params.keys()].some((key) => STATE_KEYS.has(key))
  const period = bare ? defaultPeriod() : { fromDate: params.get("fromDate") ?? "", toDate: params.get("toDate") ?? "" }
  const fromDate = ISO_DAY.test(period.fromDate) ? period.fromDate : ""
  const toDate = ISO_DAY.test(period.toDate) ? period.toDate : fromDate
  const status = params.get("status")
  const gear = params.get("withGear")
  return {
    fromDate,
    toDate: fromDate ? toDate : "",
    status: status === "pending" || status === "rejected" || status === "approved" ? status : "all",
    search: (params.get("search") ?? "").trim(),
    initiator: idList(params.get("initiator")),
    initiatorName: params.get("initiatorName") ?? "",
    supervisor: idList(params.get("supervisor")),
    brand: idList(params.get("brand")),
    merchType: params.getAll("merchType").map((value) => value.trim()).filter(Boolean),
    branch: idList(params.get("branch")),
    channelCategory: params.getAll("channelCategory").map((value) => value.trim()).filter(Boolean),
    marketTypeParent: idList(params.get("marketTypeParent")),
    market: idList(params.get("market")),
    marketName: params.get("marketName") ?? "",
    marketInn: (params.get("marketInn") ?? "").split("-").map((value) => value.trim()).filter(Boolean),
    withGear: gear === "true" || gear === "false" ? gear : "",
    pageSize: positive(params.get("pageSize")) || PAGE_SIZE,
    openFilterDialog: params.get("openFilterDialog") === "true",
    imageReport: positive(params.get("imageReport")),
    report: positive(params.get("report")),
    openShop: positive(params.get("openShop")),
  }
}

const STATE_KEYS = new Set([
  "fromDate",
  "toDate",
  "status",
  "search",
  "initiator",
  "initiatorName",
  "supervisor",
  "brand",
  "merchType",
  "branch",
  "channelCategory",
  "marketTypeParent",
  "market",
  "marketName",
  "marketInn",
  "withGear",
  "pageSize",
  "openFilterDialog",
  "imageReport",
  "report",
  "openShop",
])

/** The page state → the link's query (only what is set, as the reference writes it). */
function stateQuery(state: PageState): string {
  const params = new URLSearchParams()
  if (state.fromDate) params.set("fromDate", state.fromDate)
  if (state.toDate) params.set("toDate", state.toDate)
  if (state.status !== "all") params.set("status", state.status)
  if (state.search) params.set("search", state.search)
  if (state.initiator.length) params.set("initiator", idText(state.initiator))
  if (state.initiatorName) params.set("initiatorName", state.initiatorName)
  if (state.supervisor.length) params.set("supervisor", idText(state.supervisor))
  if (state.brand.length) params.set("brand", idText(state.brand))
  for (const value of state.merchType) params.append("merchType", value)
  if (state.branch.length) params.set("branch", idText(state.branch))
  for (const value of state.channelCategory) params.append("channelCategory", value)
  if (state.marketTypeParent.length) params.set("marketTypeParent", idText(state.marketTypeParent))
  if (state.market.length) params.set("market", idText(state.market))
  if (state.marketName) params.set("marketName", state.marketName)
  if (state.marketInn.length) params.set("marketInn", state.marketInn.join("-"))
  if (state.withGear) params.set("withGear", state.withGear)
  params.set("pageSize", String(state.pageSize))
  if (state.openFilterDialog) params.set("openFilterDialog", "true")
  if (state.imageReport) params.set("imageReport", String(state.imageReport))
  if (state.report) params.set("report", String(state.report))
  if (state.openShop) params.set("openShop", String(state.openShop))
  // The open store card keeps its own tab / sub-tab / period parameters (components/clients/shop-drawer-url.ts).
  if (state.openShop) keepShopDrawerParams(params)
  // The reference's router writes the keys in alphabetical order (its menu: ?fromDate=…&pageSize=25&toDate=…).
  params.sort()
  return params.toString()
}

/** The list request of a state (everything but the dialogs). */
function listQuery(state: PageState): string {
  const params = new URLSearchParams()
  if (state.fromDate) params.set("from", state.fromDate)
  if (state.toDate) params.set("to", state.toDate)
  if (state.status !== "all") params.set("status", API_STATUS[state.status])
  if (state.search) params.set("q", state.search)
  if (state.initiator.length) params.set("employeeId", state.initiator.join(","))
  if (state.supervisor.length) params.set("supervisorId", state.supervisor.join(","))
  if (state.brand.length) params.set("brandId", state.brand.join(","))
  for (const value of state.merchType) params.append("category", value)
  if (state.branch.length) params.set("branchId", state.branch.join(","))
  for (const value of state.channelCategory) params.append("channel", value)
  if (state.marketTypeParent.length) params.set("clientTypeId", state.marketTypeParent.join(","))
  if (state.market.length) params.set("clientId", state.market.join(","))
  for (const value of state.marketInn) params.append("inn", value)
  if (state.withGear) params.set("withEquipment", state.withGear)
  return params.toString()
}

/** One page of the filter: the newest reports, or (`before`) the ones after the previous page's nextCursor. */
async function loadPage(query: string, before: string | null, pageSize: number, facets: boolean, signal?: AbortSignal): Promise<FieldRecordPage> {
  const params = new URLSearchParams(query)
  params.set("pageSize", String(pageSize))
  if (before) params.set("before", before)
  if (facets) params.set("facets", "true")
  const response = await fetch(`/api/field-activity/photo-reports?${params.toString()}`, { cache: "no-store", signal })
  const body = (await response.json().catch(() => null)) as (FieldRecordPage & { error?: string }) | null
  if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error || "Не удалось загрузить данные")
  return body
}

const isStatus = (value: unknown): value is PhotoReportStatus => (PHOTO_REPORT_STATUSES as readonly unknown[]).includes(value)

const dotted = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "")

/** The reference's masonry breakpoints by window width: 6 columns, 4 up to 1300 px, 3 up to 700 px, 1 up to 500 px. */
function columnCount(width: number) {
  if (width <= 500) return 1
  if (width <= 700) return 3
  if (width <= 1300) return 4
  return 6
}

/** A photo slot: the picture, or (a file that is missing or fails to load) the reference's "not found" box. */
type Slot = { photo: FieldPhoto | null }

/**
 * The reference's photo groups of a report: each named group (Polka, DMP, …) has at most one before and one after
 * picture; the before pictures of all groups form one list and the after pictures another, and the i-th row of the card
 * shows the i-th of each list under the i-th group name. A report from the mobile app has no names: its i-th before /
 * after photos are the i-th row. The groups the import brought without files are slots with a missing picture.
 */
function photoRows(report: FieldRecordRow) {
  const before = report.photos.filter((photo) => photo.slot === "before")
  const after = report.photos.filter((photo) => photo.slot === "after")
  const groups = report.photoTypes ?? []
  if (!groups.length) {
    const count = Math.max(before.length, after.length)
    return {
      names: Array.from({ length: count }, () => ""),
      before: before.map((photo): Slot => ({ photo })),
      after: after.map((photo): Slot => ({ photo })),
    }
  }
  let beforeIndex = 0
  let afterIndex = 0
  const beforeSlots: Slot[] = []
  const afterSlots: Slot[] = []
  for (const group of groups) {
    if (group.before > 0) beforeSlots.push({ photo: before[beforeIndex++] ?? null })
    if (group.after > 0) afterSlots.push({ photo: after[afterIndex++] ?? null })
  }
  return { names: groups.map((group) => group.name), before: beforeSlots, after: afterSlots }
}

const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const REMOVE_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"
const FILTER_LIST = "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"
const HIGHLIGHT_OFF = "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"

function NotFoundBox({ t }: { t: (key: string) => string }) {
  return <div className="flex h-[200px] w-full cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-[#dde1e5] px-[6px] text-center text-[11px] text-[#888]">{t("Изображение не найдено")}</div>
}

function PhotoColumn({ slot, first, badge, onOpen, t }: { slot: Slot | undefined; first: boolean; badge: "до" | "после"; onOpen: (photo: FieldPhoto) => void; t: (key: string) => string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`relative flex w-full flex-col ${first ? "gap-[10px]" : ""}`}>
      {first && (
        <div>
          <div className="absolute left-0 top-[10px] z-[2] w-fit rounded-[8px] bg-[#333]/80 px-[8px] py-[2px] text-[11px] font-semibold text-white">{t(badge)}</div>
        </div>
      )}
      {slot && (
        <div className="relative">
          {slot.photo && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slot.photo.url} alt="" loading="lazy" onError={() => setBroken(true)} onClick={() => slot.photo && onOpen(slot.photo)} className="block h-auto w-full cursor-pointer overflow-hidden rounded-[8px] object-contain" />
          ) : (
            <NotFoundBox t={t} />
          )}
        </div>
      )}
    </div>
  )
}

function ReviewButton({ active, color, path, label, disabled, onClick }: { active: boolean; color: string; path: string; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{ background: active ? color : "#929292" }}
      className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[5px] outline-none active:opacity-70 disabled:cursor-default"
    >
      <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  )
}

function Card({
  report,
  canReview,
  busy,
  onSet,
  onStore,
  onEmployee,
  onOpenPhoto,
  t,
}: {
  report: FieldRecordRow
  /** False for a user without clients.manage, or for a scoped reader's own report: the buttons only show the state. */
  canReview: boolean
  busy: boolean
  onSet: (status: PhotoReportStatus) => void
  onStore: () => void
  onEmployee: () => void
  onOpenPhoto: (photo: FieldPhoto) => void
  t: (key: string) => string
}) {
  const { language } = useLanguage()
  const rows = photoRows(report)
  const storeName = report.clientName || `#${report.clientId}`
  const employeeName = report.employeeName || `#${report.employeeId}`
  return (
    <section className="relative mb-[10px] w-full rounded-[8px] bg-white p-[10px] text-center shadow-[0_2px_8px_0_rgba(99,99,99,0.2)]">
      {busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[8px] bg-white/[0.74]">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#1E4A9A] border-t-transparent" />
        </div>
      )}
      <a href={`?market=${report.clientId}&marketName=${encodeURIComponent(storeName)}`} onClick={(event) => { event.preventDefault(); onStore() }} className="text-[14px] font-semibold text-[#333] hover:text-[#1E4A9A]">
        {storeName}
      </a>
      <div className="mt-[5px] flex w-full items-start justify-between">
        <div className="flex w-full flex-col items-center gap-[5px]">
          <div className="mt-[5px] flex w-full items-start justify-between">
            <ReviewButton active={report.status === "accepted"} color="#1E4A9A" path={CHECK_CIRCLE} label={t("Принять")} disabled={!canReview || busy} onClick={() => onSet("accepted")} />
            <div className="flex w-max min-w-0 flex-col items-center gap-[5px]">
              <a href={`?initiator=${report.employeeId}&initiatorName=${encodeURIComponent(employeeName)}`} onClick={(event) => { event.preventDefault(); onEmployee() }} className="text-[13px] font-semibold text-[#999] hover:text-[#1E4A9A]">
                {employeeName}
              </a>
              <span className="text-[11px] text-[#999]">{formatDateText(report.at, language, { withTime: true })}</span>
            </div>
            <ReviewButton active={report.status === "rejected"} color="#fa8072" path={REMOVE_CIRCLE} label={t("Отклонить")} disabled={!canReview || busy} onClick={() => onSet("rejected")} />
          </div>
          {report.comment ? <span className="text-[11px] text-[#333]">{report.comment}</span> : null}
        </div>
      </div>
      <div>
        {rows.names.map((name, index) => (
          <div key={index}>
            <span className="text-[11px] text-[#999]">{name}</span>
            <div className="flex h-full w-full items-start justify-between gap-[10px]">
              {rows.before.length > 0 && <PhotoColumn slot={rows.before[index]} first={index === 0} badge="до" onOpen={onOpenPhoto} t={t} />}
              {rows.after.length > 0 && <PhotoColumn slot={rows.after[index]} first={index === 0} badge="после" onOpen={onOpenPhoto} t={t} />}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The reference's photo viewer beside the store card: ‹ › through the report's photos, −/+ zoom, rotation,
 * «Предыдущий магазин» / «Следующий магазин» through the list, and Принят / Не принят on the «Ожидает» tab. */
function PhotoViewer({
  report,
  photoId,
  previous,
  next,
  pendingTab,
  canReview,
  busy,
  onPhoto,
  onPrevious,
  onNext,
  onReview,
  t,
}: {
  report: FieldRecordRow | null
  photoId: number
  previous: FieldRecordRow | null
  next: FieldRecordRow | null
  pendingTab: boolean
  canReview: boolean
  busy: boolean
  onPhoto: (photoId: number) => void
  onPrevious: () => void
  onNext: () => void
  onReview: (status: PhotoReportStatus) => void
  t: (key: string) => string
}) {
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  // The reference's report images: the after pictures, then the before ones.
  const photos = report ? [...report.photos.filter((photo) => photo.slot === "after"), ...report.photos.filter((photo) => photo.slot === "before")] : []
  const found = photos.findIndex((photo) => photo.id === photoId)
  const index = found >= 0 ? found : 0
  const photo = photos[index]
  const move = (step: number) => {
    const target = photos[index + step]
    if (!target) return
    setZoom(1)
    onPhoto(target.id)
  }
  const roundButton = "flex h-[40px] w-[40px] select-none items-center justify-center rounded-full bg-black/60 text-[24px] text-white"
  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/75 md:right-[580px]" role="dialog" aria-modal="true" aria-label={t("Фото")}>
      <div className="my-auto">
        {photos.length > 1 && index > 0 && (
          <button type="button" aria-label={t("Назад")} onClick={() => move(-1)} className="absolute left-0 top-1/2 z-10 flex h-[70px] w-[70px] -translate-y-1/2 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-[65px] w-[65px] fill-white" aria-hidden><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
          </button>
        )}
        {previous && (
          <button type="button" title={previous.clientName} onClick={() => { setZoom(1); onPrevious() }} className="absolute left-0 top-[100px] z-10 flex h-[30px] -translate-y-1/2 items-center gap-[8px] rounded-[2px] bg-[#1E4A9A] pl-[10px] pr-[16px] text-[13px] font-semibold text-white">
            <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
            {t("Предыдущий магазин")}
          </button>
        )}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="" style={{ transform: `rotate(${rotation}deg) scale(${zoom})`, transition: "transform 0.5s ease" }} className="mx-auto block max-h-[90vh] max-w-[90vw]" />
        ) : (
          <div className="h-[16px] w-[16px]" />
        )}
        <button type="button" aria-label={t("Повернуть")} title={t("Повернуть")} onClick={() => setRotation((value) => (value + 90) % 360)} className="absolute right-[20%] top-[2%] z-10 flex h-[40px] w-[40px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[35px] w-[35px] fill-white" aria-hidden>
            <path d="M7.47 21.49C4.2 19.93 1.86 16.76 1.5 13H0c.51 6.16 5.66 11 11.95 11 .23 0 .44-.02.66-.03L8.8 20.15l-1.33 1.34zM12.05 0c-.23 0-.44.02-.66.04l3.81 3.81 1.33-1.33C19.8 4.07 22.14 7.24 22.5 11H24c-.51-6.16-5.66-11-11.95-11zM16 14h2V8c0-1.11-.9-2-2-2h-6v2h6v6zm-8 2V4H6v2H4v2h2v8c0 1.1.89 2 2 2h8v2h2v-2h2v-2H8z" />
          </svg>
        </button>
        {next && (
          <button type="button" title={next.clientName} onClick={() => { setZoom(1); onNext() }} className="absolute right-[8px] top-[100px] z-10 flex h-[30px] -translate-y-1/2 items-center gap-[8px] rounded-[2px] bg-[#1E4A9A] pl-[16px] pr-[10px] text-[13px] font-semibold text-white">
            {t("Следующий магазин")}
            <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </button>
        )}
        <div className="absolute bottom-[12%] left-1/2 z-10 flex -translate-x-1/2 gap-[10px]">
          <button type="button" aria-label={t("Уменьшить")} onClick={() => setZoom((value) => Math.max(value - 0.1, 0.5))} className={roundButton}>−</button>
          <button type="button" aria-label={t("Увеличить")} onClick={() => setZoom((value) => Math.min(value + 0.1, 3))} className={roundButton}>+</button>
        </div>
        {photos.length > 1 && index < photos.length - 1 && (
          <button type="button" aria-label={t("Вперед")} onClick={() => move(1)} className="absolute right-0 top-1/2 z-10 flex h-[70px] w-[70px] -translate-y-1/2 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-[65px] w-[65px] fill-white" aria-hidden><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </button>
        )}
        {pendingTab && report && canReview && (
          <div className="absolute bottom-[10%] right-0 z-10 flex items-center gap-[10px]">
            <button type="button" disabled={busy} onClick={() => onReview("accepted")} className="flex h-[34px] items-center gap-[8px] rounded-[2px] bg-[#71ce87] px-[16px] text-[13px] font-semibold text-white disabled:opacity-60">
              <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden><path d={CHECK_CIRCLE} /></svg>
              {t("Принят")}
            </button>
            <button type="button" disabled={busy} onClick={() => onReview("rejected")} className="flex h-[34px] items-center gap-[8px] rounded-[2px] bg-[#fa8072] px-[16px] text-[13px] font-semibold text-white disabled:opacity-60">
              <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden><path d={REMOVE_CIRCLE} /></svg>
              {t("Не принят")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const optionList = (list: FieldOption[] | undefined): KitOption[] => (list ?? []).map((item) => ({ value: String(item.id), label: item.name }))
const textOptions = (list: string[] | undefined): KitOption[] => (list ?? []).map((item) => ({ value: item, label: item }))
const ids = (values: string[]) => values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)

export function PhotoReportsView() {
  const { t, language } = useLanguage()
  // The page state is the link's (read after mount: the server render has no window).
  const [state, setState] = useState<PageState | null>(null)
  const [draft, setDraft] = useState<FilterValues | null>(null)
  const [searchText, setSearchText] = useState("")
  const [rows, setRows] = useState<FieldRecordRow[]>([])
  const [count, setCount] = useState(0)
  // Keyset paging: the next request asks for the reports after the previous page's nextCursor (of that same filter),
  // so reports that arrive meanwhile cannot shift the pages.
  const [more, setMore] = useState<{ query: string; cursor: string } | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [facets, setFacets] = useState<FieldRecordFacets | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [columns, setColumns] = useState(6)
  const [notice, setNotice] = useState("")
  // A report opened from a link that is not among the loaded cards (the viewer asks for it alone).
  const [linked, setLinked] = useState<FieldRecordRow | null>(null)
  const canReview = useCanManage(["clients.manage"])
  // The reader's own employee for a narrow field scope (its reports are not reviewable), else null.
  const [ownEmployeeId, setOwnEmployeeId] = useState<number | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set())
  const busyRef = useRef(new Set<number>())
  const sentinel = useRef<HTMLDivElement>(null)

  // Link → state on mount and on Back / Forward; a bare link (the menu's) gets the default period written into it.
  useEffect(() => {
    const sync = () => {
      const next = readState(window.location.search)
      setState(next)
      setSearchText(next.search)
      const query = stateQuery(next)
      if (window.location.search.slice(1) !== query) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}${window.location.hash}`)
    }
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  useEffect(() => {
    const update = () => setColumns(columnCount(window.innerWidth))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  /** A new state: written into the link as a new history entry (or replacing the current one). */
  const navigate = useCallback((next: PageState, replace = false) => {
    setState(next)
    setSearchText(next.search)
    const url = `${window.location.pathname}?${stateQuery(next)}${window.location.hash}`
    if (replace) window.history.replaceState(window.history.state, "", url)
    else window.history.pushState(window.history.state, "", url)
  }, [])

  const query = useMemo(() => (state ? listQuery(state) : null), [state])
  const pageSize = state?.pageSize ?? PAGE_SIZE
  // A new filter (or search) starts again from its newest reports.
  const cursor = more && more.query === query ? more.cursor : null
  // The filter options come with the first answer only (a later filter change does not ask again).
  const facetsLoaded = useRef(false)

  useEffect(() => {
    if (query === null) return
    const controller = new AbortController()
    const needFacets = !facetsLoaded.current
    setLoading(true)
    loadPage(query, cursor, pageSize, needFacets, controller.signal)
      .then((body) => {
        setRows((previous) => {
          if (!cursor) return body.rows
          const known = new Set(previous.map((row) => row.id))
          return [...previous, ...body.rows.filter((row) => !known.has(row.id))]
        })
        setCount(body.count)
        setNextCursor(body.hasMore ? body.nextCursor : null)
        setOwnEmployeeId(typeof body.ownEmployeeId === "number" ? body.ownEmployeeId : null)
        if (body.facets) {
          facetsLoaded.current = true
          setFacets(body.facets)
        }
        setLoading(false)
      })
      .catch((cause: Error) => {
        if (cause.name === "AbortError") return
        if (!cursor) {
          setRows([])
          setCount(0)
          setNextCursor(null)
        }
        if (needFacets) setFacets((value) => value ?? { employees: [], clients: [], refusalTypes: [] })
        setLoading(false)
        notify(t(cause.message || "Не удалось загрузить данные"))
      })
    return () => controller.abort()
    // `t` only translates the error text; a language switch must not reload the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, cursor, pageSize])

  // The reference loads the next reports by itself once the end of the list scrolls into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || loading || !nextCursor || query === null) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setMore({ query, cursor: nextCursor })
    }, { rootMargin: "200px" })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loading, nextCursor, query])

  // The report of the viewer when a link opens one that is not among the loaded cards.
  const reportId = state?.report ?? 0
  const loadedReport = rows.find((row) => row.id === reportId) ?? null
  useEffect(() => {
    if (!reportId || loadedReport || loading) return
    const controller = new AbortController()
    loadPage(`id=${reportId}`, null, 1, false, controller.signal)
      .then((body) => setLinked(body.rows[0] ?? null))
      .catch(() => undefined)
    return () => controller.abort()
  }, [reportId, loadedReport, loading])

  const masonry = useMemo(() => {
    const result: FieldRecordRow[][] = Array.from({ length: columns }, () => [])
    rows.forEach((row, index) => result[index % columns].push(row))
    return result
  }, [rows, columns])

  // The list a review answer lands in: the filter (or the loaded cards) may change while it is saved.
  const shown = useRef({ query, rows })
  useEffect(() => {
    shown.current = { query, rows }
  }, [query, rows])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Closing the store card closes the photo viewer with it (the reference's imageReport=0&openShop=false). A stable
  // callback: the card reloads the store whenever it gets a new one.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const closeShop = useCallback(() => {
    const now = stateRef.current
    if (now) navigate({ ...now, imageReport: 0, openShop: 0 })
  }, [navigate])

  if (!state) return <RefPage><RefHeader title={t("Фотоотчеты")} /></RefPage>
  const current = state

  /** The report's new status: patched in place, or dropped from a tab it no longer belongs to (as the tabs filter by
   * status). Nothing when another filter's list has been loaded since. */
  function showStatus(id: number, next: PhotoReportStatus, asked: string | null) {
    setLinked((value) => (value && value.id === id ? { ...value, status: next } : value))
    if (shown.current.query !== asked || !shown.current.rows.some((row) => row.id === id)) return
    if (current.status !== "all" && next !== API_STATUS[current.status]) {
      setRows((previous) => previous.filter((row) => row.id !== id))
      setCount((value) => Math.max(0, value - 1))
    } else {
      setRows((previous) => previous.map((row) => (row.id === id ? { ...row, status: next } : row)))
    }
  }

  /** Принять / Отклонить: the reference always sets the pressed status (pressing the shown one again keeps it). */
  async function review(report: FieldRecordRow, target: PhotoReportStatus) {
    if (!canReview || report.employeeId === ownEmployeeId || busyRef.current.has(report.id)) return
    busyRef.current.add(report.id)
    setBusyIds(new Set(busyRef.current))
    const asked = query
    try {
      const response = await fetch(`/api/field-activity/photo-reports/${report.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, ...(isStatus(report.status) ? { from: report.status } : {}) }),
      })
      const body = (await response.json().catch(() => null)) as (Partial<PhotoReportReview> & { error?: string; status?: unknown }) | null
      if (response.status === 409 && isStatus(body?.status)) {
        // Someone else reviewed it meanwhile: show their status instead of overriding it.
        notify(t(body?.error || "Статус фотоотчета уже изменен"))
        showStatus(report.id, body.status, asked)
        return
      }
      if (!response.ok || !isStatus(body?.status)) throw new Error(body?.error || "Изменение невозможно из-за связи с другими данными")
      showStatus(report.id, body.status, asked)
      setNotice(t("Успешно изменено"))
    } catch (cause) {
      notify(t((cause as Error).message || "Изменение невозможно из-за связи с другими данными"))
    } finally {
      busyRef.current.delete(report.id)
      setBusyIds(new Set(busyRef.current))
    }
  }

  /** A filter change: the list starts again from its first page. */
  function apply(next: PageState) {
    setMore(null)
    navigate(next)
  }

  function openFilter() {
    setDraft({
      fromDate: current.fromDate,
      toDate: current.toDate,
      initiator: current.initiator,
      supervisor: current.supervisor,
      brand: current.brand,
      merchType: current.merchType,
      branch: current.branch,
      channelCategory: current.channelCategory,
      marketTypeParent: current.marketTypeParent,
      market: current.market,
      marketInn: current.marketInn,
      withGear: current.withGear,
    })
    navigate({ ...current, openFilterDialog: true })
  }

  function closeFilter() {
    setDraft(null)
    navigate({ ...current, openFilterDialog: false })
  }

  function applyFilter() {
    const values = draft ?? current
    // The names next to «Фильтр» belong to the store / employee links: a filter of other ones drops them.
    const sameInitiator = values.initiator.length === current.initiator.length && values.initiator.every((id) => current.initiator.includes(id))
    const sameMarket = values.market.length === current.market.length && values.market.every((id) => current.market.includes(id))
    setDraft(null)
    apply({
      ...current,
      ...values,
      initiatorName: sameInitiator ? current.initiatorName : "",
      marketName: sameMarket ? current.marketName : "",
      openFilterDialog: false,
    })
  }

  /** The store / employee links of a card: the reference's link carries only that store (employee) and its name. */
  function linkTo(next: Partial<PageState>) {
    apply({ ...readState("?pageSize=" + PAGE_SIZE), fromDate: "", toDate: "", ...next })
  }

  async function exportCsv() {
    if (exporting || query === null) return
    setExporting(true)
    try {
      // Every report of the filter, not only the loaded cards.
      const all: FieldRecordRow[] = []
      for (let before: string | null = null; ; ) {
        const body = await loadPage(query, before, EXPORT_PAGE_SIZE, false)
        all.push(...body.rows)
        if (!body.hasMore || !body.nextCursor || !body.rows.length) break
        before = body.nextCursor
      }
      const statusLabel = (value: string) => t(TABS.find(([, code]) => code !== "all" && API_STATUS[code] === value)?.[0] ?? value)
      const csv = csvText([
        [t("Магазин"), t("Создал"), t("Дата"), t("Комментарий"), t("Статус")],
        ...all.map((row) => [row.clientName, row.employeeName, formatDateText(row.at, language, { withTime: true }), row.comment, statusLabel(row.status)]),
      ])
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
      const link = document.createElement("a")
      link.href = url
      link.download = "fotootchety.csv"
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      notify(t((cause as Error).message || "Не удалось загрузить данные"))
    } finally {
      setExporting(false)
    }
  }

  const filterCount = COUNTED.filter((key) => {
    const value = current[key]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  }).length
  const tabLabel = TABS.find(([, code]) => code === current.status)?.[0] ?? "Все"
  const viewerReport = state.report ? (loadedReport ?? (linked?.id === state.report ? linked : null)) : null
  const viewerIndex = viewerReport ? rows.findIndex((row) => row.id === viewerReport.id) : -1
  const previousReport = viewerIndex > 0 ? rows[viewerIndex - 1] : null
  const nextReport = viewerIndex >= 0 ? (rows[viewerIndex + 1] ?? null) : null
  const viewerOpen = state.imageReport > 0 && state.report > 0

  function openPhoto(report: FieldRecordRow, photo: FieldPhoto) {
    navigate({ ...current, imageReport: photo.id, report: report.id, openShop: report.clientId })
  }

  function stepStore(target: FieldRecordRow | null) {
    if (!target) return
    const first = [...target.photos.filter((photo) => photo.slot === "after"), ...target.photos.filter((photo) => photo.slot === "before")][0]
    navigate({ ...current, imageReport: first?.id ?? 1, report: target.id, openShop: target.clientId })
    // The next store at the end of the loaded cards: the list loads its next reports.
    const index = rows.findIndex((row) => row.id === target.id)
    if (index === rows.length - 1 && nextCursor && query !== null) setMore({ query, cursor: nextCursor })
  }

  const setDraftValue = <K extends keyof FilterValues>(key: K, value: FilterValues[K]) => setDraft((values) => (values ? { ...values, [key]: value } : values))
  const filterValues = draft ?? current
  const viewerOwnReport = viewerReport ? viewerReport.employeeId === ownEmployeeId : false

  return (
    <RefPage>
      <RefHeader title={t("Фотоотчеты")}>
        <button onClick={() => void exportCsv()} disabled={exporting} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60"><Download className="h-4 w-4" />{t("Скачать Excel")}</button>
      </RefHeader>
      <section className="overflow-hidden rounded-b-[8px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefTabs labels={TABS.map(([label]) => label)} value={tabLabel} onChange={(value) => apply({ ...current, status: TABS.find(([label]) => label === value)?.[1] ?? "all" })} />
        <div className="flex h-[50px] items-center justify-between px-[10px]">
          <div className="relative mr-[50px] shrink-0">
            <button type="button" onClick={openFilter} className="flex h-[34px] items-center gap-[8px] rounded-[2px] bg-[#1E4A9A] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95">
              <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden><path d={FILTER_LIST} /></svg>
              {t("Фильтр")}{filterCount > 0 ? ` / ${filterCount}` : ""}
            </button>
            <span className="absolute left-full top-0 flex h-full items-center whitespace-nowrap px-[10px] text-[13px] font-semibold text-[#1E4A9A]">
              {(current.initiatorName || current.marketName) && <span className="mr-[5px]">{[current.initiatorName, current.marketName].filter(Boolean).join(" ")}</span>}
              {current.fromDate ? `${dotted(current.fromDate)} - ${dotted(current.toDate || current.fromDate)}` : ""}
            </span>
          </div>
          <form
            className="relative w-[256px] shrink-0"
            onSubmit={(event) => {
              event.preventDefault()
              apply({ ...current, search: searchText.trim() })
            }}
          >
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t("Поиск")} aria-label={t("Поиск")} className="h-[45px] w-full border-b border-[#e0e0e0] bg-transparent pt-[12px] text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black focus:border-[#1E4A9A]" />
          </form>
          <span className="shrink-0 text-[13px] text-[#333]">{t("Фотоотчеты")}: <span className="text-[16px] font-semibold">{count} {t("шт")}</span></span>
        </div>
      </section>
      <div className="mt-[10px] -ml-[10px] flex">
        {masonry.map((column, index) => (
          <div key={index} className="min-w-0 flex-1 pl-[10px]">
            {column.map((report) => (
              <Card
                key={report.id}
                report={report}
                canReview={canReview && report.employeeId !== ownEmployeeId}
                busy={busyIds.has(report.id)}
                onSet={(status) => void review(report, status)}
                onStore={() => linkTo({ market: [report.clientId], marketName: report.clientName || `#${report.clientId}` })}
                onEmployee={() => linkTo({ initiator: [report.employeeId], initiatorName: report.employeeName || `#${report.employeeId}` })}
                onOpenPhoto={(photo) => openPhoto(report, photo)}
                t={t}
              />
            ))}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="h-px" />
      {/* No photo report: the reference shows nothing under the card («Фотоотчеты: 0 шт» says it). */}
      {loading && (
        <div className="flex justify-center pb-[50px] pt-[10px]">
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#1E4A9A] border-t-transparent" role="status" aria-label={t("Загрузка...")} />
        </div>
      )}
      {current.openFilterDialog && (
        // The reference's card: fixed under the tabs, four columns, a full-width green «Применить».
        <>
          <div className="fixed inset-0 z-[49] cursor-pointer bg-black/10" onClick={closeFilter} />
          <form
            onSubmit={(event) => {
              event.preventDefault()
              applyFilter()
            }}
            className="fixed left-[30px] right-[37px] top-[168px] z-[50] max-h-[calc(100vh-178px)] overflow-y-auto bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
          >
            <div className="relative flex flex-col px-[30px] py-[20px]">
              <h3 className="mb-[20px] text-[14px] font-semibold text-[#333]">{t("Фильтр")}</h3>
              <button type="button" onClick={closeFilter} aria-label={t("Закрыть")} className="absolute right-[10px] top-[10px] flex h-[44px] w-[44px] items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden><path d={HIGHLIGHT_OFF} /></svg>
              </button>
              <div className="grid grid-cols-1 gap-x-[10px] gap-y-[15px] px-[20px] py-[10px] md:grid-cols-4">
                <KitRangeField label="Дата создания" begin={filterValues.fromDate} end={filterValues.toDate} onChange={(begin, end) => setDraft((values) => (values ? { ...values, fromDate: begin, toDate: end } : values))} />
                <KitMultiSelect label="Супервайзер" options={optionList(facets?.supervisors)} value={filterValues.supervisor.map(String)} onChange={(next) => setDraftValue("supervisor", ids(next))} />
                <KitMultiSelect label="Создал" options={optionList(facets?.employees)} value={filterValues.initiator.map(String)} onChange={(next) => setDraftValue("initiator", ids(next))} />
                <KitMultiSelect label="Бренд" options={optionList(facets?.brands)} value={filterValues.brand.map(String)} onChange={(next) => setDraftValue("brand", ids(next))} />
                <KitMultiSelect label="Категория фотоотчета" options={textOptions(facets?.categories)} value={filterValues.merchType} onChange={(next) => setDraftValue("merchType", next)} />
                <KitMultiSelect label="Филиалы" options={optionList(facets?.branches)} value={filterValues.branch.map(String)} onChange={(next) => setDraftValue("branch", ids(next))} />
                <KitMultiSelect label="Категория канала" options={textOptions(facets?.channels)} value={filterValues.channelCategory} onChange={(next) => setDraftValue("channelCategory", next)} />
                <KitMultiSelect label="Тип клиента" options={optionList(facets?.clientTypes)} value={filterValues.marketTypeParent.map(String)} onChange={(next) => setDraftValue("marketTypeParent", ids(next))} />
                <KitMultiSelect label="Магазин" options={optionList(facets?.clients)} value={filterValues.market.map(String)} onChange={(next) => setDraftValue("market", ids(next))} />
                <KitMultiSelect label="ИНН магазина" options={textOptions(facets?.inns)} value={filterValues.marketInn} onChange={(next) => setDraftValue("marketInn", next)} />
                <KitSingleSelect
                  label="Магазин с оборудованием"
                  value={filterValues.withGear}
                  onChange={(value) => setDraftValue("withGear", value === "true" || value === "false" ? value : "")}
                  options={[
                    { value: "true", label: t("Да") },
                    { value: "false", label: t("Нет") },
                  ]}
                />
              </div>
              <button type="submit" className="mt-[10px] h-[36px] w-full rounded-[2px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">{t("Применить")}</button>
            </div>
          </form>
        </>
      )}
      {viewerOpen && (
        <PhotoViewer
          key={state.report}
          report={viewerReport}
          photoId={state.imageReport}
          previous={previousReport}
          next={nextReport}
          pendingTab={current.status === "pending"}
          canReview={canReview && !viewerOwnReport}
          busy={viewerReport ? busyIds.has(viewerReport.id) : false}
          onPhoto={(photoId) => navigate({ ...current, imageReport: photoId }, true)}
          onPrevious={() => stepStore(previousReport)}
          onNext={() => stepStore(nextReport)}
          onReview={(status) => viewerReport && void review(viewerReport, status)}
          t={t}
        />
      )}
      {state.openShop > 0 && (
        <ClientDrawer key={state.openShop} clientId={state.openShop} onClose={closeShop} editHref={`/clients?openShop=${state.openShop}&openUpdateDialog=true`} />
      )}
      {notice && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[1100] -translate-x-1/2 rounded-[2px] bg-[#323232] px-6 py-[14px] text-[14px] text-white shadow-lg">
          {notice}
        </div>
      )}
    </RefPage>
  )
}
