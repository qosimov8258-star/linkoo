"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { BarChart3, Download, Image as ImageIcon, ListChecks, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, ConfirmDialog, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { AddLimitDialog, BulkEditDialog } from "@/components/products/catalog-bulk"
import { CatalogDetailPanel } from "@/components/products/catalog-detail"
import { CatalogImportDialog, catalogListSheet, downloadImportTemplate, downloadUpdateSheet } from "@/components/products/catalog-excel"
import { CatalogFilterBar } from "@/components/products/catalog-filter"
import { CatalogFormDialog } from "@/components/products/catalog-form"
import { KIND_TEXT, RowMenu, SortIcon, UsageList, catalogMutate, errorText, imageUrl, unitParts } from "@/components/products/catalog-shared"
import { EMPTY_CATALOG_FILTERS, PAGE_SIZES, listUrl, stateFromParams, stateToSearch, type CatalogViewState } from "@/components/products/catalog-state"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
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

type Confirm = { action: "delete" | "hard" | "restore"; id: number; name: string; usage?: CatalogUsage[]; error?: string } | null

export function CatalogView({ kind }: { kind: CatalogKind }) {
  const { t } = useLanguage()
  const text = KIND_TEXT[kind]
  const api = CATALOG_API[kind]
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<CatalogViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString()), kind))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [form, setForm] = useState<CatalogDetail | null | undefined>(undefined)
  const [importMode, setImportMode] = useState<CatalogImportMode | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<"bulk" | "limit" | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const list = useCashJson<CatalogListResult>(listUrl(kind, state))
  const options = useCashJson<CatalogOptions>(`${api}/options`)
  const rows = list.data?.results ?? []
  const count = list.data?.count ?? 0
  const tabs = kind === "product" ? PRODUCT_TABS : RAW_TABS

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
  }, [state])

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

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [menuOpen])

  const update = (patch: Partial<CatalogViewState>) => setState((current) => ({ ...current, ...patch }))
  const notify = useCallback((value: string, error = false) => setMessage({ text: value, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const refresh = () => {
    list.reload()
    setVersion((value) => value + 1)
  }

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const sortHeader = (key: string, label: string) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {t(label)}
      <SortIcon ordering={state.ordering} sortKey={key} />
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
    setMenuOpen(false)
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

  const runConfirm = async () => {
    if (!confirm) return
    setBusy(true)
    const result =
      confirm.action === "restore"
        ? await catalogMutate("POST", `${api}/${confirm.id}/restore`)
        : await catalogMutate("DELETE", `${api}/${confirm.id}?mode=${confirm.action === "hard" ? "hard" : "soft"}`)
    setBusy(false)
    if (!result.ok) {
      if (result.status === 409 && result.stock?.length) {
        // Still in stock: the warehouses and quantities that block the delete.
        const usage = result.stock.map((line) => ({ table: `stock:${line.warehouse}`, label: line.warehouse, count: line.qty }))
        return setConfirm({ ...confirm, error: errorText(result, t), usage })
      }
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

  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-2.5 align-middle"
  const menuItem = "flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8]"
  const headerButton = "inline-flex h-[34px] items-center gap-1.5 rounded-sm px-4 text-[14px] font-semibold text-white shadow-sm hover:brightness-95"
  const iconButton = "flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:opacity-40"
  const confirmTitle = confirm ? t(confirm.action === "restore" ? "Восстановить" : confirm.action === "hard" ? "Удалить навсегда" : "Удалить") : ""
  const confirmText = confirm ? (confirm.action === "restore" ? t(text.restore).replace("{name}", confirm.name) : confirm.name) : ""

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t(text.title)}</h1>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => setImportMode("create")} className={`${headerButton} bg-[rgb(79,113,220)]`}>
              <BarChart3 className="h-[18px] w-[18px]" /> {t("Импортировать")}
            </button>
            <button type="button" onClick={() => setImportMode("update")} className={`${headerButton} bg-[rgb(79,113,220)]`}>
              <BarChart3 className="h-[18px] w-[18px]" /> {t("Обновить с excel")}
            </button>
            <button type="button" onClick={() => setForm(null)} title={t(text.add)} className={`${headerButton} bg-[#71ce87]`}>
              <Plus className="h-[18px] w-[18px]" /> {t("Добавить")}
            </button>
          </div>
        )}
      </header>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="flex overflow-x-auto border-b border-[#e1e5eb]">
          {tabs.map((tab) => (
            <button
              key={tab.value || "all"}
              type="button"
              onClick={() => {
                setSelected(new Set())
                update({ tab: tab.value, page: 1, detailId: null })
              }}
              className={`h-10 min-w-[140px] flex-1 whitespace-nowrap border-b-[3px] px-4 text-[14px] ${state.tab === tab.value ? "border-[rgb(79,113,220)] font-semibold text-[rgb(79,113,220)]" : "border-transparent text-[#333] hover:bg-[#f7f9fb]"}`}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
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
          <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[340px]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.size > 0 && canEdit && (
              <>
                <button type="button" onClick={() => setSelected(new Set())} className="text-[13px] text-[#586174] hover:underline">
                  {t("Выбрано")}: {selected.size} ✕
                </button>
                <button type="button" onClick={() => setDialog("limit")} title={t("Добавить лимит")} aria-label={t("Добавить лимит")} className={iconButton}>
                  <ListChecks className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDialog("bulk")}
                  title={t("Изменить выбранные продукты")}
                  aria-label={t("Изменить выбранные продукты")}
                  className={iconButton}
                >
                  <Pencil className="h-5 w-5" />
                </button>
              </>
            )}
            <BalancePagination
              page={state.page}
              pageSize={state.pageSize}
              count={count}
              sizes={PAGE_SIZES}
              onChange={({ page, pageSize }) => update({ page, pageSize, detailId: null })}
            />
            <button type="button" onClick={refresh} title={t("Обновить список")} aria-label={t("Обновить список")} className={iconButton}>
              <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
            </button>
            <div ref={menuRef} className="relative">
              <button type="button" onClick={() => setMenuOpen((open) => !open)} title={t("Скачать")} aria-label={t("Скачать")} className={iconButton}>
                <Download className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-[40] mt-1 min-w-[220px] rounded-md border border-[#e1e5eb] bg-white py-2 shadow-lg">
                  <button type="button" className={menuItem} onClick={() => void download("selected")}>
                    {t(text.selected)} ({selected.size})
                  </button>
                  <button type="button" className={menuItem} onClick={() => void download("all")}>
                    {t("Скачать все")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto ${list.loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[1100px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb]">
                <th className="w-10 pl-6">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    aria-label={t("Выбрать все")}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current)
                        rows.forEach((row) => (allOnPage ? next.delete(row.id) : next.add(row.id)))
                        return next
                      })
                    }
                    className="h-4 w-4 accent-[rgb(79,113,220)]"
                  />
                </th>
                <th className={`${th} w-[25%]`}>{sortHeader("name", "Наименование")}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("barcode", "Штрих - код товара")}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("vendor_code", "Артикул")}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("type", "Тип товара")}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("division__name", "Организация")}</th>
                <th className={`${th} w-[10%]`}>{t("Мера")}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("created_date", "Дата создания")}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("stock_number", "Порядковый номер")}</th>
                <th className="w-12 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                const unit = unitParts(row)
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => update({ detailId: open ? null : row.id })}
                      className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}
                    >
                      <td className="pl-6" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={row.name} className="h-4 w-4 accent-[rgb(79,113,220)]" />
                      </td>
                      <td className={td}>
                        <span className="flex items-center gap-3">
                          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded">
                            {row.primaryImageId ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={imageUrl(kind, row.id, row.primaryImageId)} alt="" className="h-[30px] w-[30px] object-cover" />
                            ) : (
                              <ImageIcon className="h-5 w-5 text-[#999]" />
                            )}
                          </span>
                          <span className="break-words">{row.name}</span>
                        </span>
                      </td>
                      <td className={td}>{row.barcodes[0] ?? t("не установлен")}</td>
                      <td className={td}>{row.article || "-"}</td>
                      <td className={td}>
                        {row.subcategory || row.type || "N/A"}
                        {row.subcategory && row.type && <strong className="block">{row.type}</strong>}
                      </td>
                      <td className={td}>{row.organization || "-"}</td>
                      <td className={td}>
                        <strong>{unit.main}</strong>
                        {unit.sub && <span className="block text-[rgb(79,113,220)]">{unit.sub}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{row.createdDate}</td>
                      <td className={td}>{row.orderNumber}</td>
                      <td className="pr-4 text-right">
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
                                  <Pencil className="h-4 w-4" /> {t("Изменить")}
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
                                      <RotateCcw className="h-4 w-4" /> {t("Восстановить")}
                                    </button>
                                    <button
                                      type="button"
                                      className={menuItem}
                                      onClick={() => {
                                        close()
                                        setConfirm({ action: "hard", id: row.id, name: row.name })
                                      }}
                                    >
                                      <X className="h-4 w-4" /> {t("Удалить навсегда")}
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
                                    <Trash2 className="h-4 w-4" /> {t("Удалить")}
                                  </button>
                                )}
                              </>
                            )}
                          </RowMenu>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={10} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
      {confirm && (
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
    </main>
  )
}
