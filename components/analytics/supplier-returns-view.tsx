"use client"

import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  ListChecks,
  ListPlus,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, ReactElement, useEffect, useMemo, useRef, useState } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { returnBranches as branches, returnPaymentTypes as paymentTypes, type ReturnStatus as Status, type SupplierReturn } from "./supplier-returns-data"

const ITEM_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "название": "product", "product": "product", "name": "product",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty",
  "серия": "series", "номер серии": "series", "series": "series",
  "цена": "cost", "стоимость": "cost", "сумма": "cost", "сумма за единицу": "cost", "цена за единицу": "cost", "cost": "cost", "price": "cost", "unit price": "cost",
}

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} SUM`
}

const statusIcon: Record<Status, ReactElement> = {
  завершен: <CheckCheck className="h-5 w-5 text-emerald-500" />,
  "в процессе": <Clock className="h-5 w-5 text-amber-500" />,
  отменен: <XCircle className="h-5 w-5 text-rose-500" />,
}

type DraftItem = { id: number; product: string; qty: number; series: string; price: number }

function formatToday() {
  const date = new Date()
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
}

function emptyDraft() {
  return {
    supplier: "",
    warehouse: "",
    organization: "",
    branch: branches[0],
    currency: "SUM",
    priceList: "",
    paymentType: paymentTypes[0],
    date: formatToday(),
    comment: "",
  }
}

export function SupplierReturnsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<SupplierReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterActive, setFilterActive] = useState(true)
  const [filterEditorOpen, setFilterEditorOpen] = useState(false)
  const [includedStatuses, setIncludedStatuses] = useState<Status[]>(["завершен", "в процессе"])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<string[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [priceListOptions, setPriceListOptions] = useState<string[]>([])
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false)
  const [quickAddWarehouseOpen, setQuickAddWarehouseOpen] = useState(false)
  const [quickAddOrganizationOpen, setQuickAddOrganizationOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/supplier-returns")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as SupplierReturn[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить возвраты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [suppliersRes, warehousesRes, organizationsRes, priceListsRes, categoriesRes, productsRes] = await Promise.all([
        fetch("/api/suppliers").catch(() => null),
        fetch("/api/warehouses").catch(() => null),
        fetch("/api/organizations").catch(() => null),
        fetch("/api/price-lists").catch(() => null),
        fetch("/api/supplier-categories").catch(() => null),
        fetch("/api/products").catch(() => null),
      ])
      if (cancelled) return
      if (suppliersRes?.ok) setSupplierOptions(((await suppliersRes.json()) as { name: string }[]).map((item) => item.name))
      if (warehousesRes?.ok) setWarehouseOptions(((await warehousesRes.json()) as { name: string }[]).map((item) => item.name))
      if (organizationsRes?.ok) setOrganizationOptions(((await organizationsRes.json()) as { name: string }[]).map((item) => item.name))
      if (priceListsRes?.ok) setPriceListOptions(((await priceListsRes.json()) as { name: string }[]).map((item) => item.name))
      if (categoriesRes?.ok) setCategoryOptions(((await categoriesRes.json()) as { name: string }[]).map((item) => item.name))
      if (productsRes?.ok) {
        const data = (await productsRes.json()) as { name: string }[]
        setProductOptions(Array.from(new Set(data.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      }
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.fromWhom.toLowerCase().includes(query.toLowerCase()) && !String(row.id).includes(query)) return false
      if (filterActive && !includedStatuses.includes(row.status)) return false
      return true
    })
  }, [rows, query, filterActive, includedStatuses])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: SupplierReturn) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function toggleStatus(status: Status) {
    setIncludedStatuses((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]))
  }

  function openCreate() {
    setDraft(emptyDraft())
    setDraftItems([])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: SupplierReturn) {
    setDraft({
      supplier: row.fromWhom,
      warehouse: row.warehouse,
      organization: row.organization,
      branch: row.branch,
      currency: row.currency || "SUM",
      priceList: row.priceList,
      paymentType: row.paymentType,
      date: row.date,
      comment: row.reason,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, series: item.series, price: item.price })))
    setEditingId(row.id)
    setModalOpen(true)
  }

  async function removeRow(row: SupplierReturn) {
    if (!window.confirm(`${t("Удалить возврат №")} ${row.id}?`)) return
    try {
      const response = await fetch(`/api/supplier-returns/${row.id}`, { method: "DELETE" })
      if (!response.ok) return
      setRows((current) => current.filter((item) => item.id !== row.id))
      if (expandedId === row.id) setExpandedId(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: productOptions[0] ?? "", qty: 1, series: "", price: 0 }])
  }

  function addFromList(product: string) {
    setDraftItems((current) => {
      if (current.some((item) => item.product === product)) return current
      return [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product, qty: 1, series: "", price: 0 }]
    })
  }

  function updateDraftItem(id: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeDraftItem(id: number) {
    setDraftItems((current) => current.filter((item) => item.id !== id))
  }

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      if (!rows.length) return

      const fieldByIndex = mapHeaderColumns(rows[0], ITEM_IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("product")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: DraftItem[] = []
      let nextId = Math.max(0, ...draftItems.map((item) => item.id)) + 1
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.product = row[0] ?? ""
          record.qty = row[1] ?? ""
          record.cost = row[3] ?? ""
        }
        const product = record.product
        if (!product || /^(товар|product|наименование|название)$/i.test(product)) continue
        parsed.push({ id: nextId++, product, qty: Number(record.qty) || 1, series: record.series || "", price: Number(record.cost) || 0 })
      }
      if (parsed.length) setDraftItems((current) => [...current, ...parsed])
    })()
  }

  const draftTotalCost = draftItems.reduce((sum, item) => sum + item.qty * item.price, 0)
  const draftTotalQty = draftItems.reduce((sum, item) => sum + item.qty, 0)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.supplier || !draft.warehouse || !draftItems.length) return
    const items = draftItems.map((item) => ({
      id: item.id,
      product: item.product,
      qty: item.qty,
      series: item.series,
      price: item.price,
    }))
    const body = {
      fromWhom: draft.supplier,
      warehouse: draft.warehouse,
      organization: draft.organization,
      branch: draft.branch,
      currency: draft.currency,
      priceList: draft.priceList,
      paymentType: draft.paymentType,
      date: draft.date,
      comment: draft.comment,
      items,
    }
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/supplier-returns/${editingId}` : "/api/supplier-returns", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить возврат"))
        return
      }
      const saved = (await response.json()) as SupplierReturn
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadList() {
    downloadExcelTable("vozvrat-postavshikam", [
      [t("№"), t("От кого"), t("Склад"), t("Добавил"), t("Дата возврата"), t("Сумма возврата"), t("Статус")],
      ...filtered.map((row) => [row.id, row.fromWhom, row.warehouse, row.addedBy, `${row.date}, ${row.time}`, row.amount, row.status]),
    ])
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> {t("Возврат поставщиков")}
          </h1>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> {t("Добавить")}
          </button>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          {filterActive ? (
            <div className="flex items-center gap-2 text-slate-600">
              <span>{t("Фильтр:")} {includedStatuses.length} {t("элемента")}</span>
              <button type="button" onClick={() => setFilterEditorOpen(true)} aria-label={t("Изменить фильтр")} className="text-slate-400 hover:text-[#4f70e7]">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setFilterActive(false)} aria-label={t("Очистить фильтр")} className="text-slate-400 hover:text-rose-500">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setFilterActive(true); setFilterEditorOpen(true) }} className="text-[#4f70e7] hover:underline">
              {t("Показать фильтр")}
            </button>
          )}

          <label className="relative ml-2 w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <ListChecks className="h-5 w-5 text-slate-400" />
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="text-slate-500 hover:text-[#4f70e7]">
            <Download className="h-5 w-5" />
          </button>
          {embedded && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> {t("Добавить")}
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">{t("№")}</th>
              <th className="px-5 py-5">{t("От кого")}</th>
              <th className="px-5 py-5">{t("Склад")}</th>
              <th className="px-5 py-5">{t("Добавил")}</th>
              <th className="px-5 py-5">{t("Дата возврата")}</th>
              <th className="px-5 py-5">{t("Сумма возврата")}</th>
              <th className="px-5 py-5">{t("Статус")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                {expandedId !== row.id && (
                  <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                    <td className="px-9 py-4">{row.id}</td>
                    <td className="px-5 py-4 text-[#4f70e7]">{row.fromWhom}</td>
                    <td className="px-5 py-4">{row.warehouse}</td>
                    <td className="px-5 py-4">{row.addedBy}</td>
                    <td className="px-5 py-4">{row.date}, {row.time}</td>
                    <td className="px-5 py-4">{formatMoney(row.amount)}</td>
                    <td className="px-5 py-4">{statusIcon[row.status]}</td>
                  </tr>
                )}

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={7} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">{t("Возврат поставщику №")}{row.id}</h2>
                          <div className="flex items-center gap-4 text-slate-500">
                            <button type="button" onClick={() => window.print()} aria-label={t("Печать")} className="hover:text-[#4f70e7]">
                              <Printer className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => openEdit(row)} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => removeRow(row)} aria-label={t("Удалить")} className="hover:text-rose-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => toggleExpand(row)} aria-label={t("Свернуть")} className="hover:text-[#4f70e7]">
                              <X className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-6 sm:grid-cols-[1fr_2fr]">
                          <div>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Добавил:")}</dt><dd className="font-medium">{row.addedBy}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Поставщик:")}</dt><dd className="font-medium">{row.fromWhom}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Организация:")}</dt><dd className="font-medium">{row.organization}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Валюта:")}</dt><dd className="font-medium">{row.currency}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Тип оплаты:")}</dt><dd className="font-medium">{row.paymentType}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Прайс лист:")}</dt><dd className="font-medium">{row.priceList}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Дата возврата:")}</dt><dd className="font-medium">{row.date}, {row.time}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Филиал:")}</dt><dd className="font-medium">{row.branch}</dd></div>
                            </dl>

                            <p className="mb-2 mt-5 font-bold uppercase tracking-wide text-slate-700">{t("Склад")}</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Склад:")}</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Время передачи:")}</dt><dd className="font-medium">{row.transferTime}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Передал:")}</dt><dd className="font-medium">{row.addedBy}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Статус:")}</dt><dd className="font-medium text-emerald-500">{row.status === "завершен" ? t("Завершен") : row.status === "в процессе" ? t("В процессе") : t("Отменен")}</dd></div>
                            </dl>

                            <p className="mb-1 mt-5 font-bold uppercase tracking-wide text-slate-700">{t("Причина возврата:")}</p>
                            <p className="text-sm text-slate-500">{row.reason || " "}</p>
                          </div>

                          <div>
                            <div className="mb-3 border-b border-slate-200">
                              <span className="inline-block border-b-2 border-[#4f70e7] pb-2 text-sm font-medium text-[#4f70e7]">{t("Список товаров")}</span>
                            </div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">{t("№")}</th>
                                  <th className="py-2 pr-4">{t("Товар")}</th>
                                  <th className="py-2 pr-4">{t("Количество")}</th>
                                  <th className="py-2 pr-4">{t("Серия")}</th>
                                  <th className="py-2 pr-4">{t("Цена (SUM)")}</th>
                                  <th className="py-2 pr-4">{t("Сумма (SUM)")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item) => (
                                  <tr key={item.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{item.id}</td>
                                    <td className="py-2 pr-4">{item.product}</td>
                                    <td className="py-2 pr-4">{item.qty}</td>
                                    <td className="py-2 pr-4">{item.series || "—"}</td>
                                    <td className="py-2 pr-4">{item.price.toLocaleString("ru-RU")}</td>
                                    <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-300 font-bold">
                                  <td className="py-2 pr-4" colSpan={2}>{t("Итого:")}</td>
                                  <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.qty, 0)}</td>
                                  <td className="py-2 pr-4" />
                                  <td className="py-2 pr-4" />
                                  <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.total, 0).toLocaleString("ru-RU")}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <FileSpreadsheet className="h-14 w-14 text-slate-300" />
            <p className="text-lg text-slate-400">{t(loadError) || t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {filterEditorOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xs rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Фильтр по статусу")}</b>
              <button type="button" onClick={() => setFilterEditorOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2 text-sm">
              {(["завершен", "в процессе", "отменен"] as Status[]).map((status) => (
                <label key={status} className="flex items-center gap-2">
                  <input type="checkbox" checked={includedStatuses.includes(status)} onChange={() => toggleStatus(status)} />
                  {t(status)}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setFilterEditorOpen(false)} className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">{t("Применить")}</button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? `${t("Изменить возврат №")}${editingId}` : t("Возврат поставщика")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid gap-8 sm:grid-cols-[1fr_1.4fr]">
                <div className="space-y-4">
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Поставщик")} *
                      <select value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">{t("Выберите...")}</option>
                        {supplierOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddSupplierOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {supplierOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет поставщиков — нажмите «+добавить»")}</p>}
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Склад назначения")} *
                      <select value={draft.warehouse} onChange={(event) => setDraft((value) => ({ ...value, warehouse: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">{t("Выберите...")}</option>
                        {warehouseOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddWarehouseOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {warehouseOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет складов — нажмите «+добавить»")}</p>}
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Организация")} *
                      <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">{t("Выберите...")}</option>
                        {organizationOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddOrganizationOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {organizationOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет организаций — нажмите «+добавить»")}</p>}
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Филиал")} *
                    <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {branches.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Валюта")} *
                    <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option>SUM</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Прайс лист")}
                    <select value={draft.priceList} onChange={(event) => setDraft((value) => ({ ...value, priceList: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">{t("Выберите...")}</option>
                      {priceListOptions.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Тип оплаты")} *
                    <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {paymentTypes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Дата создания")} *
                    <input value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block font-medium">
                    {t("Оставить комментарий...")}
                    <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={2} className="mt-2 block w-full resize-none border-b border-slate-200 outline-none" />
                  </label>
                </div>

                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-slate-800">{t("Список товаров")}</p>
                    {draft.supplier && (
                      <div className="flex items-center gap-4 text-sm">
                        <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                          <Plus className="h-4 w-4" /> {t("добавить товар")}
                        </button>
                        <button type="button" onClick={() => { setPickerQuery(""); setPickerOpen(true) }} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                          <ListPlus className="h-4 w-4" /> {t("добавить из списка")}
                        </button>
                        <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-[#4f70e7] hover:bg-slate-200">
                          <Upload className="h-4 w-4" /> {t("импортировать с excel")}
                        </button>
                        <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />
                      </div>
                    )}
                  </div>

                  {!draft.supplier ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-16 text-slate-400">
                      <FileSpreadsheet className="h-12 w-12" />
                      <p>{t("Для добавления товаров выберите клиента.")}</p>
                    </div>
                  ) : draftItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-16 text-slate-400">
                      <FileSpreadsheet className="h-12 w-12" />
                      <p>
                        {t("Вы еще не выбрали ни одного товара.")}{" "}
                        <button type="button" onClick={addBlankItem} className="text-[#4f70e7] hover:underline">
                          {t("Добавить товар?")}
                        </button>
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="py-2 pr-4">{t("Товар")}</th>
                          <th className="py-2 pr-4">{t("Кол-во")}</th>
                          <th className="py-2 pr-4">{t("Серия")}</th>
                          <th className="py-2 pr-4">{t("Цена")}</th>
                          <th className="py-2 pr-4">{t("Сумма")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {draftItems.map((item) => (
                          <tr key={item.id} className="border-t border-slate-100">
                            <td className="py-2 pr-4">
                              <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value })} className="bg-white outline-none">
                                {(productOptions.includes(item.product) ? productOptions : [item.product, ...productOptions]).map((product) => (
                                  <option key={product}>{product}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pr-4">
                              <input type="number" min={0} step="any" value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-16 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">
                              <input value={item.series} onChange={(event) => updateDraftItem(item.id, { series: event.target.value })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">
                              <input type="number" min={0} step="any" value={item.price} onChange={(event) => updateDraftItem(item.id, { price: Number(event.target.value) })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">{(item.qty * item.price).toLocaleString("ru-RU")}</td>
                            <td className="py-2 pr-4 text-right">
                              <button type="button" onClick={() => removeDraftItem(item.id)} aria-label={t("Удалить")} className="text-slate-400 hover:text-rose-500">
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-between border-t p-5">
              <div className="text-sm text-slate-600">
                {t("Общая стоимость:")} <b>{draftTotalCost.toLocaleString("ru-RU")}</b> &nbsp; {t("Общее кол-во:")} <b>{draftTotalQty} {t("ед")}</b>
              </div>
              <button type="submit" className="font-bold uppercase text-sky-500">
                {t("Оформить")}
              </button>
            </footer>
          </form>
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Добавить из списка")}</b>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <input
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              placeholder={t("Поиск товара...")}
              className="mb-3 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f70e7]"
            />
            <div className="space-y-2 overflow-y-auto">
              {productOptions.length === 0 && <p className="text-sm text-slate-400">{t("Каталог продуктов пуст")}</p>}
              {productOptions
                .filter((product) => !pickerQuery.trim() || product.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
                .slice(0, 200)
                .map((product) => (
                  <label key={product} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draftItems.some((item) => item.product === product)} onChange={() => addFromList(product)} />
                    {product}
                  </label>
                ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">{t("Готово")}</button>
            </div>
          </div>
        </div>
      )}

      {quickAddSupplierOpen && (
        <QuickAddSupplierModal
          categoryOptions={categoryOptions}
          onClose={() => setQuickAddSupplierOpen(false)}
          onCreated={(name) => {
            setSupplierOptions((current) => (current.includes(name) ? current : [name, ...current]))
            setDraft((value) => ({ ...value, supplier: name }))
            setQuickAddSupplierOpen(false)
          }}
        />
      )}

      {quickAddWarehouseOpen && (
        <QuickAddWarehouseModal
          onClose={() => setQuickAddWarehouseOpen(false)}
          onCreated={(name) => {
            setWarehouseOptions((current) => (current.includes(name) ? current : [name, ...current]))
            setDraft((value) => ({ ...value, warehouse: name }))
            setQuickAddWarehouseOpen(false)
          }}
        />
      )}

      {quickAddOrganizationOpen && (
        <QuickAddOrganizationModal
          onClose={() => setQuickAddOrganizationOpen(false)}
          onCreated={(name) => {
            setOrganizationOptions((current) => (current.includes(name) ? current : [name, ...current]))
            setDraft((value) => ({ ...value, organization: name }))
            setQuickAddOrganizationOpen(false)
          }}
        />
      )}
    </main>
  )
}

function QuickAddSupplierModal({
  categoryOptions,
  onClose,
  onCreated,
}: {
  categoryOptions: string[]
  onClose: () => void
  onCreated: (name: string) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [address, setAddress] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!name.trim() || !category.trim() || !address.trim()) return
    setSaving(true)
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), category: category.trim(), address: address.trim() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось создать поставщика"))
        return
      }
      const created = (await response.json()) as { name: string }
      onCreated(created.name)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <b className="uppercase">{t("Новый поставщик")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Наименование")} *
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full outline-none" />
            {touched && !name.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Категория")} *
            <input value={category} onChange={(event) => setCategory(event.target.value)} list="quick-add-return-supplier-categories" className="mt-2 block w-full outline-none" />
            <datalist id="quick-add-return-supplier-categories">
              {categoryOptions.map((item) => <option key={item} value={item} />)}
            </datalist>
            {touched && !category.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Адрес")} *
            <input value={address} onChange={(event) => setAddress(event.target.value)} className="mt-2 block w-full outline-none" />
            {touched && !address.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </div>
      </form>
    </div>
  )
}

function QuickAddWarehouseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!name.trim() || !address.trim()) return
    setSaving(true)
    try {
      const response = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), address: address.trim(), branch: "", manager: "", online: false }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось создать склад"))
        return
      }
      const created = (await response.json()) as { name: string }
      onCreated(created.name)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <b className="uppercase">{t("Новый склад")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Наименование")} *
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full outline-none" />
            {touched && !name.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Адрес")} *
            <input value={address} onChange={(event) => setAddress(event.target.value)} className="mt-2 block w-full outline-none" />
            {touched && !address.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </div>
      </form>
    </div>
  )
}

function QuickAddOrganizationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!name.trim()) return
    setSaving(true)
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось создать организацию"))
        return
      }
      const created = (await response.json()) as { name: string }
      onCreated(created.name)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <b className="uppercase">{t("Новая организация")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Наименование")} *
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full outline-none" />
            {touched && !name.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </div>
      </form>
    </div>
  )
}
