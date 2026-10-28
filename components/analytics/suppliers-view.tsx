"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useEffect, useMemo, useState } from "react"

import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { useCurrencyCodes } from "./supplier-incoming-dialogs"
import { SupplierFormModal } from "./supplier-form-modal"
import { SupplierReserveDialog } from "./supplier-reserve-dialog"
import type { Supplier } from "./suppliers-data"
import { notify } from "@/lib/notify"

export function SuppliersView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const currencies = useCurrencyCodes()
  const [rows, setRows] = useState<Supplier[]>([])
  const [reserveTarget, setReserveTarget] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/suppliers")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Supplier[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить поставщиков с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) || String(row.id).includes(query)),
    [rows, query],
  )
  const paging = usePaging(filtered.length)
  const visible = filtered.slice(paging.start, paging.end)

  function toggleExpand(row: Supplier) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function openCreate() {
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: Supplier) {
    setEditingId(row.id)
    setModalOpen(true)
  }

  async function removeRow(row: Supplier) {
    if (!(await askDelete(row.name))) return
    try {
      const response = await fetch(`/api/suppliers/${row.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        notify(data.error ? t(data.error) : t("Не удалось удалить поставщика"))
        return
      }
      setRows((current) => current.filter((item) => item.id !== row.id))
      if (expandedId === row.id) setExpandedId(null)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function removeReserve(row: Supplier, rowId: number) {
    if (!(await askDelete())) return
    try {
      const response = await fetch(`/api/suppliers/${row.id}/reserve/${rowId}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось удалить запись"))
        return
      }
      setRows((current) => current.map((item) => (item.id === row.id ? (data as Supplier) : item)))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadList() {
    downloadExcelTable("postavshiki", [
      ["Id", t("Наименование"), t("Категория"), t("Дата создания")],
      ...filtered.map((row) => [row.id, row.name, row.category, formatDateText(row.createdDate, language)]),
    ])
  }

  const iconButton = (path: string, label: string, onClick: () => void, extra = "") => (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`flex h-6 w-6 items-center justify-center ${extra}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={path} /></svg>
    </button>
  )

  const content = (
    <>
      {!embedded && (
        <RefHeader title={t("Поставщики")}>
          <RefButton green icon={RI.add} label={t("Добавить")} onClick={openCreate} />
        </RefHeader>
      )}
      <RefCard>
        <RefToolbar
          hideFilter
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filtered.length ? paging.start + 1 : 0}
          to={paging.end}
          total={filtered.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={
            <button type="button" title={t("Скачать Excel")} aria-label={t("Скачать")} onClick={downloadList} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.download} /></svg>
            </button>
          }
          extra={embedded ? <RefButton green icon={RI.add} label={t("Добавить")} onClick={openCreate} /> : undefined}
        />
        <RefTable
          cols="97fr 380fr 230fr 200fr"
          heads={["Id", t("Наименование"), t("Категория"), t("Дата создания")]}
          rows={visible}
          rowKey={(row) => row.id}
          onRowClick={toggleExpand}
          rowClass={(row) => (expandedId === row.id ? "hidden" : "")}
          empty={loading ? t("Загрузка поставщиков...") : t(loadError) || t("По вашему запросу ничего не найдено")}
          render={(row) => [row.id, row.name, row.category, formatDateText(row.createdDate, language)]}
          expanded={(row) => {
            if (expandedId !== row.id) return null
            return (
              <div className="-mx-[15px] mb-[14px] mt-[20px] bg-white text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                <div className="flex h-[65px] items-center justify-between border-b border-[#e0e0e0] pl-[30px] pr-[43px]">
                  <h2 className="text-[18px] font-normal leading-[24px] text-[#333]">{row.name}</h2>
                  <div className="flex items-center gap-[10px]">
                    {iconButton("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z", t("Добавить продукт"), () => setReserveTarget(row))}
                    {iconButton(RI.edit, t("Изменить"), () => openEdit(row), "ml-[24px]")}
                    {iconButton(RI.trash, t("Удалить"), () => removeRow(row), "ml-[24px]")}
                  </div>
                </div>
                <div className="grid grid-cols-[408px_1fr]">
                  <div className="border-r border-[#e0e0e0] px-[30px] pb-[20px] pt-[15px] leading-[25px]">
                    <dl>
                      <div className="flex justify-between gap-4"><dt className="font-semibold">{t("Адрес")}</dt><dd>{row.address}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="font-semibold">{t("Категория")}</dt><dd>{row.category}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="font-semibold">{t("Филиал")}</dt><dd>{t(row.branch)}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="font-semibold">{t("Организация")}</dt><dd>{t(row.organization)}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="font-semibold">{t("Дата добавления")}</dt><dd>{formatDateText(row.createdDate, language)}</dd></div>
                    </dl>
                    <p className="mt-[24px] font-semibold">{t("Контакты")}</p>
                    {row.contacts.length === 0 && <p className="text-[#666]">{t("Не указано")}</p>}
                    {row.contacts.map((contact) => (
                      <div key={contact.id} className="flex justify-between gap-4">
                        <span>{contact.name}</span>
                        <span>{contact.phone}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-[30px] pt-[14px]">
                    <div className="grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_40px] items-center pb-[12px] font-semibold">
                      <span>{t("Продукт")}</span><span>{t("Кол-во")}</span><span>{t("Цена")}</span><span>{t("Сумма")}</span><span />
                    </div>
                    <div className="border-t border-dotted border-[#cfd6dc]">
                      {row.products.map((product) => (
                        <div key={product.id} className="grid min-h-[50px] grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_40px] items-center border-b border-dotted border-[#cfd6dc]">
                          <span>{product.product}</span>
                          <span>{product.qty.toLocaleString("ru-RU")}</span>
                          <span>{formatMoney(product.price, 2)} {product.currency || currencies.base}</span>
                          <span>{formatMoney(product.qty * product.price, 2)} {product.currency || currencies.base}</span>
                          <span className="text-right">{iconButton(RI.trash, t("Удалить"), () => removeReserve(row, product.id), "ml-auto")}</span>
                        </div>
                      ))}
                      {row.products.length === 0 && <p className="py-6 text-center text-[#999]">{t("Товары не добавлены")}</p>}
                    </div>
                  </div>
                </div>
              </div>
            )
          }}
        />
      </RefCard>

      {modalOpen && (
        <SupplierFormModal
          supplier={editingId !== null ? (rows.find((row) => row.id === editingId) ?? null) : null}
          onClose={() => setModalOpen(false)}
          onSaved={(saved) => {
            setRows((current) => (editingId !== null ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
            setModalOpen(false)
          }}
        />
      )}

      {reserveTarget && (
        <SupplierReserveDialog
          supplier={reserveTarget}
          onClose={() => setReserveTarget(null)}
          onSaved={(saved) => {
            setRows((current) => current.map((item) => (item.id === saved.id ? saved : item)))
            setReserveTarget(null)
          }}
        />
      )}
    </>
  )

  return embedded ? <main className="min-w-0 flex-1">{content}</main> : <RefPage>{content}</RefPage>
}
