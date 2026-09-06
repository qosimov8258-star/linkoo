"use client"

import { ChangeEvent, Fragment, useMemo, useRef, useState } from "react"
import { BarChart3, ChevronLeft, ChevronRight, Filter, FileText, ListChecks, Search, Trash2, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

type Product = { name: string; quantity: number; sum: number }

type Order = {
  id: number
  type: string
  client: string
  createdAt: string
  deliverer: string
  deliveryDate: string
  agent: string
  amount: number
  products: Product[]
}

function formatSum(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} SUM`
}

const seed: Order[] = []

const importTypes = ["Sales XML", "Smart XML", "Ритм JSON"]

export function IntegrationsView() {
  const { t } = useLanguage()
  const [orders, setOrders] = useState(seed)
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importType, setImportType] = useState(importTypes[0])
  const [importFile, setImportFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(
    () => orders.filter((order) => String(order.id).includes(query) || order.client.toLowerCase().includes(query.toLowerCase()) || order.agent.toLowerCase().includes(query.toLowerCase())),
    [orders, query],
  )

  function toggle(id: number) {
    setExpanded((current) => (current === id ? null : id))
  }

  function remove(id: number) {
    setOrders((list) => list.filter((order) => order.id !== id))
    setExpanded((current) => (current === id ? null : current))
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  function saveImport() {
    if (!importFile) return
    const id = Math.max(0, ...orders.map((order) => order.id)) + 1
    setOrders((list) => [
      { id, type: "Заказ", client: `${t("Импорт из")} ${importFile.name}`, createdAt: t("только что"), deliverer: t("Не указано"), deliveryDate: "—", agent: `${importType} ${t("импорт")}`, amount: 0, products: [] },
      ...list,
    ])
    setImportOpen(false)
    setImportFile(null)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-600">
          <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
          <span className="mx-2 text-slate-400">|</span> {t("Интеграция")}
        </h1>
        <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
          <BarChart3 className="h-4 w-4" />
          {t("Импортировать")}
        </button>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-3 font-semibold text-white hover:brightness-95">
            <Filter className="h-4 w-4" />
            {t("Показать фильтр")}
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {rows.length} {t("из")} {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
          <ListChecks className="h-5 w-5 text-slate-400" />
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <label className="text-sm font-medium text-slate-600">
              {t("Тип")}
              <select className="mt-1 block w-56 border-0 border-b border-slate-300 bg-white px-0 py-2 outline-none focus:border-[#4f70e7]">
                <option>{t("Все типы")}</option>
                <option>{t("Заказ")}</option>
              </select>
            </label>
            <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#626b7e] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              {t("Применить")}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">№</th>
                <th className="px-5 py-5">{t("Тип")}</th>
                <th className="px-5 py-5">{t("Клиент")}</th>
                <th className="px-5 py-5">{t("Дата создания")}</th>
                <th className="px-5 py-5">{t("Доставщик")}</th>
                <th className="px-5 py-5">{t("Дата доставки")}</th>
                <th className="px-5 py-5">{t("Агент")}</th>
                <th className="px-5 py-5">{t("Сумма заказа")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <Fragment key={order.id}>
                  <tr className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50" onClick={() => toggle(order.id)}>
                    <td className="px-9 py-4 text-[#e0972a]">{order.id}</td>
                    <td className="px-5 py-4">{t(order.type)}</td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{t("Не указано")}</p>
                      <p className="text-[#4f70e7]">{order.client}</p>
                    </td>
                    <td className="px-5 py-4">{order.createdAt}</td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{t("Не указано")}</p>
                      <p className="text-[#4f70e7]">{order.deliverer}</p>
                    </td>
                    <td className="px-5 py-4">{order.deliveryDate}</td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">undefined undefined</p>
                      <p className="text-[#4f70e7]">{order.agent}</p>
                    </td>
                    <td className="px-5 py-4">{formatSum(order.amount)}</td>
                  </tr>
                  {expanded === order.id && (
                    <tr>
                      <td colSpan={8} className="border-b border-slate-200 bg-white p-0">
                        <div className="p-8">
                          <div className="mb-6 flex items-center justify-between">
                            <h2 className="text-2xl font-semibold text-slate-800">{t("Заказ")} №{order.id}</h2>
                            <button type="button" onClick={() => remove(order.id)} aria-label={t("Удалить")} className="text-slate-500 hover:text-red-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                          <div className="grid gap-10 md:grid-cols-[320px_1fr]">
                            <div className="space-y-3 text-slate-700">
                              <p>
                                {t("Клиент")}: <br />
                                <b className="text-slate-900">{order.client}</b>
                              </p>
                              <p>
                                {t("Дата создания")}: <b className="text-slate-900">{order.createdAt}</b>
                              </p>
                              <p>
                                {t("Доставщик")}: <br />
                                <b className="text-slate-900">{order.deliverer}</b>
                              </p>
                              <p>
                                {t("Дата доставки")}: <b className="text-slate-900">{order.deliveryDate}</b>
                              </p>
                              <p>
                                {t("Агент")}: <br />
                                <b className="text-slate-900">{order.agent}</b>
                              </p>
                              <p>
                                {t("Сумма заказа")}: <b className="text-slate-900">{formatSum(order.amount)}</b>
                              </p>
                            </div>
                            <div>
                              <table className="w-full text-left">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-500">
                                    <th className="pb-3 pr-4 font-medium">№</th>
                                    <th className="pb-3 pr-4 font-medium">{t("Товар")}</th>
                                    <th className="pb-3 pr-4 font-medium">{t("Количество")}</th>
                                    <th className="pb-3 font-medium">{t("Сумма")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.products.map((product, index) => (
                                    <tr key={product.name} className="border-b border-dashed border-slate-200">
                                      <td className="py-3 pr-4 text-[#4f70e7]">{index + 1}</td>
                                      <td className="py-3 pr-4">{product.name}</td>
                                      <td className="py-3 pr-4">{product.quantity}</td>
                                      <td className="py-3">{new Intl.NumberFormat("ru-RU").format(product.sum)}</td>
                                    </tr>
                                  ))}
                                  {order.products.length === 0 && (
                                    <tr>
                                      <td colSpan={4} className="py-6 text-center text-slate-400">
                                        {t("Товары не указаны")}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                                <tfoot>
                                  <tr className="font-semibold text-slate-800">
                                    <td className="pt-3" colSpan={3}>
                                      {t("Итого")}
                                    </td>
                                    <td className="pt-3">{formatSum(order.amount)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                    {t("Ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{t("Импорт с Excel")}</b>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false)
                  setImportFile(null)
                }}
                aria-label={t("Закрыть")}
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <div>
                <p className="mb-3 font-semibold text-slate-800">{t("Выберите тип")}</p>
                <div className="space-y-3">
                  {importTypes.map((type) => (
                    <label key={type} className="flex items-center gap-3 text-slate-700">
                      <input type="radio" name="import-type" checked={importType === type} onChange={() => setImportType(type)} className="h-5 w-5 accent-[#4f70e7]" />
                      {type}
                    </label>
                  ))}
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept=".xml,.json,.xls,.xlsx,.csv" onChange={pickFile} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
