"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

type Side = "top" | "bottom" | "left" | "right"

// Offsets of the reference's react-tooltip (dark `#2d3037` bubble, 13px text, 8px 21px padding, 0.9 opacity).
const PLACE: Record<Side, string> = {
  right: "left-[calc(100%+10px)] top-1/2 -translate-y-1/2",
  left: "right-[calc(100%+12px)] top-1/2 -translate-y-1/2",
  bottom: "left-1/2 top-[calc(100%+10px)] -translate-x-1/2",
  top: "bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2",
}

/**
 * Hover tooltip like the reference's `data-tip` bubbles. A "right" bubble flips to the left when it would leave the window.
 */
export function RefTip({ text, side = "top", gap, bold = false, raw = false, className = "", children }: { text: string; /** Keep the text untranslated (the reference leaves some hints in Russian in every language). */ raw?: boolean; side?: Side; /** Distance of the bubble from the element in px (default 10, «left» 12). */ gap?: number; /** Semi-bold text (the reference's transfer card hints are 600, most others 400). */ bold?: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState<Side>(side)
  const tipRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!open || !tipRef.current) return
    if (side === "right" && tipRef.current.getBoundingClientRect().right > window.innerWidth + 2) setPlaced("left")
  }, [open, side])

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => {
        setPlaced(side)
        setOpen(true)
      }}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && text && (
        <span
          ref={tipRef}
          role="tooltip"
          {...(raw ? { "data-no-translate": "" } : {})}
          className={`pointer-events-none absolute z-[1000] w-max max-w-[1008px] rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-left font-sans text-[13px] ${bold ? "font-semibold" : "font-normal"} normal-case leading-[17px] text-white opacity-90 ${PLACE[placed]}`}
          style={gap === undefined ? undefined : placed === "left" ? { right: `calc(100% + ${gap}px)` } : placed === "right" ? { left: `calc(100% + ${gap}px)` } : placed === "top" ? { bottom: `calc(100% + ${gap}px)` } : { top: `calc(100% + ${gap}px)` }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
