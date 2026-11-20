"use client"

import { useEffect, useState } from "react"

import { SaveButton } from "@/components/analytics/catalog-ui"
import { DEFAULT_AMOUNT_DIGITS, MAX_AMOUNT_DIGITS, parseAmountDigits, printDigits, type AmountPrecision } from "@/lib/amount-precision"
import { useLanguage } from "@/lib/i18n/language-context"

// Настройки → Округление сумм (GET / PUT /api/settings/amount-precision, lib/amount-precision-server.ts): the
// reference's ROUND_AMOUNT_FOR_CURRENCY and SUPPLY_ROUND_AMOUNT. An empty field = not set: every amount keeps the
// precision of its screen (three decimals). After saving the page reloads, so every screen prints with the new digits.

const SAMPLE = 1234.567891234

/** The typed field as it stays: digits only, at most MAX_AMOUNT_DIGITS (a typed 11 or 99 shows and saves as 10). */
function clampDigits(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 2)
  return digits && Number(digits) > MAX_AMOUNT_DIGITS ? String(MAX_AMOUNT_DIGITS) : digits
}

export function AmountPrecisionView() {
  const { t } = useLanguage()
  const [saved, setSaved] = useState<AmountPrecision | null>(null)
  const [digits, setDigits] = useState("")
  const [supplyDigits, setSupplyDigits] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/settings/amount-precision", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<AmountPrecision>) : Promise.reject(new Error(String(response.status)))))
      .then((value) => {
        if (cancelled) return
        setSaved(value)
        setDigits(value.digits ? String(value.digits) : "")
        setSupplyDigits(value.supplyDigits ? String(value.supplyDigits) : "")
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить настройку")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const typed = { digits: parseAmountDigits(digits), supplyDigits: parseAmountDigits(supplyDigits) }
  const changed = !!saved && (typed.digits !== saved.digits || typed.supplyDigits !== saved.supplyDigits)

  async function save() {
    if (saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/settings/amount-precision", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(typed),
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

  const field = (label: string, value: string, onChange: (value: string) => void, placeholder: string, sample: number) => (
    <label className="block">
      <span className="mb-[6px] block text-[13px] font-semibold text-[#333]">{t(label)}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_AMOUNT_DIGITS}
        step={1}
        value={value}
        placeholder={placeholder}
        disabled={!saved}
        onChange={(event) => onChange(clampDigits(event.target.value))}
        className="h-[36px] w-full rounded-[4px] border border-[#dcdcdc] px-[10px] text-[14px] outline-none focus:border-[#1E4A9A] disabled:bg-[#f5f5f5]"
      />
      <span className="mt-[6px] block text-[12px] text-[#777]">
        {t("Пример")}: {printDigits(SAMPLE, sample)}
      </span>
    </label>
  )

  return (
    <section className="min-w-0 flex-1 bg-white px-[30px] py-[30px] text-[13px] text-[#333]">
      <h1 className="text-[20px] font-semibold text-[#333]">{t("Округление сумм")}</h1>
      <p className="mt-[10px] max-w-[760px] leading-[20px] text-[#666]">
        {t("Сколько знаков после запятой показывают суммы, количества и проценты во всём приложении, до скольких знаков округляются расчёты и сколько знаков можно ввести в поле суммы. Пустое поле — по умолчанию, 3 знака.")}
      </p>

      <div className="mt-[24px] grid max-w-[760px] gap-[20px] sm:grid-cols-2">
        {field("Знаков после запятой", digits, setDigits, String(DEFAULT_AMOUNT_DIGITS), typed.digits || DEFAULT_AMOUNT_DIGITS)}
        {field("Знаков после запятой в поставках", supplyDigits, setSupplyDigits, t("Как у сумм"), typed.supplyDigits || typed.digits || DEFAULT_AMOUNT_DIGITS)}
      </div>

      {error && <p className="mt-[14px] text-[#e57373]">{t(error)}</p>}
      <div className="mt-[24px]">
        <SaveButton disabled={saving || !changed} onClick={() => void save()}>
          {t("Сохранить")}
        </SaveButton>
      </div>
    </section>
  )
}
