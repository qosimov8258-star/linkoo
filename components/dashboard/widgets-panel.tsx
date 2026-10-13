"use client"

import { useEffect, useState } from "react"
import { HOME_WIDGETS } from "@/lib/dashboard-home-widgets"
import { useLanguage } from "@/lib/i18n/language-context"

export function WidgetsPanel({
  open,
  selected,
  onClose,
  onSave,
}: {
  open: boolean
  selected: string[]
  onClose: () => void
  onSave: (keys: string[]) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<string[]>(selected)

  useEffect(() => {
    if (open) setDraft(selected)
  }, [open, selected])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  function toggle(key: string) {
    setDraft((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]))
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-[1200] bg-black/[0.54] transition-opacity duration-[400ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <form
        role="dialog"
        aria-label={t("Настройка виджетов")}
        aria-hidden={!open}
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
        className={`fixed right-0 top-0 z-[1300] flex h-full w-[340px] max-w-full flex-col bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "translate-x-0" : "invisible translate-x-full"}`}
      >
        <header className="border-b border-[#efefef] px-[30px] py-5">
          <h4 className="text-[14px] font-semibold leading-[17.5px]">{t("Настройка виджетов")}</h4>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[30px] py-5">
          {HOME_WIDGETS.map((widget) => {
            const checked = draft.includes(widget.key)
            return (
              <label key={widget.key} className="my-[15px] flex cursor-pointer items-center first:mt-0">
                <input type="checkbox" checked={checked} onChange={() => toggle(widget.key)} className="sr-only" />
                <svg viewBox="0 0 24 24" className="mr-4 h-5 w-5 shrink-0 fill-[#666]" aria-hidden>
                  <path
                    d={
                      checked
                        ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
                        : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
                    }
                  />
                </svg>
                <span className="text-[13px] font-semibold text-black">{t(widget.label)}</span>
              </label>
            )
          })}
        </div>
        <div className="flex justify-end border-t border-[#efefef] px-[30px] py-[18px]">
          <button type="submit" className="text-[13px] font-semibold uppercase text-[#0a9ddb]">
            {t("Сохранить")}
          </button>
        </div>
      </form>
    </>
  )
}
