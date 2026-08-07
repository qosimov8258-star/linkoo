"use client"

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react"
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Search, X } from "lucide-react"

type Mailing = {
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

const rows: Array<[string, string]> = [
  ["balance", "30 янв. 2026"],
  [".", "29 янв. 2026"],
  ["карзилани тоела", "11 янв. 2026"],
  ["balance", "10 янв. 2026"],
  ["balance", "27 дек. 2025"],
  ["balance", "26 дек. 2025"],
  ["balance", "26 дек. 2025"],
  ["balance", "22 дек. 2025"],
  ["yengi tovar coca cola qulbnay", "19 дек. 2025"],
  ["olma skidkada", "10 дек. 2025"],
  ["Yangi aksiyalar haqida ma'lumot", "06 дек. 2025"],
  ["Новая поставка уже на складе", "01 дек. 2025"],
  ["Chegirma 15%", "29 нояб. 2025"],
  ["monthly balance", "21 нояб. 2025"],
  ["Mahsulotlar yangilandi", "16 нояб. 2025"],
  ["Скидка для клиентов", "10 нояб. 2025"],
  ["Yangi bonuslar", "02 нояб. 2025"],
  ["balance", "26 окт. 2025"],
  ["Kuzgi aksiya", "18 окт. 2025"],
  ["Eslatma", "10 окт. 2025"],
  ["Товар в наличии", "04 окт. 2025"],
  ["balance", "28 сент. 2025"],
  ["Yangi narxlar", "16 сент. 2025"],
  ["Сентябрьская рассылка", "09 сент. 2025"],
  ["Акция выходного дня", "03 сент. 2025"],
  ["Добро пожаловать", "28 авг. 2025"],
]

const initialMailings: Mailing[] = rows.map(([message, createdAt], index) => ({
  id: 27 - index,
  message,
  createdAt,
  createdAtDetail: index === 2 ? "11 янв. 2026, 19:51" : createdAt,
  status: "Отправлено",
  sent: index === 2 ? 2 : 12 + (index % 9),
  blocked: index === 2 ? 11 : index % 4,
  debt: index % 5 === 0,
}))

export function MailingView() {
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
    const id = Math.max(...mailings.map((mailing) => mailing.id)) + 1
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
    setNotice("Рассылка сохранена как черновик")
  }

  return (
    <main className="min-h-screen bg-[#f3f6fa] px-4 pb-12 pt-5 text-[#26344c] md:px-9">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[25px] font-bold text-[#536176]">
          <span className="text-[#4f6ee8]">★ Избранные</span>
          <span className="mx-3 text-[#5f6877]">|</span>
          Рассылка
        </h1>
        <button
          type="button"
          onClick={() => {
            setComposerOpen(true)
            setNotice("")
          }}
          className="rounded px-5 py-2 text-[16px] font-medium text-[#45bdb5] transition hover:bg-[#e8f7f5]"
        >
          Разослать
        </button>
      </div>

      {notice && (
        <div className="mb-3 flex items-center justify-between rounded bg-[#e9f8ed] px-4 py-3 text-sm text-[#278549]">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label="Закрыть уведомление">
            <X size={18} />
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-sm bg-white shadow-[0_2px_6px_rgba(26,37,55,.18)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <label className="relative block w-full max-w-[240px]">
            <span className="sr-only">Поиск</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder="Поиск"
              className="w-full border-b border-[#d8dfe9] py-2 pr-9 text-[16px] outline-none placeholder:text-[#b3bac7] focus:border-[#4f6ee8]"
            />
            <Search className="absolute right-2 top-2.5 text-[#c4c9cf]" size={23} />
          </label>
          <div className="flex items-center gap-5 text-[#525e70]">
            <span>25⌄</span>
            <span>{visibleMailings.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, visibleMailings.length)} из {visibleMailings.length}</span>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Предыдущая страница" className="rounded-full text-[#8f9399] hover:text-[#4f6ee8] disabled:opacity-30"><ChevronLeft /></button>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Следующая страница" className="rounded-full text-[#8f9399] hover:text-[#4f6ee8] disabled:opacity-30"><ChevronRight /></button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-[#626c80] text-left text-white">
              <tr>
                <th className="w-[9%] px-9 py-4 font-semibold">№</th>
                <th className="w-[55%] px-4 py-4 font-semibold">Сообщение</th>
                <th className="w-[21%] px-4 py-4 font-semibold">Дата создания</th>
                <th className="w-[15%] px-4 py-4 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody>
              {pagedMailings.map((mailing) => (
                <tr
                  key={mailing.id}
                  onClick={() => setSelectedId(selectedId === mailing.id ? null : mailing.id)}
                  className={"cursor-pointer border-b-2 border-dotted border-[#d9e1ea] text-[16px] transition hover:bg-[#f1f4f8] " + (selectedId === mailing.id ? "bg-[#f0f3f7]" : "")}
                >
                  <td className="px-9 py-4">{mailing.id}</td>
                  <td className="px-4 py-4">{mailing.message}</td>
                  <td className="px-4 py-4">{mailing.createdAt}</td>
                  <td className={"px-4 py-4 " + (mailing.status === "Отправлено" ? "text-[#6fc982]" : "text-[#e4a345]")}>{mailing.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedMailing && (
        <section className="mt-6 overflow-hidden rounded-sm bg-white shadow-[0_3px_9px_rgba(26,37,55,.24)]">
          <div className="border-b border-[#e5e8ed] px-5 py-5 text-[24px] font-medium">Рассылка № {selectedMailing.id}</div>
          <div className="grid grid-cols-1 md:grid-cols-[270px_1fr_1.8fr]">
            <div className="m-5 flex min-h-56 flex-col items-center justify-center border border-[#cbd3dd] bg-[#f8fafc] text-[#8390a4]">
              {selectedMailing.photo ? (
                <img src={selectedMailing.photo} alt="Фото рассылки" className="h-56 w-full object-cover" />
              ) : (
                <>
                  <Camera size={34} className="mb-2 text-[#3d424a]" />
                  <span>Фото отсутствует</span>
                </>
              )}
            </div>
            <div className="border-r border-[#e7ebf0] px-9 py-5 leading-8">
              <p>Отправлено: <strong className="float-right">{selectedMailing.sent}(человек)</strong></p>
              <p>Заблокировали: <strong className="float-right">{selectedMailing.blocked}(человек)</strong></p>
              <p>Дата создания: <strong className="float-right">{selectedMailing.createdAtDetail}</strong></p>
              <div className="mt-5 border-t border-[#e7ebf0] pt-5">
                <p>Исполнение:</p>
                <p>Статус: <span className="float-right text-[#6fc982]">{selectedMailing.status}</span></p>
              </div>
            </div>
            <div className="px-9 py-5">
              <p>Сообщение: {selectedMailing.message}</p>
              {selectedMailing.debt && <p className="mt-4 rounded bg-[#fff4dc] px-3 py-2 text-[#a46c00]">Отправить долг: включено</p>}
            </div>
          </div>
        </section>
      )}

      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={createMailing} className="w-full max-w-[875px] overflow-hidden rounded-sm bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e6e9ee] px-9 py-6">
              <h2 className="text-[18px] font-bold">СОЗДАТЬ РАССЫЛКУ</h2>
              <button type="button" onClick={() => setComposerOpen(false)} aria-label="Закрыть"><X size={29} className="text-[#656565]" /></button>
            </div>
            <div className="px-9 py-8">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mx-auto flex h-64 w-64 flex-col items-center justify-center border-2 border-dashed border-[#e3e6eb] text-[#29364c] hover:bg-[#f7f9fc]"
              >
                {photoPreview ? <img src={photoPreview} alt="Предпросмотр" className="h-full w-full object-cover" /> : <><ImagePlus size={46} className="mb-2 text-[#adadad]" /><span>Добавьте фото</span></>}
              </button>
              <label className="mt-14 block text-[17px] font-semibold">
                Сообщение
                <textarea name="message" required rows={3} className="mt-4 w-full resize-none border-b border-[#d6dce5] p-2 text-base font-normal outline-none focus:border-[#4f6ee8]" />
              </label>
              <label className="mt-12 flex items-center gap-3 text-[17px] font-semibold">
                <input name="debt" type="checkbox" className="h-5 w-5 accent-[#4f6ee8]" />
                Отправить долг
              </label>
            </div>
            <div className="flex justify-end border-t border-[#e6e9ee] px-9 py-5">
              <button type="submit" className="rounded bg-[#72cf89] px-6 py-3 font-bold text-white transition hover:bg-[#5fbd76]">СОХРАНИТЬ</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
