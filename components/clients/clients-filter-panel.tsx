"use client"

import { useEffect, useMemo, useState } from "react"

import {
  FilterCaption,
  FilterCheck,
  FilterDate,
  FilterDays,
  FilterRange,
  FilterSelect,
  RefFilterPanel,
} from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import type { Client } from "./clients-data"

export type ClientFilters = {
  client: string
  type: string
  status: string
  only: string
  lastVisit: string
  createdBy: string
  zone: string
  agent: string
  deliverer: string
  refusalType: string
  branch: string
  collector: string
  category: string
  debtLimitType: string
  visitFrequency: string
  agentRoute: string
  locationBlocked: string
  wrongRoute: string
  individualRate: string
  clientClass: string
  channelCategory: string
  createdBegin: string
  createdEnd: string
  lastOrderFrom: string
  lastOrderTo: string
  lastPaymentFrom: string
  lastPaymentTo: string
  lastRefusalFrom: string
  lastRefusalTo: string
  lastVisitFrom: string
  lastVisitTo: string
  routeDays: string[]
  zoneUndefined: boolean
  unlimitedDebt: boolean
  noRoute: boolean
  wrongZones: boolean
  multiRoutes: boolean
  attributes: Record<string, string>
}

export const emptyClientFilters: ClientFilters = {
  client: "",
  type: "",
  status: "",
  only: "",
  lastVisit: "",
  createdBy: "",
  zone: "",
  agent: "",
  deliverer: "",
  refusalType: "",
  branch: "",
  collector: "",
  category: "",
  debtLimitType: "",
  visitFrequency: "",
  agentRoute: "",
  locationBlocked: "",
  wrongRoute: "",
  individualRate: "",
  clientClass: "",
  channelCategory: "",
  createdBegin: "",
  createdEnd: "",
  lastOrderFrom: "",
  lastOrderTo: "",
  lastPaymentFrom: "",
  lastPaymentTo: "",
  lastRefusalFrom: "",
  lastRefusalTo: "",
  lastVisitFrom: "",
  lastVisitTo: "",
  routeDays: [],
  zoneUndefined: false,
  unlimitedDebt: false,
  noRoute: false,
  wrongZones: false,
  multiRoutes: false,
  attributes: {},
}

const NOT_SET = "Не указано"

/** Applies the filters that map onto fields the client records actually carry. */
export function applyClientFilters(client: Client, filters: ClientFilters): boolean {
  if (filters.client && client.name !== filters.client) return false
  if (filters.type && client.type !== filters.type) return false
  if (filters.zone && client.zone !== filters.zone) return false
  if (filters.agent && client.agent !== filters.agent) return false
  if (filters.deliverer && client.deliverer !== filters.deliverer) return false
  if (filters.collector && client.collector !== filters.collector) return false
  if (filters.branch && client.branch !== filters.branch) return false
  if (filters.channelCategory && client.salesChannel !== filters.channelCategory) return false
  if (filters.status === "Подтвержденные" && client.tab === "unconfirmed") return false
  if (filters.status === "Не подтвержденные" && client.tab !== "unconfirmed") return false
  if (filters.zoneUndefined && client.zone && client.zone !== NOT_SET) return false
  if (filters.unlimitedDebt && !client.unlimitedDebt) return false
  if (filters.createdBegin) {
    const created = (client.createdAt ?? "").slice(0, 10)
    if (!created || created < filters.createdBegin || created > (filters.createdEnd || filters.createdBegin)) return false
  }
  for (const [name, value] of Object.entries(filters.attributes)) {
    if (value && client.attributes?.[name] !== value) return false
  }
  return true
}

export function countClientFilters(filters: ClientFilters): number {
  return Object.entries(filters).reduce((sum, [key, value]) => {
    if (key === "attributes") return sum + Object.values(value as Record<string, string>).filter(Boolean).length
    if (Array.isArray(value)) return sum + (value.length ? 1 : 0)
    return sum + (value ? 1 : 0)
  }, 0)
}

const uniq = (values: (string | undefined)[]) =>
  [...new Set(values.filter((value): value is string => Boolean(value) && value !== NOT_SET))].sort((a, b) => a.localeCompare(b, "ru"))

