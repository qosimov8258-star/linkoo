"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { SaveButton } from "@/components/analytics/catalog-ui"
import type { Currency } from "@/components/analytics/currencies-data"
import { useAppCurrency } from "@/lib/app-currency-context"
import { currencyLabel, formatMoney, normCurrency } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Настройки → Валюта приложения (PUT /api/settings/currency, lib/app-currency.ts): SOM, USD or ЕВРО
// (every currency of Валюты), or every currency as before. After saving the page reloads, so every
// screen, select and total follows the new currency at once.
export function AppCurrencyView() {
  const { t } = useLanguage()
  const saved = useAppCurrency()
  const [currencies, setCurrencies] = useState<Currency[] | null>(null)
  const [selected, setSelected] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/currencies?all=1", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Currency[]>) : Promise.reject(new Error(String(response.status)))))
      .then((rows) => {
        if (!cancelled) setCurrencies(rows)
      })
      .catch(() => {
        if (!cancelled) {
          setCurrencies([])
          setError("Не удалось загрузить валюты")
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // One option per currency (base first), whatever spelling Валюты stores it under.
  const options = (currencies ?? [])
    .map((currency) => ({ ...currency, code: normCurrency(currency.code) }))
    .filter((currency, index, list) => list.findIndex((item) => item.code === currency.code) === index)
    .sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.id - b.id)
  const base = options.find((currency) => currency.isBase)

  async function save() {
    if (saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/settings/currency", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: selected }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || "Не удалось сохранить")
        return
      }
      window.location.reload()
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const choices = [
    ...options.map((currency) => ({
      code: currency.code,
      title: currencyLabel(currency.code),
      note: currency.isBase
        ? t("Основная валюта")
        : base && currency.rate
          ? `1 ${currencyLabel(currency.code)} = ${formatMoney(currency.rate)} ${currencyLabel(base.code)}`
          : t("Курс не задан"),
    })),
    { code: "", title: t("Все валюты"), note: t("Каждая сумма в своей валюте") },
  ]

  return (
    // data-keep-currency: the rates of the choices are shown as they are (components/ref/app-currency-dom.tsx).
    <section data-keep-currency className="min-w-0 flex-1 bg-white px-[30px] py-[30px] text-[13px] text-[#333]">
      <h1 className="text-[20px] font-semibold text-[#333]">{t("Валюта приложения")}</h1>
      <p className="mt-[10px] max-w-[760px] leading-[20px] text-[#666]">
        {t("Выберите валюту, в которой работает всё приложение. Суммы, списки, формы, отчёты и фильтры показываются только в этой валюте; суммы, сохранённые в других валютах, пересчитываются по текущему курсу.")}
      </p>
      <p className="mt-[6px] max-w-[760px] leading-[20px] text-[#666]">
        {t("Курсы задаются в разделе")}{" "}
        <Link href="/analytics/currencies" className="text-[#1E4A9A] hover:underline">
          {t("Валюты")}
        </Link>
        . {t("Сохранённые документы не меняются: при выборе «Все валюты» они снова показываются в своей валюте.")}
      </p>

      <div role="radiogroup" aria-label={t("Валюта приложения")} className="mt-[24px] grid max-w-[760px] gap-[12px] sm:grid-cols-2">
        {currencies === null && <p className="text-[#999]">{t("Загрузка...")}</p>}
        {currencies !== null &&
          choices.map((choice) => {
            const active = selected === choice.code
            return (
              <button
                key={choice.code || "all"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(choice.code)}
                className={`flex items-center gap-[12px] rounded-[6px] border px-[16px] py-[14px] text-left transition-colors ${active ? "border-[#1E4A9A] bg-[#1E4A9A]/5" : "border-[#dcdcdc] hover:border-[#1E4A9A]/50"}`}
              >
                <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-[#1E4A9A]" : "border-[#b5b5b5]"}`}>
                  {active && <span className="h-[8px] w-[8px] rounded-full bg-[#1E4A9A]" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-[#333]">{choice.title}</span>
                  <span className="block text-[12px] text-[#777]">{choice.note}</span>
                </span>
                {saved === choice.code && <span className="ml-auto shrink-0 rounded-[4px] bg-[#71ce87]/15 px-[8px] py-[2px] text-[11px] font-semibold text-[#3c9a52]">{t("Текущая")}</span>}
              </button>
            )
          })}
      </div>

      {error && <p className="mt-[14px] text-[#e57373]">{t(error)}</p>}
      <div className="mt-[24px]">
        <SaveButton disabled={saving || currencies === null || selected === saved} onClick={() => void save()}>
          {t("Сохранить")}
        </SaveButton>
      </div>
    </section>
  )
}
