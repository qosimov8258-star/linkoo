"use client"

import { useCallback, useEffect, useState } from "react"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { LineField, Modal, SaveButton, SaveLink } from "@/components/analytics/catalog-ui"
import {
  EmptyRows,
  PAGE_SIZES,
  ROW_ICONS,
  RowActions,
  RowIcon,
  SettingsToolbar,
  kitHead,
  kitRow,
  useListControls,
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate, refDateTime } from "@/lib/ref-date"
import { formatLongDate } from "@/lib/settings-dates"
import type { Currency, CurrencyRate, IndividualRate } from "./currencies-data"
import { notify } from "@/lib/notify"

// "Валюты" (demo #/currency, Settings → Финансы; API finance/currencies/, currency_rate/, individual_rate/).
// Note about the base currency, then the tabs ОБЩИЙ / ИНДИВИДУАЛЬНЫЙ:
//  * Общий: № | Валюта | Курс ("1 USD = 12 500 SUM") | Дата обновления; the base currency row is dimmed
//    without actions, the others have $ ("Установить курс") and ✎ ("Изменить валюту") on hover; a row
//    click opens "История обновления курса".
//  * Индивидуальный: № | Наименование | Курс USD | Дата начала | Дата завершения | Дата создания,
//    "+ добавить" and ✎ per row (dialog "… индивидуальный курс": name, rate and two dates).

const GENERAL_COLUMNS = "139fr 304fr 405fr 427fr"
const INDIVIDUAL_COLUMNS = "139fr 203fr 202fr 203fr 202fr 326fr"

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value).replace(/[  ]/g, " ")
const day = (value: string) => refDate(`${value.slice(0, 10)}T00:00:00`)

/** Rate field while typing: groups thousands, keeps one decimal part ("12 070,85"). */
function maskRate(raw: string) {
  const [int, ...rest] = raw.replace(/[^\d.,]/g, "").replace(",", ".").split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return rest.length ? `${grouped},${rest.join("")}` : grouped
}

const unmask = (masked: string) => masked.replace(/\s/g, "").replace(",", ".")

function SaveAction({ ready, saving, onClick, label }: { ready: boolean; saving: boolean; onClick: () => void; label: string }) {
  return ready ? <SaveButton disabled={saving} onClick={onClick}>{label}</SaveButton> : <SaveLink onClick={onClick}>{label}</SaveLink>
}

function RateDialog({ currency, onClose, onSaved }: { currency: Currency; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [rate, setRate] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving || !rate) return
    setSaving(true)
    try {
      const response = await fetch(`/api/currencies/${currency.id}/rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: unmask(rate) }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || "Не удалось сохранить курс"))
        return
      }
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("Установить курс")}
      width={400}
      onClose={onClose}
      bodyClassName="px-[30px] pb-[132px] pt-[29px]"
      footer={<SaveAction ready={Boolean(rate)} saving={saving} onClick={() => void save()} label={t("Сохранить")} />}
    >
      <LineField label={t("Курс")} value={rate} onChange={(value) => setRate(maskRate(value))} />
    </Modal>
  )
}

function CurrencyDialog({ currency, onClose, onSaved }: { currency: Currency; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(currency.name)
  const [rate, setRate] = useState(maskRate(String(currency.rate)))
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving || !name.trim() || !rate) return
    setSaving(true)
    try {
      const response = await fetch(`/api/currencies/${currency.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), rate: unmask(rate) }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || "Не удалось сохранить валюту"))
        return
      }
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("Изменить валюту")}
      onClose={onClose}
      bodyClassName="px-[30px] pb-[90px] pt-[18px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <LineField label={t("Наименование")} value={name} onChange={setName} />
      <div className="mt-[12px]"><LineField label={t("Курс")} value={rate} onChange={(value) => setRate(maskRate(value))} /></div>
    </Modal>
  )
}

