"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { MaterialAlert } from "@/components/analytics/cash-material"
import { PrintMenu } from "@/components/orders/print-menu"
import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

// The supplier return card's print icon (tooltip «Распечатать», never disabled, like Linko's): Linko's print menu with
// «Кол - во повторений» and the active templates «provider_return» (Справочники → Шаблоны документов). A template
// prints the return merged into it (GET /api/supplier-returns/print), N copies: the sheet covers the page, prints itself
// once loaded (window.print()) and closes with its ✕. A sheet that cannot be made shows Linko's «Ошибка» box instead.

export function SupplierReturnPrintButton({ id }: { id: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState<{ templateId: number; copies: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const onError = useCallback(() => {
    setSheet(null)
    setFailed(true)
  }, [])
  return (
    <span className="relative z-[1] flex">
      <button
        type="button"
        title={t("Распечатать")}
        aria-label={t("Распечатать")}
        data-tip-side="left"
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 cursor-pointer items-center justify-center"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
          <path d={RI.print} />
        </svg>
      </button>
      {open && (
        <PrintMenu
          keyName="provider_return"
          className="right-0 top-12"
          onClose={() => setOpen(false)}
          onPick={(copies, templateId) => {
            setOpen(false)
            setSheet({ templateId, copies })
          }}
        />
      )}
      {sheet && <PrintSheet id={id} templateId={sheet.templateId} copies={sheet.copies} onClose={() => setSheet(null)} onError={onError} />}
      {failed && createPortal(<MaterialAlert message={t("Ошибка")} onClose={() => setFailed(false)} />, document.body)}
    </span>
  )
}

function PrintSheet({ id, templateId, copies, onClose, onError }: { id: number; templateId: number; copies: number; onClose: () => void; onError: () => void }) {
  const { t } = useLanguage()
  const [pages, setPages] = useState<string[] | null>(null)
  const printed = useRef(false)
  useEffect(() => {
    let alive = true
    fetch(`/api/supplier-returns/print?ids=${id}&template=${templateId}&count=${copies}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { pages?: Array<{ html: string }> }
        if (!alive) return
        if (response.ok && body.pages?.length) setPages(body.pages.map((page) => page.html))
        else onError()
      })
      .catch(() => alive && onError())
    return () => {
      alive = false
    }
  }, [id, templateId, copies, onError])
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
  return createPortal(
    // A template prints as written in Шаблоны документов (its own language and amounts), like Linko's.
    <div data-return-print data-no-translate="" data-keep-currency="" className="fixed inset-0 z-[140] overflow-auto bg-white text-[14px] text-[#333]">
      <style>{`[data-return-print] .printItem { width: 100%; padding: 20px 30px 40px; box-sizing: border-box; border-bottom: 1px solid #212121; background: #fff; }
@media print {
  body > *:not([data-return-print]) { display: none !important; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  [data-return-print] { position: static !important; inset: auto !important; overflow: visible !important; }
  [data-return-print] .printItem { break-inside: avoid; }
}`}</style>
      {pages ? (
        pages.map((html, index) => <div key={index} className="printItem" dangerouslySetInnerHTML={{ __html: html }} />)
      ) : (
        <div className="flex h-screen w-screen items-center justify-center bg-white">
          <span className="h-[30px] w-[30px] animate-spin rounded-full border-[3px] border-[#1E4A9A] border-t-transparent" />
        </div>
      )}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className="fixed right-[5px] top-[5px] z-[141] flex h-12 w-12 cursor-pointer items-center justify-center print:hidden">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
          <path d={RI.close} />
        </svg>
      </button>
    </div>,
    document.body,
  )
}
