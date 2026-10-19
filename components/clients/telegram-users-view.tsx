"use client"

import { useMemo, useState } from "react"

import { FilterDate, FilterSelect, RI, RefFilterPanel, RefIconButton, SimpleListPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDateTime } from "@/lib/ref-date"

type TgUser = { id: string; name: string; handle: string; client: string; phone: string; lang: string; first: string; last: string }
type Filters = { client: string; agentClients: string; createdBegin: string; createdEnd: string; activeBegin: string; activeEnd: string }

const emptyFilters: Filters = { client: "", agentClients: "", createdBegin: "", createdEnd: "", activeBegin: "", activeEnd: "" }
const WAITING = "В ожидании"

const initialUsers: TgUser[] = [
  { id: "5780398737", name: "mm xue", handle: "@fqdptea", client: WAITING, phone: "", lang: "Узбекча", first: "2026-04-30T03:22", last: "2026-04-30T03:22" },
  { id: "5077528257", name: "Adilet", handle: "@Adilet_20_03", client: WAITING, phone: "", lang: "Узбекча", first: "2026-05-20T18:37", last: "2026-05-20T20:25" },
  { id: "739613050", name: "A.", handle: "@radizabavi17", client: "Arslan", phone: "+998998845492", lang: "Узбекча", first: "2026-02-03T14:17", last: "2026-02-03T14:18" },
  { id: "6627602444", name: "Khusanjon", handle: "@Abdinazarov_Khusanjon", client: WAITING, phone: "+998930890824", lang: "Узбекча", first: "2026-02-03T16:46", last: "2026-02-03T16:46" },
  { id: "6419955571", name: "Linko (RITM) (tech_support)", handle: "@Linko_tech_support", client: "Ritm ritm", phone: "+998900459618", lang: "Узбекча", first: "2026-02-11T18:56", last: "2026-02-11T19:00" },
  { id: "1957471768", name: "Friends", handle: "@qazwazqq", client: WAITING, phone: "", lang: "Узбекча", first: "2026-03-15T02:05", last: "2026-03-15T02:05" },
]

export function TelegramUsersView() {
  const { t } = useLanguage()
  const [list, setList] = useState<TgUser[]>(initialUsers)
  const [filters, setFilters] = useState<Filters>(emptyFilters)

  const clientOptions = useMemo(() => [...new Set(list.map((u) => u.client).filter((value) => value !== WAITING))], [list])

  const rows = useMemo(
    () =>
      list.filter((u) => {
        if (filters.client && u.client !== filters.client) return false
        if (filters.createdBegin) {
          const day = u.first.slice(0, 10)
          if (day < filters.createdBegin || day > (filters.createdEnd || filters.createdBegin)) return false
        }
        if (filters.activeBegin) {
          const day = u.last.slice(0, 10)
          if (day < filters.activeBegin || day > (filters.activeEnd || filters.activeBegin)) return false
        }
        return true
      }),
    [list, filters],
  )

  function download() {
    const a = document.createElement("a")
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map((u) => [u.id, u.name, u.handle, u.client, u.phone, u.lang, refDateTime(u.first), refDateTime(u.last)].join(";")).join("\n"))
    a.download = "telegram-users.csv"
    a.click()
  }

  return (
    <SimpleListPage
      title={t("Пользователи Телеграм бота")}
      cols="minmax(0,120fr) minmax(0,180fr) minmax(0,150fr) minmax(0,140fr) minmax(0,110fr) minmax(0,150fr) minmax(0,150fr) minmax(0,40fr)"
      heads={[t("№"), t("Пользователь"), t("Клиент"), t("Телефон"), t("Язык пользователя"), t("Первое обращение"), t("Последнее обращение"), ""]}
      rows={rows}
      rowKey={(u) => u.id}
      searchText={(u) => `${u.id} ${u.name} ${u.handle} ${u.client} ${u.phone}`}
      filterPanel={(close) => (
        <TelegramFilter
          value={filters}
          clients={clientOptions}
          onClose={close}
          onApply={(next) => {
            setFilters(next)
            close()
          }}
        />
      )}
      icons={<RefIconButton path={RI.download} label={t("Скачать")} onClick={download} />}
      render={(u) => [
        u.id,
        <>
          <b className="font-semibold">{u.name}</b>
          <br />
          <span className="text-[#4f71dc]">{u.handle}</span>
        </>,
        u.client === WAITING ? t(WAITING) : <span key="c" className="font-semibold text-[#4f71dc]">{u.client}</span>,
        u.phone,
        u.lang,
        refDateTime(u.first),
        refDateTime(u.last),
        <button key="d" aria-label={t("Удалить")} onClick={() => setList((current) => current.filter((x) => x.id !== u.id))} className="opacity-0 transition-opacity group-hover:opacity-100">
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#ff5a4f]"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" /></svg>
        </button>,
      ]}
    />
  )
}

function TelegramFilter({ value, clients, onClose, onApply }: { value: Filters; clients: string[]; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(value)
  return (
    <RefFilterPanel narrow onClose={onClose} onApply={() => onApply(draft)}>
      <div className="pt-[2px]">
        <FilterSelect label={t("Клиент")} value={draft.client} onChange={(client) => setDraft((current) => ({ ...current, client }))} options={clients} />
        <FilterSelect label={t("Клиенты агента")} value={draft.agentClients} onChange={(agentClients) => setDraft((current) => ({ ...current, agentClients }))} options={[]} />
        <div className="-mt-[10px] w-[255px]">
          <FilterDate label={t("Дата создания")} begin={draft.createdBegin} end={draft.createdEnd} onChange={(createdBegin, createdEnd) => setDraft((current) => ({ ...current, createdBegin, createdEnd }))} />
          <div className="-mt-[10px]">
            <FilterDate label={t("Дата активации")} begin={draft.activeBegin} end={draft.activeEnd} onChange={(activeBegin, activeEnd) => setDraft((current) => ({ ...current, activeBegin, activeEnd }))} />
          </div>
        </div>
      </div>
    </RefFilterPanel>
  )
}
