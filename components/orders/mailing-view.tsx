"use client"

import { DragEvent, FormEvent, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { CheckBox } from "@/components/analytics/catalog-ui"
import { MaterialField } from "@/components/analytics/material-field"
import { SortHead, sortByOrdering, toggleOrdering, useListUrlState } from "@/components/analytics/list-url-state"
import { parseAnyDate } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
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

// «Рассылка» (reference #/telegram-mailing, API telegram/mailing/). The reference sends a new mailing to every bot user
// at once; this installation has no Telegram bot, so a new mailing is stored as a draft («Черновик») nobody received.
// The list is sorted, searched and paged over all mailings, with its state in the URL (components/analytics/list-url-state.tsx).

const BASE = "/analytics/mailing"
const ORDERINGS = ["id", "message", "created_date", "status"] as const
/** The reference cuts long messages in the list (trimString(message, 120)); the card shows the whole text. */
const LIST_MESSAGE_LENGTH = 120
/** The photo types the reference's drop zone takes. */
const PHOTO_TYPES = ["image/jpeg", "image/png"]
const SENT = "#81c784"
const PENDING = "#f0ad4e"
// The reference's material icons: "photo_camera" (card without a photo) and "image" (drop zone).
const CAMERA_ICON = "M20 4h-3.17l-1.24-1.35c-.37-.41-.91-.65-1.47-.65H9.88c-.56 0-1.1.24-1.48.65L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"
const IMAGE_ICON = "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"

const trimMessage = (message: string) => (message.length <= LIST_MESSAGE_LENGTH ? message : `${message.slice(0, LIST_MESSAGE_LENGTH)}...`)
const createdKey = (mailing: Mailing) => parseAnyDate(mailing.createdAtDetail || mailing.createdAt) ?? ""

export function MailingView({ initialId = null }: { initialId?: number | null }) {
  const { t, language } = useLanguage()
  const { rows: mailings, create } = useRefRecords<Mailing>("mailing")
  const { state, update } = useListUrlState({ base: BASE, dialogParam: "openCreateDialog", orderings: ORDERINGS, initialId: initialId ? String(initialId) : null })
  const [message, setMessage] = useState("")
  const [messageError, setMessageError] = useState("")
  const [photoPreview, setPhotoPreview] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState("")
  const [debt, setDebt] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // The reference searches the message text only; the list keeps its own order (newest first) under the chosen columns.
  const visibleMailings = useMemo(() => {
    const term = state.search.trim().toLowerCase()
    const found = term ? mailings.filter((mailing) => mailing.message.toLowerCase().includes(term)) : mailings
    return sortByOrdering(found, state.ordering, {
      id: (a, b) => a.id - b.id,
      // The reference sorts by an unrelated field (accepted_by) here, which leaves the order as it is; the text sorts.
      message: (a, b) => a.message.localeCompare(b.message, "ru"),
      created_date: (a, b) => createdKey(a).localeCompare(createdKey(b)),
      status: (a, b) => a.status.localeCompare(b.status),
    })
  }, [mailings, state.search, state.ordering])

  const pageCount = Math.max(1, Math.ceil(visibleMailings.length / state.pageSize))
  const page = Math.min(state.page, pageCount)
  const start = (page - 1) * state.pageSize
  const end = Math.min(start + state.pageSize, visibleMailings.length)
  const selectedId = state.id && /^\d+$/.test(state.id) ? Number(state.id) : null
  const composerOpen = state.dialog === true
  const sort = (field: string) => update({ ordering: toggleOrdering(state.ordering, field), page: 1 })

  function takePhoto(file: File | undefined) {
    if (!file || !PHOTO_TYPES.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(String(reader.result))
    reader.readAsDataURL(file)
  }

  function dropPhoto(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    takePhoto(event.dataTransfer.files?.[0])
  }

  /** Closing the dialog empties the form, like the reference (its form is reset when the dialog closes). */
  function closeComposer() {
    update({ dialog: false })
    setMessage("")
    setMessageError("")
    setPhotoPreview(undefined)
    setDebt(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function createMailing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    // The reference has no check of its own here: its server answers an empty message with «Обязательное поле.»
    // under the field. The same text is shown without the round trip.
    if (!message.trim()) {
      setMessageError(t("Обязательное поле."))
      return
    }
    setSaving(true)
    // Moment, status and counters are the server's (lib/ref-records-repo.ts mailingCreate).
    const created = await create({ message: message.trim(), debt, photo: photoPreview } as Omit<Mailing, "id">).catch(() => null)
    setSaving(false)
    // Refused: useRefRecords already shows the server's reason in the app alert; the dialog stays open.
    if (!created) return
    closeComposer()
    update({ dialog: false, id: String(created.id), page: 1 })
    setNotice(t("Рассылка сохранена как черновик"))
  }

  const statusColor = (mailing: Mailing) => (mailing.status === "Отправлено" ? SENT : PENDING)

  return (
    <RefPage>
      <RefHeader title={t("Рассылка")}>
        <button
          type="button"
          onClick={() => {
            update({ dialog: true })
            setNotice("")
          }}
          className="h-[36px] w-[99px] rounded-[2px] text-center text-[13px] font-semibold text-[#4db6ac] hover:bg-[rgba(153,153,153,0.2)]"
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
        rows={visibleMailings.slice(start, end)}
        selectedKey={selectedId}
        rowKey={(mailing) => mailing.id}
        toolbar={
          <RefToolbar
            hideFilter
            pageSizeMenu
            query={state.search}
            onQuery={(value) => update({ search: value, page: 1 })}
            pageSize={state.pageSize}
            onPageSize={(size) => update({ pageSize: size, page: 1 })}
            from={visibleMailings.length ? start + 1 : 0}
            to={end}
            total={visibleMailings.length}
            page={page}
            pageCount={pageCount}
            onPage={(next) => update({ page: next })}
          />
        }
        tableProps={{
          cols: "minmax(0,1fr) minmax(0,7fr) minmax(0,2fr) minmax(0,2fr)",
          // The reference's «№» title starts 8px left of its numbers; «Статус» is right-aligned with its arrow before it.
          heads: [
            <SortHead key="id" label={t("№")} field="id" ordering={state.ordering} onSort={sort} className="-ml-2" />,
            <SortHead key="message" label={t("Сообщение")} field="message" ordering={state.ordering} onSort={sort} />,
            <SortHead key="created" label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} />,
            <div key="status" className="-mr-2 flex justify-end"><SortHead label={t("Статус")} field="status" ordering={state.ordering} onSort={sort} right /></div>,
          ],
          rowKey: (mailing: Mailing) => mailing.id,
          onRowClick: (mailing: Mailing) => update({ id: selectedId === mailing.id ? null : String(mailing.id) }),
          empty: t("Ничего не найдено"),
          render: (mailing: Mailing) => [
            mailing.id,
            trimMessage(mailing.message),
            formatDateText(mailing.createdAt, language),
            <span key="st" className="-mr-2 block text-right" style={{ color: statusColor(mailing) }}>{t(mailing.status)}</span>,
          ],
        }}
        detail={(mailing) => (
          <>
            {/* The reference's whole header is a link back to the list: clicking it closes the card. */}
            <button
              type="button"
              onClick={() => update({ id: null })}
              className="block h-[66px] w-full cursor-pointer border-b border-[#e5e8ed] px-[30px] text-left text-[18px] font-semibold leading-[66px] text-[#333]"
            >
              {t("Рассылка")} № {mailing.id}
            </button>
            <div className="grid grid-cols-[228px_302px_minmax(0,1fr)] text-[13px] text-[#333]">
              <div className="h-[30vh] min-h-[165px] p-[15px]">
                {mailing.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the photo is a data URL stored with the mailing
                  <img src={mailing.photo} alt={t("Фото рассылки")} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full min-h-[135px] flex-col items-center justify-center border border-[#c7cdd4] bg-[rgba(233,236,239,0.38)]">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d={CAMERA_ICON} /></svg>
                    <p className="text-center leading-4 text-[#84909f]">{t("Фото отсутствует")}</p>
                  </div>
                )}
              </div>
              <div className="pl-[30px] pr-[30px] pt-[15px] leading-[25px]">
                <p>{t("Отправлено")}: <strong className="float-right font-semibold">{mailing.sent}({t("человек")})</strong></p>
                <p>{t("Заблокировали")}: <strong className="float-right font-semibold">{mailing.blocked}({t("человек")})</strong></p>
                <p>{t("Дата создания")}: <strong className="float-right font-semibold">{formatDateText(mailing.createdAtDetail, language)}</strong></p>
                <div className="-ml-[30px] -mr-[30px] mt-[16px] border-t border-[#efefef] pl-[30px] pr-[30px] pt-[20px]">
                  <p className="font-semibold leading-4">{t("Исполнение")}:</p>
                  <p className="mt-[5px]">{t("Статус")}: <span className="float-right font-semibold" style={{ color: statusColor(mailing) }}>{t(mailing.status)}</span></p>
                </div>
              </div>
              <div className="border-l border-[#efefef] px-[30px] pt-[15px] leading-4">
                <p className="whitespace-pre-line">{t("Сообщение")}: {mailing.message}</p>
              </div>
            </div>
          </>
        )}
      />

      {composerOpen && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/[0.54]">
          <form onSubmit={createMailing} noValidate className="flex max-h-[calc(100vh-32px)] w-[700px] max-w-[calc(100vw-32px)] flex-col bg-white shadow-[0_3px_10px_rgba(0,0,0,0.3)]">
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e6e9ee] px-[30px]">
              <h2 className="text-[13px] font-bold uppercase text-[#333]">{t("СОЗДАТЬ РАССЫЛКУ")}</h2>
              <button type="button" onClick={closeComposer} aria-label={t("Закрыть")}><X size={24} strokeWidth={1.5} className="text-[#333]" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pb-[30px] pt-[50px]">
              <input ref={fileInputRef} type="file" accept="image/jpeg, image/png" className="hidden" onChange={(event) => takePhoto(event.target.files?.[0])} />
              {/* The reference's drop zone: click to choose, or drop a JPEG / PNG on it. */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={dropPhoto}
                className={`mx-auto flex h-[200px] w-[200px] flex-col items-center justify-center border-2 border-dashed text-[13px] text-[#333] hover:bg-[#f7f9fc] ${dragging ? "border-[#b9b9b9] bg-[#f7f9fc]" : "border-[#efefef]"}`}
              >
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                  <img src={photoPreview} alt={t("Предпросмотр")} className="h-full w-full object-cover" />
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-[50px] w-[50px] fill-[#b9b9b9]" aria-hidden><path d={IMAGE_ICON} /></svg>
                    <span>{t("Добавьте фото")}</span>
                  </>
                )}
              </button>
              <MaterialField
                name="message"
                label={t("Сообщение")}
                rows={3}
                grow
                bold
                value={message}
                error={messageError}
                onChange={(value) => {
                  setMessage(value)
                  setMessageError("")
                }}
              />
              {/* The reference's checkbox row: 22px under the message field, black text on 20px lines. */}
              <div className="mt-[22px] leading-[20px] text-black">
                <CheckBox checked={debt} onChange={setDebt} label={t("Отправить долг")} />
              </div>
            </div>
            <div className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e6e9ee] px-[10px]">
              <button type="submit" disabled={saving} className="h-[36px] w-[111px] rounded-[4px] bg-[#71ce87] text-[13px] font-semibold uppercase text-white transition hover:bg-[#5fbd76] disabled:opacity-60">{t("СОХРАНИТЬ")}</button>
            </div>
          </form>
        </div>
      )}
    </RefPage>
  )
}
