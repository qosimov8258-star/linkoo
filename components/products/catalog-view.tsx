"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, ConfirmDialog, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { AddLimitDialog, BulkEditDialog, SendProductsDialog } from "@/components/products/catalog-bulk"
import { CatalogDetailPanel } from "@/components/products/catalog-detail"
import { CatalogImportDialog, catalogListSheet, downloadImportTemplate, downloadUpdateSheet } from "@/components/products/catalog-excel"
import { CatalogFilterBar } from "@/components/products/catalog-filter"
import { CatalogFormDialog } from "@/components/products/catalog-form"
import { KIND_TEXT, RowMenu, UsageList, catalogMutate, errorText, imageUrl, unitParts } from "@/components/products/catalog-shared"
import { EMPTY_CATALOG_FILTERS, listUrl, stateFromParams, stateToSearch, type CatalogViewState } from "@/components/products/catalog-state"
import { RI, RefButton, RefHeader, RefPage } from "@/components/ref/list-kit"
import { ConfirmDeleteDialog } from "@/components/settings/settings-list-ui"
import { RefPager } from "@/components/ref/pager-controls"
import { RefTabStrip } from "@/components/ref/tab-strip"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  CATALOG_API,
  PRODUCT_TABS,
  RAW_TABS,
  type CatalogDetail,
  type CatalogImportMode,
  type CatalogItem,
  type CatalogKind,
  type CatalogListResult,
  type CatalogOptions,
  type CatalogUsage,
} from "@/lib/products-types"

// "Продукты" (demo #/product, chunk c45 container 4100 + ProductGridList 3936) and "Сырье"
// (#/raw, container 3935 + grid 3942 — the same page with is_raw, no tabs in the demo; here
// "Все | Удалённые"). Toolbar: Импортировать, Обновить с excel, Добавить; tabs Можно
// продавать | Инвентари | Сняты с продажи | Все | Удалённые; "Показать фильтр", search,
// 25 per page "1 - 25 из N", Скачать; rows with checkboxes (Скачать выбранные, Добавить
// лимит, Изменить выбранные): Наименование | Штрих - код товара | Артикул | Тип товара |
// Организация | Мера | Дата создания | Порядковый номер | ⋮ (Изменить, Удалить /
// Восстановить). A row opens its detail in place (?id=).

const SORT_DOWN = "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z"
const SORT_UP = "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z"
const LANDSCAPE = "M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"
const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const DONE_ALL = "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
const CHECK_BOX_BLANK = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECK_BOX = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const EYE_OFF = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
const HAND = "M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"

/** 48px toolbar icon with the reference's dark tooltip to its left. */
function ToolbarIcon({ path, label, onClick, tooltip = true, color = "#666" }: { path: string; label: string; onClick: () => void; tooltip?: boolean; color?: string }) {
  return (
    <div className="group relative shrink-0">
      <button type="button" onClick={onClick} aria-label={label} className="flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: color }}><path d={path} /></svg>
      </button>
      {tooltip && (
        <span className="pointer-events-none absolute right-[calc(100%-12px)] top-[7px] hidden h-[33px] whitespace-nowrap rounded-[2px] bg-[#2d3037] px-5 text-[13px] font-bold leading-[33px] text-white opacity-90 group-hover:block">{label}</span>
      )}
    </div>
  )
}

type Confirm = { action: "delete" | "hard" | "restore"; id: number; name: string; usage?: CatalogUsage[]; error?: string } | null

