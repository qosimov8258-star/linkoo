"use client"

import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Eraser, Undo2 } from "lucide-react"

import { BUG_MARK_COLOR, type ScreenshotRect } from "@/lib/bug-reports/image"
import { useLanguage } from "@/lib/i18n/language-context"

/** A drag shorter than this (screen px) is a click, not a rectangle. */
const MIN_DRAG_PX = 4

type Props = {
  image: HTMLCanvasElement
  rects: ScreenshotRect[]
  onChange: (rects: ScreenshotRect[]) => void
  disabled?: boolean
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * The screenshot of a bug report with the customer's red rectangles: drag to draw one, «Отменить последнее» and
 * «Очистить». The marks are kept in fractions of the picture and drawn into the sent JPEG by drawMarks
 * (lib/bug-reports/image.ts); here they are 3 px boxes over the picture, so they look the same at any panel size.
 */
export function ScreenshotAnnotator({ image, rects, onChange, disabled }: Props) {
  const { t } = useLanguage()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const [draft, setDraft] = useState<ScreenshotRect | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    canvas.width = image.width
    canvas.height = image.height
    context.drawImage(image, 0, 0)
  }, [image])

  function point(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp((event.clientX - box.left) / (box.width || 1)),
      y: clamp((event.clientY - box.top) / (box.height || 1)),
    }
  }

  function rectFrom(from: { x: number; y: number }, to: { x: number; y: number }): ScreenshotRect {
    return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = point(event)
    start.current = { ...at, pointerId: event.pointerId }
    setDraft({ x: at.x, y: at.y, w: 0, h: 0 })
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.pointerId !== event.pointerId) return
    setDraft(rectFrom(start.current, point(event)))
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const from = start.current
    if (!from || from.pointerId !== event.pointerId) return
    start.current = null
    setDraft(null)
    const rect = rectFrom(from, point(event))
    const box = event.currentTarget.getBoundingClientRect()
    if (rect.w * box.width >= MIN_DRAG_PX && rect.h * box.height >= MIN_DRAG_PX) onChange([...rects, rect])
  }

  function handlePointerCancel() {
    start.current = null
    setDraft(null)
  }

  const shown = draft ? [...rects, draft] : rects
  const ratio = image.width / image.height

  return (
    <div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        // The picture keeps its proportions and stays below 45% of the window, however tall the pasted one is.
        style={{ aspectRatio: `${image.width} / ${image.height}`, width: `min(100%, calc(45vh * ${ratio}))` }}
        className={`relative mx-auto touch-none select-none overflow-hidden rounded-[5px] border border-[#e6e6e6] bg-[#f2f5f8] ${
          disabled ? "cursor-default" : "cursor-crosshair"
        }`}
      >
        <canvas ref={canvasRef} role="img" aria-label={t("Снимок экрана")} className="absolute inset-0 h-full w-full" />
        {shown.map((rect, index) => (
          <div
            key={index}
            aria-hidden
            className="pointer-events-none absolute border-[3px]"
            style={{
              borderColor: BUG_MARK_COLOR,
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-[6px] flex items-center gap-[6px]">
        <p className="min-w-0 flex-1 text-[12px] leading-4 text-[#777]">{t("Выделите место ошибки на снимке мышью")}</p>
        <button
          type="button"
          onClick={() => onChange(rects.slice(0, -1))}
          disabled={disabled || rects.length === 0}
          title={t("Отменить последнее")}
          aria-label={t("Отменить последнее")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] border border-[#e6e6e6] text-[#333] transition-colors hover:bg-[#f2f5f8] disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={disabled || rects.length === 0}
          title={t("Очистить")}
          aria-label={t("Очистить")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] border border-[#e6e6e6] text-[#333] transition-colors hover:bg-[#f2f5f8] disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
