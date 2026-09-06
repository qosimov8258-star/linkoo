"use client"

import { AlertTriangle, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type PriceListEntry = {
  id: number
  priceList: string
  product: string
  cash: number
  nonCash: number
}

type ProductAnalysis = {
  product: string
  priceListCount: number
  minCash: number
  maxCash: number
  avgCash: number
  deviationPercent: number
  entries: PriceListEntry[]
}

function formatSum(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} SUM`
}

export function PriceAnalysisView() {
  const [entries, setEntries] = useState<PriceListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/price-list-entries")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить прайс-листы")
        return (await response.json()) as PriceListEntry[]
      })
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить данные прайс-листов")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const analysis = useMemo<ProductAnalysis[]>(() => {
    const byProduct = new Map<string, PriceListEntry[]>()
    for (const entry of entries) {
      const list = byProduct.get(entry.product) ?? []
      list.push(entry)
      byProduct.set(entry.product, list)
    }

    return Array.from(byProduct.entries())
      .map(([product, list]) => {
        const cashPrices = list.map((entry) => entry.cash).filter((value) => value > 0)
        const minCash = cashPrices.length ? Math.min(...cashPrices) : 0
        const maxCash = cashPrices.length ? Math.max(...cashPrices) : 0
        const avgCash = cashPrices.length ? cashPrices.reduce((sum, value) => sum + value, 0) / cashPrices.length : 0
        const deviationPercent = maxCash > 0 ? ((maxCash - minCash) / maxCash) * 100 : 0
        return { product, priceListCount: list.length, minCash, maxCash, avgCash, deviationPercent, entries: list }
      })
      .sort((a, b) => b.deviationPercent - a.deviationPercent)
  }, [entries])

  const rows = useMemo(
    () => analysis.filter((row) => row.product.toLowerCase().includes(query.toLowerCase())),
    [analysis, query],
  )

  const priceListCount = useMemo(() => new Set(entries.map((entry) => entry.priceList)).size, [entries])

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-600">
          <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
          <span className="mx-2 text-slate-400">|</span> Анализ цен
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Сравнение отпускных цен товара между прайс-листами ({priceListCount}) и отклонения от минимальной цены.
        </p>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <label className="relative w-72">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск товара" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">
            {rows.length} товаров
          </span>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Товар</th>
              <th className="px-5 py-5">Прайс-листов</th>
              <th className="px-5 py-5">Мин. цена</th>
              <th className="px-5 py-5">Макс. цена</th>
              <th className="px-5 py-5">Средняя цена</th>
              <th className="px-5 py-5">Отклонение</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.product} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4 text-slate-700">{row.product}</td>
                <td className="px-5 py-4 text-slate-600">{row.priceListCount}</td>
                <td className="px-5 py-4 text-slate-600">{formatSum(row.minCash)}</td>
                <td className="px-5 py-4 text-slate-600">{formatSum(row.maxCash)}</td>
                <td className="px-5 py-4 text-slate-600">{formatSum(row.avgCash)}</td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                      row.deviationPercent >= 10
                        ? "bg-red-50 text-red-600"
                        : row.deviationPercent > 0
                          ? "bg-amber-50 text-amber-600"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {row.deviationPercent >= 10 && <AlertTriangle className="h-3.5 w-3.5" />}
                    {row.deviationPercent.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  {entries.length === 0 ? "Нет данных: добавьте товары в прайс-листы" : "Ничего не найдено"}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  Загрузка...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
