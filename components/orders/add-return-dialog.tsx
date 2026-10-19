"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

import { Checkbox, DateField, SelectField, toInputDate } from "./add-order-dialog"

type Mode = "client" | "orders" | "legacy"

/** Full-screen "Добавление возврата" form of the reference app. */
export function AddReturnDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (client: string) => void }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<Mode>("client")
  const [date, setDate] = useState(() => toInputDate(new Date()))
  const [client, setClient] = useState("")
  const [warehouse, setWarehouse] = useState("")
  const [deliverer, setDeliverer] = useState("")
  const [agent, setAgent] = useState("")
  const [comment, setComment] = useState("")
  const [manual, setManual] = useState(false)
  const [clients, setClients] = useState<string[]>([])
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  
  useEffect(() => {
    let cancelled = false
    const load = async (url: string, pick: (row: { name: string }) => string, set: (rows: string[]) => void) => {
      try {
        const response = await fetch(url)
        if (!response.ok) return
        const data = (await response.json()) as { name: string }[]
        if (!cancelled && Array.isArray(data)) set(data.map(pick))
      } catch {
        // options stay empty when the API is unreachable
      }
    }
    void load("/api/clients", (row) => row.name, setClients)
    void load("/api/warehouses", (row) => row.name, setWarehouses)
    void load("/api/employees", (row) => row.name, setPeople)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const options = useMemo(() => ({ clients: clients.map((c) => ({ value: c, label: c })), warehouses: warehouses.map((c) => ({ value: c, label: c })), people: people.map((c) => ({ value: c, label: c })) }), [clients, warehouses, people])
  const modes: { key: Mode; label: string }[] = [
    { key: "client", label: t("Возврат по конкретному клиенту") },
    { key: "orders", label: t("Возврат по всем заказам") },
    { key: "legacy", label: t("Возврат по старой базе") },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[14px]">
        <h2 className="text-[13px] font-bold uppercase">{t("Добавление возврата")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-600"><X className="h-6 w-6" /></button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[405px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[#efefef] px-[14px] py-[16px] pr-[60px]">
          <div className="space-y-[14px]">
            {modes.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-center gap-[8px] text-[10px] font-semibold">
                <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${mode === item.key ? "border-slate-700" : "border-slate-600"}`}>
                  {mode === item.key && <span className="h-[8px] w-[8px] rounded-full bg-slate-700" />}
                </span>
                <input type="radio" name="return-mode" checked={mode === item.key} onChange={() => setMode(item.key)} className="sr-only" />
                {item.label}
              </label>
            ))}
          </div>
          <p className="mb-[2px] mt-[26px] text-[10px] font-semibold">{t("Детали")}</p>
          <DateField label={t("Дата возврата")} required value={date} onChange={setDate} />
          <SelectField label={t("Клиент")} required placeholderLabel value={client} onChange={setClient} options={options.clients} onClear={() => setClient("")} />
          <SelectField label={t("Склад")} required placeholderLabel value={warehouse} onChange={setWarehouse} options={options.warehouses} onClear={() => setWarehouse("")} />
          <SelectField label={t("Доставщик")} required placeholderLabel value={deliverer} onChange={setDeliverer} options={options.people} onClear={() => setDeliverer("")} />
          <SelectField label={t("Ответственный агент")} placeholderLabel value={agent} onChange={setAgent} options={options.people} onClear={() => setAgent("")} />
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Оставить комментарий...")} className="mt-[22px] h-[34px] w-full border-b border-slate-300 bg-transparent text-[13px] font-semibold outline-none placeholder:text-slate-800" />
          <label className="mt-[22px] flex cursor-pointer items-center gap-[8px] text-[10px] font-semibold">
            <Checkbox checked={manual} onChange={setManual} />
            {t("Указать стоимость в ручную")}
          </label>
        </aside>
        <main className="relative min-w-0 px-[14px] py-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold">{t("Список товаров")}</span>
            <div className="flex items-center gap-[14px]">
              {!client && <span className="rounded-[3px] bg-[#3a3f4b] px-[14px] py-[10px] text-[10px] font-semibold text-white">{t("Пожалуйста, выберите клиента перед добавлением продуктов")}</span>}
              <button type="button" className="text-[10px] font-semibold text-[#0a9ddb]">+ {t("добавить товар")}</button>
            </div>
          </div>
          <div className="mt-[130px] flex flex-col items-center text-center text-[10px] text-slate-400">
            <img src="/empty-basket.svg" alt="" className="h-[60px] w-[60px] opacity-60" />
            <p className="mt-[10px]">{t("Для добавления товаров выберите клиента.")}</p>
          </div>
        </main>
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-between border-t border-[#efefef] px-[14px]">
        <span className="text-[10px] font-semibold">{t("Общая стоимость:")} <span className="text-[#0a9ddb]">0 SUM</span> &nbsp; {t("Общее кол-во:")} <span className="text-[#0a9ddb]">0 {t("ед")}</span></span>
        <button type="button" disabled={!client} onClick={() => onCreated(client)} className="text-[10px] font-bold uppercase text-[#0a9ddb] disabled:opacity-50">{t("Далее")}</button>
      </footer>
    </div>,
    document.body,
  )
}
