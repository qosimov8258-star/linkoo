"use client"

import { useState } from "react"

import { buildCashQuery } from "@/components/analytics/cash/use-cash"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { RefImportDialog } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import type { InventoryImportRow, InventoryOptions, InventoryTemplateClient } from "@/lib/inventory-items-types"

// Demo "Импорт с Excel" of the gear page (module 4864): Агент + Зона, "1. Скачать
// шаблон" (the clients of those agents / zones, demo market/export_gear_excel),
// "2. Заполните excel и загрузите", Сохранить (demo main/gear/import_excel).

const COLUMNS: Array<[string, string]> = [
  ["clientId", "ID клиента"],
  ["client", "Клиент"],
  ["zone", "Зона"],
  ["agent", "Агент"],
  ["product", "Тип инвентаря"],
  ["serialNumber", "Серийный номер"],
  ["stockNumber", "Инвентарный номер"],
  ["warehouse", "Склад"],
  ["condition", "Состояние"],
  ["date", "Дата"],
  ["comment", "Комментарий"],
]

const ALIASES: Record<string, string> = {
  "id клиента": "clientId",
  "client id": "clientId",
  "клиент": "client",
  "client": "client",
  "mijoz": "client",
  "тип инвентаря": "product",
  "инвентарь": "product",
  "продукт": "product",
  "inventory type": "product",
  "серийный номер": "serialNumber",
  "серийный": "serialNumber",
  "serial number": "serialNumber",
  "инвентарный номер": "stockNumber",
  "инвентарный": "stockNumber",
  "inventory number": "stockNumber",
  "склад": "warehouse",
  "warehouse": "warehouse",
  "ombor": "warehouse",
  "состояние": "condition",
  "condition": "condition",
  "дата": "date",
  "date": "date",
  "sana": "date",
  "комментарий": "comment",
  "comment": "comment",
  "izoh": "comment",
}

export function InventoryImportDialog({ options, onClose, onDone }: { options: InventoryOptions | null; onClose: () => void; onDone: (created: number) => void }) {
  const { t } = useLanguage()
  const [agents, setAgents] = useState<string[]>([])
  const [zones, setZones] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [error, setError] = useState("")
  const [details, setDetails] = useState<string[]>([])

  const downloadTemplate = async () => {
    setTemplateBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/inventory-items/import/template?${buildCashQuery({ agent: agents, zone: zones })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as InventoryTemplateClient[] | { error?: string } | null
      if (!response.ok || !Array.isArray(body)) throw new Error((body as { error?: string } | null)?.error || `HTTP ${response.status}`)
      const rows = body.map((client) => [client.id, client.name, client.zone, client.agent, "", "", "", "", "", "", ""])
      downloadExcelTable(t("Шаблон инвентаря"), [COLUMNS.map(([, label]) => t(label)), ...rows])
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setTemplateBusy(false)
    }
  }

  const submit = async () => {
    if (!file) return setError(t("Выберите файл"))
    setBusy(true)
    setError("")
    setDetails([])
    const sheet = await readExcelRows(file)
    const aliases: Record<string, string> = { ...ALIASES }
    for (const [key, label] of COLUMNS) aliases[normalizeHeader(t(label))] = key
    const columns = sheet.length ? mapHeaderColumns(sheet[0], aliases) : new Map<number, string>()
    const fields = new Map([...columns].map(([index, field]) => [field, index]))
    if (!fields.has("product")) {
      setBusy(false)
      return setError(t("В файле нет колонки «Тип инвентаря»"))
    }
    const cell = (row: string[], field: string) => (fields.has(field) ? (row[fields.get(field)!] ?? "") : "")
    const rows: InventoryImportRow[] = sheet.slice(1).map((row, index) => ({
      line: index + 2,
      clientId: cell(row, "clientId"),
      client: cell(row, "client"),
      product: cell(row, "product"),
      serialNumber: cell(row, "serialNumber"),
      stockNumber: cell(row, "stockNumber"),
      warehouse: cell(row, "warehouse"),
      condition: cell(row, "condition"),
      date: cell(row, "date"),
      comment: cell(row, "comment"),
    }))
    try {
      const response = await fetch("/api/inventory-items/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) })
      const body = (await response.json().catch(() => null)) as { created?: number; error?: string; lines?: Array<{ line: number; error: string }> } | null
      setBusy(false)
      if (response.ok && body) return onDone(body.created ?? 0)
      setError(response.status === 403 ? t("Недостаточно прав") : t(body?.error || `HTTP ${response.status}`))
      if (body?.lines?.length) setDetails(body.lines.map((line) => `${t("Строка")} ${line.line}: ${t(line.error)}`))
    } catch {
      setBusy(false)
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  // Linko's «ИМПОРТ С EXCEL» of the gear page (#/inventory-management?excelImportCreateDialog=true): Агент and Зона as
  // the reference's selects, «1. СКАЧАТЬ ШАБЛОН» (the clients of the chosen agents / zones), the drop area and a green
  // «СОХРАНИТЬ».
  const pick = (values: string[]): RefSelectItem[] => values.map((value) => ({ value, label: value }))
  return (
    <RefImportDialog
      file={file}
      onFile={(next) => {
        setFile(next)
        setError("")
        setDetails([])
      }}
      onTemplate={() => !templateBusy && void downloadTemplate()}
      onSave={() => void submit()}
      onClose={onClose}
      saving={busy}
      top={
        <div className="mb-[10px]">
          <RefSearchSelect multi label={t("Агент")} rowHeight={32} items={pick(options?.agents ?? [])} selected={pick(agents)} onChange={(next) => setAgents(next.map((item) => item.value))} />
          <RefSearchSelect multi label={t("Зона")} rowHeight={32} items={pick(options?.zones ?? [])} selected={pick(zones)} onChange={(next) => setZones(next.map((item) => item.value))} />
        </div>
      }
      error={
        error || details.length ? (
          <>
            {error && <p>{error}</p>}
            {details.length > 0 && (
              <ul className="max-h-40 list-disc overflow-auto pl-5">
                {details.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </>
        ) : undefined
      }
    />
  )
}
