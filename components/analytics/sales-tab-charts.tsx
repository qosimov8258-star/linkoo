"use client"

import type { ReactNode } from "react"

// SVG charts of the dashboard "ПРОДАЖА" tab (the demo draws them with ApexCharts): the "Продажа" bar
// chart, the bars + lines chart below it, and the donuts next to the breakdown tables.

export const SALES_COLORS = { bar: "#2699fb", akb: "#00e396", reject: "#ff4560" }
const DONUT_COLORS = ["#008ffb", "#00e396", "#feb019", "#ff4560", "#775dd0", "#3f51b5", "#03a9f4", "#4caf50", "#f9ce1d", "#ff9800"]

export const formatNumber = (value: number, digits = 3) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value)

/** Axis steps the way the demo's charts pick them: about five intervals, 1/2/3/4/5/8 × 10^n. */
export function niceScale(max: number) {
  if (max <= 0) return { step: 1, top: 5, ticks: [0, 1, 2, 3, 4, 5] }
  const raw = max / 5
  const unit = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 3, 4, 5, 8, 10].find((candidate) => candidate * unit >= raw) ?? 10) * unit
  const count = Math.ceil(max / step)
  return { step, top: count * step, ticks: Array.from({ length: count + 1 }, (_, index) => index * step) }
}

const axisLabel = (value: number) => formatNumber(value, 0)
// the plot starts after the widest y label (11px digits ≈ 5.4px each)
const plotLeft = (labels: string[], base: number) => base + 27 + 5.4 * Math.max(...labels.map((label) => label.length))

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={`h-12 w-12 animate-spin ${className}`} style={{ animationDuration: "1.2s" }} aria-hidden>
      {Array.from({ length: 10 }, (_, index) => {
        const angle = (index / 10) * Math.PI * 2
        return <circle key={index} cx={24 + 16 * Math.sin(angle)} cy={24 - 16 * Math.cos(angle)} r={1.2 + index * 0.18} fill="#4f71dc" />
      })}
    </svg>
  )
}

/** "Продажа": one bar per day / week / month. */
export function SalesBars({ points, width = 960, height = 432 }: { points: { label: string; total: number }[]; width?: number; height?: number }) {
  const scale = niceScale(Math.max(...points.map((point) => point.total), 0))
  const labels = scale.ticks.map(axisLabel)
  const left = plotLeft(labels, 0) + 0
  const plotWidth = width - left - 8
  const slot = plotWidth / points.length
  const y = (value: number) => 10 + (1 - value / scale.top) * height
  return (
    <svg width={width} height={height + 60} className="block">
      {scale.ticks.map((tick, index) => (
        <g key={tick}>
          <line x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="#e0e0e0" />
          <text x={left - 10} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#333">{labels[index]}</text>
        </g>
      ))}
      <line x1={left} x2={left + plotWidth} y1={y(0) + 1} y2={y(0) + 1} stroke="#e0e0e0" />
      {points.map((point, index) => {
        const barWidth = slot * 0.55
        const x = left + slot * index + (slot - barWidth) / 2
        return (
          <g key={point.label}>
            <rect x={x} y={y(point.total)} width={barWidth} height={y(0) - y(point.total)} fill={SALES_COLORS.bar} />
            <text x={left + slot * index + slot / 2} y={y(0) + 25} textAnchor="middle" fontSize="12" fill="#333">{point.label}</text>
            <line x1={left + slot * index} x2={left + slot * index} y1={y(0) + 1} y2={y(0) + 7} stroke="#e0e0e0" />
          </g>
        )
      })}
    </svg>
  )
}

