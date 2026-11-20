"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"

import { MaterialField } from "@/components/analytics/material-field"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

import { MARK_SECTIONS, scanMinute, type ReturnMark, type ReturnMarkType } from "./return-item-marks"

// «Изменение маркировки» of a return line, like Linko's UpdateMarkingForm dialog (900px):
// - «Добавлять сканы в»: the list a scan goes to (Коды маркировки by default), Linko's searchable react-select (see
//   TargetSelect; clearing it sends scans to Коды маркировки again);
// - «Ручное добавление» + blue «+»: adds the typed code to that list and empties the field; a code already in the list
//   is not added twice, its row is scrolled to and flashes yellow;
// - a barcode scanner: every key typed anywhere while the dialog is open is collected; Enter, or 320ms without a key,
//   ends the code, and a code of at least 11 characters is added like a manual one (the field keeps its text);
// - one section per list «<title> (<n>)» with a red «Удалить все» when it has codes and a table №/Код/× («Удалить»),
//   «Список пуст» when empty; «Коды транспортные» only once it has a code;
// - «Завершить сканирование» saves the three lists as the line's codes (PUT …/marks, Linko's add_marks with
//   clear_other; every scan moment cut to "YYYY-MM-DD HH:mm" as Linko does) and closes; a refusal shows the app's
//   error notice and the dialog stays. X closes without saving. A click outside or Escape does not close it (Linko's
//   modal), and the page under it does not scroll.
// - Layout of Linko's Material-UI dialog: one scrolling body (title included, at least 600px, at most the window less
//   128px) centred in the window but never above 80px, the footer pinned over its bottom.

type Draft = { code: string; createdAt: string }
type Lists = Record<ReturnMarkType, Draft[]>

const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
const ADD = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
const CARET = "M7 10l5 5 5-5z"

/** Linko's scanner: codes shorter than this are taken for typing, not a scan. */
const MIN_SCAN_LENGTH = 11
const QUIET_MS = 300

