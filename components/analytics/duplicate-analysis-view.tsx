"use client"

import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { RefButton } from "@/components/ref/list-kit"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { DUPLICATE_ORDER } from "./duplicate-data"
import { Check, Link2, Search, Trash2, X } from "lucide-react"
import { useLanguage } from "@/lib/i18n/language-context"

type DuplicateGroup = {
  id: number
  inn: string
  phone: string
  clients: string[]
}

type ClientRow = { name: string; phone: string; inn?: string }

// Clients sharing an INN / phone number, the way the reference "Объединение" page lists them.
function buildGroups(clients: ClientRow[], field: "inn" | "phone"): DuplicateGroup[] {
  const byKey = new Map<string, string[]>()
  for (const client of clients) {
    const key = (client[field] ?? "").trim()
    if (!key) continue
    byKey.set(key, [...(byKey.get(key) ?? []), client.name])
  }
  const order = new Map(DUPLICATE_ORDER[field].map((group, index) => [group.key, index]))
  return Array.from(byKey.entries())
    .filter(([, names]) => names.length > 1)
    .sort(([a], [b]) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999))
    .map(([key, names], index) => ({
      id: index + 1,
      inn: field === "inn" ? key : "",
      phone: field === "phone" ? key : "",
      clients: names,
    }))
}

