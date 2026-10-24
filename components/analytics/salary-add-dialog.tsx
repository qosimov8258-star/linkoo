"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { FilterSelect, RI } from "@/components/ref/list-kit"
import { RefPager } from "@/components/ref/pager-controls"
import { useLanguage } from "@/lib/i18n/language-context"

type Person = { id: number; name: string; job: string; accessRight: string; active: boolean }

const MONTHS_UPPER = ["ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ", "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"]

/**
 * The reference's "ДОБАВИТЬ ЗАРПЛАТУ СОТРУДНИКА НА <МЕСЯЦ ГОД>": a full-screen list of the employees with a salary input per row.
 * Saving adds a salary plan (for the chosen month) for every row that got an amount.
 */
export function SalaryAddDialog({
  month,
  year,
  onClose,
  onSave,
}: {
  month: number
  year: number
  onClose: () => void
  onSave: (entries: Array<{ employee: string; salary: number }>) => Promise<void>
}) {
  const { t } = useLanguage()
  const [people, setPeople] = useState<Person[]>([])
  const [accessRight, setAccessRight] = useState("")
  const [currencies, setCurrencies] = useState<string[]>([])
  const [currency, setCurrency] = useState("")
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Array<{ id: number; name?: string; firstName?: string; lastName?: string; job?: string; accessRight?: string; active?: boolean }>) => {
        if (cancelled) return
        setPeople(
          data
            .filter((row) => row.active !== false)
            .map((row) => ({ id: row.id, name: row.name || [row.firstName, row.lastName].filter(Boolean).join(" "), job: row.job ?? "", accessRight: row.accessRight ?? "", active: row.active !== false })),
        )
      })
      .catch(() => {})
    fetch("/api/currencies")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Array<{ name?: string }>) => {
        if (!cancelled) setCurrencies(data.map((item) => item.name ?? "").filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const accessRights = useMemo(() => [...new Set(people.map((person) => person.accessRight).filter(Boolean))], [people])
  const filtered = people.filter((person) => (!accessRight || person.accessRight === accessRight) && person.name.toLowerCase().includes(query.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const shown = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function save() {
    const entries = people
      .filter((person) => Number(amounts[person.id]) > 0)
      .map((person) => ({ employee: person.name, salary: Number(amounts[person.id]) }))
    setSaving(true)
    try {
      await onSave(entries)
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[1400] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#eee] pl-[30px] pr-[18px]">
        <span className="text-[13px] font-bold uppercase text-[#333]">{t("Добавить зарплату сотрудника на")} {MONTHS_UPPER[month]} {year}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
        </button>
      </div>
      <div className="relative flex h-[70px] shrink-0 items-center border-b border-[#eee] px-[30px]">
        <FilterSelect className="w-[250px]" label={t("Права доступа")} value={accessRight} onChange={(value) => { setAccessRight(value); setPage(1) }} options={accessRights} />
        <div className="absolute left-[550px] top-[14px] flex h-[42px] w-[280px] items-center rounded-[2px] border border-[#dfe3e8] bg-[#f2f5f8] px-[10px]">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={`${t("Поиск")}...`} className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </div>
        <div className="absolute left-[970px] top-[4px] w-[250px]"><FilterSelect label={t("Валюта")} value={currency} onChange={setCurrency} options={currencies} /></div>
        <div className="ml-auto flex items-center text-[#5d6474]">
          <RefPager
            pageSize={pageSize}
            onPageSize={(size) => { setPageSize(size); setPage(1) }}
            from={filtered.length ? (safePage - 1) * pageSize + 1 : 1}
            to={Math.min(safePage * pageSize, filtered.length)}
            total={filtered.length}
            page={safePage}
            pageCount={pageCount}
            onPage={setPage}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid h-[50px] grid-cols-[485px_238px_1fr] items-center border-b border-[#eee] pl-[30px] pr-[30px] font-semibold text-[#333]">
          <span>{t("Наименование")}</span>
          <span className="pl-[0px]">{t("Должность")}</span>
          <div className="grid grid-cols-[244px_1fr]"><span>{t("Права доступа")}</span><span className="pr-[10px] text-right">{t("Зарплата")}</span></div>
        </div>
        {shown.map((person) => (
          <div key={person.id} className="grid h-[50px] grid-cols-[485px_238px_1fr] items-center border-b border-[#f1f1f1] pl-[30px] pr-[30px]">
            <span className="truncate">{person.name}</span>
            <span className="pl-[4px]">{t(person.job)}</span>
            <div className="grid grid-cols-[244px_1fr] items-center">
              <span className="pl-[0px]">{t(person.accessRight)}</span>
              <input
                value={amounts[person.id] ?? ""}
                onChange={(event) => setAmounts((current) => ({ ...current, [person.id]: event.target.value.replace(/[^\d.]/g, "") }))}
                inputMode="decimal"
                className="mt-[6px] h-[36px] w-full border-b border-[#e0e0e0] bg-transparent text-right text-[13px] outline-none focus:border-[#5d6474]"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-[58px] shrink-0 items-center justify-end border-t border-[#eee] pr-[26px]">
        <button type="button" disabled={saving} onClick={() => void save()} className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
      </div>
    </div>,
    document.body,
  )
}
