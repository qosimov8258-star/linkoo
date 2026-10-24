"use client"

import { useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"

const FACE = 260
const CENTER = FACE / 2
const OUTER = 109
const INNER = 73

const two = (value: number) => String(value).padStart(2, "0")

function polar(index: number, steps: number, radius: number) {
  const angle = (index / steps) * Math.PI * 2
  return { x: CENTER + radius * Math.sin(angle), y: CENTER - radius * Math.cos(angle) }
}

/** 24-hour clock dialog of the reference's time fields (hours: outer 1-12 / inner 00, 13-23; then minutes); its Cancel / OK stay English there. */
export function ClockTimePicker({ value, onCancel, onPick }: { value: string; onCancel: () => void; onPick: (time: string) => void }) {
  const now = new Date()
  const match = /^(\d{2}):(\d{2})/.exec(value)
  const [hour, setHour] = useState(match ? Number(match[1]) : now.getHours())
  const [minute, setMinute] = useState(match ? Number(match[2]) : now.getMinutes())
  const [mode, setMode] = useState<"hours" | "minutes">("hours")

  function onFaceClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - rect.left - CENTER
    const dy = event.clientY - rect.top - CENTER
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI
    const normalized = (angle + 360) % 360
    if (mode === "minutes") return setMinute(Math.round(normalized / 6) % 60)
    const slot = Math.round(normalized / 30) % 12
    const outer = Math.hypot(dx, dy) > (OUTER + INNER) / 2
    setHour(outer ? (slot === 0 ? 12 : slot) : slot === 0 ? 0 : slot + 12)
    setMode("minutes")
  }

  const handIndex = mode === "hours" ? hour % 12 : minute
  const handSteps = mode === "hours" ? 12 : 60
  const handRadius = mode === "hours" ? (hour >= 1 && hour <= 12 ? OUTER : INNER) : OUTER
  const tip = polar(handIndex, handSteps, handRadius)

  const labels =
    mode === "hours"
      ? [
          ...Array.from({ length: 12 }, (_, i) => ({ text: String(i === 0 ? 12 : i), ...polar(i, 12, OUTER), selected: hour === (i === 0 ? 12 : i) })),
          ...Array.from({ length: 12 }, (_, i) => ({ text: i === 0 ? "00" : String(i + 12), ...polar(i, 12, INNER), selected: hour === (i === 0 ? 0 : i + 12) })),
        ]
      : Array.from({ length: 12 }, (_, i) => ({ text: two(i * 5), ...polar(i, 12, OUTER), selected: minute === i * 5 }))

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="w-[280px] bg-white text-[#333] shadow-xl">
        <div className="flex h-[98px] items-center justify-center bg-[#2f3544] text-[58px] font-light leading-none text-white">
          <button type="button" onClick={() => setMode("hours")} className={mode === "hours" ? "" : "opacity-50"}>{two(hour)}</button>
          <span>:</span>
          <button type="button" onClick={() => setMode("minutes")} className={mode === "minutes" ? "" : "opacity-50"}>{two(minute)}</button>
        </div>
        <div className="flex justify-center pb-[30px] pt-[20px]">
          <div onClick={onFaceClick} className="relative cursor-pointer rounded-full bg-[#eceff1]" style={{ width: FACE, height: FACE }}>
            <svg className="pointer-events-none absolute inset-0" width={FACE} height={FACE}>
              <line x1={CENTER} y1={CENTER} x2={tip.x} y2={tip.y} stroke="#4f71dc" strokeWidth={2} />
              <circle cx={CENTER} cy={CENTER} r={3} fill="#4f71dc" />
              <circle cx={tip.x} cy={tip.y} r={16} fill="#4f71dc" />
            </svg>
            {labels.map((label) => (
              <span key={label.text + label.x} style={{ left: label.x - 16, top: label.y - 16 }} className={`pointer-events-none absolute flex h-8 w-8 items-center justify-center text-[15px] ${label.selected ? "text-white" : "text-[#555]"}`}>
                {label.text}
              </span>
            ))}
            {mode === "minutes" && minute % 5 !== 0 && (
              <span style={{ left: tip.x - 16, top: tip.y - 16 }} className="pointer-events-none absolute flex h-8 w-8 items-center justify-center text-[15px] text-white">{minute}</span>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-[16px] pb-[6px] pr-[20px] text-[14px] uppercase">
          <button type="button" onClick={onCancel} className="h-[36px] px-[16px] uppercase hover:bg-black/5">Cancel</button>
          <button type="button" onClick={() => onPick(`${two(hour)}:${two(minute)}`)} className="h-[36px] min-w-[64px] px-[16px] uppercase hover:bg-black/5">OK</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
