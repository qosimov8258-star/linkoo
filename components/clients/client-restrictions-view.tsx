"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useEffect, useMemo, useRef, useState } from "react"

import { RefCard, RefHeader, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

type Config = {
  type?: string
  by?: string
  minQty?: boolean
  clients?: string[]
  items?: { name: string; qty: number }[]
}
type Restriction = { id: number; name: string; config: Config }

const SUBJECTS = ["Тип клиента", "Клиент", "Филиал", "Класс клиента"] as const
const BY = ["Продукт", "Тип продукта", "Бренд"] as const
const SUBJECT_TITLES: Record<string, string> = { "Тип клиента": "Типы клиентов", Клиент: "Клиенты", Филиал: "Филиалы", "Класс клиента": "Классы клиентов" }
const SUBJECT_ENDPOINT: Record<string, string> = { "Тип клиента": "/api/client-types", Клиент: "/api/clients", Филиал: "/api/branches" }
const BY_ENDPOINT: Record<(typeof BY)[number], string> = { Продукт: "/api/products", "Тип продукта": "/api/product-types", Бренд: "/api/brands" }

async function loadNames(url: string | undefined): Promise<string[]> {
  if (!url) return []
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const rows = (await response.json()) as { name?: string }[]
    return [...new Set(rows.map((row) => row.name ?? "").filter(Boolean))]
  } catch {
    return []
  }
}

const DOWNLOAD = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"

const BASE_PATH = "/clients/client-restrictions"

