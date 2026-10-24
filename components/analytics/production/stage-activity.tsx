"use client"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import type { Recipe } from "./batch-detail"
import type { Equipment, StaffMember } from "./stage-tabs"
import {
  api,
  Field,
  formatAmount,
  formatDate,
  formatDateTime,
  formatNumber,
  inputClass,
  ItemLinesEditor,
  Modal,
  RobotEmpty,
  SaveButton,
  todayIso,
  useApiData,
  type CatalogItem,
  type DraftLine,
  type Stage,
  type StockItem,
} from "./production-ui"
import { notify } from "@/lib/notify"

type LogRow = { id: number; partyId: number | null; direction: "made" | "raw"; name: string; unit: string; amount: number; isDefect: boolean; shift: string; worker: string; equipmentName: string; createdAt: string }
type Activity = {
  made: Array<{ key: string; name: string; unit: string; total: number; ok: number; defect: number }>
  raw: Array<{ key: string; name: string; unit: string; amount: number }>
  logs: LogRow[]
  shifts: Array<{ date: string; shift: string; worker: string; made: number; raw: number }>
}
type Inventory = { id: number; date: string; comment: string; userName: string; createdAt: string; lines: Array<{ key: string; name: string; unit: string; expected: number; actual: number; difference: number }> }
type SubTab = "overview" | "logs" | "shifts" | "inventory"
type Filters = { shift: string; equipmentId: string; worker: string }

const SUB_TABS: Array<[SubTab, string, string]> = [
  ["overview", "Обзор", "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"],
  ["logs", "Записи", "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"],
  ["shifts", "Смены", "M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"],
  ["inventory", "Инвентаризация", "M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"],
]

const MONTHS_CAP = ["Янв.", "Февр.", "Мар.", "Апр.", "Мая", "Июня", "Июля", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]
const capDate = (iso: string) => {
  const [y, m, d] = iso.split("-")
  return `${d} ${MONTHS_CAP[Number(m) - 1] ?? m} ${y}`
}

