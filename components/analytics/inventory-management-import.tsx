"use client"

import { useRef, useState } from "react"
import { Download, FileSpreadsheet } from "lucide-react"

import { buildCashQuery } from "@/components/analytics/cash/use-cash"
import { CashModal, MultiPick, PrimaryButton, SecondaryButton } from "@/components/analytics/cash-management-shared"
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [agents, setAgents] = useState<string[]>([])
  const [zones, setZones] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [error, setError] = useState("")
  const [details, setDetails] = useState<string[]>([])
  const named = (values: string[]) => values.map((value) => ({ value, label: value }))

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

  return (
    <CashModal
      title={t("Импорт с Excel")}
      onClose={onClose}
      size="sm"
      zIndex={150}
      footer={
        <>
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton busy={busy} disabled={!file} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[14px]">
        <MultiPick label={t("Агент")} options={named(options?.agents ?? [])} value={agents} onChange={setAgents} />
        <MultiPick label={t("Зона")} options={named(options?.zones ?? [])} value={zones} onChange={setZones} />
        {!agents.length && !zones.length && <p className="text-[13px] text-[#9aa3b6]">{t("Выберите агента и зону")}</p>}
        <button type="button" disabled={templateBusy} onClick={() => void downloadTemplate()} className="flex items-center justify-center gap-2 rounded-md px-4 py-2 font-medium text-[rgb(129,199,132)] hover:bg-[#f4fbf4] disabled:opacity-50">
          <Download className="h-5 w-5" /> {t("1. Скачать шаблон")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError("")
            setDetails([])
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[#81c784] px-4 py-6 font-medium text-[rgb(129,199,132)] hover:bg-[#f4fbf4]"
        >
          <FileSpreadsheet className="h-5 w-5" />
          {file ? `${t("2. Сменить файл")}: ${file.name}` : t("2. Заполните excel и загрузите")}
        </button>
        {error && <p className="rounded-md bg-[#fdecec] px-3 py-2 text-[13px] text-[#d64545]">{error}</p>}
        {details.length > 0 && (
          <ul className="max-h-40 list-disc overflow-auto pl-5 text-[13px] text-[#d64545]">
            {details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </CashModal>
  )
}
