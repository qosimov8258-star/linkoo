"use client"

import { Loader2, Percent, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import { FormField, MiniPager, MultiPick, PrimaryButton, SearchSelect, SecondaryButton, useCashRates } from "@/components/analytics/cash-management-shared"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { MarkupDialog, downloadPriceTemplate, markupPrice, readPriceTemplate, type GridList, type GridMode, type MarkupRule } from "./price-lists-markup"
import { PRICE_LISTS_API, formatPrice, mutateJson, mutationMessage, type PriceGridResult, type PriceGridSaveBody, type PriceGridSaveResult, type PriceList } from "./price-lists-data"

// "Установить цену в прайс-лист" (demo c9 module 4389, opened by "Добавить цену"). First the
// "Выберите валюту" panel: price lists (several), cash currency, "Вручную" / "Импортировать с excel"
// (template download + upload), "Установить другую цену для перевода" + its currency; then the
// full-screen grid: items × chosen lists with Нал (+ Безнал, + Мин / Макс), "Фильтр по типу",
// "Фильтр по бренду", "Поиск товаров...", paginator and "Наценка" (from cost, with rounding).
// Edits survive paging; "Сохранить" writes only the changed cells (POST /api/price-lists/prices).

type Cell = { cash: string; nonCash: string; min: string; max: string }
/** An edited cell keeps the stored values it started from (what decides "changed"). */
type Edited = Cell & { base: Cell }
type Setup = { lists: string[]; cashCurrency: string; inputType: "manually" | "excel"; twoColumns: boolean; bankCurrency: string; withLimits: boolean }

const PAGE_SIZE = 25
const cellKey = (itemKey: string, listId: number) => `${itemKey}|${listId}`
const parse = (value: string) => {
  const text = value.replace(/\s/g, "").replace(",", ".")
  if (!text) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN
}
const show = (value: number | undefined) => (value === undefined || value === null ? "" : String(value))
const baseOf = (entry: { cash: number; nonCash: number; min: number; max: number } | undefined): Cell => ({
  cash: show(entry?.cash),
  nonCash: show(entry?.nonCash),
  min: show(entry?.min || undefined),
  max: show(entry?.max || undefined),
})

export function SetPriceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const { t } = useLanguage()
  const { codes } = useCashRates()
  const allLists = useCashJson<PriceList[]>(PRICE_LISTS_API)
  const [setup, setSetup] = useState<Setup>({ lists: [], cashCurrency: "", inputType: "manually", twoColumns: false, bankCurrency: "", withLimits: false })
  const [step, setStep] = useState<"setup" | "grid">("setup")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const lists: GridList[] = useMemo(
    () => setup.lists.map((id) => allLists.data?.find((list) => String(list.id) === id)).filter((list): list is PriceList => Boolean(list)).map((list) => ({ id: list.id, name: list.name, currency: list.currency })),
    [setup.lists, allLists.data],
  )
  const mode: GridMode = { twoColumns: setup.inputType === "manually" && setup.twoColumns, withLimits: setup.withLimits }
  const currencyOptions = codes.map((code) => ({ value: code, label: currencyLabel(code) }))
  const ready = lists.length > 0 && Boolean(setup.cashCurrency) && (!mode.twoColumns || Boolean(setup.bankCurrency))

  async function allRows(): Promise<PriceGridResult | null> {
    const response = await fetch(`${PRICE_LISTS_API}/prices?${buildCashQuery({ priceList: lists.map((list) => list.id), pageSize: 0 })}`, { cache: "no-store" })
    return response.ok ? ((await response.json()) as PriceGridResult) : null
  }

  async function importExcel() {
    if (!file || !ready) return
    setBusy(true)
    setError("")
    const catalog = await allRows()
    if (!catalog) {
      setBusy(false)
      return setError(t("Не удалось загрузить данные"))
    }
    const { rows, unknown } = await readPriceTemplate(file, catalog.results, lists, mode, t)
    if (!rows.length) {
      setBusy(false)
      return setError(t("В файле нет цен для загрузки"))
    }
    const body: PriceGridSaveBody = { rows, cashCurrency: setup.cashCurrency, nonCashCurrency: setup.cashCurrency }
    const result = await mutateJson<PriceGridSaveResult>("POST", `${PRICE_LISTS_API}/prices`, body)
    setBusy(false)
    if (!result.ok) return setError(t(mutationMessage(result)))
    onSaved(unknown.length ? `${t("Успешно сохранено")}. ${t("Не найдены")}: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}` : t("Успешно сохранено"))
  }

  if (step === "grid") return <PriceGrid lists={lists} mode={mode} setup={setup} onClose={onClose} onSaved={onSaved} />

  const check = (label: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className="flex items-center gap-3 text-[14px] text-[#17233b]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#4f71dc]" />
      {label}
    </label>
  )
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:py-16" onMouseDown={onClose}>
      <div className="w-full max-w-[500px] rounded bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[#efefef] px-[30px] py-5">
          <b className="text-[15px] text-[#17233b]">{t("Выберите валюту")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex flex-col gap-4 px-[30px] pb-2 pt-4">
          <MultiPick label={`${t("Выберите прайс-лист")} *`} options={(allLists.data ?? []).map((list) => ({ value: String(list.id), label: list.name }))} value={setup.lists} onChange={(next) => setSetup((current) => ({ ...current, lists: next }))} />
          <FormField label={t("Выберите валюту для наличных")} required>
            <SearchSelect value={setup.cashCurrency} options={currencyOptions} onChange={(cashCurrency) => setSetup((current) => ({ ...current, cashCurrency }))} />
          </FormField>
          <div className="flex flex-col gap-2">
            {(["manually", "excel"] as const).map((type) => (
              <label key={type} className="flex items-center gap-3 text-[14px] text-[#17233b]">
                <input type="radio" name="inputType" checked={setup.inputType === type} onChange={() => setSetup((current) => ({ ...current, inputType: type }))} className="h-4 w-4 accent-[#4f71dc]" />
                {type === "manually" ? t("Вручную") : t("Импортировать с excel")}
              </label>
            ))}
          </div>
          {check(t("Установить минимальную и максимальную цену"), setup.withLimits, (withLimits) => setSetup((current) => ({ ...current, withLimits })))}
          {setup.inputType === "manually" ? (
            <>
              {check(t("Установить другую цену для перевода"), setup.twoColumns, (twoColumns) => setSetup((current) => ({ ...current, twoColumns })))}
              {setup.twoColumns && (
                <FormField label={t("Выберите валюту для перевода")} required>
                  <SearchSelect value={setup.bankCurrency} options={currencyOptions} onChange={(bankCurrency) => setSetup((current) => ({ ...current, bankCurrency }))} />
                </FormField>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-md bg-[#f2f5f8] p-3 text-[13px]">
              <button
                type="button"
                disabled={!ready || busy}
                onClick={async () => {
                  setBusy(true)
                  const result = await allRows()
                  setBusy(false)
                  if (result) downloadPriceTemplate(result, lists, mode, t)
                  else setError(t("Не удалось загрузить данные"))
                }}
                className="self-start font-semibold text-[#4f71dc] hover:underline disabled:opacity-40"
              >
                {t("Скачать шаблон")}
              </button>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="text-[13px]" />
            </div>
          )}
          {error && <p className="text-[13px] text-[#e57373]">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 p-2">
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton busy={busy} disabled={!ready || (setup.inputType === "excel" && !file)} onClick={() => (setup.inputType === "excel" ? void importExcel() : setStep("grid"))}>
            {setup.inputType === "excel" ? t("Сохранить") : t("Далее")}
          </PrimaryButton>
        </footer>
      </div>
    </div>
  )
}

function PriceGrid({ lists, mode, setup, onClose, onSaved }: { lists: GridList[]; mode: GridMode; setup: Setup; onClose: () => void; onSaved: (message: string) => void }) {
  const { t } = useLanguage()
  const [filters, setFilters] = useState({ type: "", brand: "", search: "" })
  const [searchDraft, setSearchDraft] = useState("")
  const [page, setPage] = useState(1)
  const [cells, setCells] = useState<Record<string, Edited>>({})
  const [markupOpen, setMarkupOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const query = buildCashQuery({ priceList: lists.map((list) => list.id), type: filters.type, brand: filters.brand, search: filters.search, page, pageSize: PAGE_SIZE })
  const grid = useCashJson<PriceGridResult>(`${PRICE_LISTS_API}/prices?${query}`)
  const rows = grid.data?.results ?? []

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === filters.search) return
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search: value }))
      setPage(1)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, filters.search])

  const storedCell = (itemKey: string, listId: number): Cell => baseOf(rows.find((item) => item.key === itemKey)?.prices[String(listId)])
  const cellOf = (itemKey: string, listId: number): Cell => cells[cellKey(itemKey, listId)] ?? storedCell(itemKey, listId)
  const edit = (itemKey: string, listId: number, patch: Partial<Cell>) =>
    setCells((current) => {
      const key = cellKey(itemKey, listId)
      const previous = current[key] ?? { ...storedCell(itemKey, listId), base: storedCell(itemKey, listId) }
      return { ...current, [key]: { ...previous, ...patch } }
    })
  const changed = Object.entries(cells).filter(
    ([, cell]) => cell.base.cash !== cell.cash || (mode.twoColumns && cell.base.nonCash !== cell.nonCash) || (mode.withLimits && (cell.base.min !== cell.min || cell.base.max !== cell.max)),
  )
  const invalid = changed.some(([, cell]) => [cell.cash, cell.nonCash, cell.min, cell.max].some((value) => Number.isNaN(parse(value) ?? 0)))
  const setFilter = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  async function applyMarkup(rules: Record<number, MarkupRule>): Promise<string> {
    const response = await fetch(`${PRICE_LISTS_API}/prices?${buildCashQuery({ priceList: lists.map((list) => list.id), type: filters.type, brand: filters.brand, search: filters.search, pageSize: 0, cost: 1 })}`, { cache: "no-store" })
    if (!response.ok) return "Не удалось загрузить данные"
    const all = (await response.json()) as PriceGridResult
    const next: Record<string, Edited> = {}
    for (const row of all.results) {
      for (const list of lists) {
        const rule = rules[list.id]
        const cash = markupPrice(row.cost, rule.cashPercent, rule.cashRound)
        const bank = mode.twoColumns ? markupPrice(row.cost, rule.bankPercent, rule.bankRound) : cash
        if (cash === null && bank === null) continue
        const key = cellKey(row.key, list.id)
        const stored = baseOf(row.prices[String(list.id)])
        const current = cells[key] ?? { ...stored, base: stored }
        next[key] = { ...current, cash: cash === null ? current.cash : String(cash), nonCash: bank === null ? current.nonCash : String(bank) }
      }
    }
    setCells((current) => ({ ...current, ...next }))
    setMarkupOpen(false)
    return ""
  }

  async function save() {
    if (!changed.length) return onClose()
    if (invalid) return setError(t("Проверьте правильность заполнения полей"))
    const byItem = new Map<string, PriceGridSaveBody["rows"][number]>()
    for (const [key, cell] of changed) {
      const [itemKey, listId] = key.split("|")
      const [kind, id] = itemKey.split(":")
      const base = cell.base
      const cash = parse(cell.cash)
      const price = {
        priceListId: Number(listId),
        cash: base.cash !== cell.cash ? cash : undefined,
        nonCash: mode.twoColumns ? (base.nonCash !== cell.nonCash ? parse(cell.nonCash) : undefined) : base.cash !== cell.cash ? cash : undefined,
        min: mode.withLimits && base.min !== cell.min ? (parse(cell.min) ?? 0) : undefined,
        max: mode.withLimits && base.max !== cell.max ? (parse(cell.max) ?? 0) : undefined,
      }
      if (price.cash === undefined && price.nonCash === undefined && price.min === undefined && price.max === undefined) continue
      const row = byItem.get(itemKey) ?? { kind: kind as "product" | "raw_material", id: Number(id), prices: [] }
      row.prices.push(price)
      byItem.set(itemKey, row)
    }
    if (!byItem.size) return onClose()
    setBusy(true)
    setError("")
    const body: PriceGridSaveBody = { rows: [...byItem.values()], cashCurrency: setup.cashCurrency, nonCashCurrency: mode.twoColumns ? setup.bankCurrency : setup.cashCurrency }
    const result = await mutateJson<PriceGridSaveResult>("POST", `${PRICE_LISTS_API}/prices`, body)
    setBusy(false)
    if (!result.ok) return setError(t(mutationMessage(result)))
    // Items deleted (or removed) meanwhile are not priced: say so instead of a silent success.
    const skipped = result.data.skipped?.length ?? 0
    onSaved(skipped ? `${t("Успешно сохранено")}. ${t("Пропущено удалённых товаров")}: ${skipped}` : t("Успешно сохранено"))
  }

  const input = (value: string, onChange: (value: string) => void, label: string, width = "w-[100px]") => (
    <input
      value={value}
      inputMode="decimal"
      aria-label={label}
      title={label}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 ${width} border-b bg-transparent px-1 text-[13px] outline-none focus:border-[#4f71dc] ${Number.isNaN(parse(value) ?? 0) ? "border-[#e57373] text-[#e57373]" : "border-[#bac6ce]"}`}
    />
  )

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
        <b className="uppercase">{t("Установить цену в прайс-лист")}</b>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="flex shrink-0 flex-wrap items-end gap-4 border-b border-[#efefef] px-[30px] py-3">
        <FormField label={t("Фильтр по типу")} className="w-[220px]">
          <SearchSelect value={filters.type} options={(grid.data?.types ?? []).map((type) => ({ value: type, label: type }))} onChange={(type) => setFilter({ type })} />
        </FormField>
        <FormField label={t("Фильтр по бренду")} className="w-[220px]">
          <SearchSelect value={filters.brand} options={(grid.data?.brands ?? []).map((brand) => ({ value: brand, label: brand }))} onChange={(brand) => setFilter({ brand })} />
        </FormField>
        <label className="relative mx-auto flex h-10 w-[280px] items-center rounded-sm border border-[#d9e0e5] bg-[#f2f5f8] pl-2.5 pr-9">
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`${t("Поиск товаров")}...`} className="w-full bg-transparent outline-none" />
          <Search className="absolute right-2 h-5 w-5 text-[#bac6ce]" />
        </label>
        <button type="button" onClick={() => setMarkupOpen(true)} className="inline-flex h-[30px] items-center gap-1.5 rounded-sm bg-[#fa8072] px-3 font-semibold text-white hover:brightness-95">
          <Percent className="h-4 w-4" /> {t("Наценка")}
        </button>
        <MiniPager page={page} pageSize={PAGE_SIZE} count={grid.data?.count ?? 0} onPage={setPage} />
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {grid.loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <Loader2 className="h-8 w-8 animate-spin text-[#4f71dc]" />
          </div>
        )}
        {!rows.length && !grid.loading ? (
          <p className="py-24 text-center text-[#666]">{grid.error ? t(grid.error) : t("По вашему запросу ничего не найдено")}</p>
        ) : (
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 z-[5] bg-white">
              <tr className="h-[51px] border-b border-[#efefef] font-semibold">
                <th className="sticky left-0 z-[6] min-w-[320px] bg-white pl-[30px] text-left shadow-[5px_0_8px_-3px_#ccc]">{t("Товар")}</th>
                {lists.map((list) => (
                  <th key={list.id} className="whitespace-nowrap border-r border-[#efefef] px-5 text-left last:border-r-0">
                    {list.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="h-[50px] odd:bg-[#F4F8FB]">
                  <td className="sticky left-0 z-[4] max-w-[360px] bg-inherit pl-[30px] pr-3 font-semibold text-[#666] shadow-[5px_0_8px_-3px_#ccc]" title={row.name}>
                    <span className="block truncate">{row.name}</span>
                    {(row.article || row.kind === "raw_material") && <span className="block text-[11px] font-normal text-[#9aa3b6]">{[row.kind === "raw_material" ? t("Сырье") : "", row.article].filter(Boolean).join(" · ")}</span>}
                  </td>
                  {lists.map((list) => {
                    const cell = cellOf(row.key, list.id)
                    const stored = row.prices[String(list.id)]
                    return (
                      <td key={list.id} className="whitespace-nowrap border-r border-[#efefef] px-5 align-middle last:border-r-0">
                        <span className="flex items-center gap-2">
                          {input(cell.cash, (cash) => edit(row.key, list.id, { cash }), `${list.name}: ${t("Нал")}`)}
                          <span className="text-[#666]" title={stored && stored.currency !== setup.cashCurrency ? `${t("Сейчас")}: ${formatPrice(stored.cash)} ${currencyLabel(stored.currency)}` : undefined}>
                            {currencyLabel(setup.cashCurrency)}
                          </span>
                          {mode.twoColumns && (
                            <>
                              {input(cell.nonCash, (nonCash) => edit(row.key, list.id, { nonCash }), `${list.name}: ${t("Безнал")}`)}
                              <span className="text-[#666]">{currencyLabel(setup.bankCurrency)}</span>
                            </>
                          )}
                          {mode.withLimits && (
                            <>
                              {input(cell.min, (min) => edit(row.key, list.id, { min }), `${list.name}: ${t("Мин")}`, "w-[80px]")}
                              {input(cell.max, (max) => edit(row.key, list.id, { max }), `${list.name}: ${t("Макс")}`, "w-[80px]")}
                            </>
                          )}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="flex h-[60px] shrink-0 items-center justify-end gap-4 border-t border-[#efefef] px-4">
        {error && <span className="mr-auto text-[#e57373]">{error}</span>}
        {changed.length > 0 && (
          <span className="text-[#586174]">
            {t("Изменено")}: {changed.length}
          </span>
        )}
        <PrimaryButton busy={busy} onClick={() => void save()}>
          {t("Сохранить")}
        </PrimaryButton>
      </footer>

      {markupOpen && <MarkupDialog lists={lists} mode={mode} onClose={() => setMarkupOpen(false)} onApply={applyMarkup} />}
    </div>
  )
}
