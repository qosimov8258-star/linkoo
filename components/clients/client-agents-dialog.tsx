"use client"

import { useEffect, useRef, useState } from "react"

import { ChipSelect } from "@/components/ref/chip-select"
import { LINE_INPUT, LineField, LineSelect } from "@/components/ref/line-fields"
import { useLanguage } from "@/lib/i18n/language-context"

// Linko's «ИЗМЕНЕНИЕ АГЕНТОВ» (the pencil of the card's «Агенты магазина»): a grey row to pick an agent, its price lists
// and a comment (+ adds it on top; an agent already listed is replaced), the list with ✎ (edit the price lists and
// the comment in place) and 🗑, and «Сохранить», which saves the whole list (PUT /api/clients/[id]/agents).

export type ClientAgentRow = { employeeId: number; name: string; description: string; priceLists: Array<{ id: number; name: string }> }
type Options = { agents: Array<{ id: number; name: string }>; priceLists: Array<{ id: number; name: string }> }

const ADD = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
const EDIT = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const DELETE = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

function Icon({ path, label, onClick, color = "#666" }: { path: string; label: string; onClick: () => void; color?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" aria-hidden className="h-[22px] w-[22px]" style={{ fill: color }}>
        <path d={path} />
      </svg>
    </button>
  )
}

