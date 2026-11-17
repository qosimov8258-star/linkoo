"use client"

import Link from "next/link"
import { Search, X } from "lucide-react"
import { FormEvent, useCallback, useEffect, useState } from "react"

import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { RefButton, RefTabs } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { EmptyState, ErrorAlert } from "./catalog-ui"
import { ClientPicker, type ClientLookup } from "./client-picker"
import { OrganizationSnackbar, type OrganizationNotice } from "./organization-dialogs"

type DuplicateGroup = { name: string; markets: { id: number; name: string }[] }
type By = "inn" | "phone"

// Linko's «Анализ дублей» (#/join): the clients sharing an ИНН / a phone (tabs = ?by=, the list's search), each group's
// clients linking to the client list of the group, «Объединить» on a hovered row (the group: the oldest client stays)
// or above the list (empty), and the «Объединение клиентов» window: the clients to delete, the one that stays, and
// «Объединить» → «Вы уверены?» → every document of the deleted clients passes to it (POST /api/clients/merge).

/** The tab in the URL (?by=): Linko titles the column «Наименование» until a tab is picked. */
function readBy(): By | null {
  if (typeof window === "undefined") return null
  const by = new URLSearchParams(window.location.search).get("by")
  return by === "inn" || by === "phone" ? by : null
}

const LINK_ICON = "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"

function Spinner() {
  return (
    <div className="flex h-[400px] items-center justify-center bg-white">
      <div className="relative h-[50px] w-[50px] animate-spin">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className="absolute left-1/2 top-1/2 h-[6px] w-[6px] rounded-full bg-[#1E4A9A]" style={{ transform: `rotate(${index * 45}deg) translate(0, -22px)`, opacity: 0.3 + index * 0.1 }} />
        ))}
      </div>
    </div>
  )
}