/** The browser's local "YYYY-MM-DD HH:mm" (Linko's moment().format of the scan). */
function nowMinute(): string {
  const date = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * «Добавлять сканы в», as Linko's react-select (v1, searchable, clearable, its options not filtered by the typed text):
 * a click on the field focuses its input and opens the list; typed text replaces the shown value while the list is
 * open; ↑/↓ move through the options (round), Enter / Tab / a click pick one; Escape closes the list, and on a closed
 * list clears the value; Backspace in an empty input clears it; the × («Clear value») clears it, the caret opens and
 * closes the list. Every change of the value, and leaving the field, ends the editing (Linko's field is drawn anew).
 * Like react-select's "pseudo focus": a list closed by Escape or the caret keeps the typed text hidden behind the value
 * (↑/↓ reopen it so, a click or typing shows the text again); and after Escape clears the value, the next click on the
 * field only focuses it (its focus-after-clear).
 */
function TargetSelect({ value, onChange }: { value: ReturnMarkType | ""; onChange: (value: ReturnMarkType | "") => void }) {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [pseudo, setPseudo] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const clearedByEscape = useRef(false)
  const current = MARK_SECTIONS.find((section) => section.type === value)
  const count = MARK_SECTIONS.length

  const openList = () => {
    setActive(Math.max(0, MARK_SECTIONS.findIndex((section) => section.type === value)))
    setOpen(true)
  }
  const closeList = () => {
    setOpen(false)
    setPseudo(true)
  }
  const change = (next: ReturnMarkType | "") => {
    onChange(next)
    setOpen(false)
    setText("")
    input.current?.blur()
  }
  const onControlDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (!focused) {
      const skipOpen = clearedByEscape.current
      input.current?.focus()
      if (!skipOpen && !open) openList()
      return
    }
    setPseudo(false)
    if (!open) openList()
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault()
        if (!open) openList()
        else setActive((index) => (index + (event.key === "ArrowDown" ? 1 : count - 1)) % count)
        return
      case "Enter":
        if (!open) return
        event.preventDefault()
        change(MARK_SECTIONS[active].type)
        return
      case "Tab":
        if (open) change(MARK_SECTIONS[active].type)
        return
      case "Escape":
        if (open) closeList()
        else if (value) {
          change("")
          clearedByEscape.current = true
        }
        return
      case "Backspace":
        if (text || !value) return
        event.preventDefault()
        change("")
        return
    }
  }
  // The value stays on view unless typed text replaces it (a "pseudo focused" field keeps that text unseen).
  const showValue = Boolean(current) && (!text || pseudo)

  return (
    <div className="relative mt-[10px] h-[49px] w-full">
      <span className="pointer-events-none absolute left-0 top-0 text-[10px] font-semibold leading-[12px] text-black">{t("Добавлять сканы в")}</span>
      <div
        onMouseDown={onControlDown}
        className={`absolute inset-x-0 bottom-0 flex h-[36px] items-end border-b pb-[4px] pr-[46px] ${focused ? "cursor-text" : "cursor-default"} ${focused || open ? "border-[#555]" : "border-[#e8e8e8]"}`}
      >
        <div className="relative h-[18px] min-w-0 flex-1">
          {showValue && current ? <span className="pointer-events-none absolute inset-0 truncate text-[13px] font-semibold leading-[18px] text-[#333]">{t(current.title)}</span> : null}
          <input
            ref={input}
            role="combobox"
            aria-label={t("Добавлять сканы в")}
            aria-expanded={open}
            aria-controls="return-marks-target-list"
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setPseudo(false)
              if (!open) openList()
            }}
            onFocus={() => {
              setFocused(true)
              clearedByEscape.current = false
            }}
            onBlur={() => {
              setFocused(false)
              setOpen(false)
              setText("")
              setPseudo(false)
            }}
            onKeyDown={onKeyDown}
            className={`absolute inset-0 w-full bg-transparent p-0 text-[13px] font-semibold leading-[18px] outline-none ${current && pseudo && text ? "text-transparent" : "text-[#333]"}`}
          />
        </div>
      </div>
      {current && (
        <span
          role="button"
          aria-label="Clear value"
          title="Clear value"
          data-native-tip
          onMouseDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            change("")
          }}
          className="absolute bottom-[3px] right-[24px] flex h-5 w-5 cursor-pointer items-center justify-center text-[17px] leading-none text-[#999] hover:text-[#d0021b]"
        >
          ×
        </span>
      )}
      <span
        aria-hidden
        onMouseDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          // A closed list: react-select hands the click to the field itself.
          if (open) closeList()
          else onControlDown(event)
        }}
        className="absolute bottom-[1px] right-[3px] h-6 w-6 cursor-pointer"
      >
        <svg viewBox="0 0 24 24" className={`h-6 w-6 fill-[#999] transition-transform ${open ? "rotate-180" : ""}`}>
          <path d={CARET} />
        </svg>
      </span>
      {open && (
        <div id="return-marks-target-list" role="listbox" className="absolute inset-x-0 top-full z-[60] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {MARK_SECTIONS.map((section, index) => (
            <div
              key={section.type}
              role="option"
              aria-selected={section.type === value}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                change(section.type)
              }}
              className={`flex h-8 cursor-pointer items-center truncate px-[10px] text-[13px] font-semibold ${index === active ? "bg-[#e6f0ff] text-[#333]" : "bg-white text-[#666]"}`}
            >
              {t(section.title)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReturnItemMarksDialog({
  returnId,
  itemId,
  marks,
  onClose,
  onSaved,
}: {
  returnId: number
  itemId: number
  marks: ReturnMark[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [lists, setLists] = useState<Lists>(() => {
    const of = (type: ReturnMarkType) => marks.filter((mark) => mark.type === type).map((mark) => ({ code: mark.code, createdAt: mark.createdAt }))
    return { consumer: of("consumer"), group: of("group"), transport: of("transport") }
  })
  const [target, setTarget] = useState<ReturnMarkType | "">("consumer")
  const [manual, setManual] = useState("")
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null)
  const rows = useRef(new Map<string, HTMLTableRowElement>())

  // The latest lists / target for the scanner listener and the add helpers (no stale closures between renders).
  const state = useRef({ lists, target })
  useEffect(() => {
    state.current = { lists, target }
  }, [lists, target])

  /** Adds `code` to the chosen list, or flashes its row when the list has it; false when it was already there. */
  const addCode = useRef((code: string): boolean => {
    const type = state.current.target || "consumer"
    const list = state.current.lists[type]
    const key = `${type}\u0000${code}`
    if (!list.some((item) => item.code === code)) {
      const next = { ...state.current.lists, [type]: [...list, { code, createdAt: nowMinute() }] }
      state.current = { ...state.current, lists: next }
      setLists(next)
      setFlash((current) => ({ key, n: (current?.n ?? 0) + 1 }))
      return true
    }
    setFlash((current) => ({ key, n: (current?.n ?? 0) + 1 }))
    return false
  })

  // The scanned / added row comes into view and flashes (Linko's flashOnce: #fff8c5 fading out in 1.2s).
  useEffect(() => {
    if (!flash) return
    const row = rows.current.get(flash.key)
    if (!row) return
    row.scrollIntoView?.({ behavior: "smooth", block: "center" })
    row.animate?.([{ background: "#fff8c5" }, { background: "transparent" }], { duration: 1200, easing: "ease" })
  }, [flash])

  // Linko's barcode scanner listener (keydown on the window, capture phase).
  useEffect(() => {
    let buffer = ""
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      const code = buffer.trim()
      buffer = ""
      if (code.length >= MIN_SCAN_LENGTH) addCode.current(code)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape never closes this modal, nor a card dialog under it (ClientReturnDialog skips a prevented Escape).
      if (event.key === "Escape") event.preventDefault()
      if (event.key === "Enter") {
        if (timer) clearTimeout(timer)
        flush()
        return
      }
      if (event.key.length === 1) buffer += event.key
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, QUIET_MS + 20)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Linko's modal locks the page under it: the wheel never scrolls it.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const addManual = () => {
    const code = manual.trim()
    if (!code) return
    if (addCode.current(code)) setManual("")
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = {
        marks: MARK_SECTIONS.flatMap((section) =>
          lists[section.type].map((item) => ({ type: section.type, code: item.code, createdAt: scanMinute(item.createdAt) || undefined })),
        ),
      }
      const response = await fetch(`/api/client-returns/${returnId}/items/${itemId}/marks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as { error?: string }
        // Linko's openErrorAction: the app's error notice over the dialog, which stays open.
        notify(answer.error || "Не удалось сохранить")
        return
      }
      onSaved()
    } catch {
      notify("Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  const section = (type: ReturnMarkType, title: string) => {
    const list = lists[type]
    const update = (next: Draft[]) => setLists((current) => ({ ...current, [type]: next }))
    return (
      <div key={type} className="flex flex-none flex-col">
        <div className="flex items-center justify-between border-b border-[#efefef] px-[20px] py-[12px]">
          <div>
            <strong className="font-semibold">{t(title)}</strong> ({list.length})
          </div>
          {list.length > 0 && (
            <button type="button" onClick={() => update([])} className="cursor-pointer font-semibold text-[#d9534f]">
              {t("Удалить все")}
            </button>
          )}
        </div>
        <div className="px-[20px] pb-[20px]">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className="w-[60px] border-b border-[#efefef] px-[8px] py-[10px] text-left font-semibold">№</th>
                <th className="border-b border-[#efefef] px-[8px] py-[10px] text-left font-semibold">{t("Код")}</th>
                <th className="w-[56px] border-b border-[#efefef] px-[8px] py-[10px]" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={3} className="border-b border-[#f2f2f2] p-[16px] text-[#777]">
                    {t("Список пуст")}
                  </td>
                </tr>
              ) : (
                list.map((item, index) => {
                  const key = `${type}\u0000${item.code}`
                  return (
                    <tr
                      key={`${item.code}-${index}`}
                      ref={(element) => {
                        if (element) rows.current.set(key, element)
                        else rows.current.delete(key)
                      }}
                    >
                      <td className="w-[60px] border-b border-[#f2f2f2] px-[8px] py-0">{index + 1}</td>
                      <td className="border-b border-[#f2f2f2] px-[8px] py-0">
                        <span className="break-all font-[monospace]" data-no-translate>
                          {item.code}
                        </span>
                      </td>
                      <td className="w-[56px] border-b border-[#f2f2f2] px-[8px] py-0 text-right">
                        {/* The only hinted control of the dialog (Linko's «Удалить» bubble). */}
                        <button
                          type="button"
                          title={t("Удалить")}
                          aria-label={t("Удалить")}
                          onClick={() => update(list.filter((_, at) => at !== index))}
                          className="ml-auto flex h-12 w-12 cursor-pointer items-center justify-center"
                        >
                          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                            <path d={CLOSE} />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[1501] flex flex-col items-center overflow-clip bg-black/[0.54] py-[80px] font-sans text-[13px] leading-[1.25] text-[#333]" role="dialog" aria-modal="true" aria-label={t("Изменение маркировки")}>
      <div className="relative my-auto w-[900px] max-w-[calc(100vw-32px)] shrink-0 rounded-[2px] bg-white shadow-[0_14px_45px_rgba(0,0,0,0.25),0_10px_18px_rgba(0,0,0,0.22)]">
        <div className="max-h-[calc(100vh-128px)] min-h-[600px] overflow-y-auto overscroll-contain">
          <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
            <span className="text-[13px] font-bold uppercase">{t("Изменение маркировки")}</span>
            <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="flex h-12 w-12 cursor-pointer items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666666]" aria-hidden>
                <path d={CLOSE} />
              </svg>
            </button>
          </div>
          <div className="flex flex-col items-center gap-[8px] px-[20px] text-[#666]">
            <TargetSelect value={target} onChange={setTarget} />
            <div className="flex w-full">
              <MaterialField label={t("Ручное добавление")} name="manualAddition" value={manual} onChange={setManual} className="min-w-0 flex-1" />
              <button type="button" aria-label={t("Добавить")} onClick={addManual} className="flex h-12 w-12 flex-none cursor-pointer items-center justify-center rounded-full hover:bg-black/[0.04]">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[rgb(79,113,220)]" aria-hidden>
                  <path d={ADD} />
                </svg>
              </button>
            </div>
          </div>
          {/* 64px below the lists keep the last row clear of the pinned footer. */}
          <div className="flex flex-col pb-[64px]">
            {MARK_SECTIONS.filter((item) => item.type !== "transport" || lists.transport.length > 0).map((item) => section(item.type, item.title))}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex h-[57px] items-center justify-end border-t border-[#efefef] bg-white px-[16px]">
          {saving ? (
            <Loader2 className="mr-[16px] h-6 w-6 animate-spin text-[#1E4A9A]" aria-hidden />
          ) : (
            <button type="button" onClick={() => void save()} className="h-9 min-w-[88px] cursor-pointer rounded-[2px] px-[16px] text-[13px] font-semibold uppercase text-[rgb(79,113,220)] hover:bg-black/[0.04]">
              {t("Завершить сканирование")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