export function CatalogView({ kind, initialDetailId }: { kind: CatalogKind; initialDetailId?: number }) {
  const { t } = useLanguage()
  const text = KIND_TEXT[kind]
  const api = CATALOG_API[kind]
  const searchParams = useSearchParams()
  const pathname = usePathname()
  // /analytics/products/966 — the opened item lives in the path (reference: #/product/966).
  const basePath = pathname.replace(/\/\d+\/?$/, "")
  const canEdit = useCanWrite()
  const [state, setState] = useState<CatalogViewState>(() => {
    const initial = stateFromParams(new URLSearchParams(searchParams.toString()), kind)
    return initialDetailId ? { ...initial, detailId: initialDetailId } : initial
  })
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  // ?openCreateDialog=true (the green "+" links of other pages) opens the empty form.
  const [form, setForm] = useState<CatalogDetail | null | undefined>(() => (searchParams.get("openCreateDialog") === "true" ? null : undefined))
  const [importMode, setImportMode] = useState<CatalogImportMode | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<"bulk" | "limit" | "send" | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [version, setVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<CatalogListResult>(listUrl(kind, state))
  const options = useCashJson<CatalogOptions>(`${api}/options`)
  const rows = list.data?.results ?? []
  const count = list.data?.count ?? 0
  const tabs = kind === "product" ? PRODUCT_TABS : RAW_TABS

  useEffect(() => {
    const params = new URLSearchParams(stateToSearch(state))
    params.delete("id")
    if (form === null) params.set("openCreateDialog", "true")
    else if (form) params.set("openUpdateDialog", "true")
    const search = params.toString()
    const path = state.detailId ? `${basePath}/${state.detailId}` : basePath
    if (window.location.pathname !== path || window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${path}${search ? `?${search}` : ""}`)
  }, [state, form, basePath])

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  useEffect(() => {
    if (!list.data || list.loading || state.page <= 1) return
    const last = Math.max(1, Math.ceil(list.data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [list.data, list.loading, state.page, state.pageSize])

  const update = (patch: Partial<CatalogViewState>) => setState((current) => ({ ...current, ...patch }))
  const notify = useCallback((value: string, error = false) => setMessage({ text: value, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const refresh = () => {
    list.reload()
    setVersion((value) => value + 1)
  }

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const sortHeader = (key: string, label: string) => (
    <button type="button" onClick={() => sort(key)} className="flex min-h-[36px] items-center text-left font-semibold leading-[18px]">
      {t(label)}
      <svg viewBox="0 0 24 24" className={`ml-[6px] h-6 w-6 shrink-0 fill-white ${state.ordering === key || state.ordering === `-${key}` ? "" : "invisible"}`}>
        <path d={state.ordering === `-${key}` ? SORT_UP : SORT_DOWN} />
      </svg>
    </button>
  )

  const fetchAll = async (ids?: number[], idsOnly = false): Promise<CatalogItem[]> => {
    const scope = idsOnly ? { ...state, search: "", filters: EMPTY_CATALOG_FILTERS } : state
    const response = await fetch(listUrl(kind, scope, { pageSize: 0, ids }), { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as (CatalogListResult & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
    return body.results
  }

  const download = async (which: "all" | "selected") => {
    try {
      if (which === "selected" && !selected.size) return notify(t("Выберите продукты"), true)
      // The selection spans pages; it is taken whatever the search / filters are now.
      const items = which === "all" ? await fetchAll() : await fetchAll([...selected], true)
      downloadExcelTable(which === "all" ? t(text.excel) : t(text.selectedExcel), catalogListSheet(items, t))
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const openEdit = async (id: number) => {
    const response = await fetch(`${api}/${id}`, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as (CatalogDetail & { error?: string }) | null
    if (!response.ok || !body) return notify(t(body?.error || "Не удалось загрузить данные"), true)
    setForm(body)
  }

  useEffect(() => {
    if (searchParams.get("openUpdateDialog") === "true" && state.detailId) void openEdit(state.detailId)
    // only once, for the link that carries ?openUpdateDialog=true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runConfirm = async () => {
    if (!confirm) return
    setBusy(true)
    const result =
      confirm.action === "restore"
        ? await catalogMutate("POST", `${api}/${confirm.id}/restore`)
        : await catalogMutate("DELETE", `${api}/${confirm.id}?mode=${confirm.action === "hard" ? "hard" : "soft"}`)
    setBusy(false)
    if (!result.ok) {
      const error = result.status === 409 && result.usage ? t("Удаление невозможно из-за связи с другими данными") : errorText(result, t)
      return setConfirm({ ...confirm, error, usage: result.usage })
    }
    notify(t(confirm.action === "restore" ? "Успешно" : "Успешно удалено"))
    if (state.detailId === confirm.id) update({ detailId: null })
    setConfirm(null)
    setSelected((current) => {
      const next = new Set(current)
      next.delete(confirm.id)
      return next
    })
    refresh()
  }

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.id))

  const menuItem = "flex h-12 w-full items-center pl-6 pr-4 text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]"
  const menuIcon = "mr-[28px] h-6 w-6 shrink-0 fill-[#5d6474]"
  const confirmTitle = confirm ? t(confirm.action === "restore" ? "Восстановить" : confirm.action === "hard" ? "Удалить навсегда" : "Удалить") : ""
  const confirmText = confirm ? (confirm.action === "restore" ? t(text.restore).replace("{name}", confirm.name) : confirm.name) : ""

  const lastPage = Math.max(1, Math.ceil(count / Math.max(1, state.pageSize)))
  const page = Math.min(state.page, lastPage)
  const hasSelection = selectMode && selected.size > 0
  const gridCols = selectMode
    ? "grid-cols-[20px_minmax(0,2.5fr)_repeat(7,minmax(0,1fr))_minmax(0,0.5fr)]"
    : "grid-cols-[minmax(0,2.5fr)_repeat(7,minmax(0,1fr))_minmax(0,0.5fr)]"

  const toggleSelectMode = () => {
    setSelectMode((current) => !current)
    setSelected(new Set())
  }

  return (
    <RefPage>
      <RefHeader title={t(text.title)}>
        {canEdit && (
          <>
            <RefButton exact icon={RI.chart} label={t("Импортировать")} onClick={() => setImportMode("create")} />
            <RefButton exact icon={RI.chart} label={t("Обновить с excel")} onClick={() => setImportMode("update")} />
            <RefButton exact icon={RI.add} green label={t("Добавить")} onClick={() => setForm(null)} />
          </>
        )}
      </RefHeader>

      {/* The reference's "Сырье" page has no tabs (its deleted items are not reachable there). */}
      {kind === "product" && (
        <RefTabStrip
          tabs={tabs}
          value={state.tab}
          onChange={(value) => {
            setSelected(new Set())
            update({ tab: value, page: 1, detailId: null })
          }}
        />
      )}

      <section className="bg-white">
        <div className="relative flex h-[50px] items-center whitespace-nowrap px-[5px]">
          {hasSelection ? (
            <span className="text-[13px] font-semibold text-[#333]">
              {t("Выбрано")}: {selected.size}
            </span>
          ) : (
            <>
              <div className="w-[355px] shrink-0">
                <CatalogFilterBar
                  kind={kind}
                  filters={state.filters}
                  options={options.data}
                  open={filterOpen}
                  onOpen={() => setFilterOpen(true)}
                  onClose={() => setFilterOpen(false)}
                  onClear={() => {
                    setFilterOpen(false)
                    update({ filters: { ...EMPTY_CATALOG_FILTERS }, page: 1, detailId: null })
                  }}
                  onApply={(filters) => {
                    setFilterOpen(false)
                    update({ filters, page: 1, detailId: null })
                  }}
                />
              </div>
              <div className="ml-[18px] flex h-12 w-[300px] shrink-0 items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={t("Поиск")}
                  aria-label={t("Поиск")}
                  className="h-12 w-[262px] bg-transparent text-[13px] outline-none placeholder:text-black/30"
                />
                <svg viewBox="0 0 24 24" className="ml-[12px] h-6 w-6 shrink-0 fill-[#ccc]">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
              </div>
            </>
          )}

          <div className="ml-auto flex shrink-0 items-center text-[#5d6474]">
            <RefPager
              pageSize={state.pageSize}
              onPageSize={(pageSize) => update({ page: 1, pageSize, detailId: null })}
              from={count ? (page - 1) * state.pageSize + 1 : 0}
              to={Math.min(page * state.pageSize, count)}
              total={count}
              page={page}
              pageCount={lastPage}
              onPage={(next) => update({ page: next, detailId: null })}
            />
            <div className="ml-5 flex items-center">
              {hasSelection ? (
                <>
                  <ToolbarIcon path={RI.download} label={t("Скачать")} onClick={() => void download("selected")} />
                  {canEdit && kind === "product" && <ToolbarIcon path={RI.send} color="#666" label={t("Отправить продукты")} onClick={() => setDialog("send")} />}
                  {canEdit && <ToolbarIcon path={HAND} color="#5d6474" label={t("Добавить лимит")} onClick={() => setDialog("limit")} />}
                  {canEdit && <ToolbarIcon path={RI.edit} label={t("Изменить выбранные продукты")} onClick={() => setDialog("bulk")} />}
                  <ToolbarIcon path={MINUS_BOX} label={t("Снять выделение")} onClick={() => setSelected(new Set())} />
                </>
              ) : (
                <>
                  <ToolbarIcon path={selectMode ? EYE_OFF : RI.checklist} color="#5d6474" label={t("Выбрать из списка")} onClick={toggleSelectMode} tooltip={false} />
                  <ToolbarIcon path={RI.download} label={t("Скачать Excel")} onClick={() => void download("all")} />
                </>
              )}
            </div>
          </div>
        </div>

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-[30px] py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f71dc] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto min-[1160px]:overflow-visible ${list.loading ? "opacity-60" : ""}`}>
          <div className="min-w-[1100px]">
            <div className={`grid min-h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold leading-[16.25px] text-white ${gridCols}`}>
              {selectMode && (
                <button
                  type="button"
                  aria-label={t("Выбрать все")}
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current)
                      rows.forEach((row) => (allOnPage ? next.delete(row.id) : next.add(row.id)))
                      return next
                    })
                  }
                  className="-ml-[10px] flex h-6 w-6 items-center justify-center"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={allOnPage ? DONE_ALL : SELECT_ALL} /></svg>
                </button>
              )}
              <div className="px-2">{sortHeader("name", "Наименование")}</div>
              <div className="px-2">{sortHeader("barcode", "Штрих - код товара")}</div>
              <div className="px-2">{sortHeader("vendor_code", "Артикул")}</div>
              <div className="px-2">{sortHeader("type", "Тип товара")}</div>
              <div className="px-2">{sortHeader("division__name", "Организация")}</div>
              <div className="px-2">{t("Мера")}</div>
              <div className="px-2">{sortHeader("created_date", "Дата создания")}</div>
              <div className="px-2">{sortHeader("stock_number", "Порядковый номер")}</div>
              <div />
            </div>

            {rows.map((row) => {
              const open = state.detailId === row.id
              const unit = unitParts(row)
              const isSelected = selected.has(row.id)
              if (open)
                return (
                  <div key={row.id} className="bg-[#f2f5f8] py-5">
                    <CatalogDetailPanel
                      kind={kind}
                      id={row.id}
                      canEdit={canEdit}
                      version={version}
                      onClose={() => update({ detailId: null })}
                      onEdit={(item) => setForm(item)}
                      onDelete={(item, hard) => setConfirm({ action: hard ? "hard" : "delete", id: item.id, name: item.name })}
                      onRestore={(item) => setConfirm({ action: "restore", id: item.id, name: item.name })}
                      onChanged={list.reload}
                      notify={notify}
                    />
                  </div>
                )
              return (
                <Fragment key={row.id}>
                  <div
                    onClick={() => update({ detailId: row.id })}
                    className={`relative grid min-h-[50px] cursor-pointer items-center px-[30px] leading-[16.25px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dotted after:border-[#d6d6d6] text-[#333] hover:bg-[#f2f5f8] ${isSelected ? "bg-[#f2f5f8]" : "bg-white"} ${gridCols}`}
                  >
                    {selectMode && (
                      <button
                        type="button"
                        aria-label={row.name}
                        aria-pressed={isSelected}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggle(row.id)
                        }}
                        className="-ml-[10px] flex h-6 w-6 items-center justify-center"
                      >
                        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${isSelected ? "fill-[#5d6474]" : "fill-[#333]"}`}><path d={isSelected ? CHECK_BOX : CHECK_BOX_BLANK} /></svg>
                      </button>
                    )}
                    <div className="flex items-center px-2">
                      <span className="mr-[15px] flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden">
                        {row.primaryImageId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl(kind, row.id, row.primaryImageId)} alt="" className="h-[30px] w-[27px] object-contain" />
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]"><path d={LANDSCAPE} /></svg>
                        )}
                      </span>
                      <span className="min-w-0 break-words">{row.name}</span>
                    </div>
                    <div className="break-words px-2">{row.barcodes[0] ?? t("не установлен")}</div>
                    <div className="break-words px-2">{row.article || "-"}</div>
                    <div className="px-2">
                      {row.subcategory || row.type || "N/A"}
                      {row.subcategory && row.type && <strong className="block font-semibold">{row.type}</strong>}
                    </div>
                    <div className="px-2">{row.organization || "-"}</div>
                    <div className="px-2">
                      <strong className="font-semibold">{unit.main}</strong>
                      {unit.sub && <span className="block text-[#4f71dc]">{unit.sub}</span>}
                    </div>
                    <div className="px-2">{row.createdDate}</div>
                    <div className="px-2">{row.orderNumber}</div>
                    <div className="flex justify-end px-2">
                      {canEdit && (
                        <RowMenu>
                          {(close) => (
                            <>
                              <button
                                type="button"
                                className={menuItem}
                                onClick={() => {
                                  close()
                                  void openEdit(row.id)
                                }}
                              >
                                <svg viewBox="0 0 24 24" className={menuIcon}><path d={RI.edit} /></svg>
                                {t("Изменить")}
                              </button>
                              {row.deleted ? (
                                <>
                                  <button
                                    type="button"
                                    className={menuItem}
                                    onClick={() => {
                                      close()
                                      setConfirm({ action: "restore", id: row.id, name: row.name })
                                    }}
                                  >
                                    <svg viewBox="0 0 24 24" className={menuIcon}><path d={RI.undo} /></svg>
                                    {t("Восстановить")}
                                  </button>
                                  <button
                                    type="button"
                                    className={menuItem}
                                    onClick={() => {
                                      close()
                                      setConfirm({ action: "hard", id: row.id, name: row.name })
                                    }}
                                  >
                                    <svg viewBox="0 0 24 24" className={menuIcon}><path d={RI.close} /></svg>
                                    {t("Удалить навсегда")}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className={menuItem}
                                  onClick={() => {
                                    close()
                                    setConfirm({ action: "delete", id: row.id, name: row.name })
                                  }}
                                >
                                  <svg viewBox="0 0 24 24" className={menuIcon}><path d={RI.trash} /></svg>
                                  {t("Удалить")}
                                </button>
                              )}
                            </>
                          )}
                        </RowMenu>
                      )}
                    </div>
                  </div>
                </Fragment>
              )
            })}

            {!rows.length && (
              <div className="flex h-[276.3px] flex-col items-center pt-[57px]">
                {list.loading || list.error ? (
                  <p className="mt-[100px] text-[13px] leading-[16.25px] text-[#666]">{list.loading ? t("Загрузка...") : ""}</p>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/robot-empty.png" alt="" className="h-[162px] w-[162px] object-contain" />
                    <p className="mt-[11px] text-[13px] leading-[16.25px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {form !== undefined && (
        <CatalogFormDialog
          kind={kind}
          item={form}
          options={options.data}
          onClose={() => setForm(undefined)}
          onSaved={(id, created) => {
            setForm(undefined)
            notify(t("Успешно сохранено"))
            options.reload()
            refresh()
            if (created) update({ detailId: id })
          }}
        />
      )}
      {importMode && (
        <CatalogImportDialog
          kind={kind}
          mode={importMode}
          onTemplate={async () => {
            if (importMode === "create") return downloadImportTemplate(kind, options.data, t)
            try {
              downloadUpdateSheet(kind, await fetchAll(), options.data, t)
            } catch (reason) {
              notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
            }
          }}
          onClose={() => setImportMode(null)}
          onDone={() => {
            notify(t(importMode === "create" ? "Продукты успешно добавлены" : "Успешно сохранено"))
            setImportMode(null)
            options.reload()
            refresh()
          }}
        />
      )}
      {dialog === "bulk" && (
        <BulkEditDialog
          kind={kind}
          ids={[...selected]}
          options={options.data}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setSelected(new Set())
            notify(t("Успешно сохранено"))
            options.reload()
            refresh()
          }}
        />
      )}
      {dialog === "send" && (
        <SendProductsDialog
          ids={[...selected]}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            notify(t("Успешно сохранено"))
          }}
        />
      )}
      {dialog === "limit" && (
        <AddLimitDialog
          kind={kind}
          ids={[...selected]}
          options={options.data}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            notify(t("Успешно сохранено"))
            refresh()
          }}
        />
      )}
      {confirm && confirm.action === "delete" && !confirm.usage && (
        <ConfirmDeleteDialog name={confirm.name} busy={busy} error={confirm.error} onConfirm={() => void runConfirm()} onClose={() => setConfirm(null)} />
      )}
      {confirm && (confirm.action !== "delete" || confirm.usage) && (
        <ConfirmDialog
          title={confirmTitle}
          text={confirmText}
          confirmLabel={confirm.action === "restore" ? "Восстановить" : "Удалить"}
          tone={confirm.action === "restore" ? "blue" : "red"}
          busy={busy}
          error={confirm.usage ? undefined : confirm.error}
          onConfirm={() => void runConfirm()}
          onClose={() => setConfirm(null)}
        >
          {confirm.action === "hard" && !confirm.error && <p className="mt-2 text-[13px] text-[#586174]">{t("Удалить можно только то, что нигде не используется.")}</p>}
          {confirm.usage && confirm.usage.length > 0 && (
            <>
              <p className="mt-3 text-[14px] font-semibold text-[#e57373]">{confirm.error}</p>
              <UsageList usage={confirm.usage} t={t} />
            </>
          )}
        </ConfirmDialog>
      )}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </RefPage>
  )
}
