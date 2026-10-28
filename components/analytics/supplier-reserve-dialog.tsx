"use client"

import { Plus, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { currencyChoices, useCurrencyCodes } from "./supplier-incoming-dialogs"
import type { Supplier } from "./suppliers-data"
import { notify } from "@/lib/notify"

type Line = { key: number; product: string; qty: string; price: string; currency: string }

/** "Добавить продукт" on a supplier: products the supplier keeps in reserve
 * for us. Without a manual price the product's current net cost is used. */
export function SupplierReserveDialog({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: (supplier: Supplier) => void }) {
  const { t } = useLanguage()
  // Configured currencies; an empty line currency means the base one (known once loaded).
  const currencies = useCurrencyCodes()
  const [catalog, setCatalog] = useState<Array<{ name: string; cost: number }>>([])
  const [manual, setManual] = useState(false)
  const [lines, setLines] = useState<Line[]>([{ key: 1, product: "", qty: "1", price: "", currency: "" }])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetch("/api/products").then((response) => (response.ok ? response.json() : [])), fetch("/api/raw-materials").then((response) => (response.ok ? response.json() : []))])
      .then(([products, rawMaterials]) => {
        if (cancelled) return
        const items = [...(products as Array<{ name: string; cost: number; deleted?: boolean }>).filter((item) => !item.deleted), ...(rawMaterials as Array<{ name: string }>).map((item) => ({ name: item.name, cost: 0 }))]
        setCatalog(items.sort((a, b) => a.name.localeCompare(b.name, "ru")))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const costOf = (product: string) => catalog.find((item) => item.name === product)?.cost ?? 0

  function update(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const products = lines
      .filter((line) => line.product && Number(line.qty.replace(",", ".")) > 0)
      .map((line) => ({
        product: line.product,
        qty: Number(line.qty.replace(",", ".")),
        price: manual ? Number(line.price.replace(",", ".")) || 0 : costOf(line.product),
        currency: manual ? line.currency || currencies.base : currencies.base,
      }))
    if (!products.length) return
    setSaving(true)
    try {
      const response = await fetch(`/api/suppliers/${supplier.id}/reserve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual, products }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось сохранить"))
        return
      }
      onSaved(data as Supplier)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded bg-white">
        <header className="flex items-center justify-between border-b p-6">
          <b className="uppercase">{t("Добавить продукт")} — {supplier.name}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={manual} onChange={(event) => setManual(event.target.checked)} />
            {t("Указать цену вручную")}
          </label>
          {!manual && <p className="text-xs text-slate-500">{t("Цена берется из текущей себестоимости товара.")}</p>}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-2 pr-3">{t("Продукт")}</th>
                <th className="py-2 pr-3">{t("Кол-во")}</th>
                <th className="py-2 pr-3">{t("Цена")}</th>
                {manual && <th className="py-2 pr-3">{t("Валюта")}</th>}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-t border-slate-100">
                  <td className="py-2 pr-3">
                    <select required value={line.product} onChange={(event) => update(line.key, { product: event.target.value })} className="w-full border-b border-slate-200 bg-white py-1 outline-none">
                      <option value="">{t("Выберите...")}</option>
                      {catalog.map((item) => <option key={item.name}>{item.name}</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input required inputMode="decimal" value={line.qty} onChange={(event) => update(line.key, { qty: event.target.value })} className="w-20 border-b border-slate-200 py-1 outline-none" />
                  </td>
                  <td className="py-2 pr-3">
                    {manual ? (
                      <input required inputMode="decimal" value={line.price} onChange={(event) => update(line.key, { price: event.target.value })} className="w-28 border-b border-slate-200 py-1 outline-none" />
                    ) : (
                      <span className="text-slate-600">{costOf(line.product).toLocaleString("ru-RU")} {currencies.base}</span>
                    )}
                  </td>
                  {manual && (
                    <td className="py-2 pr-3">
                      <select value={line.currency || currencies.base} onChange={(event) => update(line.key, { currency: event.target.value })} className="border-b border-slate-200 bg-white py-1 outline-none">
                        {currencyChoices(currencies.codes, currencies.base, line.currency).map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} aria-label={t("Удалить")} className="text-slate-400 hover:text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setLines((current) => [...current, { key: Math.max(...current.map((line) => line.key)) + 1, product: "", qty: "1", price: "", currency: "" }])}
            className="inline-flex items-center gap-1 text-sm text-[#4f70e7] hover:underline"
          >
            <Plus className="h-4 w-4" /> {t("добавить товар")}
          </button>
        </div>
        <footer className="flex justify-end border-t p-5">
          <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-60">{t("Сохранить")}</button>
        </footer>
      </form>
    </div>
  )
}
