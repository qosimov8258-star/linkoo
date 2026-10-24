"use client"

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react"
import { Camera, ImagePlus, X } from "lucide-react"
import { RefHeader, RefPage, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { CheckBox } from "@/components/analytics/catalog-ui"
import { useRefRecords } from "@/lib/use-ref-records"
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

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const pad2 = (value: number) => String(value).padStart(2, "0")

export function MailingView() {
  const { t } = useLanguage()
  const { rows: mailings, create } = useRefRecords<Mailing>("mailing")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string>()
  const [notice, setNotice] = useState("")
  const [debt, setDebt] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visibleMailings = useMemo(() => {
    const term = query.trim().toLowerCase()
    return mailings.filter((mailing) => {
      return !term || [mailing.id, mailing.message, mailing.createdAt, mailing.status]
        .join(" ")
        .toLowerCase()
        .includes(term)
    })
  }, [mailings, query])

  const paging = usePaging(visibleMailings.length)
  const pagedMailings = visibleMailings.slice(paging.start, paging.end)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function createMailing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const message = String(formData.get("message") || "").trim()
    if (!message) return
    const now = new Date()
    const day = `${pad2(now.getDate())} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`
    const created = await create({
      message,
      createdAt: day,
      createdAtDetail: `${day}, ${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      status: "Черновик",
      sent: 0,
      blocked: 0,
      debt,
      photo: photoPreview,
    } as Omit<Mailing, "id">)
    if (created) setSelectedId(created.id)
    paging.setPage(1)
    setComposerOpen(false)
    setPhotoPreview(undefined)
    setDebt(false)
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
          className="h-[36px] w-[99px] text-center text-[13px] font-bold text-[#45bdb5] hover:bg-[#e8f7f5]"
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

      <SplitDetailList
        rows={pagedMailings}
        selectedKey={selectedId}
        rowKey={(mailing) => mailing.id}
        toolbar={
          <RefToolbar
            hideFilter
            query={query}
            onQuery={(value) => { setQuery(value); paging.setPage(1) }}
            pageSize={paging.pageSize}
            onPageSize={paging.setPageSize}
            from={visibleMailings.length ? paging.start + 1 : 0}
            to={paging.end}
            total={visibleMailings.length}
            page={paging.page}
            pageCount={paging.pageCount}
            onPage={paging.setPage}
          />
        }
        tableProps={{
          cols: "minmax(0,1fr) minmax(0,7fr) minmax(0,2fr) minmax(0,2fr)",
          heads: [t("№"), t("Сообщение"), t("Дата создания"), <span key="status-head" className="-mr-2 block text-right font-semibold">{t("Статус")}</span>],
          rowKey: (mailing: Mailing) => mailing.id,
          onRowClick: (mailing: Mailing) => setSelectedId(selectedId === mailing.id ? null : mailing.id),
          empty: t("Ничего не найдено"),
          render: (mailing: Mailing) => [mailing.id, mailing.message, mailing.createdAt, <span key="st" className={`-mr-2 block text-right ${mailing.status === "Отправлено" ? "text-[#6fc982]" : "text-[#e4a345]"}`}>{t(mailing.status)}</span>],
        }}
        detail={(mailing) => (
          <>
            <div className="h-[66px] border-b border-[#e5e8ed] px-[30px] text-[18px] font-medium leading-[66px] text-[#333]">{t("Рассылка")} № {mailing.id}</div>
            <div className="grid grid-cols-[212px_298px_minmax(0,1fr)] text-[13px] text-[#333]">
              <div className="m-[15px] mb-[16px] flex h-[240px] flex-col items-center justify-center border border-[#cbd3dd] bg-[#f4f6f9] text-[#8390a4]">
                {mailing.photo ? (
                  <img src={mailing.photo} alt={t("Фото рассылки")} className="h-full w-full object-cover" />
                ) : (
                  <>
                    <Camera size={22} className="mb-[6px] text-[#222]" />
                    <span>{t("Фото отсутствует")}</span>
                  </>
                )}
              </div>
              <div className="border-r border-[#e7ebf0] pl-[30px] pr-[28px] pt-[16px] leading-[25px]">
                <p>{t("Отправлено")}: <strong className="float-right">{mailing.sent}({t("человек")})</strong></p>
                <p>{t("Заблокировали")}: <strong className="float-right">{mailing.blocked}({t("человек")})</strong></p>
                <p>{t("Дата создания")}: <strong className="float-right">{mailing.createdAtDetail}</strong></p>
                <div className="-ml-[30px] -mr-[28px] mt-[14px] border-t border-[#e7ebf0] pl-[30px] pr-[28px] pt-[17px]">
                  <p><strong>{t("Исполнение")}:</strong></p>
                  <p>{t("Статус")}: <span className={`float-right ${mailing.status === "Отправлено" ? "text-[#6fc982]" : "text-[#e4a345]"}`}>{t(mailing.status)}</span></p>
                </div>
              </div>
              <div className="px-[30px] pt-[15px] leading-[18px]">
                <p>{t("Сообщение")}: {mailing.message}</p>
              </div>
            </div>
          </>
        )}
      />

      {composerOpen && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/[0.54]">
          <form onSubmit={createMailing} className="flex h-[547px] w-[700px] flex-col bg-white shadow-[0_3px_10px_rgba(0,0,0,0.3)]">
            <div className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#e6e9ee] px-[30px]">
              <h2 className="text-[13px] font-bold uppercase text-[#333]">{t("СОЗДАТЬ РАССЫЛКУ")}</h2>
              <button type="button" onClick={() => setComposerOpen(false)} aria-label={t("Закрыть")}><X size={24} strokeWidth={1.5} className="text-[#333]" /></button>
            </div>
            <div className="min-h-0 flex-1 px-[30px] pt-[50px]">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mx-auto flex h-[200px] w-[200px] flex-col items-center justify-center border-2 border-dashed border-[#e3e6eb] text-[13px] text-[#29364c] hover:bg-[#f7f9fc]"
              >
                {photoPreview ? <img src={photoPreview} alt={t("Предпросмотр")} className="h-full w-full object-cover" /> : <><ImagePlus size={40} className="mb-[14px] text-[#adadad]" /><span>{t("Добавьте фото")}</span></>}
              </button>
              <label className="mt-[41px] block text-[13px] font-bold">
                {t("Сообщение")}
                <textarea name="message" required rows={2} className="mt-0 block h-[53px] w-full resize-none border-b border-[#d6dce5] text-[13px] font-normal outline-none focus:border-[#4f6ee8]" />
              </label>
              <div className="mt-[19px]">
                <CheckBox checked={debt} onChange={setDebt} label={t("Отправить долг")} />
              </div>
            </div>
            <div className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e6e9ee] px-[10px]">
              <button type="submit" className="h-[36px] w-[111px] rounded-[4px] bg-[#71ce87] text-[12px] font-bold uppercase text-white transition hover:bg-[#5fbd76]">{t("СОХРАНИТЬ")}</button>
            </div>
          </form>
        </div>
      )}
    </RefPage>
  )
}
