"use client"

import { X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { SaveLink } from "@/components/analytics/catalog-ui"
import { LinePick } from "@/components/analytics/settings-list-kit"
import { FilterDate, RefFilterPanel } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"
import { notify } from "@/lib/notify"

export type PricePeriod = { period: number; percent: number; licenses: Array<{ key: string; name: string; price: number }> }
export type LicenseGroup = { key: string; name: string; available: number }
type ProlongOption = {
  period: number
  percent: number
  total: number
  licenses: Array<{ key: string; name: string; amount: number; beginDate: string; endDate: string; price: number; total: number }>
}

export function sum(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU").replace(/[  ]/g, " ")} SUM`
}

async function errorText(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return body.error || fallback
}

function FullScreen({ title, onClose, footer, children, titleSuffix, inset, bigTitle }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode; titleSuffix?: ReactNode; inset?: boolean; /** 15 px title (the reference's «АКТ СВЕРКИ»). */ bigTitle?: boolean }) {
  const { t } = useLanguage()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className={`fixed inset-0 z-[110] flex flex-col bg-white text-[13px] text-[#333] ${inset ? "px-[30px]" : ""}`}>
      <header className={`flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] ${bigTitle ? "pr-[42px]" : "pr-[28px]"} ${inset ? "pl-[30px]" : "pl-[30px]"}`}>
        <h3 className={`flex items-baseline gap-[8px] ${bigTitle ? "text-[15px]" : "text-[13px]"} font-bold uppercase`}>{title}{titleSuffix}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className={`h-6 w-6 ${bigTitle ? "text-[#333]" : "text-slate-500"}`} strokeWidth={bigTitle ? 1.6 : 2} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {!bigTitle && <footer className="flex h-[57px] shrink-0 items-center justify-between border-t border-[#efefef] px-[10px]">{footer}</footer>}
    </div>
  )
}

