"use client"

import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export type ClientLookup = { id: number; name: string; code: string; zone: string; phone: string; address: string }

/** Underlined select over GET /api/clients/lookup (newest first, 50 per search) like the demo's client selects. */
export function ClientPicker({
  label,
  value,
  optionText,
  onPick,
  onClear,
  excluded = [],
}: {
  label: string
  /** Text of the picked client (shown in the field). */
  value?: string
  optionText: (client: ClientLookup) => string
  onPick: (client: ClientLookup) => void
  onClear?: () => void
  excluded?: number[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [options, setOptions] = useState<ClientLookup[]>([])
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      fetch(`/api/clients/lookup?search=${encodeURIComponent(search.trim())}`, { signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<ClientLookup[]>) : []))
        .then((rows) => setOptions(rows))
        .catch(() => undefined)
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, search ? 300 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, search])

  const visible = options.filter((option) => !excluded.includes(option.id))
  const floating = Boolean(value)

  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => setOpen(true)} className="relative h-[40px] cursor-pointer border-b border-[#d5dae1]">
        <span className={`pointer-events-none absolute left-0 ${floating ? "top-[-8px] text-[10px] font-semibold leading-3" : "top-[17px] text-[13px] font-bold leading-4"}`}>{label}</span>
        {open ? (
          <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent pr-12 text-[13px] outline-none" />
        ) : (
          value && <span className="absolute inset-x-0 bottom-[3px] truncate pr-12 text-[13px]">{value}</span>
        )}
        {/* like the reference: a plain × then the Material "arrow_drop_down" triangle */}
        <span className="absolute bottom-[-1px] right-[3px] flex items-center text-slate-500">
          {value && onClear && <span role="button" aria-label="clear" className="mr-0" onClick={(event) => { event.stopPropagation(); onClear() }}><X className="h-3.5 w-3.5" /></span>}
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
        </span>
      </div>
      {open && (
        <ul className="absolute left-0 right-0 z-30 mt-0.5 max-h-[200px] overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {visible.length === 0 ? (
            <li className="px-3 py-2 font-semibold text-slate-400">{loading ? "…" : "—"}</li>
          ) : (
            visible.map((option, index) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => { onPick(option); setOpen(false); setSearch("") }}
                  className={`block w-full px-[10px] py-[7px] text-left text-[13px] font-semibold ${index === 0 ? "bg-[#e3effd] text-slate-700" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {optionText(option)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