export function DuplicateAnalysisView() {
  const { t } = useLanguage()
  const [by, setBy] = useState<By | null>(null)
  const mode: By = by ?? "inn"
  const [searchDraft, setSearchDraft] = useState("")
  const [search, setSearch] = useState("")
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [dialog, setDialog] = useState<{ removed: ClientLookup[]; survivor: ClientLookup | null } | null>(null)
  const [notice, setNotice] = useState<OrganizationNotice | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])

  // The URL's tab (and back / forward between tabs).
  useEffect(() => {
    const sync = () => setBy(readBy())
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 500)
    return () => window.clearTimeout(timer)
  }, [searchDraft])

  useEffect(() => {
    const controller = new AbortController()
    setGroups(null)
    fetch(`/api/clients/duplicates?by=${mode}&search=${encodeURIComponent(search)}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<DuplicateGroup[]>) : []))
      .then(setGroups)
      .catch(() => { if (!controller.signal.aborted) setGroups([]) })
    return () => controller.abort()
  }, [mode, search, reloadKey])

  // Linko reads the group's clients by id (ordering=id): the oldest one stays, the others are to be deleted.
  async function openRowMerge(group: DuplicateGroup) {
    const ids = group.markets.map((market) => market.id).sort((a, b) => a - b)
    const response = await fetch(`/api/clients/lookup?ids=${ids.join(",")}`)
    const rows = response.ok ? ((await response.json()) as ClientLookup[]) : []
    const ordered = ids.map((id) => rows.find((row) => row.id === id)).filter((row): row is ClientLookup => Boolean(row))
    setDialog({ survivor: ordered[0] ?? null, removed: ordered.slice(1) })
  }

  const pickTab = (next: By) => {
    const url = new URL(window.location.href)
    url.searchParams.set("by", next)
    window.history.pushState(null, "", `${url.pathname}${url.search}`)
    setBy(next)
    setSearchDraft("")
    setSearch("")
  }

  return (
    <CatalogPageLayout>
      <section className="min-w-0 flex-1">
        <div className="bg-white">
          <div className="flex h-[60px] items-end justify-between pb-[10px] pr-[26px]">
            {/* Linko: the one entity tab «Клиенты» above the ИНН / phone tabs. */}
            <span className="mb-[3px] w-[345px] text-center text-[13px] text-[#333]">{t("Клиенты")}</span>
            <RefButton icon={LINK_ICON} label={t("Объединить")} onClick={() => setDialog({ removed: [], survivor: null })} />
          </div>
          <RefTabs
            labels={[t("По ИНН"), t("По номеру телефона")]}
            value={mode === "inn" ? t("По ИНН") : t("По номеру телефона")}
            onChange={(label) => pickTab(label === t("По ИНН") ? "inn" : "phone")}
          />
          <label className="relative block h-[50px] w-[330px] px-[15px] pt-[9px]">
            <span className="sr-only">{t("Поиск")}</span>
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              className="h-[30px] w-full border-b border-[#e0e0e0] bg-transparent pr-10 text-[13px] outline-none placeholder:text-black/30 focus:border-[#5d6474]"
            />
            <Search className="absolute right-[22px] top-[12px] h-6 w-6 text-[#ccc]" />
          </label>
        </div>

        {/* Linko's columns: № 15%, the ИНН / phone 20%, the clients the rest. */}
        <div className="grid h-[50px] grid-cols-[15%_20%_1fr] items-center bg-[#5d6474] pl-[38px] text-[13px] font-semibold text-white">
          <span>№</span>
          <span>{by === "inn" ? t("ИНН") : by === "phone" ? t("Телефон") : t("Наименование")}</span>
          <span>{t("Клиенты")}</span>
        </div>
        {groups === null ? (
          <Spinner />
        ) : groups.length === 0 ? (
          <EmptyState />
        ) : (
          groups.map((group, index) => (
            <div key={group.name} className="group relative grid min-h-[62px] grid-cols-[15%_20%_1fr] items-center border-b-2 border-dotted border-[#d9e0e5] bg-white pl-[38px] text-[13px] hover:bg-[#f2f5f8]">
              <span>{index + 1}</span>
              <span>{group.name}</span>
              <div className="flex flex-col items-start gap-[5px] py-[5px] pr-[200px]">
                {/* Linko: «N.» and the client's name, a link to the client list of the whole group. */}
                {group.markets.map((market, position) => (
                  <span key={market.id} className="flex max-w-full items-center rounded-[5px] bg-[#e9ecef] px-[10px] py-[5px] text-left leading-[16px]">
                    <span className="truncate">
                      {position + 1}.
                      <Link href={`/clients?ids=${group.markets.map((item) => item.id).join("-")}`} className="ml-[5px] font-semibold text-[#1E4A9A] hover:underline">
                        {market.name}
                      </Link>
                    </span>
                  </span>
                ))}
              </div>
              <div className="absolute right-[168px] top-1/2 hidden -translate-y-1/2 group-hover:block">
                <RefButton icon={LINK_ICON} label={t("Объединить")} onClick={() => void openRowMerge(group)} />
              </div>
            </div>
          ))
        )}
      </section>

      {dialog && (
        <MergeDialog
          initial={dialog}
          onClose={() => setDialog(null)}
          onMerged={() => {
            setDialog(null)
            setNotice({ text: t("Данные успешно объединены"), tone: "success" })
            setReloadKey((key) => key + 1)
          }}
        />
      )}
      <OrganizationSnackbar notice={notice} onClose={closeNotice} />
    </CatalogPageLayout>
  )
}

function MergeDialog({ initial, onClose, onMerged }: { initial: { removed: ClientLookup[]; survivor: ClientLookup | null }; onClose: () => void; onMerged: (count: number) => void }) {
  const { t } = useLanguage()
  const [removed, setRemoved] = useState(initial.removed)
  const [survivor, setSurvivor] = useState(initial.survivor)
  const [pending, setPending] = useState<ClientLookup | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [alertMessage, setAlertMessage] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || alertMessage) return
      if (confirming) setConfirming(false)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, alertMessage, confirming])

  // The client that stays, as its picker shows it (Linko writes it under the warning).
  const survivorText = survivor ? `${survivor.name} (№${survivor.id}) (${survivor.code}) (${survivor.zone})` : ""

  // «Объединить» asks first (Linko's «Вы уверены?»); «Да» merges.
  function askMerge(event?: FormEvent) {
    event?.preventDefault()
    if (!survivor) return setAlertMessage(t("Выберите клиента, который остается"))
    if (removed.length === 0) return setAlertMessage(t("Выберите клиентов для объединения"))
    setConfirming(true)
  }

  async function merge() {
    if (saving || !survivor) return
    setConfirming(false)
    setSaving(true)
    try {
      const response = await fetch("/api/clients/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorId: survivor.id, mergeIds: removed.map((client) => client.id) }),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string; merged?: number }
      if (!response.ok) return setAlertMessage(t(data.error || "Не удалось объединить клиентов"))
      onMerged(data.merged ?? removed.length)
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const excluded = [...removed.map((client) => client.id), ...(survivor ? [survivor.id] : [])]

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white text-[13px] text-[#333]" role="dialog" aria-modal="true">
      <form onSubmit={askMerge} className="flex h-full flex-col">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[20px]">
          <h2 className="text-[13px] font-bold uppercase">{t("Объединение клиентов")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-900"><X className="h-6 w-6" /></button>
        </header>
        <div className="shrink-0 border-b border-[#efefef] px-[10px] pb-[10px] pt-[20px] text-[15px] font-bold leading-[19px]">
          <p className="tracking-[0.12px] text-[#888]">
            {t("Все данные выбранных клиентов будут переписаны на имя клиента:")}
            <br />
            <span className="text-[#4f71dc]">{survivorText}</span>
          </p>
          <p className="tracking-[0.12px] text-[#ff5252]">{t("Объединённые клиенты нельзя восстановить !")}</p>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-[#efefef]">
          <section className="min-h-0 overflow-y-auto px-[10px] pt-[7px]">
            <h3 className="text-[19.5px] font-bold">{t("Клиенты которые будут удалены")}</h3>
            <div className="mt-[16px] flex items-start justify-between gap-[148px]">
              <div className="w-[486px]">
                <ClientPicker
                  label={t("Клиент")}
                  value={pending ? `${pending.name} (№ ${pending.id}) (${pending.zone})` : undefined}
                  optionText={(client) => `${client.name} (№ ${client.id}) (${client.zone})`}
                  onPick={setPending}
                  onClear={() => setPending(null)}
                  excluded={excluded}
                />
              </div>
              <button
                type="button"
                onClick={() => { if (pending) { setRemoved((list) => [...list, pending]); setPending(null) } }}
                className="mr-[23px] mt-[24px] text-[13px] font-semibold uppercase text-[#1E4A9A] hover:opacity-80"
              >
                {t("Добавить")}
              </button>
            </div>
            <div className="mt-[35px] grid grid-cols-[182px_122px_1fr_30px] px-[8px] pr-[13px] font-bold">
              <span>{t("Наименование")}</span><span>{t("Телефон")}</span><span>{t("Адрес")}</span><span />
            </div>
            {removed.map((client) => (
              <div key={client.id} className="grid grid-cols-[182px_122px_1fr_30px] items-center px-[8px] pr-[13px] py-[12px]">
                <span className="pr-[35px]">{client.name}</span>
                <span>{client.phone && client.phone !== "-" ? client.phone : t("Не указан")}</span>
                <span>{client.address || t("Не указано")}</span>
                <button type="button" aria-label={t("Удалить")} onClick={() => setRemoved((list) => list.filter((item) => item.id !== client.id))} className="text-[#555] hover:text-black">
                  <svg viewBox="0 0 24 24" className="relative -top-[4px] left-[3px] h-6 w-6 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                </button>
              </div>
            ))}
          </section>
          <section className="min-h-0 overflow-y-auto px-[10px] pt-[7px]">
            <h3 className="text-[19.5px] font-bold">{t("Клиент который остается")}</h3>
            <div className="mt-[16px]">
              <ClientPicker
                label={t("Клиент")}
                value={survivor ? `${survivor.name} (№${survivor.id}) (${survivor.code}) (${survivor.zone})` : undefined}
                optionText={(client) => `${client.name} (№${client.id}) (${client.code}) (${client.zone})`}
                onPick={setSurvivor}
                onClear={() => setSurvivor(null)}
                excluded={removed.map((client) => client.id)}
              />
            </div>
          </section>
        </div>
        <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-[#efefef] pr-[25px]">
          <button type="submit" disabled={saving} className="text-[13px] font-semibold uppercase text-[#129fdd] hover:opacity-80 disabled:opacity-50">{t("Объединить")}</button>
        </footer>
      </form>
      {confirming && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
          <div role="alertdialog" aria-label={t("Вы уверены")} className="max-w-[720px] bg-white px-[30px] py-[20px] text-center text-[15px] font-bold shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <p className="mt-[10px] text-[#898989]">
              {t("Все данные выбранных клиентов будут переписаны на имя клиента")} <span className="text-[20px] text-[#4f71dc]">{survivorText}</span>
            </p>
            <p className="mt-[10px] text-[#ff5e5e]">{t("Объединённые клиенты нельзя восстановить !")}</p>
            <p className="mt-[10px]">{t("Вы уверены")}?</p>
            <div className="mt-[10px] flex justify-center gap-[8px]">
              <button type="button" onClick={() => setConfirming(false)} className="h-[36px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8]">
                {t("Нет")}
              </button>
              <button type="button" disabled={saving} onClick={() => void merge()} className="h-[36px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-50">
                {t("Да")}
              </button>
            </div>
          </div>
        </div>
      )}
      {alertMessage && <ErrorAlert message={alertMessage} onClose={() => setAlertMessage("")} />}
    </div>
  )
}