/** Small centered dialog of the Подписки page: 500 px wide, "подписки" title, optional green footer button. */
function MiniModal({ onClose, children, footer, bodyHeight = 200 }: { onClose: () => void; children: ReactNode; footer?: ReactNode; bodyHeight?: number }) {
  const { t } = useLanguage()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-[500px] max-w-full bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[28px]">
          <h3 className="text-[15px] font-semibold">{t("подписки")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div style={{ height: bodyHeight }}>{children}</div>
        {footer && <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

/** "подписки" — notice shown when an action needs a selected employee. */
export function NoticeDialog({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <MiniModal onClose={onClose}>
      <p className="flex h-full items-center justify-center text-[19px] font-semibold">{text}</p>
    </MiniModal>
  )
}

export function AttachDialog({ ids, groups, onClose, onSaved }: { ids: number[]; groups: LicenseGroup[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [licenseKey, setLicenseKey] = useState("")
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!licenseKey || saving) return
    setSaving(true)
    try {
      const response = await fetch("/api/subscriptions/attach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, licenseKey }) })
      if (!response.ok) {
        notify(t(await errorText(response, "Не удалось прикрепить подписку")))
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
    <MiniModal
      onClose={onClose}
      footer={<button type="button" onClick={() => void save()} disabled={!licenseKey || saving} className="h-[36px] rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-bold uppercase text-white hover:brightness-95 disabled:cursor-default">{t("Сохранить")}</button>}
    >
      <div className="px-[30px] pt-[52px]">
        <LinePick
          label={t("Лицензия")}
          value={licenseKey}
          clearable={false}
          options={groups.map((group) => ({ value: group.key, label: `${group.name} - ${t("Доступно")} ${group.available} ${t("шт.")}` }))}
          onChange={setLicenseKey}
        />
      </div>
    </MiniModal>
  )
}

export function DetachDialog({ onConfirm, onClose, busy }: { count: number; onConfirm: () => void; onClose: () => void; busy: boolean }) {
  const { t } = useLanguage()
  // Reference: the same small "подписки" dialog (368 px high), the question and a green «ДА».
  return (
    <MiniModal
      onClose={onClose}
      bodyHeight={251}
      footer={<button type="button" disabled={busy} onClick={onConfirm} className="h-[36px] min-w-[88px] rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-bold uppercase text-white hover:brightness-95 disabled:cursor-default">{t("Да")}</button>}
    >
      <p className="px-[30px] pt-[30px] text-[15px]">{t("Вы точно хотите открепить все выделенные подписки?")}</p>
    </MiniModal>
  )
}

/** "ПРОДЛИТЬ ПОДПИСКУ": one tab per period with the license table; "Подтвердить" charges the balance. */
export function ProlongDialog({ ids, onClose, onDone }: { ids: number[]; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [options, setOptions] = useState<ProlongOption[] | null>(null)
  const [active, setActive] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/subscriptions/prolong?users=${ids.join(",")}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: ProlongOption[]) => { if (!cancelled) setOptions(data) })
      .catch(() => { if (!cancelled) setOptions([]) })
    return () => { cancelled = true }
  }, [ids])

  const option = options?.[active]
  async function confirm() {
    if (!option || saving) return
    setSaving(true)
    try {
      const response = await fetch("/api/subscriptions/extend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, period: option.period }) })
      if (!response.ok) {
        notify(t(await errorText(response, "Не удалось продлить подписку")))
        return
      }
      onDone()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FullScreen title={t("Продлить подписку")} onClose={onClose} footer={<><span /><SaveLink disabled={!option || saving} onClick={() => void confirm()}>{t("Подтвердить")}</SaveLink></>}>
      <div className="flex border-b border-[#efefef]">
        {options?.map((item, index) => (
          <button key={item.period} type="button" onClick={() => setActive(index)} className="relative h-[50px] flex-1 text-[16px] font-semibold uppercase">
            <span className="text-[#4f71dc]">{item.period}</span> {t("месяц")}: <span className="text-[#4f71dc]">{sum(item.total)}</span>
            {index === active && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#4f71dc]" />}
          </button>
        ))}
      </div>
      {option && (
        <div className="px-[22px] pt-[10px] text-[16px]">
          <div className="grid h-[60px] grid-cols-6 items-center font-semibold">
            <span>{t("Название")}</span><span>{t("Кол-во")}</span><span>{t("Начало")}</span><span>{t("Конец")}</span><span>{t("Цена")}</span><span>{t("Сумма")}</span>
          </div>
          {option.licenses.map((license) => (
            <div key={license.key} className="grid h-[60px] grid-cols-6 items-center border-y-2 border-dotted border-[#d9e0e5]">
              <span>{license.name}</span>
              <span>{license.amount}</span>
              <span>{refDate(license.beginDate)}</span>
              <span>{refDate(license.endDate)}</span>
              <span>{sum(license.price)}</span>
              <span>{sum(license.total)}</span>
            </div>
          ))}
        </div>
      )}
    </FullScreen>
  )
}

/** "ДОБАВЛЕНИЕ ПОДПИСКИ": period cards, then "ВЫБЕРИТЕ КОЛИЧЕСТВО N МЕСЯЦ" with a start date and a count per license. */
export function PurchaseDialog({ pricing, onClose, onDone }: { pricing: PricePeriod[]; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [chosen, setChosen] = useState<PricePeriod | null>(null)
  const [startDate, setStartDate] = useState("")
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const total = chosen ? chosen.licenses.reduce((acc, license) => acc + license.price * chosen.period * (Number(counts[license.key]) || 0), 0) : 0

  async function save() {
    if (!chosen || saving) return
    if (!startDate) {
      notify(t("Укажите дату начала подписки"))
      return
    }
    setSaving(true)
    try {
      const items = chosen.licenses.map((license) => ({ licenseKey: license.key, count: Number(counts[license.key]) || 0 })).filter((item) => item.count > 0)
      const response = await fetch("/api/subscriptions/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: chosen.period, startDate, items }) })
      if (!response.ok) {
        notify(t(await errorText(response, "Не удалось купить подписку")))
        return
      }
      onDone()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  if (chosen) {
    return (
      <FullScreen
        title={t("Выберите количество")}
        inset
        titleSuffix={<span className="text-[22px] font-semibold uppercase text-[#5d6474]"><span className="text-[#4f71dc]">{chosen.period}</span> {t("месяц")}</span>}
        onClose={onClose}
        footer={<><span className="pl-[0px] text-[15px]">{t("Итого")}: <b>{sum(total)}</b></span><SaveLink disabled={saving || total <= 0} onClick={() => void save()}>{t("Сохранить")}</SaveLink></>}
      >
        <div className="pt-[40px]">
          <label className="flex items-center gap-[10px] pl-[30px] text-[15px] font-bold">
            {t("Подписка действует начиная с даты:")}
            <input type="date" value={startDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} className={`h-[40px] w-[255px] border-b border-[#d5dae1] bg-transparent text-[14px] font-normal outline-none ${startDate ? "" : "text-transparent"}`} />
          </label>
          <div className="mt-[40px] grid grid-cols-[1fr_1fr_1fr_1fr] items-center px-[8px] font-semibold">
            <span className="pl-[22px]">{t("Название пакета")}</span><span>{t("Цена")}</span><span>{t("Кол-во лицензий")}</span><span>{t("Сумма")}</span>
          </div>
          {chosen.licenses.map((license) => (
            <div key={license.key} className="mt-[10px] grid h-[52px] grid-cols-[1fr_1fr_1fr_1fr] items-center border-y-2 border-dotted border-[#d9e0e5] px-[8px] text-[14px]">
              <span className="pl-[22px]">{license.name}</span>
              <span>{sum(license.price)}</span>
              <span className="pr-[16px]"><input inputMode="numeric" value={counts[license.key] ?? ""} onChange={(event) => setCounts((current) => ({ ...current, [license.key]: event.target.value.replace(/\D/g, "").slice(0, 6) }))} className="h-[40px] w-full border-b border-[#d5dae1] bg-transparent outline-none" /></span>
              <span>{sum(license.price * chosen.period * (Number(counts[license.key]) || 0))} ({t("на")} {chosen.period} {t("месяц")})</span>
            </div>
          ))}
        </div>
      </FullScreen>
    )
  }

  return (
    <FullScreen title={t("Добавление подписки")} onClose={onClose} footer={<SaveLink disabled>{t("Сохранить")}</SaveLink>}>
      <div className="flex justify-center gap-[30px] px-[30px] pt-[50px]">
        {pricing.map((period) => (
          <div key={period.period} className="flex h-[406px] w-[300px] flex-col shadow-[0_1px_6px_rgba(0,0,0,0.15),0_1px_4px_rgba(0,0,0,0.12)]">
            <div className="flex h-[52px] items-center justify-center gap-[6px] border-b border-[#efefef] text-[20px] text-[#5d6474]">
              <b className="text-[24px] text-[#4f71dc]">{period.period}</b> {t("месяц")}
              {period.percent > 0 && <span className="rounded-[10px] bg-[#4f71dc] px-[8px] py-[2px] text-[12px] font-semibold text-white">{t("Скидка")} {period.percent}%</span>}
            </div>
            <div className="flex-1 space-y-[3px] px-[30px] pt-[30px] text-[15px] font-semibold text-[#5d6474]">
              {period.licenses.map((license) => (
                <div key={license.key} className="flex justify-between gap-[10px]">
                  <span>{license.name.replace("(", " (").replace("  (", " (")}:</span>
                  <span className="shrink-0 whitespace-nowrap font-normal">{sum(license.price)}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setChosen(period)} className="h-[52px] border-t border-[#efefef] text-[22px] font-bold text-[#4f71dc] hover:bg-[#f7f9ff]">{t("Выбрать")}</button>
          </div>
        ))}
      </div>
    </FullScreen>
  )
}

type ActResult = { rows: Array<{ date: string; type: string; debit: number; credit: number; beginDate: string | null; endDate: string | null }>; total: number }

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** "АКТ СВЕРКИ": opening balance, ledger rows of the period, closing balance. */
export function ActDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [range, setRange] = useState(() => {
    const end = new Date()
    const begin = new Date(end)
    begin.setMonth(begin.getMonth() - 1)
    return { begin: isoDay(begin), end: isoDay(end) }
  })
  const [draft, setDraft] = useState(range)
  const [filterOpen, setFilterOpen] = useState(false)
  const [data, setData] = useState<ActResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/subscriptions/act?begin=${range.begin}&end=${range.end}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { rows: [], total: 0 }))
      .then((result: ActResult) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setData({ rows: [], total: 0 }) })
    return () => { cancelled = true }
  }, [range])

  return (
    <FullScreen title={t("АКТ сверки")} bigTitle onClose={onClose} footer={<span />}>
      <div className="relative">
        <button type="button" onClick={() => { setDraft(range); setFilterOpen((open) => !open) }} className="h-[50px] pl-[5px] text-[13px] text-[#4f71dc]">{t("Показать фильтр")} ⌄</button>
        {filterOpen && (
          <div className="absolute left-[5px] top-[-5px] z-30 w-[300px]">
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={() => { setRange(draft); setFilterOpen(false) }}>
              <FilterDate label={t("Период создания")} begin={draft.begin} end={draft.end} onChange={(begin, end) => setDraft({ begin, end })} />
            </RefFilterPanel>
          </div>
        )}
      </div>
      <div className="grid h-[35px] grid-cols-[267px_356px_168px_184px_252px_1fr] items-center bg-[#eff2f7] font-semibold text-[#374557]">
        <span className="pl-[17px]">{t("Дата")}</span><span className="pl-[17px]">{t("Тип")}</span><span className="pl-[17px]">{t("Дебит")}</span><span className="pl-[17px]">{t("Кредит")}</span><span className="pl-[17px]">{t("Действует с")}</span><span className="pl-[17px]">{t("Действует до")}</span>
      </div>
      {data?.rows.map((row, index) => (
        <div key={index} className="grid h-[36px] grid-cols-[267px_356px_168px_184px_252px_1fr] border-b border-[#e6e9ee] font-semibold [&>span]:flex [&>span]:items-center">
          <span className="pl-[17px]">{refDate(row.date)}</span>
          <span className="border-l border-[#e6e9ee] pl-[18px]">{t(row.type)}</span>
          <span className="border-l border-[#e6e9ee] pl-[17px] text-[#e57373]">{Math.round(row.debit).toLocaleString("ru-RU")}</span>
          <span className="border-l border-[#e6e9ee] pl-[17px] text-[#8acb8d]">{Math.round(row.credit).toLocaleString("ru-RU")}</span>
          <span className="border-l border-[#e6e9ee] pl-[17px]">{row.beginDate ? refDate(row.beginDate) : ""}</span>
          <span className="border-l border-[#e6e9ee] pl-[17px]">{row.endDate ? refDate(row.endDate) : ""}</span>
        </div>
      ))}
      {data && (
        <div className="grid h-[36px] grid-cols-[267px_356px_168px_184px_252px_1fr] border-b border-[#e6e9ee] font-semibold [&>span]:flex [&>span]:items-center">
          <span className="pl-[17px]">{t("Итого")}</span><span /><span /><span className="border-l border-[#e6e9ee] pl-[17px] text-[#8acb8d]">{Math.round(data.total).toLocaleString("ru-RU")}</span><span className="border-l border-[#e6e9ee]" /><span className="border-l border-[#e6e9ee]" />
        </div>
      )}
    </FullScreen>
  )
}


