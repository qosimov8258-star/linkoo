"use client"

import { useCallback, useEffect, useState } from "react"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { CheckBox, ImportDialog, LineField, Modal, SaveButton, SaveLink } from "@/components/analytics/catalog-ui"
import {
  ConfirmDeleteDialog,
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
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Currency, CurrencyRate, IndividualRate } from "./currencies-data"
import { notify } from "@/lib/notify"

// "Валюты" (demo #/currency, Settings → Финансы; API finance/currencies/, currency_rate/, individual_rate/).
// Note about the base currency, then the tabs ОБЩИЙ / ИНДИВИДУАЛЬНЫЙ:
//  * Общий: № | Валюта | Курс ("1 USD = 12 500 SUM") | Дата обновления; the base currency row is dimmed
//    without actions, the others have $ ("Установить курс") and ✎ ("Изменить валюту") on hover; a row
//    click opens "История обновления курса".
//  * Индивидуальный: № | Наименование | Курс USD | Дата начала | Дата завершения | Дата создания,
//    "+ добавить" and ✎ per row (dialog "… индивидуальный курс": name, rate and two dates).
// The general tab also adds ("+ добавить валюту"), imports (Excel) and deletes currencies: a fresh install has no
// currency yet, and the first one created becomes the base currency with rate 1 (lib/currencies-repo.ts).

const GENERAL_COLUMNS = "139fr 304fr 405fr 427fr"
const INDIVIDUAL_COLUMNS = "139fr 203fr 202fr 203fr 202fr 326fr"

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value).replace(/[  ]/g, " ")

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "код": "code", "code": "code",
  "курс": "rate", "курс к sum": "rate", "rate": "rate",
}

/** Codes of the national currency (the import's base currency when there is none yet). */
const NATIONAL_CODES = new Set(["SUM", "UZS"])

/** The order to save imported rows in while the company has no base currency: the first
 * currency saved becomes the base one and must have rate 1 (lib/currencies-repo.ts), so the
 * national currency with rate 1 (else another row with rate 1) goes first. null = the file
 * has no row that can be the base currency. */
export function baseCurrencyFirst<T extends { code: string; rate: number }>(rows: T[]): T[] | null {
  const national = rows.findIndex((row) => row.rate === 1 && NATIONAL_CODES.has(row.code))
  const index = national >= 0 ? national : rows.findIndex((row) => row.rate === 1)
  if (index < 0) return null
  return [rows[index], ...rows.slice(0, index), ...rows.slice(index + 1)]
}

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

function HistoryDialog({ currency, baseName, onClose }: { currency: Currency; baseName: string; onClose: () => void }) {
  const { t, language } = useLanguage()
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
          <span>1 {currency.name} = {money(rate.rate)} {baseName}</span>
          <span className="text-right">{formatDateText(rate.createdAt, language, { withTime: true, utc: true })}</span>
        </div>
      ))}
    </Modal>
  )
}

