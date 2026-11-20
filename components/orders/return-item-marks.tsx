"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"

import { ReturnItemMarksDialog } from "./return-item-marks-dialog"

// Marking codes of a return line in the card's «Список товаров», like Linko's: a green rounded «+» after the line
// number opens a row under the line (GET /api/client-returns/<id>/items/<line>/marks, Linko's get_marks) and turns
// into a dark «−» that closes it. The row is a card with «Коды маркировки» / «Коды агрегации» (and «Коды
// транспортные» only when the line has some): chips «1. <code>» with the scan moment, or «Нет … кодов»; its pencil
// opens «Изменение маркировки» (./return-item-marks-dialog.tsx).

export type ReturnMarkType = "consumer" | "group" | "transport"
export type ReturnMark = { id?: number; type: ReturnMarkType; code: string; createdAt: string }

export const MARK_SECTIONS: ReadonlyArray<{ type: ReturnMarkType; title: string; empty: string }> = [
  { type: "consumer", title: "Коды маркировки", empty: "Нет кодов маркировки" },
  { type: "group", title: "Коды агрегации", empty: "Нет кодов агрегации" },
  { type: "transport", title: "Коды транспортные", empty: "Нет транспортных кодов" },
]

const PENCIL = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"

// Linko's date helper prints the scan moment as "DD MMM YYYY, HH:mm" with moment's Russian short months in Russian and
// Uzbek (and here in Turkmen, which Linko does not have), and with English ones in English.
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const SHORT_MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (n: number) => String(n).padStart(2, "0")
/** A local wall time without an offset: "2026-11-19 10:30", "2026-07-17T08:24:09.654729". */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/

/** "19 нояб. 2026, 10:30" ("19 Nov 2026, 10:30" in English) from a stored scan moment: a local wall time as it is, a
 * moment with an offset or "Z" in the viewer's time (moment's parsing). */
