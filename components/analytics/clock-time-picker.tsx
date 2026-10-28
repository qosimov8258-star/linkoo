"use client"

import { useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"

const FACE = 260
const CENTER = FACE / 2
const OUTER = 109
const INNER = 73

const two = (value: number) => String(value).padStart(2, "0")

// Label offsets (translate x / y from the top-centre of the face) exactly as the reference's clock
// lays them out: 12 outer slots of 32px boxes and 12 inner slots of 28px boxes. The reference's
// "1 o'clock" slot sits 3px higher than the mirrored "11" slot and its 13 / 23 slots are not
// mirrored either; those quirks are copied on purpose.
const OUTER_SLOTS: [number, number][] = [[0, 5], [54.5, 16.6], [94.4, 59.5], [109, 114], [94.4, 168.5], [54.5, 208.4], [0, 223], [-54.5, 208.4], [-94.4, 168.5], [-109, 114], [-94.4, 59.5], [-54.5, 19.6]]
const INNER_SLOTS: [number, number][] = [[0, 40], [36.9, 49.9], [64, 77], [74, 114], [64, 151], [37, 178], [0, 188], [-37, 178], [-64, 151], [-74, 114], [-64, 77], [-37, 50]]

function Slot({ text, slot, size, selected }: { text: string; slot: [number, number]; size: number; selected: boolean }) {
  return (
    <span
      style={{ left: FACE / 2 - size / 2, top: 0, width: size, height: size, transform: `translate(${slot[0]}px, ${slot[1]}px)` }}
      className={`pointer-events-none absolute select-none rounded-full pt-[5px] text-center text-[17.6px] leading-[22px] ${selected ? "bg-[#4f71dc] text-white" : "text-[#7d7d7d]"}`}
    >
      {text}
    </span>
  )
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

  const outerHour = hour >= 1 && hour <= 12
  const handAngle = mode === "hours" ? (hour % 12) * 30 : minute * 6
  const handLength = mode === "hours" && !outerHour ? 84 : 112

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/[0.54]">
      <div className="w-[280px] rounded-[2px] bg-white text-[#333] shadow-[0_14px_45px_rgba(0,0,0,0.25),0_10px_18px_rgba(0,0,0,0.22)]">
        <div className="flex h-[98px] items-center justify-center bg-[#2d3037] text-[58px] font-normal leading-none text-white">
          <button type="button" onClick={() => setMode("hours")} className={mode === "hours" ? "" : "opacity-70"}>{two(hour)}</button>
          <span>:</span>
          <button type="button" onClick={() => setMode("minutes")} className={mode === "minutes" ? "" : "opacity-70"}>{two(minute)}</button>
        </div>
        <div className="flex justify-center pb-[20px] pt-[20px]">
          <div onClick={onFaceClick} className="relative cursor-pointer rounded-full bg-[#ededed]" style={{ width: FACE, height: FACE }}>
            <div
              className="pointer-events-none absolute w-[2px] bg-[#4f71dc]"
              style={{ left: CENTER - 1, bottom: CENTER, height: handLength, transformOrigin: "center bottom", transform: `rotate(${handAngle}deg)` }}
            >
              {mode === "minutes" && minute % 5 !== 0 && (
                <div className="absolute rounded-full border-4 border-solid border-[#4f71dc] bg-white" style={{ boxSizing: "content-box", width: 7, height: 7, top: -5, left: -6 }} />
              )}
            </div>
            {mode === "hours"
              ? (
                <>
                  {OUTER_SLOTS.map((slot, i) => <Slot key={`o${i}`} text={String(i === 0 ? 12 : i)} slot={slot} size={32} selected={hour === (i === 0 ? 12 : i)} />)}
                  {INNER_SLOTS.map((slot, i) => <Slot key={`i${i}`} text={i === 0 ? "00" : String(i + 12)} slot={slot} size={28} selected={hour === (i === 0 ? 0 : i + 12)} />)}
                </>
              )
              : OUTER_SLOTS.map((slot, i) => <Slot key={`m${i}`} text={i === 0 ? "00" : String(i * 5)} slot={slot} size={32} selected={minute === i * 5} />)}
          </div>
        </div>
        <div className="flex justify-end gap-0 p-[8px] text-[13px] uppercase">
          <button type="button" onClick={onCancel} className="h-[36px] w-[88px] rounded-[2px] uppercase text-black hover:bg-black/5"><span className="relative top-[2.27px]">Cancel</span></button>
          <button type="button" onClick={() => onPick(`${two(hour)}:${two(minute)}`)} className="h-[36px] w-[88px] rounded-[2px] uppercase text-black hover:bg-black/5"><span className="relative top-[2.27px]">OK</span></button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
