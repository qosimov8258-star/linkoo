"use client"

import { useState } from "react"

import { RI, RefIconButton, SimpleListPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

type TgUser = { id: string; name: string; handle: string; client: string; phone: string; lang: string; first: string; last: string }

export function TelegramUsersView() {
  const { t } = useLanguage()
  const [list, setList] = useState<TgUser[]>([])

  function download() {
    const a = document.createElement("a")
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(list.map((u) => [u.id, u.name, u.handle, u.client, u.phone, u.lang, u.first, u.last].join(";")).join("\n"))
    a.download = "telegram-users.csv"
    a.click()
  }

  return (
    <SimpleListPage
      title={t("Пользователи Телеграм бота")}
      cols="minmax(0,120fr) minmax(0,180fr) minmax(0,150fr) minmax(0,140fr) minmax(0,110fr) minmax(0,150fr) minmax(0,150fr) minmax(0,40fr)"
      heads={[t("№"), t("Пользователь"), t("Клиент"), t("Телефон"), t("Язык пользователя"), t("Первое обращение"), t("Последнее обращение"), ""]}
      rows={list}
      rowKey={(u) => u.id}
      searchText={(u) => `${u.name} ${u.handle} ${u.client}`}
      filterPanel={<div className="w-64 border border-slate-200 bg-white p-4 text-[13px] shadow-xl">{t("Используйте поиск для фильтрации")}</div>}
      icons={<RefIconButton path={RI.download} label={t("Скачать")} onClick={download} />}
      render={(u) => [
        u.id,
        <><b className="font-semibold">{u.name}</b><br /><span className="text-[#4f71dc]">{u.handle}</span></>,
        <span key="c" className="text-[#4f71dc]">{u.client}</span>,
        u.phone,
        u.lang,
        u.first,
        u.last,
        <button key="d" aria-label={t("Удалить")} onClick={() => setList((current) => current.filter((x) => x.id !== u.id))}>
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#ef5350]"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" /></svg>
        </button>,
      ]}
    />
  )
}
