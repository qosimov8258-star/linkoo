"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { RefTip } from "@/components/ref/ref-tip"
import { sortPlans, type PlanItem, type PlanTask } from "./agent-day"

// The body of the agent card of the tracking map: the day's clients on a vertical timeline (the reference's plan list).

const MONTH_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
const pad = (n: number) => String(n).padStart(2, "0")
const hhmm = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : "")
const hhmmss = (iso: string | null | undefined) => (iso ? iso.slice(11, 19) : "")

export const CARD_SHADOW = "0 1px 6px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.12)"

const P = {
  done: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  undone: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
  pending: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z",
  box: "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  boxOn: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  selectAll:
    "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  selectAllOn: "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
}

function Svg({ d, size = 24, fill, className, style }: { d: string; size?: number; fill: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={{ fill, display: "block", ...style }} aria-hidden>
      <path d={d} />
    </svg>
  )
}

/** The checkbox of the reference's lists (a 24px glyph in a 30px cell). */
export function PlanCheck({ checked, onChange, color, checkedColor = color, glyph = "box" }: { checked: boolean; onChange: () => void; color: string; checkedColor?: string; glyph?: "box" | "all" }) {
  return (
    <div className="relative block h-[24px] w-[30px] cursor-pointer" onClick={onChange} role="checkbox" aria-checked={checked}>
      <div className="relative mr-[16px] h-[24px] w-[24px]">
        <Svg d={glyph === "all" ? (checked ? P.selectAllOn : P.selectAll) : checked ? P.boxOn : P.box} fill={checked ? checkedColor : color} className="absolute left-0 top-0" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Calendar of the day chip (react-date-range look).
// ---------------------------------------------------------------------------------------------------------------------------------

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

export function DayCalendar({ value, onPick, onClose, top, left }: { value: string; onPick: (iso: string) => void; onClose: () => void; top: number; left: number }) {
  const [view, setView] = useState(() => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 }))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener("mousedown", down)
    return () => document.removeEventListener("mousedown", down)
  }, [onClose])
  const first = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, index) => new Date(view.year, view.month, 1 - first + index))
  const shift = (delta: number) => setView((current) => {
    const next = new Date(current.year, current.month + delta, 1)
    return { year: next.getFullYear(), month: next.getMonth() }
  })
  const arrow = "mx-[10px] flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-white"
  return (
    <div ref={ref} className="fixed z-[1400] rounded-[8px] bg-white" style={{ top, left, width: 270, boxShadow: CARD_SHADOW }}>
      <div className="inline-block w-[270px] rounded-[2px] bg-white p-[10px]">
        <div className="flex h-[42px] items-center justify-between bg-[#5d6474] p-[12px] text-[12px] leading-[18px] text-white">
          <button type="button" className={arrow} onClick={() => shift(-1)}>
            <i className="ml-px block h-0 w-0 border-y-[4px] border-r-[6px] border-y-transparent border-r-[#5d6474]" />
          </button>
          <span>
            {MONTH_NOM[view.month]} - {view.year}
          </span>
          <button type="button" className={arrow} onClick={() => shift(1)}>
            <i className="ml-[2px] block h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-[#5d6474]" />
          </button>
        </div>
        <div className="flex h-[18.8px] w-[250px]">
          {WEEKDAYS.map((name) => (
            <span key={name} className="mb-px inline-block h-[17.84px] w-[35.7px] bg-white text-center text-[12px] font-semibold leading-[17.86px] text-[#5d6474]">
              {name}
            </span>
          ))}
        </div>
        <div className="grid w-[250px] grid-cols-7 [grid-auto-rows:35.7px]">
          {cells.map((cell) => {
            const iso = `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`
            const passive = cell.getMonth() !== view.month
            const selected = iso === value
            return (
              <span
                key={iso}
                onClick={() => onPick(iso)}
                className={`inline-block cursor-pointer text-center text-[12px] leading-[35.7px] ${selected ? "bg-[#5d6474] text-white" : "text-black hover:bg-[#f0f0f0]"} ${passive ? "opacity-40" : ""}`}
              >
                {cell.getDate()}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The tasks of a client.
// ---------------------------------------------------------------------------------------------------------------------------------

function TaskRow({ task }: { task: PlanTask }) {
  const { t } = useLanguage()
  const service = task.type === "service_time"
  const mobile = task.created_mobile_time
  const images = (task.type === "rejection" ? [task.rejection_image] : task.type === "march_report" ? (task.merch_images ?? []) : task.type === "custom" ? [task.image_url] : []).filter((src): src is string => Boolean(src))
  const color = task.status === "done" ? (task.type !== "no_plan_visit" ? "#92ce95" : "#e57373") : task.status === "undone" ? "rgb(229, 115, 115)" : task.status === "pending" ? "#DDE007" : null
  const extra = () => {
    switch (task.type) {
      case "quiz_answer":
      case "order":
      case "march_report":
        return <span>(<a className="cursor-pointer text-[#129fdd]">{t("Просмотреть")}</a>)</span>
      default:
        return null
    }
  }
  return (
    <li>
      <div className="flex flex-row-reverse items-center justify-end text-[13px] font-semibold leading-[20px]" style={{ margin: mobile ? 5 : 0 }}>
        {service ? (
          <div className="flex w-full items-center justify-between">
            <span>
              {t("Начало")} {hhmmss(task.service_time?.start_time)} - {t("Конец")} {hhmmss(task.service_time?.end_time)}
            </span>
            <span className="rounded-[10px] bg-[#ff5e5e] px-[10px] py-[2px] text-white">{task.service_time?.difference_time}</span>
          </div>
        ) : (
          <div>
            {task.text} {extra()}
          </div>
        )}
        {mobile ? (
          <span className="mr-[5px] rounded-[10px] px-[10px] py-[2px] text-white" style={{ background: color ?? undefined }}>
            {hhmm(mobile)}
          </span>
        ) : task.status === "done" ? (
          <Svg d={P.done} size={20} fill={task.type !== "no_plan_visit" ? "#92ce95" : "#e57373"} className="mr-[10px]" />
        ) : task.status === "undone" ? (
          <Svg d={P.undone} size={20} fill="rgb(229, 115, 115)" className="mr-[10px]" />
        ) : task.status === "pending" ? (
          <Svg d={P.pending} size={20} fill="rgb(240, 173, 78)" className="mr-[10px]" />
        ) : null}
      </div>
      {task.service_time?.audio_record_url && (
        <audio controls style={{ display: "inline-block", verticalAlign: "baseline" }}>
          <source src={task.service_time.audio_record_url} type="audio/mpeg" />
        </audio>
      )}
      {images.length > 0 && (
        <div className="flex gap-[10px]">
          {images.map((src, index) => (
            <div key={`${src}-${index}`} className="relative mt-[10px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="block max-h-[150px] w-full cursor-pointer" />
            </div>
          ))}
        </div>
      )}
      {task.response && <div className="my-[5px] w-fit rounded-[10px] bg-[#4f71dc] px-[10px] py-[2px] text-white">{task.response}</div>}
    </li>
  )
}

const ringColor = (item: PlanItem) =>
  item.plans.some((task) => task.type === "rejection") ? "#e57373" : item.plans.some((task) => task.type === "no_plan_visit") ? "#DDE007" : item.plans.some((task) => task.status === "done") ? "#81c784" : "#5868F0"

function PlanBlock({ item, index, count, selected, onToggle, onLocate }: { item: PlanItem; index: number; count: number; selected: boolean; onToggle: () => void; onLocate: () => void }) {
  const { t } = useLanguage()
  const done = item.plans.some((task) => task.status === "done")
  const first = item.plans[0]?.done_time
  // The line through the dots: the first block's reaches up to the buttons, the last block's ends under its card, the rest run on to the next block.
  const line = index === 0 ? { bottom: -23, height: "calc(100% + 43px)" } : index === count - 1 ? { top: 15, height: "calc(100% + 5px)" } : { top: 15, height: "calc(100% + 8px)" }
  return (
    <div className="relative flow-root" style={{ marginBottom: index === count - 1 ? 0 : 10 }}>
      <span className="absolute left-[calc(10%-2px)] w-[4px] bg-[#22a6c6]" style={line} />
      <div className="absolute left-[calc(10%-8px)] top-[15px] h-[16px] w-[16px] rounded-full bg-[#22a6c6]" style={{ outline: "2px solid #f4f4f4" }} />
      <div className="relative float-right w-[calc(90%-30px)] rounded-[2px] bg-white px-[20px] py-[15px] text-left text-[#666]" style={{ boxShadow: CARD_SHADOW, zIndex: 3 }}>
        <span className="pointer-events-none absolute -left-[13px] top-[15px] z-[1] h-0 w-0 border-y-[8px] border-r-[11px] border-y-transparent border-r-black/25 blur-[1px]" />
        <span className="pointer-events-none absolute -left-[12px] top-[13px] z-[3] h-0 w-0 border-y-[10px] border-r-[12px] border-y-transparent border-r-white" />
        <div className="-ml-px flex w-full items-center">
          <PlanCheck checked={selected} onChange={onToggle} color="#333" checkedColor="#5d6474" />
          <h2 className="text-[16px] font-bold leading-[14px]">
            <a className="cursor-pointer text-inherit hover:text-[#4f71dc]">{item.market.name}</a>
          </h2>
        </div>
        <p style={{ margin: "-5px 0 10px" }}>{item.market.guide}</p>
        {item.plans.length === 0 ? <div>{t("Пока не выполнено заданий")}</div> : <ul>{item.plans.map((task) => <TaskRow key={task.id} task={task} />)}</ul>}
        {first && <span className="absolute -left-[85px] top-[12px] text-[16px] font-bold leading-[20px]">{hhmm(first)}</span>}
        {item.distance ? (
          <span onClick={onLocate} className="absolute -left-[85px] top-[42px] cursor-pointer text-[14px] font-semibold leading-[17.5px]" style={{ color: item.distance >= 50 && item.distance <= 100 ? "#DDE007" : item.distance > 100 ? "rgb(255, 94, 94)" : "rgb(58, 201, 119)" }}>
            <RefTip text={t("Расстояние между магазином и действием")} side="right">
              <div className="flex items-center font-bold">{item.distance} {t("м.")}</div>
            </RefTip>
          </span>
        ) : null}
        <span onClick={onLocate} className="absolute -left-[41px] top-[10px] flex h-[25px] w-[25px] cursor-pointer select-none items-center justify-center rounded-full bg-white text-[14px] font-semibold leading-[17.5px] text-[#666]" style={{ border: `3px solid ${ringColor(item)}` }}>
          <div>{done ? index + 1 : (item.route_position ?? "")}</div>
        </span>
      </div>
    </div>
  )
}

export function PlanTimeline({ items, selected, onSelect, onLocate }: { items: PlanItem[]; selected: number[]; onSelect: (ids: number[]) => void; onLocate: (lat: number, lon: number) => void }) {
  const sorted = sortPlans(items)
  return (
    <div>
      {sorted.map((item, index) => {
        const id = item.market.id
        return (
          <PlanBlock
            key={item.id ?? `${id}-${index}`}
            item={item}
            index={index}
            count={sorted.length}
            selected={selected.includes(id)}
            onToggle={() => onSelect(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])}
            onLocate={() => item.location && onLocate(item.location.lat, item.location.lon)}
          />
        )
      })}
    </div>
  )
}

/** The ring of dots of the reference's loader. */
export function RingSpinner() {
  return (
    <svg viewBox="-20 -20 40 40" width={48} height={48} className="animate-spin" style={{ animationDuration: "1.4s" }} aria-hidden>
      {Array.from({ length: 10 }, (_, index) => {
        const angle = (index / 10) * Math.PI * 2
        return <circle key={index} cx={Math.sin(angle) * 14} cy={-Math.cos(angle) * 14} r={1.6 + index * 0.1} fill="#4f71dc" opacity={0.25 + index * 0.075} />
      })}
    </svg>
  )
}

