"use client"

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react"
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Search, X } from "lucide-react"
import { MAILING_SEED } from "./mailing-data"
import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

export type Mailing = {
  id: number
  message: string
  createdAt: string
  createdAtDetail: string
  status: "Отправлено" | "Черновик"
  sent: number
  blocked: number
  debt: boolean
  photo?: string
}

const initialMailings: Mailing[] = MAILING_SEED

export function MailingView() {
  const { t } = useLanguage()
  const [mailings, setMailings] = useState(initialMailings)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string>()
  const [notice, setNotice] = useState("")
  const [page, setPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  const visibleMailings = useMemo(() => {
    const term = query.trim().toLowerCase()
    return mailings.filter((mailing) => {
      return !term || [mailing.id, mailing.message, mailing.createdAt, mailing.status]
        .join(" ")
        .toLowerCase()
        .includes(term)
    })
  }, [mailings, query])

  const pageCount = Math.max(1, Math.ceil(visibleMailings.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pagedMailings = visibleMailings.slice((safePage - 1) * pageSize, safePage * pageSize)

  const selectedMailing = mailings.find((mailing) => mailing.id === selectedId)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(String(reader.result))
    reader.readAsDataURL(file)
  }

  function createMailing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const message = String(formData.get("message") || "").trim()
    if (!message) return
    const id = Math.max(0, ...mailings.map((mailing) => mailing.id)) + 1
    const mailing: Mailing = {
      id,
      message,
      createdAt: "06 авг. 2026",
      createdAtDetail: "06 авг. 2026, 12:00",
      status: "Черновик",
      sent: 0,
      blocked: 0,
      debt: formData.get("debt") === "on",
      photo: photoPreview,
    }
    setMailings((current) => [mailing, ...current])
    setSelectedId(id)
    setPage(1)
    setComposerOpen(false)
    setPhotoPreview(undefined)
    setNotice(t("Рассылка сохранена как черновик"))
  }

  return (
    <RefPage>
      <RefHeader title={t("Рассылка")}>
        <button
          type="button"
          onClick={() => {
            setComposerOpen(true)
            setNotice("")
          }}
          className="px-2 text-[13px] font-medium text-[#45bdb5] hover:bg-[#e8f7f5]"
        >
          {t("Разослать")}
        </button>
      </RefHeader>

      {notice && (
        <div className="mb-3 flex items-center justify-between rounded bg-[#e9f8ed] px-4 py-3 text-sm text-[#278549]">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label={t("Закрыть уведомление")}>
            <X size={18} />
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-sm bg-white shadow-[0_2px_6px_rgba(26,37,55,.18)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <label className="relative block w-full max-w-[240px]">
            <span className="sr-only">{t("Поиск")}</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder={t("Поиск")}
              className="w-full border-b border-[#d8dfe9] py-2 pr-9 text-[16px] outline-none placeholder:text-[#b3bac7] focus:border-[#4f6ee8]"
            />
            <Search className="absolute right-2 top-2.5 text-[#c4c9cf]" size={23} />
          </label>
          <div className="flex items-center gap-5 text-[#525e70]">
            <span>25⌄</span>
            <span>{visibleMailings.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, visibleMailings.length)} {t("из")} {visibleMailings.length}</span>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label={t("Предыдущая страница")} className="rounded-full text-[#8f9399] hover:text-[#4f6ee8] disabled:opacity-30"><ChevronLeft /></button>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label={t("Следующая страница")} className="rounded-full text-[#8f9399] hover:text-[#4f6ee8] disabled:opacity-30"><ChevronRight /></button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-[#5d6474] text-left text-white">
              <tr>
                <th className="w-[9%] px-9 py-4 font-semibold">№</th>
                <th className="w-[55%] px-4 py-4 font-semibold">{t("Сообщение")}</th>
                <th className="w-[21%] px-4 py-4 font-semibold">{t("Дата создания")}</th>
                <th className="w-[15%] px-4 py-4 font-semibold">{t("Статус")}</th>
              </tr>
            </thead>
            <tbody>
              {pagedMailings.map((mailing) => (
                <tr
                  key={mailing.id}
                  onClick={() => setSelectedId(selectedId === mailing.id ? null : mailing.id)}
                  className={"cursor-pointer border-b-2 border-dotted border-[#d9e1ea] text-[16px] transition hover:bg-[#f2f5f8] " + (selectedId === mailing.id ? "bg-[#f0f3f7]" : "")}
                >
                  <td className="px-9 py-4">{mailing.id}</td>
                  <td className="px-4 py-4">{mailing.message}</td>
                  <td className="px-4 py-4">{mailing.createdAt}</td>
                  <td className={"px-4 py-4 " + (mailing.status === "Отправлено" ? "text-[#6fc982]" : "text-[#e4a345]")}>{t(mailing.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedMailing && (
        <section className="mt-6 overflow-hidden rounded-sm bg-white shadow-[0_3px_9px_rgba(26,37,55,.24)]">
          <div className="border-b border-[#e5e8ed] px-5 py-5 text-[24px] font-medium">{t("Рассылка")} № {selectedMailing.id}</div>
          <div className="grid grid-cols-1 md:grid-cols-[270px_1fr_1.8fr]">
            <div className="m-5 flex min-h-56 flex-col items-center justify-center border border-[#cbd3dd] bg-[#f8fafc] text-[#8390a4]">
              {selectedMailing.photo ? (
                <img src={selectedMailing.photo} alt={t("Фото рассылки")} className="h-56 w-full object-cover" />
              ) : (
                <>
                  <Camera size={34} className="mb-2 text-[#3d424a]" />
                  <span>{t("Фото отсутствует")}</span>
                </>
              )}
            </div>
            <div className="border-r border-[#e7ebf0] px-9 py-5 leading-8">
              <p>{t("Отправлено")}: <strong className="float-right">{selectedMailing.sent}({t("человек")})</strong></p>
              <p>{t("Заблокировали")}: <strong className="float-right">{selectedMailing.blocked}({t("человек")})</strong></p>
              <p>{t("Дата создания")}: <strong className="float-right">{selectedMailing.createdAtDetail}</strong></p>
              <div className="mt-5 border-t border-[#e7ebf0] pt-5">
                <p>{t("Исполнение")}:</p>
                <p>{t("Статус")}: <span className="float-right text-[#6fc982]">{t(selectedMailing.status)}</span></p>
              </div>
            </div>
            <div className="px-9 py-5">
              <p>{t("Сообщение")}: {selectedMailing.message}</p>
              {selectedMailing.debt && <p className="mt-4 rounded bg-[#fff4dc] px-3 py-2 text-[#a46c00]">{t("Отправить долг")}: {t("включено")}</p>}
            </div>
          </div>
        </section>
      )}

      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={createMailing} className="w-full max-w-[875px] overflow-hidden rounded-sm bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e6e9ee] px-9 py-6">
              <h2 className="text-[18px] font-bold">{t("СОЗДАТЬ РАССЫЛКУ")}</h2>
              <button type="button" onClick={() => setComposerOpen(false)} aria-label={t("Закрыть")}><X size={29} className="text-[#656565]" /></button>
            </div>
            <div className="px-9 py-8">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mx-auto flex h-64 w-64 flex-col items-center justify-center border-2 border-dashed border-[#e3e6eb] text-[#29364c] hover:bg-[#f7f9fc]"
              >
                {photoPreview ? <img src={photoPreview} alt={t("Предпросмотр")} className="h-full w-full object-cover" /> : <><ImagePlus size={46} className="mb-2 text-[#adadad]" /><span>{t("Добавьте фото")}</span></>}
              </button>
              <label className="mt-14 block text-[17px] font-semibold">
                {t("Сообщение")}
                <textarea name="message" required rows={3} className="mt-4 w-full resize-none border-b border-[#d6dce5] p-2 text-base font-normal outline-none focus:border-[#4f6ee8]" />
              </label>
              <label className="mt-12 flex items-center gap-3 text-[17px] font-semibold">
                <input name="debt" type="checkbox" className="h-5 w-5 accent-[#4f6ee8]" />
                {t("Отправить долг")}
              </label>
            </div>
            <div className="flex justify-end border-t border-[#e6e9ee] px-9 py-5">
              <button type="submit" className="rounded bg-[#72cf89] px-6 py-3 font-bold text-white transition hover:bg-[#5fbd76]">{t("СОХРАНИТЬ")}</button>
            </div>
          </form>
        </div>
      )}
    </RefPage>
  )
}
