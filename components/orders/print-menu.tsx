"use client"

import { useEffect, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
}

/** Linko's «Распечатать» menu (shared by its order and return cards and lists): a popover under the button with
 * «Кол - во повторений» (Linko's ORDER_PRINT_REPLY_DEFAULT, 1) and the print templates of `keyName` (Справочники →
 * Шаблоны документов, the active ones: «order» for orders, «order_return» for returns). `children` adds boxes to the
 * right of it (the lists' «Для зав.склада»); `className` places it under its button. */
export function PrintMenu({
  onClose,
  onPick,
  keyName = "order",
  className = "right-[-9px] top-[30px]",
  children,
}: {
  onClose: () => void
  onPick: (copies: number, templateId: number) => void
  keyName?: string
  className?: string
  children?: ReactNode
}) {
  const { t } = useLanguage()
  const [copies, setCopies] = useState("1")
  const [templates, setTemplates] = useState<{ id: number; name: string }[] | null>(null)
  useEscape(onClose)
  useEffect(() => {
    fetch("/api/doc-templates?pageSize=500")
      .then(async (response) => (response.ok ? ((await response.json()) as { results: { id: number; name: string; keyName: string; isActive: boolean }[] }) : { results: [] }))
      .then((data) => setTemplates(data.results.filter((row) => row.keyName === keyName && row.isActive)))
      .catch(() => setTemplates([]))
  }, [keyName])
  return (
    <>
      <button type="button" data-order-overlay aria-label={t("Закрыть")} onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      {/* Material's menu: the boxes centred in a width of 224 px (358 px with a second box), 4 px above and below. */}
      <div
        className={`absolute ${className} z-[115] max-h-[70vh] ${children ? "w-[358px]" : "min-w-[224px] max-w-[358px]"} overflow-y-auto rounded-[8px] bg-white py-[4px] font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]`}
      >
        <div className="flex justify-center">
          <div className={`px-[10px] ${children ? "border-r border-[#efefef]" : ""}`}>
            <div className="mb-[10px] w-[150px]">
              <span className="mb-[8px] block whitespace-nowrap text-[13px] font-semibold leading-4">{t("Кол - во повторений")}</span>
              <input
                id="controlInput"
                value={copies}
                onChange={(event) => setCopies(event.target.value.replace(/\D/g, ""))}
                className="h-[26px] w-full border-b border-[#e0e0e0] bg-transparent py-[5px] pr-[5px] text-[13px] text-black outline-none"
              />
            </div>
            {(templates ?? []).map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onPick(Math.max(1, Number(copies) || 1), template.id)}
                className="block h-12 min-w-[150px] max-w-[338px] cursor-pointer overflow-hidden whitespace-nowrap px-4 text-left leading-[48px] hover:bg-[rgba(51,51,51,0.1)]"
              >
                {template.name}
              </button>
            ))}
          </div>
          {children}
        </div>
      </div>
    </>
  )
}
