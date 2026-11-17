"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { LINE_INPUT, LineSelect } from "@/components/ref/line-fields"
import { FilterCheck, FilterSelect, RefAppliedFilter, RefFilterPanel } from "@/components/ref/list-kit"
import { MONTHS_NOMINATIVE } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"
import type { MonthlyPlan, PlanProduct, PlanProductOptions } from "@/lib/monthly-plans-repo"

// Linko's «План на продукты» (Анализ маршрутов → an agent → «план продаж»): the agent's sales plan for a month. Месяц and
// Год pick the month (cleared = the current one); every organization gets a sales sum and an АКБ («Сохранить» saves
// them, PUT /api/monthly-plans). «План на продукты» opens the products of the month in full screen: «Показать
// фильтр» (Тип продукта → Подкатегория, Только ММЛ продукты, Показать установленный план), the search, and a quantity
// per product (PUT /api/monthly-plans/products); × goes back to the organizations, and unsaved quantities are offered
// to be saved first («Сохранить текущие товары?»).

const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
const GRID = "M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm15 0h-2v3h-3v2h3v3h2v-3h3v-2h-3z"
const SEARCH = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
/** Linko's years of the selects (2016 on), through this year. */
const FIRST_YEAR = 2016

const text = (value: number | null) => (value === null ? "" : String(value))
/** "1 500,5" → 1500.5; empty → null. */
function parseAmount(value: string): number | null {
  const clean = value.replace(/\s/g, "").replace(",", ".")
  if (!clean) return null
  const number = Number(clean)
  return Number.isFinite(number) && number >= 0 ? number : NaN
}
const keepNumber = (value: string) => value.replace(/[^\d.,\s]/g, "")

function Icon({ path, className = "h-6 w-6 fill-[#666]" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d={path} />
    </svg>
  )
}

