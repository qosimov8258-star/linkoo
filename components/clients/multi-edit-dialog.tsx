"use client"

import { useMemo, useState } from "react"

import { FilterSelect } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import type { Client } from "./clients-data"
import { useDirectoryNames } from "./use-directory"

export type MultiEditPatch = Partial<Pick<Client, "deliverer" | "zone" | "agent" | "type" | "collector" | "branch" | "unlimitedDebt">>

/** Changes stored outside the client row: the location lock (PUT /api/tracking/location-locks). */
export type MultiEditExtras = { locationLock?: boolean }

const LOCK_OPTIONS = ["Заблокировать локацию", "Разблокировать локацию"] as const

const CHECKS = [
  "Изменить ответственного инкассатора",
  "Изменить неограниченный долг",
  "Изменить потдверждения",
  "Изменить лимит долга",
  "Изменить статус ИНН",
  "Изменить статус закрытия",
  "Изменить срок блокировки за долг по заказу",
  "Изменить индивидуальный курс",
  "Изменить прайс-лист",
  "Изменить финансовый счет",
  "Изменить КПИ",
  "Изменить маркетинговые акции",
  "Изменить блокировку локации",
  "Изменить класс клиента",
  "Изменить филиал",
] as const

export function MultiEditDialog({ onSave, onClose }: { clients: Client[]; onSave: (patch: MultiEditPatch, extras: MultiEditExtras) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [values, setValues] = useState({ deliverer: "", zone: "", agent: "", type: "", status: "", category: "", collector: "", branch: "" })
  const [lock, setLock] = useState<"" | (typeof LOCK_OPTIONS)[number]>("")
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  // People are employees, types are client types (the API refuses other names), zones and branches come from their directories.
  const employees = useDirectoryNames("employees")
  const clientTypes = useDirectoryNames("clientTypes")
  const zones = useDirectoryNames("zones")
  const branches = useDirectoryNames("branches")
  const options = useMemo(
    () => ({
      deliverers: employees,
      zones,
      agents: employees,
      types: clientTypes,
      collectors: employees,
      // A client's branch must be a Филиал (the API refuses other names).
      branches,
    }),
    [employees, clientTypes, zones, branches],
  )
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }))

  function save() {
    const patch: MultiEditPatch = {}
    if (values.deliverer) patch.deliverer = values.deliverer
    if (values.zone) patch.zone = values.zone
    if (values.agent) patch.agent = values.agent
    if (values.type) patch.type = values.type
    if (checks["Изменить ответственного инкассатора"] && values.collector) patch.collector = values.collector
    if (checks["Изменить филиал"] && values.branch) patch.branch = values.branch
    if (checks["Изменить неограниченный долг"]) patch.unlimitedDebt = true
    const extras: MultiEditExtras = {}
    if (checks["Изменить блокировку локации"] && lock) extras.locationLock = lock === "Заблокировать локацию"
    onSave(patch, extras)
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/[0.54]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="fixed bottom-[48px] left-1/2 top-[80px] flex w-[500px] max-w-full -translate-x-1/2 flex-col bg-white text-[13px] text-[#333] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b className="uppercase">{t("Изменение выбранных клиентов")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pt-[20px]">
          <FilterSelect compact label={t("Ответственный доставщик")} value={values.deliverer} onChange={set("deliverer")} options={options.deliverers} />
          <FilterSelect compact label={t("Зона")} value={values.zone} onChange={set("zone")} options={options.zones} />
          <FilterSelect compact label={t("Ответственный агент")} value={values.agent} onChange={set("agent")} options={options.agents} />
          <FilterSelect compact label={t("Тип заведения")} value={values.type} onChange={set("type")} options={options.types} />
          <FilterSelect compact label={t("Статус")} value={values.status} onChange={set("status")} options={[t("Активный"), t("Неактивный")]} />
          <div className="mt-[8px]">
            <FilterSelect compact label={t("Категория")} value={values.category} onChange={set("category")} options={[]} />
          </div>
          <div className="pb-4 pt-[7px]">
            {CHECKS.map((label) => (
              <div key={label}>
                <button
                  type="button"
                  onClick={() => setChecks((current) => ({ ...current, [label]: !current[label] }))}
                  aria-pressed={Boolean(checks[label])}
                  className="relative flex h-[30px] w-full items-center gap-[4px] text-left font-semibold"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#333]">
                    <path d={checks[label] ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"} />
                  </svg>
                  {t(label)}
                  {label === "Изменить срок блокировки за долг по заказу" && (
                    <span className="absolute right-0 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#4f71dc] text-[14px] font-bold leading-none text-white">i</span>
                  )}
                </button>
                {checks[label] && label === "Изменить ответственного инкассатора" && <FilterSelect compact label={t("Инкассаторы")} value={values.collector} onChange={set("collector")} options={options.collectors} />}
                {checks[label] && label === "Изменить филиал" && <FilterSelect compact label={t("Филиалы")} value={values.branch} onChange={set("branch")} options={options.branches} />}
                {checks[label] && label === "Изменить блокировку локации" && (
                  <FilterSelect
                    compact
                    label={t("Изменить блокировку локации")}
                    value={lock ? t(lock) : ""}
                    onChange={(text) => setLock(LOCK_OPTIONS.find((option) => t(option) === text) ?? "")}
                    options={LOCK_OPTIONS.map((option) => t(option))}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] pr-[26px]">
          <button type="button" onClick={save} className="text-[13px] font-semibold uppercase text-[#0a9ddb]">{t("Изменить клиента")}</button>
        </footer>
      </div>
    </div>
  )
}
