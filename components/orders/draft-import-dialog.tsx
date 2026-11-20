"use client"

import { useEffect, useState } from "react"

import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

// «Импортировать» of the «Интеграция» list (Linko's excelImportCreateDialog, ?excelImportCreateDialog=true): a 400 px
// dialog «Импорт с Excel» with «Выберите тип» (Sales XML / Smart XML / Ритм JSON, Sales XML first and chosen), the
// drop zone and «Сохранить». Linko hands the file to its integration (sales/draft_order/import_xml/); this installation
// has no integration, so «Сохранить» with a file says so in the drop zone, where Linko prints its errors.

const TYPES = [
  { value: "sales", label: "Sales XML" },
  { value: "smart", label: "Smart XML" },
  { value: "ritm", label: "Ритм JSON" },
] as const

const RADIO_ON = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_OFF = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const FILE = "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"

export function DraftImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [type, setType] = useState<string>("sales")
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/[0.54] p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[400px] max-w-full bg-white text-[13px] text-[#333] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
          <b className="text-[13px] font-bold uppercase leading-[16.25px]">{t("Импорт с Excel")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
              <path d={RI.close} />
            </svg>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            // Without a file Linko's «Сохранить» sends nothing either.
            if (file) setError(t("Интеграция не подключена: нет новых заказов для импорта"))
          }}
        >
          <div className="px-[30px] pb-[20px] pt-[40px]">
            <strong className="block font-semibold leading-[18px]">{t("Выберите тип")}</strong>
            <div role="radiogroup" aria-label={t("Выберите тип")} className="-mt-px">
              {TYPES.map((item) => (
                <label key={item.value} className="flex h-[34px] cursor-pointer items-center py-[5px]">
                  <input type="radio" name="draft-import-type" value={item.value} checked={type === item.value} onChange={() => setType(item.value)} className="sr-only" />
                  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#5d6474]" aria-hidden>
                    <path d={type === item.value ? RADIO_ON : RADIO_OFF} />
                  </svg>
                  <span className="pl-4">{item.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-[10px] h-[237px] border border-[#efefef] py-[5px]">
              <label className="ml-[20px] mt-[5px] flex h-[200px] w-[302px] cursor-pointer flex-col items-center justify-center border-2 border-dashed border-[#efefef] text-center">
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const picked = event.target.files?.[0] ?? null
                    event.target.value = ""
                    if (picked) {
                      setFile(picked)
                      setError("")
                    }
                  }}
                />
                {error ? (
                  <span className="px-2 font-semibold text-[#f44336]">
                    {t("Ошибка")}: {error}
                  </span>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="mb-[5px] h-6 w-6 fill-[#333]" aria-hidden>
                      <path d={FILE} />
                    </svg>
                    <span className="leading-[16.25px]">{file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
                  </>
                )}
              </label>
            </div>
          </div>
          <footer className="flex justify-end p-[10px]">
            <button type="submit" className="h-9 rounded-[2px] bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95">
              {t("Сохранить")}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
