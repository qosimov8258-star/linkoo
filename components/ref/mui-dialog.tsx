"use client"

import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

// The reference's Material-UI dialog with a green action (Себестоимость: "Перерасчет",
// "Перезаписать", "Сгенерировать заново"): centred 540px paper, 60px title bar with the 13px bold
// uppercase title and a 24px close icon, a body of a fixed height, a 57px footer with the
// green action pinned 10px from the right and bottom edges.

const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

export function RefMuiDialog({
  title,
  onClose,
  action,
  onAction,
  busy,
  error,
  width = 540,
  bodyHeight,
  children,
}: {
  title: string
  onClose: () => void
  /** Label of the green action; omit for a dialog without footer. */
  action?: string
  onAction?: () => void
  busy?: boolean
  /** Message printed left of the action (server error). */
  error?: string
  width?: number
  /** Fixed height of the body in px (the reference sizes each dialog that way). */
  bodyHeight?: number
  children: ReactNode
}) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" style={{ width }} className="max-h-full max-w-full overflow-y-auto bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <div className="relative h-[60px] border-b border-[#efefef]">
          <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{title}</span>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
              <path d={CLOSE} />
            </svg>
          </button>
        </div>
        <div className="px-[30px] pt-[30px]" style={bodyHeight ? { minHeight: bodyHeight } : undefined}>
          {children}
        </div>
        {action && (
          <div className="flex h-[57px] items-center justify-end gap-3 border-t border-[#efefef] pr-[10px]">
            {error && <span className="mr-auto pl-[30px] text-[13px] text-[#e57373]">{error}</span>}
            <button
              type="button"
              disabled={busy}
              onClick={onAction}
              className="h-9 min-w-[88px] cursor-pointer rounded-[3px] bg-[#6fc988] px-4 text-[13px] font-semibold uppercase text-white disabled:cursor-default disabled:opacity-60"
            >
              {action}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Material radio row (24px ring, 16px gap, 34px pitch) of the reference's dialogs. */
export function RefMuiRadio({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onChange} className="flex h-[34px] w-full cursor-pointer items-center text-left text-[13px] text-[#333]">
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#5d6474]">
        <path d={checked ? "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"} />
      </svg>
      <span className="ml-4">{children}</span>
    </button>
  )
}

const CALENDAR = "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z"

/** "1 октября 2026 г." (ru) for the filled field of the reference. */
function longDate(iso: string, language: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return ""
  try {
    const locale = language === "ru" ? "ru-RU" : language === "uz" ? "uz-UZ" : language === "tk" ? "tk-TM" : "en-GB"
    return new Date(year, month - 1, day).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })
  } catch {
    return iso
  }
}

/**
 * Underlined date field of the Material dialogs: the label is the placeholder, a chosen date moves it
 * above; a transparent native date input on top opens the calendar.
 */
export function RefMuiDate({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const { language } = useLanguage()
  return (
    <div className="relative h-[38px] min-w-0 flex-1">
      <div className={`absolute inset-x-0 bottom-0 h-px ${error ? "bg-[#f44336]" : "bg-[#e0e0e0]"}`} />
      {value ? (
        <>
          <span className="absolute left-0 top-[-3px] text-[10px] leading-3 text-[#333]">{label}</span>
          <span className="absolute bottom-[-2px] left-0 text-[13px] text-black">{longDate(value, language)}</span>
        </>
      ) : (
        <span className="absolute bottom-[6px] left-0 text-[13px] text-[#333]">{label}</span>
      )}
      <svg viewBox="0 0 24 24" className="absolute bottom-[4px] right-[2px] h-[17px] w-[17px] fill-[#ccc]">
        <path d={CALENDAR} />
      </svg>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      {error && <span className="absolute -bottom-[16px] left-0 text-[11px] text-[#f44336]">{error}</span>}
    </div>
  )
}