export function ActivityTab({ stage, equipment, staff }: { stage: Stage; equipment: Equipment[]; staff: StaffMember[] }) {
  const { t } = useLanguage()
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(todayIso())
  const [subTab, setSubTab] = useState<SubTab>("overview")
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [draft, setDraft] = useState<Filters>({ shift: "", equipmentId: "", worker: "" })
  const [filters, setFilters] = useState<Filters>({ shift: "", equipmentId: "", worker: "" })
  const [dialog, setDialog] = useState<"made" | "raw" | "reconcile" | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams({ stageId: String(stage.id), from, to })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    return params.toString()
  }, [filters, from, stage.id, to])
  const { data: activity, reload } = useApiData<Activity>(`/api/production/activity?${query}`, { made: [], raw: [], logs: [], shifts: [] })
  const { data: inventories, reload: reloadInventories } = useApiData<Inventory[]>(
    subTab === "inventory" ? `/api/production/inventories?stageId=${stage.id}&from=${from}&to=${to}` : null,
    [],
  )
  const shifts = useMemo(() => Array.from(new Set(staff.map((member) => member.shift).filter(Boolean))), [staff])
  const workers = useMemo(() => Array.from(new Set(staff.map((member) => member.employeeName))), [staff])

  return (
    <div className="font-sans text-[13px] text-[#333]">
      <div className="flex h-[56px] items-center justify-end gap-[10px]">
        <ColorButton color="bg-[#fa8072]" icon="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" label="Сверить" onClick={() => setDialog("reconcile")} />
        <ColorButton color="bg-[#4db6ac]" icon="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" label="Добавить продукт" onClick={() => setDialog("made")} />
        <ColorButton color="bg-[#4f71dc]" icon="M10 17l5-5-5-5v10zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" label="Добавить сырье" onClick={() => setDialog("raw")} />
      </div>

      <div className="relative bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative flex h-[66px] items-center justify-between pl-[30px] pr-[30px]">
          <button type="button" onClick={() => setPeriodOpen((value) => !value)} className="text-[13px] font-bold text-[#4f71dc]">
            {capDate(from)} - {capDate(to)}
          </button>
          {periodOpen && (
            <DateRangePicker
              begin={from}
              end={to}
              onClose={() => setPeriodOpen(false)}
              onApply={(begin, end) => {
                setFrom(begin)
                setTo(end)
                setPeriodOpen(false)
              }}
            />
          )}
          <button onClick={() => { setDraft(filters); setFilterOpen((value) => !value) }} className="flex h-[34px] items-center rounded-[3px] bg-[#4f71dc] pl-[8px] pr-[12px] text-[13px] font-bold text-white">
            <svg viewBox="0 0 24 24" className="mr-[4px] h-6 w-6 fill-white" aria-hidden><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" /></svg>
            {t("Фильтр")}
          </button>
        </div>
        {filterOpen && (
          <form
            onSubmit={(event) => { event.preventDefault(); setFilters(draft); setFilterOpen(false) }}
            className="absolute right-4 top-16 z-20 w-80 space-y-4 bg-white p-5 shadow-2xl"
          >
            <Field label="Смена">
              <select value={draft.shift} onChange={(event) => setDraft({ ...draft, shift: event.target.value })} className={inputClass}>
                <option value="">{t("Все")}</option>
                {shifts.map((shift) => <option key={shift}>{shift}</option>)}
              </select>
            </Field>
            <Field label="Оборудование">
              <select value={draft.equipmentId} onChange={(event) => setDraft({ ...draft, equipmentId: event.target.value })} className={inputClass}>
                <option value="">{t("Все")}</option>
                {equipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </Field>
            <Field label="Работник">
              <select value={draft.worker} onChange={(event) => setDraft({ ...draft, worker: event.target.value })} className={inputClass}>
                <option value="">{t("Все")}</option>
                {workers.map((worker) => <option key={worker}>{worker}</option>)}
              </select>
            </Field>
            <div className="flex justify-between">
              <button type="button" onClick={() => { const empty = { shift: "", equipmentId: "", worker: "" }; setDraft(empty); setFilters(empty); setFilterOpen(false) }} className="text-sm text-slate-500">{t("Очистить")}</button>
              <button type="submit" className="rounded bg-[#5b7ce6] px-5 py-2 text-sm font-semibold uppercase text-white">{t("Применить")}</button>
            </div>
          </form>
        )}

        <nav className="flex h-[48px] border-y border-[#efefef]">
          {SUB_TABS.map(([value, label, path]) => (
            <button key={value} onClick={() => setSubTab(value)} className={`flex h-[48px] items-center border-b-2 px-[42px] text-[13px] ${subTab === value ? "border-[#4f71dc] text-[#4f71dc]" : "border-transparent text-[#333]"}`}>
              <svg viewBox="0 0 24 24" className="mr-[12px] h-[18px] w-[18px]" style={{ fill: subTab === value ? "#4f71dc" : "#5d6474" }} aria-hidden><path d={path} /></svg>
              {t(label)}
            </button>
          ))}
        </nav>

        <div className="px-[30px] pb-[20px]">
          {subTab === "overview" && (
            <>
              <SimpleTable headers={["Произведено", "Всего", "Ок", "Брак"]} rows={activity.made.map((line) => [line.name, formatAmount(line.total, line.unit), formatAmount(line.ok, line.unit), formatAmount(line.defect, line.unit)])} empty="Продукции еще не произведены" />
              <SimpleTable headers={["Затраченное сырье", "Кол-во"]} rows={activity.raw.map((line) => [line.name, formatAmount(line.amount, line.unit)])} empty="Не затрачено сырья" />
            </>
          )}
          {subTab === "logs" && (
            <SimpleTable
              headers={["Продукт / сырье", "Тип", "Кол-во", "Партия", "Дата, время"]}
              rows={activity.logs.map((row) => [
                row.name,
                `${t(row.direction === "made" ? "Продукт" : "Сырье")}${row.isDefect ? ` (${t("Брак")})` : ""}`,
                formatAmount(row.amount, row.unit),
                row.partyId ? `№ ${row.partyId}` : [row.shift, row.worker].filter(Boolean).join(", ") || "-",
                formatDateTime(row.createdAt),
              ])}
              empty="Нет записей в данной смене"
              bareWhenEmpty
            />
          )}
          {subTab === "shifts" && (
            <SimpleTable
              headers={["Дата", "Смена", "Работник", "Произведено", "Сырье"]}
              rows={activity.shifts.map((row) => [formatDate(row.date), row.shift || "-", row.worker || "-", formatNumber(row.made), formatNumber(row.raw)])}
              empty="В этом периоде не найдено смен"
              bareWhenEmpty
            />
          )}
          {subTab === "inventory" && <InventoryList inventories={inventories} />}
        </div>
      </div>

      {(dialog === "made" || dialog === "raw") && (
        <ActivityDialog
          stage={stage}
          direction={dialog}
          equipment={equipment}
          shifts={shifts}
          workers={workers}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); reload() }}
        />
      )}
      {dialog === "reconcile" && (
        <ReconcileDialog
          stage={stage}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); setSubTab("inventory"); reloadInventories() }}
        />
      )}
    </div>
  )
}

function ColorButton({ color, icon, label, onClick }: { color: string; icon: string; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button onClick={onClick} className={`flex h-[36px] items-center rounded-[3px] px-[14px] text-[13px] font-semibold text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95 ${color}`}>
      <svg viewBox="0 0 24 24" className="mr-[9px] h-[18px] w-[18px] fill-white" aria-hidden><path d={icon} /></svg>
      {t(label)}
    </button>
  )
}