function DateField({ label, value, onPick }: { label: string; value: string; onPick: (value: string) => void }) {
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative block h-[40px] w-full border-b border-[#d5dae1] text-left">
        <span className={`absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] leading-4"}`}>{label}</span>
        {value && <span className="absolute inset-x-0 bottom-[4px] text-[13px]">{formatDateText(value, language)}</span>}
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

/** "Добавить валюту": name, code, "Базовая валюта" and the rate to the base currency (POST /api/currencies). */
function CreateDialog({ noBase, baseCode, onClose, onSaved }: { noBase: boolean; baseCode: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  // Nothing is pre-ticked: "Базовая валюта" moves the base of the company.
  const [draft, setDraft] = useState({ name: "", code: "", rate: "1", isBase: false })
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const rateLabel = t(baseCode && baseCode.toUpperCase() !== "SUM" ? "Курс к базовой валюте" : "Курс к SUM")

  async function save() {
    const name = draft.name.trim()
    const code = draft.code.trim().toUpperCase()
    if (saving || !name || !code) return
    setSaving(true)
    setFormError("")
    try {
      const response = await fetch("/api/currencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, rate: draft.isBase ? 1 : unmask(draft.rate), isBase: draft.isBase }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setFormError(data.error || "Не удалось сохранить валюту")
        return
      }
      onSaved()
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("Добавить валюту")}
      onClose={onClose}
      bodyClassName="px-[30px] pb-[29px] pt-[18px]"
      footer={<SaveButton disabled={saving || !draft.name.trim() || !draft.code.trim()} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <LineField label={t("Наименование")} required value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <div className="mt-[12px]"><LineField label={t("Код")} required value={draft.code} onChange={(code) => setDraft({ ...draft, code: code.toUpperCase().slice(0, 10) })} /></div>
      <div className="mt-[18px]"><CheckBox label={t("Базовая валюта")} checked={draft.isBase} onChange={(isBase) => setDraft({ ...draft, isBase })} /></div>
      {noBase && <p className="mt-[12px] text-[12px] text-[#777]">{t("Базовой валюты ещё нет: первая валюта станет базовой, поэтому её курс должен быть 1.")}</p>}
      {!draft.isBase && <div className="mt-[12px]"><LineField label={rateLabel} value={draft.rate} onChange={(value) => setDraft({ ...draft, rate: maskRate(value) })} /></div>}
      {formError && <p className="mt-[12px] text-[13px] font-semibold text-[#e57373]">{t(formError)}</p>}
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
  const { t, language } = useLanguage()
  const [tab, setTab] = useState<"general" | "individual">("general")
  const [currencies, setCurrencies] = useState<Currency[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Currency | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
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
      setLoadError(currencyResponse.ok ? "" : "Не удалось загрузить валюты с сервера")
      setIndividual(individualResponse.ok ? ((await individualResponse.json()) as IndividualRate[]) : [])
    } catch {
      setCurrencies([])
      setLoadError("Не удалось загрузить валюты с сервера")
      setIndividual([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const needle = controls.query.trim().toLowerCase()
  const base = currencies?.find((currency) => currency.isBase)
  // There is always one base currency: while there is none (a fresh install) the first currency created becomes
  // the base one with rate 1 (lib/currencies-repo.ts createCurrency). Unknown while loading or after a load error.
  const baseCode = base?.code ?? ""
  const baseName = base?.name ?? "—"
  const noBase = currencies !== null && !loadError && !baseCode
  const currencyRows = (currencies ?? []).filter((currency) => currency.name.toLowerCase().includes(needle) || currency.code.toLowerCase().includes(needle))
  const individualRows = (individual ?? []).filter((item) => item.name.toLowerCase().includes(needle))
  const pagedCurrencies = usePaged(currencyRows, controls.page, controls.pageSize)
  const pagedIndividual = usePaged(individualRows, controls.page, controls.pageSize)
  const paged = tab === "general" ? pagedCurrencies : pagedIndividual

  function switchTab(next: "general" | "individual") {
    setTab(next)
    controls.setQuery("")
  }

  async function remove(currency: Currency) {
    try {
      const response = await fetch(`/api/currencies/${currency.id}`, { method: "DELETE" })
      if (!response.ok) {
        // 409 for the base currency or while other records use it: the usage list says where (labels are i18n keys).
        const data = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
        const usage = data.usage?.map((item) => `${t(item.label)}: ${item.count}`).join(", ")
        notify(`${t(data.error || "Не удалось удалить валюту")}${usage ? ` (${usage})` : ""}`)
        return
      }
      setDeleting(null)
      void load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("currencies-template", [[t("Наименование"), t("Код"), t("Курс к SUM")]])
  }

  async function saveImport() {
    if (!importFile || importSaving) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        notify(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: { name: string; code: string; rate: number }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.code = row[1] ?? ""
          record.rate = row[2] ?? ""
        }
        if (!record.name || /^(наименование|название|name)$/i.test(record.name)) continue
        if (!record.code) continue
        parsed.push({ name: record.name, code: record.code.toUpperCase(), rate: Math.max(0, Number(record.rate) || 0) })
      }

      if (!parsed.length) {
        notify(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      // Without a base currency the first row saved becomes the base one and must have rate 1:
      // save the national currency (or another row with rate 1) first, never a row whose
      // rate is against a base that does not exist yet (the server refuses those then).
      let ordered = parsed
      if (!baseCode) {
        const withBase = baseCurrencyFirst(parsed)
        if (!withBase && noBase) {
          notify(t("Базовой валюты ещё нет: добавьте в файл базовую валюту с курсом 1"))
          return
        }
        if (withBase) ordered = withBase
      }

      let created = 0
      let failed = 0
      for (const item of ordered) {
        try {
          const response = await fetch("/api/currencies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item.name, code: item.code, rate: item.rate, isBase: false }),
          })
          if (response.ok) created += 1
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created) void load()
      if (failed) notify(`${t("Импортировано")} ${created} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <p className="h-[70px] pl-[30px] pt-[30px]">
        <span className="font-medium">{t("Основная валюта")}:</span> <b>{baseName}</b> <i className="text-[#777]">({t("используется при формировании стоимости продукта / заказа")})</i>
      </p>
      {loadError && <p className="-mt-[10px] pl-[30px] text-[13px] text-[#e57373]">{t(loadError)}</p>}
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
            {tab === "general" && (
              <span className="ml-[18px] flex items-center gap-[18px] pt-[3px]">
                <button type="button" onClick={() => setCreating(true)} className="text-[13px] text-[#4f71dc] hover:underline">{t("+ добавить валюту")}</button>
                <button type="button" onClick={() => setImportOpen(true)} className="text-[13px] text-[#4f71dc] hover:underline">{t("Импорт с Excel")}</button>
              </span>
            )}
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
              <span>1 {currency.name} = {money(currency.rate)} {baseName}</span>
              <span>{formatDateText(currency.rateDate, language, { withTime: true, utc: true })}</span>
              {!currency.isBase && (
                <RowActions
                  right={67}
                  gap={6}
                  extra={<RowIcon path={ROW_ICONS.dollar} label={t("Установить курс")} onClick={() => setRateOf(currency)} />}
                  onEdit={() => setEditing(currency)}
                  onDelete={() => setDeleting(currency)}
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
              <span>{money(item.rate)} {baseName}</span>
              <span>{formatDateText(item.beginDate, language, { withTime: false })}</span>
              <span>{formatDateText(item.endDate, language, { withTime: false })}</span>
              <span>{formatDateText(item.createdAt, language, { withTime: true, utc: true })}</span>
              <RowActions right={97} onEdit={() => setIndividualDialog({ item })} />
            </div>
          ))}
          {individual && pagedIndividual.rows.length === 0 && <EmptyRows />}
        </>
      )}

      {rateOf && <RateDialog currency={rateOf} onClose={() => setRateOf(null)} onSaved={() => { setRateOf(null); void load() }} />}
      {editing && <CurrencyDialog currency={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
      {history && <HistoryDialog currency={history} baseName={baseName} onClose={() => setHistory(null)} />}
      {creating && <CreateDialog noBase={noBase} baseCode={baseCode} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
      {deleting && <ConfirmDeleteDialog name={deleting.name} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
      {importOpen && (
        <ImportDialog
          file={importFile}
          onFile={setImportFile}
          onTemplate={downloadTemplate}
          onSave={() => void saveImport()}
          saving={importSaving}
          onClose={() => { setImportOpen(false); setImportFile(null) }}
        />
      )}
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