export function markMoment(value: string, language?: LanguageCode): string {
  if (!value) return ""
  const months = language === "en" ? SHORT_MONTHS_EN : SHORT_MONTHS
  const wall = WALL_TIME.exec(value.trim())
  if (wall) return `${wall[3]} ${months[Number(wall[2]) - 1] ?? ""} ${wall[1]}, ${wall[4]}:${wall[5]}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A scan moment as Linko's «Завершить сканирование» sends it again: moment(createdDate).format("YYYY-MM-DD HH:mm"), so
 * the seconds of a code copied from Linko are dropped and a moment with an offset becomes the viewer's wall time. */
export function scanMinute(value: string): string {
  const text = value.trim()
  const wall = WALL_TIME.exec(text)
  if (wall) return `${wall[1]}-${wall[2]}-${wall[3]} ${wall[4]}:${wall[5]}`
  const date = new Date(text)
  if (!text || Number.isNaN(date.getTime())) return text
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// The open lines of the card on screen. Linko keeps them while its card stays open (after «Логи» → «Список товаров»
// they are still open) and drops them when the card closes or shows another return; the items tab unmounts on a tab
// switch, so the card (returns-view.tsx Detail) holds this scope with useReturnItemMarksScope.
const openLines: { returnId: number; open: number[] } = { returnId: 0, open: [] }

/** Mounted by the return card: its open lines live as long as the card shows return `returnId`. */
export function useReturnItemMarksScope(returnId: number) {
  useEffect(() => {
    if (openLines.returnId !== returnId) {
      openLines.returnId = returnId
      openLines.open = []
    }
    return () => {
      openLines.returnId = 0
      openLines.open = []
    }
  }, [returnId])
}

/** Which lines of the card `returnId` show their codes (none after switching to another return). */
export function useReturnItemMarksOpen(returnId: number) {
  const [state, setState] = useState<{ returnId: number; open: number[] }>(() => ({ returnId, open: openLines.returnId === returnId ? openLines.open : [] }))
  const open = state.returnId === returnId ? state.open : []
  return {
    isOpen: (itemId: number) => open.includes(itemId),
    toggle: (itemId: number) => {
      const next = open.includes(itemId) ? open.filter((id) => id !== itemId) : [...open, itemId]
      openLines.returnId = returnId
      openLines.open = next
      setState({ returnId, open: next })
    },
  }
}

/** Linko's 20px icon in a 10px padded box after the line number: green «+» (closed) / dark «−» (open). */
export function ReturnItemMarksToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <span className="p-[10px]">
      <button type="button" aria-expanded={open} aria-label={t("Коды маркировки")} onClick={onToggle} className="block h-5 w-5 cursor-pointer">
        {open ? (
          <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z"
              stroke="#1C274C"
            />
            <path d="M15 12H9" stroke="#1C274C" />
          </svg>
        ) : (
          <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="#2ec23f" aria-hidden>
            <path d="M12 7.75732L12 16.2426" stroke="#2ec23f" strokeWidth="2" strokeLinecap="round" />
            <path d="M7.75735 12L16.2426 12" stroke="#2ec23f" strokeWidth="2" strokeLinecap="round" />
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="#2ec23f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </span>
  )
}

async function readMarks(returnId: number, itemId: number): Promise<ReturnMark[]> {
  try {
    const response = await fetch(`/api/client-returns/${returnId}/items/${itemId}/marks`)
    if (!response.ok) return []
    const body = (await response.json()) as { marks?: ReturnMark[] }
    return Array.isArray(body.marks) ? body.marks : []
  } catch {
    return []
  }
}

/**
 * The row under an open line: a grid cell spanning the whole line grid (return-items-tab.tsx rows: padding 10px 0, the
 * dotted line drawn at their bottom). Like Linko's separate row: the line keeps its own height with its dotted line at
 * the bottom (this cell's top rule, 9px under the line's cells), then 6px, the card and 10px; the negative bottom
 * margin takes back the line's bottom padding, so the line's own dotted line closes this row.
 */
export function ReturnItemMarksPanel({ returnId, itemId }: { returnId: number; itemId: number }) {
  const { t, language } = useLanguage()
  const [marks, setMarks] = useState<ReturnMark[] | null>(null)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let alive = true
    void readMarks(returnId, itemId).then((rows) => alive && setMarks(rows))
    return () => {
      alive = false
    }
  }, [returnId, itemId, version])

  const byType = (type: ReturnMarkType) => (marks ?? []).filter((mark) => mark.type === type)
  const sections = MARK_SECTIONS.filter((section) => section.type !== "transport" || byType("transport").length > 0)

  return (
    <div className="col-span-full -mb-[10px] mt-[9px] border-t border-dotted border-[#c7ced4] pb-[10px] pt-[6px]">
      <div className="w-full rounded-[8px] border border-[#eee] bg-white leading-[1.25]">
        {marks === null ? (
          <div className="flex h-max justify-center p-[10px]">
            <Loader2 className="h-6 w-6 animate-spin text-[#1E4A9A]" aria-hidden />
          </div>
        ) : (
          <div className="grid items-start" style={{ gridTemplateColumns: sections.length > 2 ? "1fr 1fr 1fr auto" : "1fr 1fr auto" }}>
            {sections.map((section) => {
              const items = byType(section.type)
              return (
                <div key={section.type} className="h-full min-w-0 border-r border-[#eee] px-[16px] py-[8px]">
                  <h4 className="mb-[8px] text-[13px] font-semibold text-[#333]">{t(section.title)}</h4>
                  {items.length === 0 ? (
                    <div className="text-[12px] text-[#888]">{t(section.empty)}</div>
                  ) : (
                    <div className="flex flex-col gap-[6px]">
                      {items.map((mark, index) => (
                        <span key={mark.id ?? `${mark.code}-${index}`} className="flex items-center justify-between rounded-[4px] bg-[#f5f6fa] px-[6px] py-[4px] text-[12px]">
                          {/* Codes and the formatted scan moment are shown as they are (no dictionary pass: Linko keeps
                              Russian months in Uzbek). */}
                          <span className="min-w-0 break-all" data-no-translate>
                            {index + 1}. {mark.code}
                          </span>
                          <span className="flex items-center">
                            <span className="mr-[10px] whitespace-nowrap text-[10px]" data-no-translate>
                              {markMoment(mark.createdAt, language)}
                            </span>
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="flex h-full items-center justify-center px-[16px] py-[8px]">
              {/* Linko's pencil: a plain 48px icon button without a hint. */}
              <button type="button" aria-label={t("Изменение маркировки")} onClick={() => setEditing(true)} className="flex h-12 w-12 cursor-pointer items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                  <path d={PENCIL} />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
      {editing && marks !== null && (
        <ReturnItemMarksDialog
          returnId={returnId}
          itemId={itemId}
          marks={marks}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            // Linko reads the line's codes again after a save.
            setMarks(null)
            setVersion((value) => value + 1)
          }}
        />
      )}
    </div>
  )
}