function SimpleTable({ headers, rows, empty, bareWhenEmpty }: { headers: string[]; rows: string[][]; empty: string; bareWhenEmpty?: boolean }) {
  const { t } = useLanguage()
  const lastIndex = headers.length - 1
  // The reference keeps the first column wide, the middle ones left-aligned and the last one at the right edge.
  const align = (index: number) => (index > 0 && index === lastIndex ? "text-right" : "text-left")
  if (bareWhenEmpty && !rows.length) {
    return (
      <div className="-mx-[30px] flex flex-col items-center px-[30px] pb-[30px] pt-[30px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/robot-empty.png" alt="" className="w-[150px]" />
        <p className="-mt-[30px] text-[13px] text-[#666]">{t(empty)}</p>
      </div>
    )
  }
  return (
    <div className="-mx-[30px] border-[#efefef] px-[30px] pb-[10px] [&:not(:last-child)]:border-b">
      <table className="w-full table-fixed text-[13px]">
        {headers.length > 2 && (
          <colgroup>
            <col style={{ width: 558 }} />
            {headers.slice(1).map((header, index) => <col key={header} style={index < headers.length - 2 ? { width: 186 } : undefined} />)}
          </colgroup>
        )}
        <thead>
          <tr>
            {headers.map((header, index) => <th key={header} className={`h-[50px] font-semibold ${align(index)}`}>{t(header)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-dashed border-[#d9e0e5]">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`h-[50px] ${align(cellIndex)}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="relative flex flex-col items-center pb-[30px] pt-[0px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[150px]" />
          <p className="-mt-[30px] text-[13px] text-[#666]">{t(empty)}</p>
        </div>
      )}
    </div>
  )
}

function InventoryList({ inventories }: { inventories: Inventory[] }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState<number | null>(null)
  if (!inventories.length) return <RobotEmpty text="В этом периоде не найдено инвентаризаций" size={110} />
  return (
    <ul className="mt-2">
      {inventories.map((inventory) => {
        const changed = inventory.lines.filter((line) => line.difference !== 0).length
        return (
          <li key={inventory.id} className="border-b border-dashed border-slate-200">
            <button onClick={() => setOpen(open === inventory.id ? null : inventory.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left text-sm">
              <span className="font-semibold">№ {inventory.id} · {formatDate(inventory.date)}</span>
              <span className="text-slate-500">{inventory.userName}</span>
              <span>{t("Позиций")}: {inventory.lines.length}</span>
              <span className={changed ? "text-red-500" : "text-emerald-600"}>{t("Расхождений")}: {changed}</span>
            </button>
            {open === inventory.id && (
              <table className="mb-3 w-full bg-slate-50 text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="px-3 py-2">{t("Наименование")}</th>
                    <th className="px-3 py-2 text-right">{t("Ожидалось")}</th>
                    <th className="px-3 py-2 text-right">{t("Фактически")}</th>
                    <th className="px-3 py-2 text-right">{t("Разница")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.lines.map((line) => (
                    <tr key={line.key} className="border-t border-slate-200">
                      <td className="px-3 py-2">{line.name}</td>
                      <td className="px-3 py-2 text-right">{formatAmount(line.expected, line.unit)}</td>
                      <td className="px-3 py-2 text-right">{formatAmount(line.actual, line.unit)}</td>
                      <td className={`px-3 py-2 text-right ${line.difference < 0 ? "text-red-500" : line.difference > 0 ? "text-emerald-600" : ""}`}>{formatAmount(line.difference, line.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {open === inventory.id && inventory.comment && <p className="mb-3 text-sm text-slate-500">{inventory.comment}</p>}
          </li>
        )
      })}
    </ul>
  )
}

function ActivityDialog({
  stage,
  direction,
  equipment,
  shifts,
  workers,
  onClose,
  onSaved,
}: {
  stage: Stage
  direction: "made" | "raw"
  equipment: Equipment[]
  shifts: string[]
  workers: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const { data: recipes } = useApiData<Recipe[]>(direction === "made" ? `/api/production/recipes?stageId=${stage.id}` : null, [])
  const { data: stock } = useApiData<StockItem[]>(direction === "raw" ? `/api/production/items?stageId=${stage.id}` : null, [])
  const [date, setDate] = useState(todayIso())
  const [shift, setShift] = useState(shifts[0] ?? "")
  const [equipmentId, setEquipmentId] = useState("")
  const [worker, setWorker] = useState("")
  const [isDefect, setIsDefect] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!lines.length) return
    setSaving(true)
    try {
      await api("/api/production/activity", {
        method: "POST",
        body: { stageId: stage.id, direction, date, shift, equipmentId: equipmentId ? Number(equipmentId) : null, worker, items: lines.map((line) => ({ ...line, isDefect })) },
      })
      onSaved()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(direction === "made" ? "Добавление продукта" : "Добавление сырья")} tall onClose={onClose} onSubmit={save} width="max-w-[1000px]" footer={<SaveButton saving={saving} disabled={!lines.length} />}>
      <div className="-mx-[30px] -mb-[20px] -mt-[16px] flex min-h-[400px]">
        <div className="w-[250px] shrink-0 space-y-[20px] border-r border-[#efefef] px-[30px] pt-[30px]">
          <Field label="Дата использования" required><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} /></Field>
          <Field label="Смена">
            <input list="production-shifts" value={shift} onChange={(event) => setShift(event.target.value)} className={inputClass} />
            <datalist id="production-shifts">{shifts.map((value) => <option key={value} value={value} />)}</datalist>
          </Field>
          <Field label="Оборудование">
            <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
              <option value="">—</option>
              {equipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </Field>
          <Field label="Работник">
            <select value={worker} onChange={(event) => setWorker(event.target.value)} className={inputClass}>
              <option value="">—</option>
              {workers.map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={isDefect} onChange={(event) => setIsDefect(event.target.checked)} /> {t("Брак")}
          </label>
        </div>
        <div className="min-w-0 flex-1 px-[30px] pt-[24px]">
          <div className="mb-[14px] flex items-center justify-between">
            <p className="text-[13px] font-semibold">{t("Список товаров")}</p>
            <button type="button" onClick={() => setPicking((value) => !value)} className="text-[13px] text-[#333] hover:underline">{t("добавить товары")}</button>
          </div>
          {direction === "made" && !recipes.length && <p className="mb-3 text-[13px] text-[#e58a00]">{t("У этапа нет продуктов. Добавьте их во вкладке «Продукция».")}</p>}
          <ItemLinesEditor<CatalogItem> items={direction === "made" ? recipes : stock} lines={lines} onChange={setLines} showStock={direction === "raw"} hideInput={!picking} emptyText="Вы еще не выбрали ни одного товара..." />
          {!lines.length && !picking && (
            <button type="button" onClick={() => setPicking(true)} className="mx-auto mt-[-8px] block text-[13px] text-[#129fdd] hover:underline">{t("добавить товары?")}</button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ReconcileDialog({ stage, onClose, onSaved }: { stage: Stage; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { data: stock, loading } = useApiData<StockItem[]>(`/api/production/items?stageId=${stage.id}`, [])
  const [date, setDate] = useState(todayIso())
  const [comment, setComment] = useState("")
  const [showAll, setShowAll] = useState(false)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const rows = stock.filter((item) => showAll || item.available !== 0 || counts[item.key] !== undefined)

  async function save(event: FormEvent) {
    event.preventDefault()
    const lines = rows.map((item) => ({ key: item.key, actual: Number((counts[item.key] ?? String(item.available)).replace(",", ".")) })).filter((line) => Number.isFinite(line.actual) && line.actual >= 0)
    if (!lines.length) return
    setSaving(true)
    try {
      await api("/api/production/inventories", { method: "POST", body: { stageId: stage.id, date, comment, lines } })
      onSaved()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Сверить")} onClose={onClose} onSubmit={save} width="max-w-3xl" footer={<SaveButton saving={saving} disabled={!rows.length} />}>
      <div className="mb-4 grid gap-5 sm:grid-cols-2">
        <Field label="Дата" required><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} /></Field>
        <Field label="Склад"><input value={stage.warehouse || t("Не указано")} disabled className={`${inputClass} text-slate-500`} /></Field>
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /> {t("Показать все товары")}
      </label>
      {loading ? (
        <p className="py-8 text-center text-slate-400">{t("Загрузка...")}</p>
      ) : rows.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dashed border-slate-300 text-left">
              <th className="py-2">{t("Наименование")}</th>
              <th className="py-2 text-right">{t("Ожидалось")}</th>
              <th className="py-2 text-right">{t("Фактически")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key} className="border-b border-dashed border-slate-200">
                <td className="py-2">{item.name}</td>
                <td className="py-2 text-right">{formatAmount(item.available, item.unit)}</td>
                <td className="py-2 text-right">
                  <input
                    value={counts[item.key] ?? String(Math.max(0, item.available))}
                    onChange={(event) => setCounts({ ...counts, [item.key]: event.target.value })}
                    inputMode="decimal"
                    className="w-28 border-b border-slate-300 text-right outline-none focus:border-blue-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="py-8 text-center text-sm text-slate-400">{t("На складе этапа нет остатков")}</p>
      )}
      <Field label="Комментарий" className="mt-4"><input value={comment} onChange={(event) => setComment(event.target.value)} className={inputClass} /></Field>
    </Modal>
  )
}
