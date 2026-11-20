"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { MaterialDialog, MaterialFooter } from "@/components/analytics/cash-material"
import { useLanguage } from "@/lib/i18n/language-context"

// Linko's InventoryVerifyForm (module 4762), used by the inventory card for «Подтверждения инвентаризации» (Подтвердить)
// and, with the title «Удаление», for 🗑: a 500px dialog, one «Комментарий...» field (a multi-line text field of one
// row that grows to three) and the «Подтвердить» action, which sends the comment.

/** The «Комментарий...» field: the bold label sits on the line and floats up on focus or once there is text. */
function CommentField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [focused, setFocused] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const floated = focused || value !== ""
  useLayoutEffect(() => {
    const node = area.current
    if (!node) return
    node.style.height = "auto"
    // rows 1, rowsMax 3 (20px rows): it grows up to three rows, then scrolls.
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 20), 60)}px`
  }, [value])
  return (
    <div className="group relative pt-[28px]">
      <span
        className={`pointer-events-none absolute left-0 z-[1] whitespace-nowrap font-semibold text-black transition-all duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${floated ? "top-[6px] text-[10px] leading-[14px]" : "top-[28px] text-[13px] leading-[20px]"}`}
      >
        {label}
      </span>
      <textarea
        ref={area}
        rows={1}
        value={value}
        maxLength={2000}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="relative block h-[20px] w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-[20px] text-[#333] outline-none"
      />
      <span className="relative mt-[4px] block h-px bg-[#e0e0e0]">
        <span className="absolute inset-x-0 -top-px h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-[scale] duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-focus-within:scale-x-100" />
      </span>
    </div>
  )
}

export function InventoryCommentDialog({
  title,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  busy?: boolean
  error?: string
  onSubmit: (comment: string) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [comment, setComment] = useState("")
  return (
    <MaterialDialog
      title={title}
      width={500}
      zIndex={1400}
      closeInset={15}
      modal
      onClose={onClose}
      onSubmit={() => {
        if (!busy) onSubmit(comment)
      }}
      footer={<MaterialFooter label={t("Подтвердить")} busy={busy} error={error} />}
    >
      <div className="min-h-[100px] px-[30px] pb-[48px] pt-[41px]">
        <CommentField label={`${t("Комментарий")}...`} value={comment} onChange={setComment} />
      </div>
    </MaterialDialog>
  )
}
