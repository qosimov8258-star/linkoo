"use client"

import { useState } from "react"
import { SelectField } from "./select-field"

const GROUPINGS = ["По брендам", "По категориям", "По клиентам", "По регионам", "По агентам"]

export function RightPanel() {
  const [grouping, setGrouping] = useState("По брендам")

  return (
    <div className="flex flex-col rounded-lg bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <SelectField label="Группировка" options={GROUPINGS} value={grouping} onChange={setGrouping} />
        </div>
        <div className="pt-6 text-slate-300">И</div>
      </div>

      {/* Empty chart area */}
      <div className="flex flex-1 flex-col items-center justify-center py-16">
        <span className="text-2xl font-bold text-slate-700">0</span>
        <span className="mt-1 text-sm uppercase tracking-wide text-slate-500">итого</span>
      </div>
    </div>
  )
}