function HistoryDialog({ currency, onClose }: { currency: Currency; onClose: () => void }) {
  const { t } = useLanguage()
  const [rates, setRates] = useState<CurrencyRate[] | null>(null)
  const controls = useListControls()
  useEffect(() => {
    fetch(`/api/currencies/${currency.id}/rates`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<CurrencyRate[]>) : []))
      .then(setRates)
      .catch(() => setRates([]))
  }, [currency.id])
  const paged = usePaged(rates ?? [], controls.page, controls.pageSize)
  return (
    <Modal
      title={t("История обновления курса")}
      width={700}
      onClose={onClose}
      bodyClassName="h-[424px] overflow-y-auto px-[22px]"
      footer={
        <div className="flex items-center pr-[20px] text-[13px]">
          <select value={controls.pageSize} onChange={(event) => controls.setPageSize(Number(event.target.value))} aria-label={t("Строк на странице")} className="bg-transparent text-[13px] outline-none">
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <span className="ml-[30px]">{paged.from} - {paged.to} {t("из")} {paged.total}</span>
          <button type="button" disabled={paged.page <= 1} onClick={() => controls.setPage(paged.page - 1)} aria-label={t("Назад")} className="ml-[10px] h-6 w-6">
            <svg viewBox="0 0 24 24" className={`h-6 w-6 ${paged.page > 1 ? "fill-black/70" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
          </button>
          <button type="button" disabled={paged.page >= paged.pageCount} onClick={() => controls.setPage(paged.page + 1)} aria-label={t("Вперед")} className="ml-[5px] h-6 w-6">
            <svg viewBox="0 0 24 24" className={`h-6 w-6 ${paged.page < paged.pageCount ? "fill-black/70" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
          </button>
        </div>
      }
    >
      <div className="grid h-[46px] grid-cols-[109px_1fr_auto] items-center border-b-2 border-dotted border-[#d9e0e5] px-[8px] font-semibold">
        <span>№</span><span>{t("Курс")}</span><span className="text-right">{t("Дата")}</span>
      </div>
      {paged.rows.map((rate) => (
        <div key={rate.id} className="grid h-[46px] grid-cols-[109px_1fr_auto] items-center border-b-2 border-dotted border-[#d9e0e5] px-[8px]">
          <span>{rate.id}</span>
          <span>1 {currency.name} = {money(rate.rate)} SUM</span>
          <span className="text-right">{refDateTime(rate.createdAt)}</span>
        </div>
      ))}
    </Modal>
  )
}

function DateField({ label, value, onPick }: { label: string; value: string; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative block h-[40px] w-full border-b border-[#d5dae1] text-left">
        <span className={`absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] leading-4"}`}>{label}</span>
        {value && <span className="absolute inset-x-0 bottom-[4px] text-[13px]">{formatLongDate(value)}</span>}
        <svg viewBox="0 0 24 24" className="absolute bottom-[2px] right-[1px] h-[20px] w-[20px] fill-[#9e9e9e]"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11zM5 7V6h14v1H5z" /></svg>
      </button>
      {open && <DatePickerDialog value={value} onCancel={() => setOpen(false)} onPick={(next) => { onPick(next); setOpen(false) }} />}
    </>
  )
}

function IndividualDialog({ item, onClose, onSaved }: { item: IndividualRate | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({ name: item?.name ?? "", rate: item ? maskRate(String(item.rate)) : "", beginDate: item?.beginDate ?? "", endDate: item?.endDate ?? "" })
  const [saving, setSaving] = useState(false)
  const ready = Boolean(draft.name.trim() && draft.rate && draft.beginDate && draft.endDate)

  async function save() {
    if (saving || !ready) return
    setSaving(true)
    try {
      const response = await fetch(item ? `/api/individual-rates/${item.id}` : "/api/individual-rates", {
        method: item ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, name: draft.name.trim(), rate: unmask(draft.rate) }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } }
        const first = Object.values(data.details?.fieldErrors ?? {}).flat()[0]
        notify(t(first || data.error || "Не удалось сохранить индивидуальный курс"))
        return
      }
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={item ? t("Изменить индивидуальный курс") : t("Добавить индивидуальный курс")}
      onClose={onClose}
      bodyClassName="px-[30px] pb-[29px] pt-[18px]"
      footer={<SaveButton disabled={saving || !ready} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <LineField label={t("Наименование")} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <div className="mt-[12px]"><LineField label={t("Курс")} value={draft.rate} onChange={(value) => setDraft({ ...draft, rate: maskRate(value) })} /></div>
      <div className="mt-[12px]"><DateField label={t("Дата начала")} value={draft.beginDate} onPick={(beginDate) => setDraft({ ...draft, beginDate })} /></div>
      <div className="mt-[12px]"><DateField label={t("Дата завершения")} value={draft.endDate} onPick={(endDate) => setDraft({ ...draft, endDate })} /></div>
    </Modal>
  )
}

function Tabs({ tab, onTab }: { tab: "general" | "individual"; onTab: (tab: "general" | "individual") => void }) {
  const { t } = useLanguage()
  const base = "h-[28px] px-[16px] text-[13px] font-medium uppercase"
  const on = "bg-[#4f71dc] text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
  const off = "bg-[#e0e0e0] text-[#bdbdbd] hover:text-[#9e9e9e]"
  return (
    <span className="ml-[22px] flex items-center">
      <button type="button" onClick={() => onTab("general")} className={`${base} rounded-l-[2px] ${tab === "general" ? on : off}`}>{t("Общий")}</button>
      <button type="button" onClick={() => onTab("individual")} className={`${base} rounded-r-[2px] ${tab === "individual" ? on : off}`}>{t("Индивидуальный")}</button>
    </span>
  )
}

export function CurrenciesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<"general" | "individual">("general")
  const [currencies, setCurrencies] = useState<Currency[] | null>(null)
  const [individual, setIndividual] = useState<IndividualRate[] | null>(null)
  const [rateOf, setRateOf] = useState<Currency | null>(null)
  const [editing, setEditing] = useState<Currency | null>(null)
  const [history, setHistory] = useState<Currency | null>(null)
  const [individualDialog, setIndividualDialog] = useState<{ item: IndividualRate | null } | null>(null)
  const controls = useListControls()

  const load = useCallback(async () => {
    try {
      const [currencyResponse, individualResponse] = await Promise.all([fetch("/api/currencies", { cache: "no-store" }), fetch("/api/individual-rates", { cache: "no-store" })])
      setCurrencies(currencyResponse.ok ? ((await currencyResponse.json()) as Currency[]) : [])
      setIndividual(individualResponse.ok ? ((await individualResponse.json()) as IndividualRate[]) : [])
    } catch {
      setCurrencies([])
      setIndividual([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const needle = controls.query.trim().toLowerCase()
  const base = currencies?.find((currency) => currency.isBase)
  const currencyRows = (currencies ?? []).filter((currency) => currency.name.toLowerCase().includes(needle))
  const individualRows = (individual ?? []).filter((item) => item.name.toLowerCase().includes(needle))
  const pagedCurrencies = usePaged(currencyRows, controls.page, controls.pageSize)
  const pagedIndividual = usePaged(individualRows, controls.page, controls.pageSize)
  const paged = tab === "general" ? pagedCurrencies : pagedIndividual

  function switchTab(next: "general" | "individual") {
    setTab(next)
    controls.setQuery("")
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <p className="h-[70px] pl-[30px] pt-[30px]">
        <span className="font-medium">{t("Основная валюта")}:</span> <b>{base?.name ?? "SUM"}</b> <i className="text-[#777]">({t("используется при формировании стоимости продукта / заказа")})</i>
      </p>
      <SettingsToolbar
        className="h-[61px] pt-[10px]"
        searchClassName="left-[15px] top-[21px]"
        searchWidth={182}
        query={controls.query}
        onQuery={controls.setQuery}
        pager={{
          label: `1 - ${controls.pageSize} ${t("из")}`,
          pageSize: controls.pageSize,
          onPageSize: controls.setPageSize,
          from: paged.from,
          to: paged.to,
          total: paged.total,
          onPrev: paged.page > 1 ? () => controls.setPage(paged.page - 1) : undefined,
          onNext: paged.page < paged.pageCount ? () => controls.setPage(paged.page + 1) : undefined,
        }}
        right={
          <>
            {tab === "individual" && <span className="ml-[18px] pt-[3px]"><AddLinkInline onClick={() => setIndividualDialog({ item: null })}>{t("добавить")}</AddLinkInline></span>}
            <Tabs tab={tab} onTab={switchTab} />
          </>
        }
      />
      {tab === "general" ? (
        <>
          <div className={kitHead} style={{ gridTemplateColumns: GENERAL_COLUMNS }}>
            <span className="pl-[30px]">№</span>
            <span>{t("Валюта")}</span>
            <span>{t("Курс")}</span>
            <span>{t("Дата обновления")}</span>
          </div>
          {pagedCurrencies.rows.map((currency) => (
            <div
              key={currency.id}
              onClick={() => !currency.isBase && setHistory(currency)}
              className={`${kitRow} ${currency.isBase ? "text-[#b5b5b5]" : "cursor-pointer"}`}
              style={{ gridTemplateColumns: GENERAL_COLUMNS }}
            >
              <span className="pl-[30px]">{currency.id}</span>
              <span>{currency.name}</span>
              <span>1 {currency.name} = {money(currency.rate)} {base?.name ?? "SUM"}</span>
              <span>{refDateTime(currency.rateDate)}</span>
              {!currency.isBase && (
                <RowActions
                  right={67}
                  gap={6}
                  extra={<RowIcon path={ROW_ICONS.dollar} label={t("Установить курс")} onClick={() => setRateOf(currency)} />}
                  onEdit={() => setEditing(currency)}
                />
              )}
            </div>
          ))}
          {currencies && pagedCurrencies.rows.length === 0 && <EmptyRows />}
        </>
      ) : (
        <>
          <div className={kitHead} style={{ gridTemplateColumns: INDIVIDUAL_COLUMNS }}>
            <span className="pl-[30px]">№</span>
            <span>{t("Наименование")}</span>
            <span>{t("Курс")} USD</span>
            <span>{t("Дата начала")}</span>
            <span>{t("Дата завершения")}</span>
            <span>{t("Дата создания")}</span>
          </div>
          {pagedIndividual.rows.map((item) => (
            <div key={item.id} className={kitRow} style={{ gridTemplateColumns: INDIVIDUAL_COLUMNS }}>
              <span className="pl-[30px]">{item.id}</span>
              <span className="pr-2">{item.name}</span>
              <span>{money(item.rate)} {base?.name ?? "SUM"}</span>
              <span>{day(item.beginDate)}</span>
              {/* the demo prints the start date in both date columns (its API end_date only shows in the dialog) */}
              <span>{day(item.beginDate)}</span>
              <span>{refDateTime(item.createdAt)}</span>
              <RowActions right={97} onEdit={() => setIndividualDialog({ item })} />
            </div>
          ))}
          {individual && pagedIndividual.rows.length === 0 && <EmptyRows />}
        </>
      )}

      {rateOf && <RateDialog currency={rateOf} onClose={() => setRateOf(null)} onSaved={() => { setRateOf(null); void load() }} />}
      {editing && <CurrencyDialog currency={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
      {history && <HistoryDialog currency={history} onClose={() => setHistory(null)} />}
      {individualDialog && (
        <IndividualDialog
          key={individualDialog.item?.id ?? "new"}
          item={individualDialog.item}
          onClose={() => setIndividualDialog(null)}
          onSaved={() => { setIndividualDialog(null); void load() }}
        />
      )}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}

function AddLinkInline({ children, onClick }: { children: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="text-[13px] text-[#4f71dc] hover:underline">+ {children}</button>
}