export function SalesPlanDialog({
  employeeId,
  year: initialYear,
  month: initialMonth,
  currency,
  canEdit,
  onClose,
  onSaved,
}: {
  employeeId: number
  year: number
  month: number
  /** The base currency's name, after the sales sums. */
  currency: string
  canEdit: boolean
  onClose: () => void
  /** A plan was saved (the agent's card shows it). */
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const now = new Date()
  const [monthValue, setMonthValue] = useState(String(initialMonth))
  const [yearValue, setYearValue] = useState(String(initialYear))
  // Cleared selects mean the current month / year (Linko's serializer falls back to them).
  const month = Number(monthValue) || now.getMonth() + 1
  const year = Number(yearValue) || now.getFullYear()
  const [view, setView] = useState<"organizations" | "products">("organizations")
  const [plan, setPlan] = useState<{ key: string; data: MonthlyPlan } | null>(null)
  const [draft, setDraft] = useState<Record<number, { summa: string; akb: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const key = `${employeeId}|${year}|${month}`
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => dialogRef.current?.focus(), [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/monthly-plans?employeeId=${employeeId}&year=${year}&month=${month}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (MonthlyPlan & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        return body
      })
      .then((data) => {
        if (cancelled) return
        setPlan({ key, data })
        setDraft(Object.fromEntries(data.organizations.map((row) => [row.id, { summa: text(row.summa), akb: text(row.akb) }])))
        setError("")
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, year, month, key])

  const loading = plan?.key !== key
  const years = Array.from({ length: Math.max(now.getFullYear(), 2026) - FIRST_YEAR + 1 }, (_, index) => String(FIRST_YEAR + index))

  async function save() {
    if (!plan || loading) return
    const organizations = plan.data.organizations.map((row) => ({ organizationId: row.id, summa: parseAmount(draft[row.id]?.summa ?? ""), akb: parseAmount(draft[row.id]?.akb ?? "") }))
    if (organizations.some((row) => Number.isNaN(row.summa) || Number.isNaN(row.akb))) {
      setError("Неверное значение")
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/monthly-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, year, month, organizations }),
      })
      const body = (await response.json().catch(() => null)) as (MonthlyPlan & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || "Не удалось сохранить")
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (view === "products") {
    return <ProductsPlan employeeId={employeeId} year={year} month={month} canEdit={canEdit} onBack={() => setView("organizations")} onSaved={onSaved} />
  }

  return createPortal(
    // Linko's dialog is modal (over the whole page): only × closes it, and its keys stay inside it.
    <div
      className="fixed inset-0 z-[1300] flex items-start justify-center overflow-y-auto bg-black/[0.54] px-4 py-[64px]"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.nativeEvent.stopImmediatePropagation()
      }}
    >
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("План на продукты")} className="relative w-full max-w-[800px] bg-white text-[13px] text-[#333] shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)] outline-none">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px] font-bold uppercase">
          <span>{t("План на продукты")}</span>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="flex h-[48px] w-[48px] items-center justify-center">
            <Icon path={CLOSE} />
          </button>
        </header>

        <div className="flex h-[50px] items-center justify-between border-b border-[#efefef] px-[30px]">
          <div className="grid w-[420px] grid-cols-2 gap-x-[30px]">
            <ClearableSelect label={t("Месяц")} value={monthValue} onChange={setMonthValue} options={MONTHS_NOMINATIVE.map((name, index) => ({ value: String(index + 1), label: t(name) }))} />
            <ClearableSelect label={t("Год")} value={yearValue} onChange={setYearValue} options={years.map((value) => ({ value, label: value }))} />
          </div>
          <button
            type="button"
            onClick={() => setView("products")}
            className="flex h-[36px] items-center gap-[8px] rounded-[2px] bg-[#536fe1] px-[15px] text-[13px] text-white hover:brightness-105"
          >
            {t("План на продукты")}
            <Icon path={GRID} className="h-[18px] w-[18px] fill-white" />
          </button>
        </div>

        <div className="relative min-h-[120px] overflow-y-auto px-[30px] pb-[10px]" style={{ maxHeight: "300px" }}>
          {loading && !error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#536fe1] border-t-transparent" />
            </div>
          )}
          <div className="sticky top-0 z-[5] grid grid-cols-[50%_120px_1fr_120px_1fr] items-end gap-x-[10px] bg-white pt-[8px] text-[#333]">
            <span />
            <span className="text-center">{t("Сумма продаж")}</span>
            <span />
            <span className="text-center">{t("АКБ")}</span>
            <span />
          </div>
          {plan?.data.organizations.map((row) => (
            <div key={row.id} className="grid grid-cols-[50%_120px_1fr_120px_1fr] items-end gap-x-[10px]">
              <span className="pb-[12px] font-semibold">{row.name}</span>
              <PlanInput
                label={`${row.name} — ${t("Сумма продаж")}`}
                value={draft[row.id]?.summa ?? ""}
                disabled={!canEdit}
                onChange={(summa) => setDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { summa: "", akb: "" }), summa } }))}
              />
              <span className="pb-[12px]">{currency}</span>
              <PlanInput
                label={`${row.name} — ${t("АКБ")}`}
                value={draft[row.id]?.akb ?? ""}
                disabled={!canEdit}
                onChange={(akb) => setDraft((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { summa: "", akb: "" }), akb } }))}
              />
              <span className="pb-[12px]">{t("ед.")}</span>
            </div>
          ))}
        </div>
        {error && <p className="mx-[30px] mb-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[#f44336]">{t(error)}</p>}

        <footer className="border-t border-[#efefef] p-[10px] text-right">
          {canEdit && (
            <button type="button" disabled={busy || loading} onClick={() => void save()} className="h-[36px] rounded-[2px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-50">
              {t("Сохранить")}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  )
}

/** Linko's select with × (clears it) and ▾. */
function ClearableSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const { t } = useLanguage()
  return (
    <div className="relative">
      <LineSelect label={label} value={value} onChange={onChange} options={options} />
      {value && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("")} className="absolute bottom-[6px] right-[22px] flex h-[18px] w-[18px] items-center justify-center">
          <Icon path={CLOSE} className="h-[14px] w-[14px] fill-[#999]" />
        </button>
      )}
    </div>
  )
}

/** A 120px underlined number field, right-aligned, «0.00» until it has a value. */
function PlanInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="relative block h-[45px]">
      <input
        value={value}
        inputMode="decimal"
        aria-label={label}
        placeholder="0.00"
        disabled={disabled}
        onChange={(event) => onChange(keepNumber(event.target.value))}
        className={`${LINE_INPUT} text-right placeholder:text-black/30 disabled:text-[#777]`}
      />
    </label>
  )
}

type ProductFilter = { typeParent: string; typeChild: string; onlyMml: boolean; onlyPlanned: boolean }
const NO_FILTER: ProductFilter = { typeParent: "", typeChild: "", onlyMml: false, onlyPlanned: false }

