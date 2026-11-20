"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, ErrorBlock, LoadingBlock, mutationError } from "@/components/analytics/cash-management-shared"
import { MaterialAlert } from "@/components/analytics/cash-material"
import { docDate, formatQty } from "@/components/analytics/internal-transfers-shared"
import { PrintMenu } from "@/components/orders/print-menu"
import { RI } from "@/components/ref/list-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { WRITE_OFF_STATUS_COLORS, type WriteOff, type WriteOffAction, type WriteOffStatus } from "@/lib/write-offs-types"

// Linko's WriteOffDetail (chunk 143 module 5214), shown in place of the clicked row. Header (65px): «Списание № N»;
// for a finished one the ⊖ «Отменить списание» (→ ?openConfirmDialog=true: «Подтверждение отмены» with «Списание №N»;
// refused with «Отменение невозможно из-за связи с другими данными» when a later count relies on it) and the print
// menu «Распечатать» («Кол - во повторений» and the «writeoff» templates of Шаблоны документов). Left (25%): Создал,
// Склад, Дата создания, Статус, then «Комментарий:». Right (75%): Товар | Код товара | Серия | Блок | Кол-во |
// Себестоимость | Сумма on Linko's 3/1/2/1/1/2/2 grid. A pending write-off (Mezon only) also offers «Списать».

export function WriteOffStatusLabel({ status }: { status: WriteOffStatus }) {
  const { t } = useLanguage()
  return (
    <span className="whitespace-nowrap font-semibold" style={{ color: WRITE_OFF_STATUS_COLORS[status] }}>
      {t(status)}
    </span>
  )
}

// Rows of Linko's dottedList: 15px top and bottom, parted by a dotted line (2px dots every 8px), none under the last.
const DOTS: CSSProperties = { backgroundImage: "linear-gradient(to right, #d9e0e5 2px, transparent 2px)", backgroundSize: "8px 2px", backgroundRepeat: "repeat-x" }
const GRID = "relative -mx-[8px] grid grid-cols-[3fr_1fr_2fr_1fr_1fr_2fr_2fr] py-[15px] leading-4 [&>div]:px-[8px] [&>div]:break-words"
// Linko's IconButton (48px, no hover circle) and its bold dark hint on the left.
const ICON_BUTTON = "flex h-12 w-12 items-center justify-center text-[#666]"
const TIP = "group/tip"

function Dots() {
  return <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={DOTS} />
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex h-[25px] items-center justify-between leading-[25px]">
      <span>{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </li>
  )
}

/** The print icon: «Кол - во повторений» and the «writeoff» templates; a template prints the write-off merged into it, N
 * copies, on a sheet over the page that prints itself and closes with its ✕. */