/** Bars (sales) with the АКБ and refusal lines on the right axis. */
export function SalesCombo({ points, width = 1400, height = 266 }: { points: { date: string; sales: number; akb: number; reject: number }[]; width?: number; height?: number }) {
  const empty = points.length === 0
  const scale = niceScale(Math.max(...points.map((point) => point.sales), 0))
  const rightMax = Math.max(...points.map((point) => Math.max(point.akb, point.reject)), 0)
  const rightTicks = empty ? [0, 1, 2, 3, 4, 5] : Array.from({ length: rightMax + 1 }, (_, index) => index)
  const labels = scale.ticks.map(axisLabel)
  const left = empty ? 30 : 5.4 * Math.max(...labels.map((label) => label.length)) + 12
  const right = width - 35
  const slot = (right - left) / Math.max(points.length, 1)
  const top = 10
  const y = (value: number) => top + (1 - value / (empty ? 5 : scale.top)) * height
  const yRight = (value: number) => top + (1 - value / (empty ? 5 : Math.max(rightMax, 1))) * height
  const center = (index: number) => left + slot * index + slot / 2
  const line = (pick: (point: (typeof points)[number]) => number) => points.map((point, index) => `${center(index)},${yRight(pick(point))}`).join(" ")
  const marker = (index: number, value: number, color: string) => (
    <g key={`${color}-${index}`}>
      <rect x={center(index) - 7} y={yRight(value) - 7} width="14" height="14" rx="2" fill={color} />
      <text x={center(index)} y={yRight(value) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{value}</text>
    </g>
  )
  return (
    <svg width={width} height={height + 81} className="block">
      {(empty ? [0, 1, 2, 3, 4, 5] : scale.ticks).map((tick) => (
        <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="#e0e0e0" />
          {!empty && <text x={left - 12} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#333">{axisLabel(tick)}</text>}
        </g>
      ))}
      {rightTicks.map((tick) => (
        <text key={`r${tick}`} x={right + 10} y={yRight(tick) + 4} fontSize="11" fill="#333">{tick}</text>
      ))}
      {points.map((point, index) => {
        const barWidth = slot * 0.68
        return <rect key={point.date} x={center(index) - barWidth / 2} y={y(point.sales)} width={barWidth} height={y(0) - y(point.sales)} fill="#4d9ff9" opacity="0.95" />
      })}
      {points.length > 0 && <polyline points={line((point) => point.akb)} fill="none" stroke={SALES_COLORS.akb} strokeWidth="4" strokeLinejoin="round" />}
      {points.length > 0 && <polyline points={line((point) => point.reject)} fill="none" stroke={SALES_COLORS.reject} strokeWidth="4" strokeLinejoin="round" />}
      {points.map((point, index) => marker(index, point.akb, SALES_COLORS.akb))}
      {points.map((point, index) => marker(index, point.reject, SALES_COLORS.reject))}
      {points.map((point, index) => (
        <text key={`x${point.date}`} x={center(index)} y={y(0) + 22} textAnchor="middle" fontSize="12" fill="#333">{point.date}</text>
      ))}
      {!empty && (
        <g fontSize="12" fill="#373d3f">
          {[
            ["Факт продаж", SALES_COLORS.bar, width / 2 - 88],
            ["АКБ", SALES_COLORS.akb, width / 2 + 12],
            ["Отказ", SALES_COLORS.reject, width / 2 + 62],
          ].map(([name, color, x]) => (
            <g key={name as string}>
              <circle cx={(x as number) - 6} cy={y(0) + 46} r="6" fill={color as string} />
              <text x={(x as number) + 4} y={y(0) + 50}>{name as string}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  )
}

/** Ring chart with the total in the middle; slices carry "name / NN.N%" labels. */
export function SalesDonut({ rows, total, label }: { rows: { name: string; percent: number }[]; total: string; label: ReactNode }) {
  const size = 308
  const radius = 152
  const inner = 101
  const cx = size / 2
  const cy = size / 2
  const sum = rows.reduce((value, row) => value + row.percent, 0) || 1
  let start = -Math.PI / 2
  const point = (angle: number, r: number) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  return (
    <svg width={size} height={size} className="block">
      {rows.length === 0 ? (
        <circle cx={cx} cy={cy} r={(radius + inner) / 2} fill="none" stroke="#f0f4f8" strokeWidth={radius - inner} />
      ) : (
        rows.map((row, index) => {
          const angle = (row.percent / sum) * Math.PI * 2
          const end = start + angle
          const large = angle > Math.PI ? 1 : 0
          const [x1, y1] = point(start, radius)
          const [x2, y2] = point(end, radius)
          const [x3, y3] = point(end, inner)
          const [x4, y4] = point(start, inner)
          const mid = start + angle / 2
          const [lx, ly] = point(mid, (radius + inner) / 2)
          const path = rows.length === 1 ? null : `M${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`
          const slice = (
            <g key={row.name}>
              {path ? (
                <path d={path} fill={DONUT_COLORS[index % DONUT_COLORS.length]} stroke="#fff" strokeWidth="1" />
              ) : (
                <circle cx={cx} cy={cy} r={(radius + inner) / 2} fill="none" stroke={DONUT_COLORS[0]} strokeWidth={radius - inner} />
              )}
              {row.percent >= 3 && (
                <>
                  <text x={lx} y={ly - 2} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" style={{ textShadow: "0 0 2px rgba(0,0,0,0.5)" }}>{row.name}</text>
                  <text x={lx} y={ly + 13} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" style={{ textShadow: "0 0 2px rgba(0,0,0,0.5)" }}>{row.percent.toFixed(1)}%</text>
                </>
              )}
            </g>
          )
          start = end
          return slice
        })
      )}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="13" fontWeight="600" fill="#333">{total}</text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize="12" fill="#333">{label}</text>
    </svg>
  )
}