export function ClientAgentsDialog({ clientId, agents, onClose, onSaved }: { clientId: number; agents: ClientAgentRow[]; onClose: () => void; onSaved: (agents: ClientAgentRow[]) => void }) {
  const { t } = useLanguage()
  const [options, setOptions] = useState<Options>({ agents: [], priceLists: [] })
  const [rows, setRows] = useState<ClientAgentRow[]>(agents)
  const [draft, setDraft] = useState({ employeeId: "", priceListIds: [] as number[], description: "" })
  const [editing, setEditing] = useState<{ index: number; priceListIds: number[]; description: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // Focus moves into the dialog, so its keys (Escape) start inside it and do not reach the card behind.
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => dialogRef.current?.focus(), [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/clients/${clientId}/agents?options=1`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Options>) : null))
      .then((body) => {
        if (!cancelled && body) setOptions(body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [clientId])

  const listsOf = (ids: number[]) => ids.map((id) => options.priceLists.find((list) => list.id === id)).filter((list): list is { id: number; name: string } => Boolean(list))

  // «+»: the agent goes on top with its price lists and comment; a row of the same agent is replaced (Linko's handleAdd).
  const add = () => {
    const employeeId = Number(draft.employeeId)
    const agent = options.agents.find((item) => item.id === employeeId)
    if (!agent) return
    setRows((current) => [{ employeeId, name: agent.name, description: draft.description.trim(), priceLists: listsOf(draft.priceListIds) }, ...current.filter((row) => row.employeeId !== employeeId)])
    setDraft({ employeeId: "", priceListIds: [], description: "" })
    setEditing(null)
  }

  // ✓ of a row in edit: Linko keeps the old price lists when none is chosen and the old comment when it is emptied.
  const applyEdit = () => {
    if (!editing) return
    setRows((current) =>
      current.map((row, index) =>
        index === editing.index
          ? { ...row, priceLists: editing.priceListIds.length ? listsOf(editing.priceListIds) : row.priceLists, description: editing.description.trim() || row.description }
          : row,
      ),
    )
    setEditing(null)
  }

  async function save() {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/clients/${clientId}/agents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: rows.map((row) => ({ employeeId: row.employeeId, description: row.description, priceListIds: row.priceLists.map((list) => list.id) })) }),
      })
      const body = (await response.json().catch(() => null)) as (ClientAgentRow[] & { error?: string }) | { error?: string } | null
      if (!response.ok || !Array.isArray(body)) throw new Error((body as { error?: string } | null)?.error || "Не удалось сохранить")
      onSaved(body)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const agentOptions = options.agents.map((agent) => ({ value: String(agent.id), label: agent.name }))
  const cols = "grid grid-cols-[33.333%_33.333%_25%_8.333%] items-center"

  return (
    // Linko's dialog is modal: only × closes it (neither a click outside nor Escape, which must not reach the card either).
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/[0.54] px-4 py-10"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.nativeEvent.stopImmediatePropagation()
      }}
    >
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("Изменение агентов")} className="w-full max-w-[1000px] bg-white text-[13px] text-[#333] shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)] outline-none">
        <header className="relative flex items-center border-b border-[#efefef] px-[30px] py-[20px] font-bold uppercase">
          <span>{t("Изменение агентов")}</span>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[13px] flex h-[30px] w-[30px] items-center justify-center">
            <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5 fill-[#666]">
              <path d={CLOSE} />
            </svg>
          </button>
        </header>

        <div className="min-h-[400px] px-[30px] pb-[20px]">
          <div className={`${cols} -mx-[30px] gap-x-[16px] bg-[#f1f5f8] px-[30px] py-[20px]`}>
            <LineSelect label={t("Агент")} value={draft.employeeId} onChange={(employeeId) => setDraft((current) => ({ ...current, employeeId }))} options={agentOptions} />
            <ChipSelect label={t("Прайс лист")} options={options.priceLists} value={draft.priceListIds} onChange={(priceListIds) => setDraft((current) => ({ ...current, priceListIds }))} />
            <LineField label={t("Комментарий")} filled={Boolean(draft.description)}>
              <input value={draft.description} aria-label={t("Комментарий")} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className={LINE_INPUT} />
            </LineField>
            <div className="flex justify-center pt-[15px]">
              <Icon path={ADD} label={t("Добавить")} onClick={add} color="#1E4A9A" />
            </div>
          </div>

          <div className={`${cols} mt-[20px] border-b border-dotted border-[#ccc] py-[12px] font-semibold`}>
            <span>{t("Агент")}</span>
            <span>{t("Прайс лист")}</span>
            <span>{t("Комментарий")}</span>
          </div>
          {rows.map((row, index) =>
            editing?.index === index ? (
              <div key={row.employeeId} className={`${cols} gap-x-[16px] border-b border-dotted border-[#ccc] p-[5px]`}>
                <span className="py-[20px]">{row.name}</span>
                <ChipSelect label={t("Прайс лист")} options={options.priceLists} value={editing.priceListIds} onChange={(priceListIds) => setEditing({ ...editing, priceListIds })} />
                <LineField label={t("Комментарий")} filled={Boolean(editing.description)}>
                  <input value={editing.description} aria-label={t("Комментарий")} onChange={(event) => setEditing({ ...editing, description: event.target.value })} className={LINE_INPUT} />
                </LineField>
                <div className="flex justify-center">
                  <Icon path={ADD} label={t("Сохранить")} onClick={applyEdit} />
                </div>
              </div>
            ) : (
              <div key={row.employeeId} className={`${cols} border-b border-dotted border-[#ccc] p-[5px]`}>
                <span>{row.name}</span>
                <span className="flex min-h-[50px] flex-wrap items-center">
                  {row.priceLists.length
                    ? row.priceLists.map((list) => (
                        <span key={list.id} className="my-[5px] mr-[10px] inline-flex h-[28px] items-center rounded-[2px] bg-[#e9ecef] px-[10px] leading-none">
                          {list.name}
                        </span>
                      ))
                    : "-"}
                </span>
                <span>{row.description || "-"}</span>
                <span className="flex items-center justify-end pr-[10px]">
                  <Icon path={EDIT} label={t("Изменить")} onClick={() => setEditing({ index, priceListIds: row.priceLists.map((list) => list.id), description: row.description })} />
                  <Icon path={DELETE} label={t("Удалить")} onClick={() => { setRows((current) => current.filter((_, i) => i !== index)); setEditing(null) }} />
                </span>
              </div>
            ),
          )}
          {error && <p className="mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[#f44336]">{t(error)}</p>}
        </div>

        <footer className="border-t border-[#efefef] p-[10px] text-right">
          <button type="button" disabled={busy} onClick={() => void save()} className="h-[36px] rounded-[2px] px-[16px] text-[13px] font-semibold uppercase text-[#1E4A9A] hover:bg-[#f2f5f8] disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </footer>
      </section>
    </div>
  )
}