export function DuplicateAnalysisView() {
  const { t } = useLanguage()
  const [mode, setMode] = useState<"inn" | "phone">("inn")
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<DuplicateGroup[]>([])

  useEffect(() => {
    let cancelled = false
    fetch("/api/clients")
      .then((response) => (response.ok ? (response.json() as Promise<ClientRow[]>) : Promise.reject()))
      .then((clients) => {
        if (!cancelled) setGroups(buildGroups(clients, mode))
      })
      .catch(() => {
        if (!cancelled) setGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [mode])
  const [selected, setSelected] = useState<string[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [primary, setPrimary] = useState("")
  const [message, setMessage] = useState("")
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null)
  const [clientPickerOpen, setClientPickerOpen] = useState(true)
  const [addKey, setAddKey] = useState("")

  const availableToAdd = useMemo(
    () =>
      groups
        .flatMap((group) => group.clients.map((client, index) => ({ key: `${group.id}:${index}`, client })))
        .filter(({ key }) => !selected.includes(key)),
    [groups, selected],
  )

  const survivorOptions: string[] = []
  const LINK_ICON = "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru")
    if (!normalized) return groups
    return groups.filter((group) =>
      [group.inn, group.phone, ...group.clients].some((value) =>
        value.toLocaleLowerCase("ru").includes(normalized),
      ),
    )
  }, [groups, query])

  function toggleClient(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  function openMerge() {
    if (selected.length < 2) {
      const group = filtered[0]
      if (!group || group.clients.length < 2) {
        setMessage("Для объединения необходимо выбрать минимум двух клиентов.")
        return
      }
      const fallbackSelection = group.clients.slice(0, 2).map((_, index) => `${group.id}:${index}`)
      setSelected(fallbackSelection)
      setPrimary(survivorOptions[0] ?? "")
      setActiveGroupId(group.id)
      setClientPickerOpen(true)
      setMergeOpen(true)
      return
    }
    setPrimary(survivorOptions[0] ?? "")
    setActiveGroupId(Number(selected[0].split(":")[0]))
    setClientPickerOpen(true)
    setMergeOpen(true)
  }

  function openGroupMerge(group: DuplicateGroup) {
    const groupSelection = group.clients.map((_, index) => `${group.id}:${index}`)
    setSelected(groupSelection)
    setPrimary(survivorOptions[0] ?? "")
    setActiveGroupId(group.id)
    setClientPickerOpen(true)
    setMergeOpen(true)
  }

  function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGroups((current) => current.filter((group) => group.id !== activeGroupId))
    setMergeOpen(false)
    setSelected([])
    setMessage(`${selected.length} клиента успешно объединены.`)
  }

  return (
    <CatalogPageLayout>
        <section className="min-w-0 flex-1">
          <div className="sticky top-0 z-40 bg-white shadow-sm">
            <div className="flex h-[59px] items-end justify-end pb-[10px] pr-[26px]">
              <RefButton icon={LINK_ICON} label="Объединить" onClick={openMerge} />
            </div>
            <div className="grid grid-cols-2 border-b border-[#e8e8e8]">
              {(["inn", "phone"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setMode(tab)
                    setSelected([])
                  }}
                  className={`h-[41px] border-b-[3px] px-4 text-[13px] font-medium transition-colors ${
                    mode === tab ? "border-[#6178e8] text-slate-900" : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  {tab === "inn" ? t("По ИНН") : t("По номеру телефона")}
                </button>
              ))}
            </div>
            <label className="relative block h-[50px] w-full max-w-[330px] px-[15px]">
              <span className="sr-only">{t("Поиск")}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Поиск")}
                className="h-12 w-full border-b border-[#e0e0e0] bg-transparent pr-10 text-[13px] outline-none placeholder:text-black/30 focus:border-[#5d6474]"
              />
              <Search className="absolute right-[22px] top-1/2 h-6 w-6 -translate-y-1/2 text-[#ccc]" />
            </label>
          </div>

          {message && (
            <div className="mx-6 mt-4 flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {message}
              <button type="button" onClick={() => setMessage("")} aria-label={t("Закрыть сообщение")}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] table-fixed border-collapse text-[13px]">
              <thead className="bg-[#5d6474] text-left" style={{ color: "#fff" }}>
                <tr>
                  <th className="h-[50px] w-[182px] pl-[38px] font-semibold">№</th>
                  <th className="h-[50px] w-[243px] pl-[38px] font-semibold">{t("Наименование")}</th>
                  <th className="h-[50px] pl-[38px] font-semibold">{t("Клиенты")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((group) => (
                  <tr key={group.id} className="group relative border-b border-dotted border-[#d6d6d6] hover:bg-[#f2f5f8]">
                    <td className="pl-[38px] align-middle">{group.id}</td>
                    <td className="pl-[38px] align-middle">{mode === "inn" ? group.inn : group.phone}</td>
                    <td className="relative pl-[38px] pr-48">
                      <div className="flex flex-col items-start gap-[5px] py-[5px]">
                      {group.clients.map((client, index) => {
                        const key = `${group.id}:${index}`
                        const isSelected = selected.includes(key)
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleClient(key)}
                            aria-pressed={isSelected}
                            className={`flex h-[26px] max-w-full items-center gap-2 rounded-[3px] px-[10px] text-left text-[#4f71dc] transition-colors ${
                              isSelected ? "bg-[#dfe7fb] ring-1 ring-[#4f71dc]" : "bg-[#eef0f4] hover:bg-[#e5e9f2]"
                            }`}
                          >
                            <span>{index + 1}. {client}</span>
                            {isSelected && <Check className="h-4 w-4 shrink-0" />}
                          </button>
                        )
                      })}
                      </div>
                      <button
                        type="button"
                        onClick={() => openGroupMerge(group)}
                        className="absolute right-[120px] top-1/2 hidden h-[30px] -translate-y-1/2 items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white group-hover:inline-flex focus:inline-flex"
                      >
                        <Link2 className="h-4 w-4" />
                        {t("Объединить")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-20 text-center text-[13px] text-[#8c8c8c]">{t("По вашему запросу ничего не найдено.")}</div>
            )}
          </div>
        </section>

      {mergeOpen && (
        <div className="fixed inset-0 z-[70] bg-white" role="dialog" aria-modal="true" aria-labelledby="merge-title">
          <form onSubmit={merge} className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-9 py-6">
              <h2 id="merge-title" className="text-[17px] font-bold uppercase">{t("Объединение клиентов")}</h2>
              <button type="button" onClick={() => setMergeOpen(false)} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-900">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="border-b px-3 py-6 text-[17px] font-semibold text-slate-500">
              <p>{t("Все данные выбранных клиентов будут переписаны на имя клиента:")}</p>
              <p className="text-red-500">{t("Объединённые клиенты нельзя восстановить !")}</p>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 divide-x lg:grid-cols-2">
              <section className="overflow-y-auto p-3">
                <h3 className="mb-8 text-2xl font-bold">{t("Клиенты которые будут удалены")}</h3>
                <div className="mb-10 flex items-end gap-4">
                  <label className="min-w-0 flex-1">
                    <span className="mb-2 block text-sm">{t("Клиент")}</span>
                    <select value={addKey} onChange={(event) => setAddKey(event.target.value)} className="w-full border-b border-slate-300 bg-white py-2 outline-none">
                      <option value="">{t("Выберите клиента")}</option>
                      {availableToAdd.map(({ key, client }) => (
                        <option key={key} value={key}>{client}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!addKey}
                    onClick={() => {
                      if (!addKey) return
                      setSelected((current) => [...current, addKey])
                      setAddKey("")
                    }}
                    className="px-5 py-2 font-medium text-brand-blue disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("ДОБАВИТЬ")}
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_155px_1fr_42px] gap-4 px-2 text-sm font-semibold">
                  <span>{t("Наименование")}</span><span>{t("Телефон")}</span><span>{t("Адрес")}</span><span />
                </div>
                {selected.map((key) => {
                  const [id, index] = key.split(":").map(Number)
                  const client = groups.find((group) => group.id === id)?.clients[index] ?? key
                  return (
                    <div key={key} className="mt-4 grid grid-cols-[1fr_155px_1fr_42px] items-center gap-4 border-b py-3 text-sm">
                      <span>{client}</span>
                      <span>{t("Не указан")}</span>
                      <span>{t("Не указано")}</span>
                      <button
                        type="button"
                        aria-label={`Удалить ${client}`}
                        onClick={() => setSelected((current) => current.filter((item) => item !== key))}
                        className="text-slate-500 hover:text-red-500"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  )
                })}
              </section>
              <section className="relative overflow-y-auto p-3">
                <h3 className="mb-3 text-2xl font-bold">{t("Клиент который остается")}</h3>
                <label className="block text-sm">
                  {t("Клиент")}
                  <button
                    type="button"
                    onClick={() => setClientPickerOpen((current) => !current)}
                    className="mt-2 flex w-full items-center justify-between border-b border-slate-300 py-2 text-left"
                  >
                    <span>{primary}</span>
                    <span className="text-slate-400">{clientPickerOpen ? "▲" : "▼"}</span>
                  </button>
                </label>
                {clientPickerOpen && (
                  <div className="absolute left-3 right-3 top-28 z-10 max-h-64 overflow-y-auto border bg-white py-1 shadow-xl">
                    {survivorOptions.map((client) => (
                      <button
                        key={client}
                        type="button"
                        onClick={() => {
                          setPrimary(client)
                          setClientPickerOpen(false)
                        }}
                        className="block w-full px-3 py-2.5 text-left text-[15px] text-slate-600 hover:bg-blue-50"
                      >
                        {client}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <div className="flex justify-end border-t px-7 py-5">
              <button type="submit" disabled={!primary || selected.length === 0} className="font-semibold text-[#00a4e8] disabled:opacity-40">{t("ОБЪЕДИНИТЬ")}</button>
            </div>
          </form>
        </div>
      )}
    </CatalogPageLayout>
  )
}