function WriteOffPrintButton({ id }: { id: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState<{ templateId: number; copies: number } | null>(null)
  return (
    <span className="relative flex">
      <RefTip text={t("Распечатать")} side="left" bold className={TIP}>
        <button type="button" aria-label={t("Распечатать")} onClick={() => setOpen((value) => !value)} className={ICON_BUTTON}>
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden>
            <path d={RI.print} />
          </svg>
        </button>
      </RefTip>
      {open && (
        <PrintMenu
          keyName="writeoff"
          className="right-[0px] top-[44px]"
          onClose={() => setOpen(false)}
          onPick={(copies, templateId) => {
            setOpen(false)
            setSheet({ templateId, copies })
          }}
        />
      )}
      {sheet && <WriteOffPrintSheet id={id} templateId={sheet.templateId} copies={sheet.copies} onClose={() => setSheet(null)} />}
    </span>
  )
}

function WriteOffPrintSheet({ id, templateId, copies, onClose }: { id: number; templateId: number; copies: number; onClose: () => void }) {
  const { t } = useLanguage()
  const [pages, setPages] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const printed = useRef(false)
  useEffect(() => {
    let alive = true
    fetch(`/api/write-offs/${id}/print?template=${templateId}&count=${copies}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { pages?: Array<{ html: string }> }
        if (!alive) return
        if (response.ok && body.pages?.length) setPages(body.pages.map((page) => page.html))
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [id, templateId, copies])
  useEffect(() => {
    if (!pages || printed.current) return
    printed.current = true
    const frame = requestAnimationFrame(() => window.setTimeout(() => window.print(), 50))
    return () => cancelAnimationFrame(frame)
  }, [pages])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  if (failed) return createPortal(<MaterialAlert message={t("Ошибка")} onClose={onClose} />, document.body)
  return createPortal(
    // A template prints as written in Шаблоны документов (its own language and amounts), like Linko.
    <div data-writeoff-print data-no-translate="" data-keep-currency="" className="fixed inset-0 z-[140] overflow-auto bg-white text-[14px] text-[#333]">
      <style>{`[data-writeoff-print] .printItem { width: 100%; padding: 20px 30px 40px; box-sizing: border-box; border-bottom: 1px solid #212121; background: #fff; }
@media print {
  body > *:not([data-writeoff-print]) { display: none !important; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  [data-writeoff-print] { position: static !important; inset: auto !important; overflow: visible !important; }
  [data-writeoff-print] .printItem { break-inside: avoid; }
}`}</style>
      {pages ? (
        pages.map((html, index) => <div key={index} className="printItem" dangerouslySetInnerHTML={{ __html: html }} />)
      ) : (
        <div className="flex h-screen w-screen items-center justify-center">
          <span className="h-[30px] w-[30px] animate-spin rounded-full border-[3px] border-[#1E4A9A] border-t-transparent" />
        </div>
      )}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className="fixed right-[5px] top-[5px] z-[141] flex h-12 w-12 items-center justify-center print:hidden">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
          <path d={RI.close} />
        </svg>
      </button>
    </div>,
    document.body,
  )
}

export function WriteOffDetailPanel({
  id,
  canEdit,
  confirmOpen,
  onConfirmOpen,
  onClose,
  onChanged,
  notify,
}: {
  id: number
  canEdit: boolean
  /** ?openConfirmDialog=true: the «Подтверждение отмены» of a finished write-off. */
  confirmOpen: boolean
  onConfirmOpen: (open: boolean) => void
  onClose: () => void
  onChanged: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<WriteOff>(`/api/write-offs/${id}`)
  const [finishing, setFinishing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const run = async (action: WriteOffAction) => {
    setBusy(true)
    setError("")
    const result = await cashMutate<WriteOff>("POST", `/api/write-offs/${id}/action`, { action })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    notify(t(action === "cancel" ? "Успешно отменено" : "Успешно сохранено"))
    if (action === "cancel") onConfirmOpen(false)
    else setFinishing(false)
    detail.reload()
    onChanged()
  }

  const finished = data.status === "закрыт"
  const cancelOpen = canEdit && finished && confirmOpen
  const closeDialog = () => {
    setError("")
    if (finishing) setFinishing(false)
    else onConfirmOpen(false)
  }
  return (
    <div className="text-[13px] text-[#333]">
      <div className="relative flex h-[65px] items-center justify-between pl-[30px] pr-[15px]">
        <button type="button" onClick={onClose} className="absolute inset-0 z-[1] cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="text-[18px] font-semibold leading-6">
          {t("Списание")} № {data.id}
        </h3>
        <div className="relative z-[2] flex items-center">
          {canEdit && data.status === "ожидает" && (
            <RefTip text={t("Списать")} side="left" bold className={TIP}>
              <button type="button" onClick={() => setFinishing(true)} aria-label={t("Списать")} className={ICON_BUTTON}>
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#81c784]" aria-hidden>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </button>
            </RefTip>
          )}
          {canEdit && finished && (
            <RefTip text={t("Отменить списание")} side="left" bold className={TIP}>
              <button type="button" onClick={() => onConfirmOpen(true)} aria-label={t("Отменить списание")} className={ICON_BUTTON}>
                {/* Material "Remove circle" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" />
                </svg>
              </button>
            </RefTip>
          )}
          <WriteOffPrintButton id={data.id} />
        </div>
      </div>

      <div className="flex flex-col border-t border-[#efefef] md:flex-row">
        <div className="pb-[5px] md:w-1/4 md:shrink-0">
          <ul className="border-b border-[#efefef] px-[30px] py-[15px]">
            <InfoRow label={t("Создал")}>{data.creator || t("Не указано")}</InfoRow>
            <InfoRow label={t("Склад")}>{data.warehouse}</InfoRow>
            <InfoRow label={t("Дата создания")}>{docDate(data.date, language)}</InfoRow>
            <InfoRow label={t("Статус")}>
              <WriteOffStatusLabel status={data.status} />
            </InfoRow>
          </ul>
          <div className="px-[30px] py-[20px] leading-4">
            <div className="mb-[5px] font-semibold">{t("Комментарий")}:</div>
            <div className="break-words">{data.comment || t("Комментарий отсутствует")}</div>
          </div>
        </div>
        <div className="min-w-0 overflow-x-auto border-[#efefef] px-[14px] py-[5px] md:w-3/4 md:border-l">
          <div className="min-w-[720px]">
            <div className={`${GRID} font-semibold`}>
              <div>{t("Товар")}</div>
              <div>{t("Код товара")}</div>
              <div>{t("Серия")}</div>
              <div>{t("Блок")}</div>
              <div>{t("Кол-во")}</div>
              <div>{t("Себестоимость")}</div>
              <div>{t("Сумма")}</div>
              {data.items.length > 0 && <Dots />}
            </div>
            {data.items.map((item, index) => (
              <div key={item.id} className={GRID}>
                <div>{item.product}</div>
                <div>{item.code || "-"}</div>
                <div>{item.series || "-"}</div>
                <div>{formatQty(Math.floor(item.block || 0), "")}</div>
                <div>{formatQty(item.qty, item.unit)}</div>
                <div>{formatMoney(item.cost)}</div>
                <div>{formatMoney(item.sum)}</div>
                {index < data.items.length - 1 && <Dots />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {cancelOpen && (
        <ConfirmDialog
          title={t("Подтверждение отмены")}
          kind="cancel"
          confirmLabel="Да"
          item={`${t("Списание")} №${data.id}`}
          busy={busy}
          error={error}
          onConfirm={() => void run("cancel")}
          onClose={closeDialog}
        />
      )}
      {finishing && (
        <ConfirmDialog
          title={t("Списать")}
          confirmLabel="Списать"
          tone="blue"
          item={`${t("Списание")} №${data.id}`}
          busy={busy}
          error={error}
          onConfirm={() => void run("finish")}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
