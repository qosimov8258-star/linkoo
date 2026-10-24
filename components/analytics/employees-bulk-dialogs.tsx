"use client"

import { X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { LinePick } from "@/components/analytics/settings-list-kit"
import { LineField } from "@/components/analytics/catalog-ui"
import { Check, MultiSelectField, type Option } from "@/components/staff/staff-kit"
import type { EmployeeOptions } from "@/components/analytics/employees-data"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

function Dialog({ title, width, onClose, footer, children }: { title: string; width: number; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 py-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" style={{ width }} className="max-w-full bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[28px]">
          <h3 className="text-[13px] font-bold uppercase">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        {children}
        <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">{footer}</footer>
      </div>
    </div>,
    document.body,
  )
}

type Group = "cashboxes" | "branches" | "supervisor" | "organizations" | "stocks" | "priceLists" | "currencies" | "restrictions"

/** "ИЗМЕНЕНИЕ": every ticked group of fields is overwritten for the selected employees. */
export function BulkChangeDialog({ ids, options, onClose, onDone }: { ids: number[]; options: EmployeeOptions; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [ticked, setTicked] = useState<Group[]>([])
  const [values, setValues] = useState<Record<Group, string[]>>({ cashboxes: [], branches: [], supervisor: [], organizations: [], stocks: [], priceLists: [], currencies: [], restrictions: [] })
  const [removeOld, setRemoveOld] = useState(false)
  const [saving, setSaving] = useState(false)

  const named = (list: Array<{ id: number; name: string }>): Option[] => list.map((item) => ({ value: String(item.id), label: item.name }))
  const groups: Array<{ key: Group; label: string; caption: string; options: Option[]; single?: boolean }> = [
    { key: "cashboxes", label: t("Изменить кассы"), caption: t("Какие кассы будут доступны?"), options: named(options.cashboxes) },
    { key: "branches", label: t("Изменить филиалы"), caption: t("Какие филиалы будут доступны?"), options: named(options.branches) },
    { key: "supervisor", label: t("Изменить супервайзер"), caption: t("Супервайзер"), options: named(options.employees), single: true },
    { key: "organizations", label: t("Изменить организации"), caption: t("Какие организации будут доступны?"), options: named(options.organizations) },
    { key: "stocks", label: t("Изменить склады"), caption: t("Какие склады будут доступны?"), options: named(options.warehouses) },
    { key: "priceLists", label: t("Изменить прайс лист"), caption: t("Какие прайс листы будут доступны?"), options: named(options.priceLists) },
    { key: "currencies", label: t("Изменить валюты"), caption: t("Какие валюты будут доступны?"), options: named(options.currencies) },
    { key: "restrictions", label: t("Изменить ограничение времени"), caption: t("Ограничения времени"), options: named(options.restrictions) },
  ]

  async function save() {
    if (saving || !ticked.length) return
    const numbers = (group: Group) => values[group].map(Number)
    const change: Record<string, unknown> = {}
    if (ticked.includes("cashboxes")) change.cashboxIds = numbers("cashboxes")
    if (ticked.includes("branches")) {
      if (!values.branches.length) return notify(t("Выберите хотя бы один филиал"))
      change.branchIds = numbers("branches")
    }
    if (ticked.includes("supervisor")) change.supervisorId = values.supervisor[0] ? Number(values.supervisor[0]) : null
    if (ticked.includes("organizations")) {
      if (!values.organizations.length) return notify(t("Выберите хотя бы одну организацию"))
      change.organizationIds = numbers("organizations")
    }
    if (ticked.includes("stocks")) change.stockIds = numbers("stocks")
    if (ticked.includes("priceLists")) change.priceListIds = numbers("priceLists")
    if (ticked.includes("currencies")) change.currencyIds = numbers("currencies")
    if (ticked.includes("restrictions")) change.restrictions = { names: options.restrictions.filter((item) => values.restrictions.includes(String(item.id))).map((item) => item.name), replace: removeOld }
    setSaving(true)
    try {
      const response = await fetch("/api/employees/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, change }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(body.error || "Не удалось изменить сотрудников"))
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
    <Dialog
      title={t("Изменение")}
      width={700}
      onClose={onClose}
      footer={<button type="button" onClick={() => void save()} disabled={saving} className="h-9 px-[16px] text-[12px] font-bold uppercase text-[#1ea1f2] hover:opacity-80 disabled:opacity-40">{t("Изменить")}</button>}
    >
      <div className="px-[30px] pb-[16px] pt-[22px]">
        {groups.map((group) => {
          const on = ticked.includes(group.key)
          return (
            <div key={group.key}>
              <div className="flex h-[30px] items-center">
                <Check checked={on} onChange={(checked) => setTicked((current) => (checked ? [...current, group.key] : current.filter((key) => key !== group.key)))} label={group.label} />
              </div>
              {on && group.key === "restrictions" && (
                <div className="pb-[10px] pl-[2px]">
                  <Check checked={removeOld} onChange={setRemoveOld} label={t("Удалить старые")} />
                </div>
              )}
              {on && (
                <div className="pb-[14px]">
                  {group.single ? (
                    <LinePick label={group.caption} value={values[group.key][0] ?? ""} options={group.options} onChange={(value) => setValues((current) => ({ ...current, [group.key]: value ? [value] : [] }))} />
                  ) : (
                    <MultiSelectField label={group.caption} options={group.options} value={values[group.key]} onChange={(value) => setValues((current) => ({ ...current, [group.key]: value }))} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}

/** "ОГРАНИЧИТЬ ДОСТУП СОТРУДНИКА": confirmation code and block / unblock everyone. */
export function BlockAllDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [code, setCode] = useState("")
  const [block, setBlock] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    if (!code.trim()) return setError(t("Обязательное поле"))
    setSaving(true)
    try {
      const response = await fetch("/api/employees/block-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), block }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(t(body.error || "Не удалось сохранить"))
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
    <Dialog
      title={t("Ограничить доступ сотрудника")}
      width={600}
      onClose={onClose}
      footer={<button type="button" onClick={() => void save()} disabled={saving} className="h-9 px-[16px] text-[12px] font-bold uppercase text-[#1ea1f2] hover:opacity-80 disabled:opacity-40">{t("Сохранить")}</button>}
    >
      <div className="px-[30px] pb-[10px] pt-[40px]">
        <LineField label={t("Код подтверждения")} value={code} onChange={(value) => { setCode(value); setError("") }} />
        {error && <span className="mt-[2px] block text-[12px] text-[#e57373]">{error}</span>}
        <div className="mt-[20px] space-y-[8px]">
          {[{ value: true, label: t("Блокировать всех") }, { value: false, label: t("Разблокировать всех") }].map((item) => (
            <label key={String(item.value)} className="flex cursor-pointer items-center gap-[14px] py-[2px] text-[13px]">
              <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 ${block === item.value ? "border-[#5d6474]" : "border-[#555]"}`}>
                {block === item.value && <span className="h-[10px] w-[10px] rounded-full bg-[#5d6474]" />}
              </span>
              <input type="radio" name="block-all" checked={block === item.value} onChange={() => setBlock(item.value)} className="sr-only" />
              {item.label}
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