/** «План на продукты на MM.YYYY»: the month's products with the agent's quantities. */
function ProductsPlan({ employeeId, year, month, canEdit, onBack, onSaved }: { employeeId: number; year: number; month: number; canEdit: boolean; onBack: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [options, setOptions] = useState<PlanProductOptions>({ types: [], organizations: [] })
  const [filter, setFilter] = useState<ProductFilter>(NO_FILTER)
  const [filterDraft, setFilterDraft] = useState<ProductFilter>(NO_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [list, setList] = useState<{ key: string; products: PlanProduct[]; total: number } | null>(null)
  // Quantities typed and not saved yet, by product.
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [confirm, setConfirm] = useState<null | (() => void)>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [tick, setTick] = useState(0)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => dialogRef.current?.focus(), [])

  const typeId = (name: string, parent: boolean) => options.types.find((type) => type.name === name && (parent ? type.parentId === null : true))?.id
  const params = new URLSearchParams({ employeeId: String(employeeId), year: String(year), month: String(month) })
  if (query) params.set("search", query)
  const parentId = filter.typeParent ? typeId(filter.typeParent, true) : undefined
  const childId = filter.typeChild ? options.types.find((type) => type.name === filter.typeChild && type.parentId === parentId)?.id : undefined
  if (parentId) params.set("typeParent", String(parentId))
  if (childId) params.set("typeChild", String(childId))
  if (filter.onlyMml) params.set("onlyMml", "1")
  if (filter.onlyPlanned) params.set("onlyPlanned", "1")
  const key = `${params.toString()}|${tick}`

  useEffect(() => {
    let cancelled = false
    fetch("/api/monthly-plans/products?options=1", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<PlanProductOptions>) : null))
      .then((body) => {
        if (!cancelled && body) setOptions(body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const url = `/api/monthly-plans/products?${key.slice(0, key.lastIndexOf("|"))}`
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { products: PlanProduct[]; total: number; error?: string } | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        return body
      })
      .then((body) => {
        if (!cancelled) setList({ key, products: body.products, total: body.total })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [key])

  const loading = list?.key !== key
  const dirty = Object.keys(edits).length > 0
  // A step that drops the typed quantities asks to save them first (Linko's «Сохранить текущие товары?»).
  const guarded = (step: () => void) => (dirty && canEdit ? setConfirm(() => step) : step())

  async function save(after?: () => void) {
    const products = Object.entries(edits).map(([id, value]) => ({ productId: Number(id), amount: parseAmount(value) }))
    if (products.some((row) => Number.isNaN(row.amount))) {
      setError("Неверное значение")
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/monthly-plans/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, year, month, products }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || "Не удалось сохранить")
      setEdits({})
      onSaved()
      if (after) after()
      else setTick((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const parents = options.types.filter((type) => type.parentId === null).map((type) => type.name)
  const draftParentId = filterDraft.typeParent ? typeId(filterDraft.typeParent, true) : undefined
  const children = draftParentId ? options.types.filter((type) => type.parentId === draftParentId).map((type) => type.name) : []
  const filterCount = [filter.typeParent, filter.typeChild, filter.onlyMml, filter.onlyPlanned].filter(Boolean).length
  const mm = String(month).padStart(2, "0")

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] bg-black/[0.54]"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.nativeEvent.stopImmediatePropagation()
      }}
    >
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("План на продукты")} className="absolute inset-0 flex flex-col bg-white text-[13px] text-[#333] outline-none">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px] font-bold uppercase">
          <span>
            {t("План на продукты")} {t("на")} {mm}.{year}
          </span>
          <button type="button" aria-label={t("Закрыть")} onClick={() => guarded(onBack)} className="flex h-[48px] w-[48px] items-center justify-center">
            <Icon path={CLOSE} />
          </button>
        </header>

        <div className="relative flex h-[50px] shrink-0 items-end justify-between border-b border-[#efefef] px-[30px]">
          <div className="relative self-stretch">
            {filterCount > 0 && !filterOpen ? (
              <RefAppliedFilter
                count={filterCount}
                onEdit={() => {
                  setFilterDraft(filter)
                  setFilterOpen(true)
                }}
                onClear={() => guarded(() => setFilter(NO_FILTER))}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFilterDraft(filter)
                  setFilterOpen((open) => !open)
                }}
                className="flex h-full items-center gap-[2px] text-[#1E4A9A]"
              >
                {t("Показать фильтр")}
                <svg viewBox="0 0 10 5" aria-hidden className="ml-[3px] h-[5px] w-[8px] fill-current">
                  <path d="M0 0h10L5 5z" />
                </svg>
              </button>
            )}
            {filterOpen && (
              <div className="absolute left-[-30px] top-0 z-20">
                <RefFilterPanel
                  narrow
                  onClose={() => setFilterOpen(false)}
                  onApply={() =>
                    guarded(() => {
                      setFilter(filterDraft)
                      setFilterOpen(false)
                    })
                  }
                >
                  <FilterSelect label="Тип продукта" value={filterDraft.typeParent} onChange={(typeParent) => setFilterDraft((current) => ({ ...current, typeParent, typeChild: "" }))} options={parents} />
                  {filterDraft.typeParent && <FilterSelect label="Подкатегория" value={filterDraft.typeChild} onChange={(typeChild) => setFilterDraft((current) => ({ ...current, typeChild }))} options={children} />}
                  <FilterCheck label={t("Только ММЛ продукты")} checked={filterDraft.onlyMml} onChange={(onlyMml) => setFilterDraft((current) => ({ ...current, onlyMml }))} />
                  <FilterCheck label={t("Показать установленный план")} checked={filterDraft.onlyPlanned} onChange={(onlyPlanned) => setFilterDraft((current) => ({ ...current, onlyPlanned }))} />
                </RefFilterPanel>
              </div>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const next = search.trim()
              guarded(() => setQuery(next))
            }}
            className="absolute left-1/2 top-[8px] flex w-[280px] -translate-x-1/2 items-center border-b border-[#e0e0e0]"
          >
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} aria-label={t("Поиск")} className="h-[32px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
            <button type="submit" aria-label={t("Поиск")}>
              <Icon path={SEARCH} className="h-5 w-5 fill-[#999]" />
            </button>
          </form>
          <span className="pb-[8px] text-[#999]">{list && !loading && list.total > list.products.length ? `${list.products.length} / ${list.total}` : ""}</span>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-[30px]">
          {loading && !error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#536fe1] border-t-transparent" />
            </div>
          )}
          {list && list.products.length === 0 ? (
            <p className="py-[40px] text-center text-[#666]">{t("По вашему запросу ничего не найдено")}...</p>
          ) : (
            list && (
              <>
                <div className="grid grid-cols-[66.66%_33.33%] border-b border-dotted border-[#ccc] py-[10px] font-semibold">
                  <span>{t("Наименование")}</span>
                  <span className="text-right">{t("Кол-во")}</span>
                </div>
                {list.products.map((product) => (
                  <div key={product.id} className="grid grid-cols-[66.66%_33.33%] items-end border-b border-dotted border-[#ccc]">
                    <span className="pb-[12px]">{product.name}</span>
                    <span className="flex items-end gap-[10px]">
                      <span className="flex-1">
                        <PlanInput
                          label={product.name}
                          value={edits[product.id] ?? text(product.amount)}
                          disabled={!canEdit}
                          onChange={(value) => setEdits((current) => ({ ...current, [product.id]: value }))}
                        />
                      </span>
                      <span className="whitespace-nowrap pb-[12px] font-semibold">{product.unit}</span>
                    </span>
                  </div>
                ))}
              </>
            )
          )}
        </div>
        {error && <p className="mx-[30px] my-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[#f44336]">{t(error)}</p>}

        <footer className="shrink-0 border-t border-[#efefef] p-[10px] text-right">
          {canEdit && (
            <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="h-[36px] rounded-[2px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-50">
              {t("Сохранить")}
            </button>
          )}
        </footer>

        {confirm && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/[0.3]">
            <div role="alertdialog" aria-label={t("Сохранить текущие товары")} className="w-[340px] bg-white p-[20px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
              <header className="mb-[20px] text-[15px] font-semibold">{t("Сохранить текущие товары")}?</header>
              <div className="flex justify-end gap-[8px]">
                <button
                  type="button"
                  onClick={() => {
                    const step = confirm
                    setConfirm(null)
                    setEdits({})
                    step()
                  }}
                  className="h-[36px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8]"
                >
                  {t("Нет")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const step = confirm
                    setConfirm(null)
                    void save(step)
                  }}
                  className="h-[36px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-50"
                >
                  {t("Сохранить")}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
