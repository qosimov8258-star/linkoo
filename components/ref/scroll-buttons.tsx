"use client"

import { useCallback, useEffect, useState, type RefObject } from "react"

// The reference puts a pair of translucent half-discs at the window edges of wide tables: "«" while the table can scroll
// back, "»" while it can scroll on. A click moves the table by most of its visible width.
const CHEVRON = "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"
const BACK_CHEVRON = "M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"

/**
 * `top` pins the pair to the window (fixed, like the debts page). Give `inside` the offset (px) from the top of the closest
 * positioned ancestor instead to let it sit on the table, as on the visit reports.
 */
export function ScrollButtons({ targetRef, watch, inside }: { targetRef: RefObject<HTMLElement | null>; watch?: unknown; inside?: number }) {
  const [state, setState] = useState({ back: false, forward: false })

  const measure = useCallback(() => {
    const node = targetRef.current
    if (!node) return
    const back = node.scrollLeft > 1
    const forward = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    setState((current) => (current.back === back && current.forward === forward ? current : { back, forward }))
  }, [targetRef])

  useEffect(() => {
    const node = targetRef.current
    if (!node) return
    measure()
    node.addEventListener("scroll", measure, { passive: true })
    window.addEventListener("resize", measure)
    return () => {
      node.removeEventListener("scroll", measure)
      window.removeEventListener("resize", measure)
    }
  }, [targetRef, measure, watch])

  const move = (direction: 1 | -1) => targetRef.current?.scrollBy({ left: direction * targetRef.current.clientWidth * 0.8, behavior: "smooth" })
  const base = `${inside === undefined ? "fixed top-[265px]" : "absolute"} z-[12] flex h-[60px] w-[40px] items-center bg-black/[0.31] opacity-80 transition-opacity`
  const place = inside === undefined ? undefined : { top: inside }

  if (!state.back && !state.forward) return null
  return (
    <>
      {state.back && (
      <button type="button" aria-label="«" onClick={() => move(-1)} style={place} className={`${base} left-0 justify-start rounded-r-[60px] pl-[2px]`}>
        <svg viewBox="0 0 24 24" className="-mr-[12px] h-6 w-6 fill-white"><path d={BACK_CHEVRON} /></svg>
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={BACK_CHEVRON} /></svg>
      </button>
      )}
      {state.forward && (
      <button type="button" aria-label="»" onClick={() => move(1)} style={place} className={`${base} right-0 justify-end rounded-l-[60px] pr-[2px]`}>
        <svg viewBox="0 0 24 24" className="-mr-[12px] h-6 w-6 fill-white"><path d={CHEVRON} /></svg>
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={CHEVRON} /></svg>
      </button>
      )}
    </>
  )
}