export function ClientRestrictionsView({ initialOpenId }: { initialOpenId?: number }) {
  const { t } = useLanguage()
  const [items, setItems] = useState<Restriction[]>([])
  const [query, setQuery] = useState("")
  const [form, setForm] = useState<Restriction | "new" | null>(null)
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null)

  // Same URL scheme as the reference: …/<id> for an opened restriction, ?openCreateDialog=true for the create dialog.
  const urlReady = useRef(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("openCreateDialog") === "true") setForm("new")
    urlReady.current = true
  }, [])
  useEffect(() => {
    if (!urlReady.current || !window.location.pathname.startsWith(BASE_PATH)) return
    const next = `${BASE_PATH}${openId ? `/${openId}` : ""}${form === "new" ? "?openCreateDialog=true" : ""}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next)
  }, [openId, form])

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-restrictions")
      .then((response) => (response.ok ? (response.json() as Promise<Restriction[]>) : []))
      .then((data) => {
        if (!cancelled) setItems([...data].sort((a, b) => b.id - a.id))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [items, query])
  const paging = usePaging(rows.length)
  const pageRows = rows.slice(paging.start, paging.end)

  async function save(draft: { id?: number; name: string; config: Config }) {
    try {
      const response = await fetch(draft.id ? `/api/client-restrictions/${draft.id}` : "/api/client-restrictions", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, config: draft.config }),
      })
      if (!response.ok) return false
      const saved = (await response.json()) as Restriction
      setItems((current) => (draft.id ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current]))
      setForm(null)
      return true
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
      return false
    }
  }

  async function remove(item: Restriction) {
    if (!(await askDelete(item.name))) return
    const response = await fetch(`/api/client-restrictions/${item.id}`, { method: "DELETE" })
    if (response.ok) {
      setItems((current) => current.filter((row) => row.id !== item.id))
      setOpenId(null)
    }
  }

  return (
    <RefPage>
      <RefHeader title={t("Ограничения по клиентам")}>
        <button onClick={() => setForm("new")} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
          {t("Добавить")}
        </button>
      </RefHeader>
      <RefCard className="bg-white">
        <RefToolbar
          hideFilter
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={rows.length ? paging.start + 1 : 0}
          to={paging.end}
          total={rows.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
        />
        <RefTable
          cols="minmax(0,700fr) minmax(0,692fr)"
          heads={["№", t("Наименование")]}
          rows={pageRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => setOpenId((current) => (current === row.id ? null : row.id))}
          rowClass={(row) => (openId === row.id ? "hidden" : "")}
          expanded={(row) =>
            openId === row.id ? <RestrictionDetail item={row} onEdit={() => setForm(row)} onDelete={() => void remove(row)} /> : null
          }
          empty={t("По вашему запросу ничего не найдено")}
          render={(row) => [<span key="n" className="pl-2">{row.id}</span>, row.name]}
        />
      </RefCard>
      {form && <RestrictionForm initial={form === "new" ? null : form} onSave={save} onClose={() => setForm(null)} />}
    </RefPage>
  )
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex h-[29px] items-center rounded-[4px] bg-[#f4f6f8] px-[11px] text-[12px] font-medium leading-4 text-[#8a94a0]">
      {label}:&nbsp;<b className="font-semibold text-[#2c3138]">{value}</b>
    </span>
  )
}

function RestrictionDetail({ item, onEdit, onDelete }: { item: Restriction; onEdit: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  const config = item.config
  const clients = config.clients ?? []
  const goods = config.items ?? []
  const total = goods.reduce((sum, good) => sum + good.qty, 0)
  return (
    <div className="-mx-[15px] bg-[#f2f5f8] py-[20px]">
    <div className="rounded-[10px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex items-start justify-between border-b border-[#eef1f4] px-[32px] pb-[26px] pt-[26px]">
        <div>
          <h3 className="text-[18px] font-semibold leading-[23px] text-[#333]">{item.name}</h3>
          <div className="mt-[11px] flex gap-[9px]">
            <Chip label={t("Тип")} value={t(config.type ?? "Клиент")} />
            <Chip label={t("Ограничение по")} value={t(config.by ?? "Продукт")} />
            {config.minQty && <Chip label={t("Мин. количество")} value={t("Да")} />}
          </div>
        </div>
        <div className="flex items-center gap-[28px] pr-[12px] pt-[12px]">
          <button type="button" onClick={onEdit} aria-label={t("Изменить")}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          </button>
          <button type="button" onClick={onDelete} aria-label={t("Удалить")}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[400px_1fr]">
        <div className="min-h-[171px] rounded-bl-[10px] bg-[#fbfcfd] px-[20px] pb-[12px] pt-[22px]">
          <div className="flex h-5 items-center gap-2 text-[12px] font-semibold uppercase leading-[15px] tracking-[0.7px] text-[#8a94a0]">
            {t(SUBJECT_TITLES[config.type ?? "Клиент"] ?? "Клиенты")}
            <span className="flex h-5 items-center rounded-[10px] bg-[#eef1f4] px-[7px] text-[12px] tracking-normal text-[#6b7480]">{clients.length}</span>
          </div>
          {clients.length === 0 ? (
            <p className="mt-[52px] text-center text-[14px] text-[#9aa4b0]">{t("Ничего не найдено")}</p>
          ) : (
            <ul className="mt-3 space-y-1 text-[13px] text-[#333]">{clients.map((name) => <li key={name}>{name}</li>)}</ul>
          )}
        </div>
        <div className="px-[32px] pb-[12px] pt-[22px]">
          <h4 className="text-[18px] font-semibold leading-[23px] text-[#333]">{t("Список товаров")}</h4>
          <div className="mt-[15px] overflow-hidden rounded-[10px] border border-[#eef1f4]">
            <div className="flex h-[40px] items-center border-b border-[#eef1f4] bg-[#f8fafb] px-[18px] text-[12px] font-semibold uppercase tracking-[0.55px] text-[#8a94a0]">
              <span className="w-[44px] text-[#a9b2bd]">№</span>
              <span className="flex-1 text-[#2c3138]">{t("Товар")}</span>
              <span>{t("Количество")}</span>
            </div>
            {goods.map((good, index) => (
              <div key={`${good.name}-${index}`} className="flex h-[40px] items-center border-b border-[#eef1f4] px-[18px] text-[13px] text-[#333]">
                <span className="w-[44px]">{index + 1}</span>
                <span className="flex-1">{good.name}</span>
                <span>{good.qty}</span>
              </div>
            ))}
            <div className="flex h-[46px] items-center bg-[#f4f6f8] px-[18px] py-2 font-semibold text-[#333]">
              <span className="flex-1 text-[14px]">{t("Итого")}</span>
              <span className="text-[16px]">{total}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} role="radio" aria-checked={checked} className="flex h-[34px] w-full items-center text-left text-[13px] text-black">
      <span className="mr-[18px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[#333]">
        {checked && <span className="h-[10px] w-[10px] rounded-full bg-[#5d6474]" />}
      </span>
      {label}
    </button>
  )
}

function PickSelect({ placeholder, options, value, onChange, className = "" }: { placeholder: string; options: string[]; value: string; onChange: (value: string) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const filtered = options.filter((option) => option.toLowerCase().includes(search.toLowerCase())).slice(0, 200)
  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-[46px] w-full items-center justify-between rounded-[3px] border border-[#ddd] bg-white px-[12px] text-left text-[13px]">
        <span className={value ? "text-[#333]" : "text-[#aaa]"}>{value || placeholder}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-[#555]" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <button type="button" aria-label="close" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-[48px] z-50 max-h-[260px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} className="mx-2 mb-1 h-8 w-[calc(100%-16px)] border-b border-[#ddd] px-1 text-[13px] outline-none" />
            {filtered.map((option) => (
              <button key={option} type="button" onClick={() => { onChange(option); setOpen(false); setSearch("") }} className="block h-9 w-full truncate px-[12px] text-left text-[13px] hover:bg-[#f2f5f8]">
                {option}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function PlusButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[3px] bg-[#f0f2f5] text-[24px] font-light text-[#999] enabled:text-[#4f71dc] disabled:cursor-default">
      +
    </button>
  )
}

function RestrictionForm({ initial, onSave, onClose }: { initial: Restriction | null; onSave: (draft: { id?: number; name: string; config: Config }) => Promise<boolean>; onClose: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(initial?.name ?? "")
  const [type, setType] = useState<string>(initial?.config.type ?? "Клиент")
  const [by, setBy] = useState<(typeof BY)[number]>((initial?.config.by as (typeof BY)[number]) ?? "Продукт")
  const [clients, setClients] = useState<string[]>(initial?.config.clients ?? [])
  const [items, setItems] = useState<{ name: string; qty: number }[]>(initial?.config.items ?? [])
  const [subjectOptions, setSubjectOptions] = useState<string[]>([])
  const [goodsOptions, setGoodsOptions] = useState<string[]>([])
  const [subjectPick, setSubjectPick] = useState("")
  const [goodPick, setGoodPick] = useState("")
  const [qty, setQty] = useState("0")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (type === "Класс клиента") setSubjectOptions(["A", "B", "C"])
    else void loadNames(SUBJECT_ENDPOINT[type]).then(setSubjectOptions)
  }, [type])
  useEffect(() => {
    void loadNames(BY_ENDPOINT[by]).then(setGoodsOptions)
  }, [by])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    await onSave({ id: initial?.id, name: name.trim(), config: { type, by, minQty: items.some((item) => item.qty > 0), clients, items } })
    setSaving(false)
  }

  async function importExcel(file: File | undefined) {
    if (!file) return
    const rowsData = await readExcelRows(file)
    const mapping = mapHeaderColumns(rowsData[0] ?? [], { "наименование": "name", "название": "name", "кол-во": "qty", "количество": "qty" })
    const hasHeader = Array.from(mapping.values()).includes("name")
    const parsed = (hasHeader ? rowsData.slice(1) : rowsData)
      .map((row) => {
        let itemName = row[0] ?? ""
        let itemQty = row[1] ?? "0"
        if (hasHeader) row.forEach((cell, index) => {
          if (mapping.get(index) === "name") itemName = cell
          if (mapping.get(index) === "qty") itemQty = cell
        })
        return { name: itemName.trim(), qty: Number(itemQty) || 0 }
      })
      .filter((row) => row.name)
    if (parsed.length) setItems((current) => [...current, ...parsed])
  }

  const heading = SUBJECT_TITLES[type] ?? "Клиенты"

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[24px]">
        <b className="uppercase">{initial ? t("Изменение ограничения") : t("Добавления ограничения")}</b>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[340px_520px_1fr]">
        <div className="border-r border-[#efefef] px-[30px] pt-[12px]">
          <label className="relative block h-[42px] w-[279px] border-b border-[#e0e0e0]">
            <span className="absolute left-0 top-[20px] font-semibold leading-4">
              {name ? null : (<>{t("Название ограничения")} <span className="text-[#e57373]">*</span></>)}
            </span>
            {name && <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{t("Название ограничения")}</span>}
            <input value={name} onChange={(event) => setName(event.target.value)} className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent font-semibold outline-none" />
          </label>
          <div className="mt-[20px] pl-[2px]">
            {SUBJECTS.map((subject) => (
              <Radio key={subject} label={t(subject)} checked={type === subject} onChange={() => { setType(subject); setClients([]); setSubjectPick("") }} />
            ))}
          </div>
          <p className="mb-[8.4px] mt-[8.3px] text-[13px] font-semibold">{t("Ограничения по")}:</p>
          <div className="pl-[2px]">
            {BY.map((item) => (
              <Radio key={item} label={t(item)} checked={by === item} onChange={() => { setBy(item); setGoodPick("") }} />
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-col border-r border-[#efefef] px-[24px] pb-[16px] pt-[16px]">
          <h3 className="text-[14px] font-semibold leading-[22px]">{t(heading)}</h3>
          <span className="mt-[9px] text-[12px] text-[#7a8288]">{t("Наименование")}</span>
          <div className="mt-[4px] flex gap-[10px]">
            <PickSelect className="flex-1" placeholder={t("Выберите из списка")} options={subjectOptions} value={subjectPick} onChange={setSubjectPick} />
            <PlusButton disabled={!subjectPick} onClick={() => { setClients((current) => (current.includes(subjectPick) ? current : [...current, subjectPick])); setSubjectPick("") }} />
          </div>
          <div className="mt-[16.3px] flex items-center justify-between">
            <b className="font-semibold">{t("Выбранные клиенты")}:</b>
            <span className="text-[12px] text-[#7a8288]">{t("Всего")}: {clients.length}</span>
          </div>
          <div className="mt-[6px] flex h-[30px] items-center text-[11px] font-semibold uppercase tracking-[0.4px] text-[#9aa1a6]"><span className="ml-[10px] w-[36px]">№</span>{t("Наименование")}</div>
          <div className="min-h-0 flex-1 overflow-y-auto border border-[#e8e8e8]">
            {clients.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[#999]">{t("Список пуст. Выберите из списка или загрузите Excel")}</div>
            ) : (
              clients.map((client, index) => (
                <div key={client} className="flex h-[40px] items-center border-b border-[#f1f1f1] px-[12px]">
                  <span className="w-[36px]">{index + 1}</span>
                  <span className="flex-1">{client}</span>
                  <button type="button" onClick={() => setClients((current) => current.filter((item) => item !== client))} aria-label={t("Удалить")} className="text-[#e57373]">×</button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-col px-[24px] pb-[16px] pt-[16px]">
          <div className="flex items-center justify-between">
            <h3 className="mt-[2.3px] text-[16px] font-bold">{t("Список товаров")}</h3>
            <div className="flex items-center gap-[12px]">
              <button type="button" onClick={() => downloadExcelTable("restriction-items-template", [[t("Наименование"), t("Кол-во")]])} className="mt-[2.8px] flex items-center gap-1 text-[12px] font-semibold uppercase text-[#71ce87]">
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-[#71ce87]" strokeWidth="2"><path d={DOWNLOAD} className="hidden" /><path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" /></svg>
                {t("Шаблон")}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(event) => { void importExcel(event.target.files?.[0]); event.target.value = "" }} />
              <button type="button" onClick={() => fileRef.current?.click()} className="mt-[2.8px] flex h-[30px] items-center gap-1 rounded-[3px] bg-[#71ce87] px-[14px] text-[12px] font-semibold uppercase text-white hover:brightness-95">
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-white" strokeWidth="2"><path d="M12 15V5m0 0l-4 4m4-4l4 4M5 19h14" /></svg>
                {t("Загрузить с Excel")}
              </button>
            </div>
          </div>
          <div className="mt-[13px] flex items-end gap-[10px]">
            <div className="flex-1">
              <span className="text-[12px] text-[#7a8288]">{t("Наименование")}</span>
              <PickSelect className="mt-[2.2px]" placeholder={t("Выберите из списка")} options={goodsOptions} value={goodPick} onChange={setGoodPick} />
            </div>
            <div className="w-[130px]">
              <span className="relative top-[1.8px] text-[12px] text-[#7a8288]">{t("Кол-во")}</span>
              <input value={qty} onChange={(event) => setQty(event.target.value.replace(/[^\d.]/g, ""))} className="mt-[2px] block h-[46px] w-full rounded-[3px] border border-[#ddd] px-[12px] outline-none" />
            </div>
            <PlusButton disabled={!goodPick} onClick={() => { setItems((current) => [...current, { name: goodPick, qty: Number(qty) || 0 }]); setGoodPick(""); setQty("0") }} />
          </div>
          <div className="mt-[14.3px] flex items-center justify-between">
            <b className="font-semibold">{t("Добавленные товары")}:</b>
            <span className="text-[12px] text-[#7a8288]">{t("Всего")}: {items.length}</span>
          </div>
          <div className="mt-[5.3px] flex h-[30px] items-center text-[11.5px] font-bold uppercase tracking-[0.4px] text-[#98a2ac]">
            <span className="ml-[10px] w-[36px]">№</span>
            <span className="flex-1">{t("Наименование")}</span>
            <span className="w-[164px]">{t("Кол-во")}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border border-[#e8e8e8]">
            {items.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[#999]">{t("Список пуст. Добавьте товары или загрузите Excel")}</div>
            ) : (
              items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex h-[40px] items-center border-b border-[#f1f1f1] px-[12px]">
                  <span className="w-[36px]">{index + 1}</span>
                  <span className="flex-1">{item.name}</span>
                  <span className="w-[144px]">{item.qty}</span>
                  <button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label={t("Удалить")} className="text-[#e57373]">×</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <footer className="flex h-[58px] shrink-0 items-center justify-end border-t border-[#efefef] pr-[26px]">
        <button type="button" onClick={() => void submit()} className="text-[13px] font-semibold uppercase text-[#129fdd]">{t("Сохранить")}</button>
      </footer>
    </div>
  )
}
