"use client"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { CalendarClock, ClipboardCheck, ClipboardList, Filter, Package, PackagePlus, RefreshCcw, ShieldCheck } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
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

const SUB_TABS: Array<[SubTab, string, typeof ClipboardList]> = [
  ["overview", "Общий", ClipboardList],
  ["logs", "Записи", CalendarClock],
  ["shifts", "Смены", RefreshCcw],
  ["inventory", "Инвентаризация", ClipboardCheck],
]

export function ActivityTab({ stage, equipment, staff }: { stage: Stage; equipment: Equipment[]; staff: StaffMember[] }) {
  const { t } = useLanguage()
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(todayIso())
  const [subTab, setSubTab] = useState<SubTab>("overview")
  const [filterOpen, setFilterOpen] = useState(false)
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
    <div className="mt-5">
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <ColorButton color="bg-[#f0856a]" icon={<ShieldCheck className="h-4 w-4" />} label="Сверить" onClick={() => setDialog("reconcile")} />
        <ColorButton color="bg-[#5cc6a4]" icon={<PackagePlus className="h-4 w-4" />} label="Добавить продукт" onClick={() => setDialog("made")} />
        <ColorButton color="bg-[#5d6be0]" icon={<Package className="h-4 w-4" />} label="Добавить сырье" onClick={() => setDialog("raw")} />
      </div>

      <div className="relative bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-[#4f70e7]">
            <span className="text-sm text-slate-500">{t("Выберите период")}:</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="border-b border-slate-300 bg-transparent outline-none" />
            <span>—</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="border-b border-slate-300 bg-transparent outline-none" />
          </div>
          <button onClick={() => { setDraft(filters); setFilterOpen((value) => !value) }} className="flex items-center gap-2 rounded bg-[#5b7ce6] px-4 py-2 text-sm font-semibold text-white">
            <Filter className="h-4 w-4" /> {t("Фильтр")}
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

        <nav className="grid grid-cols-2 border-b sm:grid-cols-4">
          {SUB_TABS.map(([value, label, Icon]) => (
            <button key={value} onClick={() => setSubTab(value)} className={`flex items-center justify-center gap-2 border-b-2 py-3 text-sm ${subTab === value ? "border-blue-600 text-blue-600" : "border-transparent text-slate-600"}`}>
              <Icon className="h-4 w-4" /> {t(label)}
            </button>
          ))}
        </nav>

        <div className="px-5 pb-6">
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
              empty="Записей нет"
            />
          )}
          {subTab === "shifts" && (
            <SimpleTable
              headers={["Дата", "Смена", "Работник", "Произведено", "Сырье"]}
              rows={activity.shifts.map((row) => [formatDate(row.date), row.shift || "-", row.worker || "-", formatNumber(row.made), formatNumber(row.raw)])}
              empty="В этом периоде не найдено смен"
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

function ColorButton({ color, icon, label, onClick }: { color: string; icon: ReactNode; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95 ${color}`}>
      {icon} {t(label)}
    </button>
  )
}

function SimpleTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  const { t } = useLanguage()
  return (
    <div className="mt-2 border-b border-slate-200 pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-dashed border-slate-300 text-left">
            {headers.map((header, index) => <th key={header} className={`py-3 font-semibold ${index ? "text-right" : ""}`}>{t(header)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-dashed border-slate-200">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`py-3 ${cellIndex ? "text-right" : ""}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <RobotEmpty text={empty} size={110} />}
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
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(direction === "made" ? "Добавление продукта" : "Добавление сырья")} tall onClose={onClose} onSubmit={save} width="max-w-3xl" footer={<SaveButton saving={saving} disabled={!lines.length} />}>
      <div className="mb-5 grid gap-5 sm:grid-cols-2">
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
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isDefect} onChange={(event) => setIsDefect(event.target.checked)} /> {t("Брак")}
      </label>
      {direction === "made" && !recipes.length && <p className="mb-3 text-sm text-amber-600">{t("У этапа нет продуктов. Добавьте их во вкладке «Продукция».")}</p>}
      <ItemLinesEditor<CatalogItem> items={direction === "made" ? recipes : stock} lines={lines} onChange={setLines} showStock={direction === "raw"} />
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
      window.alert((error as Error).message)
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