export function ClientsFilterPanel({
  clients,
  value,
  onApply,
  onClose,
}: {
  clients: Client[]
  value: ClientFilters
  onApply: (filters: ClientFilters) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<ClientFilters>(value)
  const [expanded, setExpanded] = useState(false)
  const [attributeNames, setAttributeNames] = useState<string[]>([])

  useEffect(() => {
    if (!expanded || attributeNames.length) return
    let cancelled = false
    fetch("/api/client-attributes")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name?: string }[]) => {
        if (!cancelled && Array.isArray(rows)) setAttributeNames(rows.map((row) => row.name ?? "").filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expanded, attributeNames.length])

  const options = useMemo(
    () => ({
      clients: uniq(clients.map((c) => c.name)).slice(0, 300),
      types: uniq(clients.map((c) => c.type)),
      zones: uniq(clients.map((c) => c.zone)),
      agents: uniq(clients.map((c) => c.agent)),
      deliverers: uniq(clients.map((c) => c.deliverer)),
      collectors: uniq(clients.map((c) => c.collector)),
      branches: uniq(clients.map((c) => c.branch)),
      channels: uniq(clients.map((c) => c.salesChannel)),
    }),
    [clients],
  )

  const attributeOptions = (name: string) => uniq(clients.map((c) => c.attributes?.[name]))
  const set = <K extends keyof ClientFilters>(key: K) => (next: ClientFilters[K]) => setDraft((current) => ({ ...current, [key]: next }))
  const yesNo = [t("Да"), t("Нет")]

  const cell = "min-w-0"

  return (
    <RefFilterPanel
      onClose={onClose}
      onApply={() => onApply(draft)}
      footer={
        <button type="button" onClick={() => setExpanded((current) => !current)} className="text-[13px] text-[#4f71dc] hover:underline">
          {expanded ? t("Свернуть") : t("Расширить")} {expanded ? "⌃" : "⌄"}
        </button>
      }
    >
      <div className="grid grid-cols-4 gap-x-[9.33px] gap-y-[5px]">
        <FilterSelect className={cell} label={t("Клиент")} value={draft.client} onChange={set("client")} options={options.clients} />
        <FilterSelect className={cell} label={t("Тип клиента")} value={draft.type} onChange={set("type")} options={options.types} />
        <FilterSelect className={cell} label={t("Статус")} value={draft.status} onChange={set("status")} options={[t("Подтвержденные"), t("Не подтвержденные")]} />
        <FilterSelect className={cell} label={t("Показать только")} value={draft.only} onChange={set("only")} options={[t("С координатами"), t("Без координат")]} />

        <FilterSelect className={cell} label={t("Последнее посещение")} value={draft.lastVisit} onChange={set("lastVisit")} options={[t("Сегодня"), t("Вчера"), t("Последние 7 дней"), t("Текущий месяц")]} />
        <FilterSelect className={cell} label={t("Создал")} value={draft.createdBy} onChange={set("createdBy")} options={options.agents} />
        <FilterSelect className={cell} label={t("Зона")} value={draft.zone} onChange={set("zone")} options={options.zones} />
        <FilterSelect className={cell} label={t("Ответственный агент")} value={draft.agent} onChange={set("agent")} options={options.agents} />

        <FilterSelect className={cell} label={t("Ответственные доставщики")} value={draft.deliverer} onChange={set("deliverer")} options={options.deliverers} />
        <FilterSelect className={cell} label={t("Тип отказа")} value={draft.refusalType} onChange={set("refusalType")} options={[]} />
        <FilterSelect className={cell} label={t("Филиалы")} value={draft.branch} onChange={set("branch")} options={options.branches} />
        <FilterSelect className={cell} label={t("Инкассаторы")} value={draft.collector} onChange={set("collector")} options={options.collectors} />

        <FilterSelect className={cell} label={t("Категория")} value={draft.category} onChange={set("category")} options={[]} />
        <FilterSelect className={cell} label={t("Тип лимита долга")} value={draft.debtLimitType} onChange={set("debtLimitType")} options={[t("По сумме"), t("По дням")]} />
        <FilterSelect className={cell} label={t("Частота посещения")} value={draft.visitFrequency} onChange={set("visitFrequency")} options={[t("Еженедельно"), t("Раз в 2 недели"), t("Ежемесячно")]} />
        <FilterSelect className={cell} label={t("Маршрут агента")} value={draft.agentRoute} onChange={set("agentRoute")} options={options.agents} />

        <FilterSelect className={cell} label={t("Локация заблокировано")} value={draft.locationBlocked} onChange={set("locationBlocked")} options={yesNo} />
        <FilterSelect className={cell} label={t("Не верно установлено маршрут")} value={draft.wrongRoute} onChange={set("wrongRoute")} options={yesNo} />
        <FilterSelect className={cell} label={t("Индивидуальный курс")} value={draft.individualRate} onChange={set("individualRate")} options={yesNo} />
        <FilterSelect className={cell} label={t("Класс клиента")} value={draft.clientClass} onChange={set("clientClass")} options={["A", "B", "C"]} />
      </div>

      <div className="grid grid-cols-4 grid-rows-[68px_63px] gap-x-[9.33px]">
        <FilterDate
          className={`${cell} -translate-y-[8px]`}
          label={t("Период создания клиента")}
          begin={draft.createdBegin}
          end={draft.createdEnd}
          placement="above"
          onChange={(begin, end) => setDraft((current) => ({ ...current, createdBegin: begin, createdEnd: end }))}
        />
        <FilterRange caption={t("Прошло дней с последнего заказа")} from={draft.lastOrderFrom} to={draft.lastOrderTo} onFrom={set("lastOrderFrom")} onTo={set("lastOrderTo")} />
        <FilterRange caption={t("Прошло дней с последней оплаты")} from={draft.lastPaymentFrom} to={draft.lastPaymentTo} onFrom={set("lastPaymentFrom")} onTo={set("lastPaymentTo")} />
        <FilterSelect className={`${cell} mt-[5px]`} label={t("Категория канала")} value={draft.channelCategory} onChange={set("channelCategory")} options={options.channels} />

        <FilterRange caption={t("Прошло дней с последнего отказа")} from={draft.lastRefusalFrom} to={draft.lastRefusalTo} onFrom={set("lastRefusalFrom")} onTo={set("lastRefusalTo")} />
        <FilterRange caption={t("Прошло дней с последнего визита")} from={draft.lastVisitFrom} to={draft.lastVisitTo} onFrom={set("lastVisitFrom")} onTo={set("lastVisitTo")} />
        <FilterDays value={draft.routeDays} onChange={set("routeDays")} />
        <div className="pt-[8px]">
          <FilterCheck label={t("Зона не определена")} checked={draft.zoneUndefined} onChange={set("zoneUndefined")} />
        </div>
      </div>

      <div className="mt-[34px] grid grid-cols-4 gap-x-[9.33px]">
        <FilterCheck label={t("Неограниченный долг")} checked={draft.unlimitedDebt} onChange={set("unlimitedDebt")} />
        <FilterCheck label={t("Маршрут не установлено")} checked={draft.noRoute} onChange={set("noRoute")} />
        <FilterCheck label={t("Неправильно присвоенные зоны(зона агента не совпадает с зоной клиента)")} checked={draft.wrongZones} onChange={set("wrongZones")} />
        <FilterCheck label={t("Установлено больше одного маршрута")} checked={draft.multiRoutes} onChange={set("multiRoutes")} />
      </div>

      {expanded && (
        <div className="-mx-5 mt-5 bg-[#f2f5f8] px-5 pb-4 pt-5">
          <FilterCaption className="font-semibold text-[#5d6474]">{t("Атрибуты клиента")}</FilterCaption>
          <div className="mt-5 grid grid-cols-4 gap-x-[9.33px] gap-y-[5px]">
            {attributeNames.map((name) => (
              <FilterSelect
                key={name}
                className={cell}
                label={name}
                value={draft.attributes[name] ?? ""}
                onChange={(next) => setDraft((current) => ({ ...current, attributes: { ...current.attributes, [name]: next } }))}
                options={attributeOptions(name)}
              />
            ))}
          </div>
        </div>
      )}
    </RefFilterPanel>
  )
}
