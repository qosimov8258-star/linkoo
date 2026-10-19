"use client"

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import {
  inventoryConditions as conditions,
  inventoryProductTypes as productTypes,
  inventoryResponsibles as responsibles,
  inventoryWarehouses as warehousesList,
  type InventoryItem,
} from "./inventory-items-data"
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  Pencil,
  Trash2,
  X,
  XCircle,
} from "lucide-react"
import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { ReportSelectField } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "серийный номер": "serialNumber", "серийный №": "serialNumber", "serial number": "serialNumber",
  "клиент": "client", "client": "client",
  "тип инвентаря": "inventoryType", "inventory type": "inventoryType",
  "инвентарный номер": "inventoryCode", "инвентарный №": "inventoryCode", "inventory code": "inventoryCode",
  "склад": "warehouse", "warehouse": "warehouse",
  "состояние": "condition", "condition": "condition",
  "ответственный": "responsible", "responsible": "responsible",
}

type MovementLog = {
  id: number
  direction: "in" | "out"
  inventoryType: string
  inventoryCode: string
  createdAt: string
  movementDate: string
  client: string
  warehouse: string
  condition: string
  type: "Новый" | "Изъятие" | "Передача"
}

type CheckLog = {
  id: number
  client: string
  createdBy: string
  checkDate: string
  inventoryType: string
  inventoryCode: string
}

type RequestRow = {
  id: number
  type: string
  client: string
  inventoryType: string
  inventory: string
  requestedBy: string
  requestDate: string
  processedBy: string
  processedDate: string
  status: "В процессе" | "Подтверждено" | "Отклонено"
}

const movementLogs: MovementLog[] = []

const checkLogs: CheckLog[] = []

const requestRows: RequestRow[] = []

type MainTab = "requests" | "warehouse" | "attached" | "all" | "movements" | "checks"

export function InventoryManagementView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<MainTab>("all")
  const [requestSubTab, setRequestSubTab] = useState<"in_progress" | "confirmed" | "rejected" | "all">("in_progress")
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/inventory-items")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить инвентарь")
        return (await response.json()) as InventoryItem[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить инвентарь с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const scopedItems = useMemo(() => {
    if (tab === "warehouse") return items.filter((item) => !item.client)
    if (tab === "attached") return items.filter((item) => item.client)
    return items
  }, [items, tab])

  const filtered = useMemo(() => {
    return scopedItems.filter((item) => {
      if (!search.trim()) return true
      const needle = search.trim().toLocaleLowerCase("ru")
      return item.inventoryType.toLocaleLowerCase("ru").includes(needle) || item.client.toLocaleLowerCase("ru").includes(needle) || item.serialNumber.includes(search.trim())
    })
  }, [scopedItems, search])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const approvedCount = scopedItems.filter((item) => item.approved).length

  const itemInput = (data: Omit<InventoryItem, "id" | "createdDate">) => ({
    serialNumber: data.serialNumber,
    client: data.client,
    inventoryType: data.inventoryType,
    inventoryCode: data.inventoryCode,
    warehouse: data.warehouse,
    condition: data.condition,
    responsible: data.responsible,
    attachDate: data.attachDate,
    checkDate: data.checkDate,
    approved: data.approved,
  })

  const toggleApproved = async (id: number) => {
    const item = items.find((current) => current.id === id)
    if (!item) return
    try {
      const response = await fetch(`/api/inventory-items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemInput({ ...item, approved: !item.approved })),
      })
      if (!response.ok) return
      const saved = (await response.json()) as InventoryItem
      setItems((current) => current.map((current_) => (current_.id === id ? saved : current_)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  const deleteItem = async (id: number) => {
    try {
      const response = await fetch(`/api/inventory-items/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setItems((current) => current.filter((item) => item.id !== id))
      setExpandedId(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  const saveItem = async (data: InventoryItem) => {
    try {
      if (data.id) {
        const response = await fetch(`/api/inventory-items/${data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemInput(data)),
        })
        if (!response.ok) {
          window.alert(t("Не удалось сохранить инвентарь"))
          return
        }
        const saved = (await response.json()) as InventoryItem
        setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      } else {
        const response = await fetch("/api/inventory-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemInput(data)),
        })
        if (!response.ok) {
          window.alert(t("Не удалось создать инвентарь"))
          return
        }
        const saved = (await response.json()) as InventoryItem
        setItems((current) => [saved, ...current])
      }
      setAddOpen(false)
      setEditItem(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const updateTransfer = async (id: number, patch: Partial<InventoryItem>) => {
    const item = items.find((current) => current.id === id)
    if (!item) return
    try {
      const response = await fetch(`/api/inventory-items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemInput({ ...item, ...patch })),
      })
      if (!response.ok) return
      const saved = (await response.json()) as InventoryItem
      setItems((current) => current.map((current_) => (current_.id === id ? saved : current_)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function importFromExcel(file: File) {
    const rows = await readExcelRows(file)
    if (!rows.length) return { created: 0, total: 0, failed: 0 }

    const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
    const hasHeader = Array.from(fieldByIndex.values()).includes("inventoryType")
    const dataRows = hasHeader ? rows.slice(1) : rows

    const parsed: ReturnType<typeof itemInput>[] = []
    for (const row of dataRows) {
      const record: Record<string, string> = {}
      if (hasHeader) {
        row.forEach((cell, index) => {
          const field = fieldByIndex.get(index)
          if (field) record[field] = cell
        })
      } else {
        record.serialNumber = row[0] ?? ""
        record.client = row[1] ?? ""
        record.inventoryType = row[2] ?? ""
        record.inventoryCode = row[3] ?? ""
        record.warehouse = row[4] ?? ""
        record.condition = row[5] ?? ""
        record.responsible = row[6] ?? ""
      }
      if (!record.inventoryType || /^(тип инвентаря|inventory type)$/i.test(record.inventoryType)) continue
      parsed.push({
        serialNumber: record.serialNumber || "",
        client: record.client || "",
        inventoryType: record.inventoryType,
        inventoryCode: record.inventoryCode || "",
        warehouse: record.warehouse || warehousesList[0],
        condition: record.condition || conditions[0],
        responsible: record.responsible || responsibles[0],
        attachDate: "",
        checkDate: "",
        approved: false,
      })
    }
    if (!parsed.length) return { created: 0, total: 0, failed: 0 }

    const created: InventoryItem[] = []
    let failed = 0
    for (const item of parsed) {
      try {
        const response = await fetch("/api/inventory-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        })
        if (response.ok) created.push((await response.json()) as InventoryItem)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (created.length) setItems((current) => [...created, ...current])
    return { created: created.length, total: parsed.length, failed }
  }

  const downloadExcel = () => {
    const header = [t("№"), t("Серийный №"), t("Клиент"), t("Тип инвентаря"), t("Склад"), t("Дата прикрепления"), t("Дата проверки")]
    const body = filtered.map((item) => [item.id, item.serialNumber, item.client, item.inventoryType, item.warehouse, item.attachDate, item.checkDate])
    downloadExcelTable("inventory", [header, ...body])
  }

  const mainTabs: { key: MainTab; label: string }[] = [
    { key: "requests", label: "Запросы" },
    { key: "warehouse", label: "На складе" },
    { key: "attached", label: "Прикрепление" },
    { key: "all", label: "Все" },
    { key: "movements", label: "История движений" },
    { key: "checks", label: "История проверки" },
  ]

  const tabLabels = mainTabs.map((item) => t(item.label))
  const tabLabel = t(mainTabs.find((item) => item.key === tab)?.label ?? "")
  const filterPanel = (
    <div className="w-[300px] bg-white p-6 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <ReportSelectField label="Склад" value={warehouseFilter} onChange={setWarehouseFilter} options={warehousesList} />
    </div>
  )
  const emptyText = t("Ничего не найдено")
  const movementRows = movementLogs.filter((log) => !search.trim() || log.inventoryType.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")))
  const checkRows = checkLogs.filter((log) => !search.trim() || log.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")))
  const toolbarFor = (total: number, withFilter: boolean) => (
    <RefToolbar
      linkFilter
      hideFilter={!withFilter}
      filterOpen={filterOpen}
      onToggleFilter={() => setFilterOpen((value) => !value)}
      filterPanel={filterPanel}
      query={search}
      onQuery={(value) => { setSearch(value); setPage(1) }}
      pageSize={pageSize}
      onPageSize={(size) => { setPageSize(size); setPage(1) }}
      from={total ? (safePage - 1) * pageSize + 1 : 0}
      to={Math.min(safePage * pageSize, total)}
      total={total}
      page={safePage}
      pageCount={Math.max(1, Math.ceil(total / pageSize))}
      onPage={setPage}
      icons={<svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]" aria-hidden><path d={RI.checklist} /></svg>}
    />
  )

  return (
    <RefPage>
      <RefHeader title={t("Работа с инвентарем")}>
        {tab !== "requests" && (
          <>
            <RefButton icon={RI.chart} label={t("Скачать Excel")} onClick={downloadExcel} />
            <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => setImportOpen(true)} />
            <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => setAddOpen(true)} />
          </>
        )}
      </RefHeader>

      <RefCard>
        <RefTabs labels={tabLabels} value={tabLabel} onChange={(label) => { const next = mainTabs.find((item) => t(item.label) === label); if (next) { setTab(next.key); setPage(1); setExpandedId(null) } }} />

        {tab === "requests" && (
          <>
            <RefTabs
              labels={[t("В процессе"), t("Подтверждено"), t("Отклонено"), t("Все")]}
              value={t(requestSubTab === "in_progress" ? "В процессе" : requestSubTab === "confirmed" ? "Подтверждено" : requestSubTab === "rejected" ? "Отклонено" : "Все")}
              onChange={(label) => setRequestSubTab(label === t("В процессе") ? "in_progress" : label === t("Подтверждено") ? "confirmed" : label === t("Отклонено") ? "rejected" : "all")}
            />
            {toolbarFor(0, false)}
            <RefTable cols="repeat(10,minmax(0,1fr))" heads={["№", "Тип", "Клиент", "Тип инвентаря", "Инвентарь", "Запросил", "Дата запроса", "Обработал", "Дата обработки", "Статус"].map((title) => t(title))} rows={requestRows} rowKey={(row) => row.id} render={() => []} empty={<RequestsEmpty text={t("По вашему запросу ничего не найдено")} />} />
          </>
        )}

        {(tab === "warehouse" || tab === "attached" || tab === "all") && (
          <>
            {loadError && <p className="px-6 py-3 text-[13px] text-red-500">{loadError}</p>}
            <div className="grid grid-cols-3 bg-[#5869f0] py-[4px] text-center text-[13px] font-semibold leading-4 text-white">
              <span>{t("Одобрено")}: {approvedCount}</span>
              <span>{t("Не одобрено")}: {scopedItems.length - approvedCount}</span>
              <span>{t("Итого")}: {scopedItems.length}</span>
            </div>
            {toolbarFor(filtered.length, true)}
            <RefTable
              cols="0.54fr repeat(6,minmax(0,1fr))"
              heads={["№", "Серийный №", "Клиент", "Тип инвентаря", "Склад", "Дата прикрепления", "Дата проверки"].map((title) => t(title))}
              rows={loading ? [] : visible}
              rowKey={(item) => item.id}
              onRowClick={(item) => setExpandedId((current) => (current === item.id ? null : item.id))}
              empty={loading ? t("Загрузка...") : emptyText}
              render={(item) => [
                item.id,
                item.serialNumber,
                <span key="c" className="text-[#4f71dc]">{item.client}</span>,
                <div key="t"><div>{item.inventoryType}</div>{item.inventoryCode && <div className="text-[#4f71dc]">{item.inventoryCode}</div>}</div>,
                item.warehouse,
                item.attachDate,
                <div key="d" className="flex items-center justify-between gap-2"><span>{item.checkDate}</span>
                  <button aria-label={item.approved ? t("Одобрено") : t("Не одобрено")} onClick={(event) => { event.stopPropagation(); toggleApproved(item.id) }}>
                    {item.approved ? <CheckCircle2 className="h-5 w-5 text-[#39ca79]" /> : <X className="h-5 w-5 text-[#f06c6c]" />}
                  </button></div>,
              ]}
              expanded={(item) => expandedId === item.id ? (
                <div className="bg-white">
                  <div onClick={(event) => event.stopPropagation()} className="border-y border-[#e1e5eb] px-9 py-7 shadow-inner">
                                            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                                              <h3 className="text-xl font-semibold">{t("№")} {item.id}</h3>
                                              <div className="flex items-center gap-3">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    downloadExcelTable(`inventory-${item.id}.xls`, [
                                                      [t("Склад"), t("Тип"), t("Состояние"), t("Клиент"), t("Серийный номер"), t("Инвентарный номер"), t("Дата прикрепления"), t("Дата создания"), t("Ответственный"), t("Одобрено")],
                                                      [item.warehouse, item.inventoryType, item.condition, item.client || "—", item.serialNumber || "—", item.inventoryCode || "—", item.attachDate, item.createdDate, item.responsible, item.approved ? t("Да") : t("Нет")],
                                                    ])
                                                  }
                                                  className="flex items-center gap-2 h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white"
                                                >
                                                  <Eye className="h-4 w-4" /> {t("Просмотреть")}
                                                </button>
                                                <button onClick={() => setTransferItem(item)} className="flex items-center gap-2 h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white"><ArrowLeftRight className="h-4 w-4" /> {t("Передача / Изъятие")}</button>
                                                <button onClick={() => setEditItem(item)} className="flex items-center gap-2 h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white"><Pencil className="h-4 w-4" /> {t("Изменить")}</button>
                                                <button aria-label={item.approved ? t("Одобрено") : t("Не одобрено")} onClick={() => toggleApproved(item.id)}>
                                                  {item.approved ? <CheckCircle2 className="h-6 w-6 text-[#39ca79]" /> : <XCircle className="h-6 w-6 text-[#9aa3b6]" />}
                                                </button>
                                                <button aria-label={t("Удалить")} onClick={() => deleteItem(item.id)}><Trash2 className="h-5 w-5 text-[#9aa3b6] hover:text-[#e5484d]" /></button>
                                              </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                                              <dl className="space-y-3 text-[15px]">
                                                <DetailRow label={t("Склад")} value={item.warehouse} />
                                                <DetailRow label={t("Тип")} value={item.inventoryType} />
                                                <DetailRow label={t("Состояние")} value={item.condition} />
                                                <DetailRow label={t("Клиент")} value={item.client || "—"} />
                                                <DetailRow label={t("Серийный номер")} value={item.serialNumber || "—"} />
                                                <DetailRow label={t("Инвентарный номер")} value={item.inventoryCode || "—"} />
                                                <DetailRow label={t("Дата прикрепления")} value={item.attachDate} />
                                                <DetailRow label={t("Дата создания")} value={item.createdDate} />
                                                <div className="flex items-baseline justify-between gap-6">
                                                  <dt className="text-[#586174]">{t("Одобрено")}</dt>
                                                  <dd>{item.approved ? <CheckCircle2 className="h-5 w-5 text-[#39ca79]" /> : <X className="h-5 w-5 text-[#e5484d]" />}</dd>
                                                </div>
                                              </dl>
                                              <div>
                                                <p className="mb-2 font-semibold uppercase tracking-wide text-[#586174]">{t("Ответственный")}:</p>
                                                <p>{item.responsible}</p>
                                              </div>
                                            </div>
                                          </div>
                </div>
              ) : null}
            />
          </>
        )}

        {tab === "movements" && (
          <>
            {toolbarFor(movementRows.length, true)}
            <RefTable
              cols="repeat(7,minmax(0,1fr))"
              heads={["Инвентарь", "Дата создания", "Дата движения", "Клиент", "Склад", "Состояние", "Тип"].map((title) => t(title))}
              rows={movementRows}
              rowKey={(log) => log.id}
              empty={emptyText}
              render={(log) => [
                <span key="i"><span className={`mr-2 inline-block ${log.direction === "in" ? "text-[#71ce87]" : "text-[#f06c6c]"}`}>{log.direction === "in" ? "↓" : "↑"}</span>{log.inventoryType} {log.inventoryCode && <span className="text-[#555]">({t("№")}{log.inventoryCode})</span>}</span>,
                log.createdAt,
                log.movementDate,
                <span key="c" className="text-[#4f71dc]">{log.client}</span>,
                log.warehouse,
                log.condition,
                t(log.type),
              ]}
            />
          </>
        )}

        {tab === "checks" && (
          <>
            {toolbarFor(checkRows.length, true)}
            <RefTable
              cols="repeat(6,minmax(0,1fr))"
              heads={["№", "Клиент", "Создал", "Дата проверки", "Инвентарь", "Изображений"].map((title) => t(title))}
              rows={checkRows}
              rowKey={(log) => log.id}
              empty={emptyText}
              render={(log) => [
                <span key="n">{log.id}<span className="block text-[12px] text-[#4f71dc]">{t("(ком.)")}</span></span>,
                log.client,
                log.createdBy,
                log.checkDate,
                <span key="i">{log.inventoryType} <span className="text-[#555]">({t("№")}{log.inventoryCode})</span></span>,
                <span key="im" className="flex h-12 w-12 items-center justify-center rounded bg-[#f2f5f8] text-[11px] text-[#999]">img</span>,
              ]}
            />
          </>
        )}
      </RefCard>

      {(addOpen || editItem) && (
        <InventoryFormModal
          mode={addOpen ? "add" : "edit"}
          item={editItem}
          onClose={() => { setAddOpen(false); setEditItem(null) }}
          onSave={saveItem}
        />
      )}

      {transferItem && (
        <TransferModal
          item={transferItem}
          onClose={() => setTransferItem(null)}
          onSave={(patch) => {
            void updateTransfer(transferItem.id, patch)
            setTransferItem(null)
          }}
        />
      )}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={importFromExcel} />}
    </RefPage>
  )
}

function RequestsEmpty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center text-[13px] text-[#777]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[120px]" />
      <span className="-mt-[10px]">{text}</span>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-[#586174]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function InventoryFormModal({
  mode,
  item,
  onClose,
  onSave,
}: {
  mode: "add" | "edit"
  item: InventoryItem | null
  onClose: () => void
  onSave: (item: InventoryItem) => void
}) {
  const { t } = useLanguage()
  const [warehouse, setWarehouse] = useState(item?.warehouse ?? "")
  const [product, setProduct] = useState(item?.inventoryType ?? "")
  const [condition, setCondition] = useState(item?.condition ?? "")
  const [responsible, setResponsible] = useState(item?.responsible ?? "")
  const [client, setClient] = useState(item?.client ?? "")
  const [serialNumber, setSerialNumber] = useState(item?.serialNumber ?? "")
  const [inventoryCode, setInventoryCode] = useState(item?.inventoryCode ?? "")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")
  const [touched, setTouched] = useState(false)

  const submit = () => {
    setTouched(true)
    if (!warehouse || !product || !condition || !serialNumber || !inventoryCode) return
    onSave({
      id: item?.id ?? 0,
      serialNumber,
      client,
      inventoryType: product,
      inventoryCode,
      warehouse,
      condition,
      responsible,
      attachDate: date,
      createdDate: item?.createdDate ?? date,
      checkDate: item?.checkDate ?? date,
      approved: item?.approved ?? false,
    })
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 py-10" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="grid w-[960px] max-w-[95vw] grid-cols-1 rounded-md bg-white shadow-2xl md:grid-cols-[1fr_320px]">
        <div className="col-span-full flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{mode === "add" ? t("Добавление инвентаря") : t("Изменение инвентаря")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </div>
        <div className="space-y-6 px-8 py-8">
          {mode === "edit" && <p className="text-xs text-[#9aa3b6]">{t("Текущий Клиент")}:</p>}
          <Field label={t("Склад")} required value={warehouse} onChange={setWarehouse} options={warehousesList} error={touched && !warehouse ? t("Обязательное поле") : ""} />
          <Field label={t("Продукт")} required value={product} onChange={setProduct} options={productTypes} error={touched && !product ? t("Обязательное поле") : ""} />
          <Field label={t("Состояние")} required value={condition} onChange={setCondition} options={conditions} error={touched && !condition ? t("Обязательное поле") : ""} />
          <Field label={t("Ответственный")} required value={responsible} onChange={setResponsible} options={responsibles} />
          <Field label={t("Клиент")} value={client} onChange={setClient} options={["Doston market", "Pepsi Market", "Usman Dembele"]} />
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Серийный номер")} <span className="text-red-500">*</span>
            <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
            {touched && !serialNumber && <p className="mt-1 text-sm text-[#e5484d]">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Инвентарный номер")} <span className="text-red-500">*</span>
            <input value={inventoryCode} onChange={(event) => setInventoryCode(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
            {touched && !inventoryCode && <p className="mt-1 text-sm text-[#e5484d]">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Дата")} <span className="text-red-500">*</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Комментарий...")} className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>
        <div className="flex items-center justify-center border-t p-8 md:border-l md:border-t-0">
          <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[#dbe0e8] text-center text-sm text-[#586174]">
            <span className="text-2xl">🖼</span> {t("Добавьте фото")}
          </div>
        </div>
        <div className="col-span-full flex justify-end border-t px-8 py-5">
          <button onClick={submit} className="font-bold uppercase tracking-wide text-[#4f71dc]">{t("Сохранить")}</button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  value,
  onChange,
  options,
  error,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  options: string[]
  error?: string
}) {
  return (
    <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
      {label} {required && <span className="text-red-500">*</span>}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
        <option value="" />
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
      {error && <p className="mt-1 text-sm text-[#e5484d]">{error}</p>}
    </label>
  )
}

function TransferModal({
  item,
  onClose,
  onSave,
}: {
  item: InventoryItem
  onClose: () => void
  onSave: (patch: Partial<InventoryItem>) => void
}) {
  const { t } = useLanguage()
  const [client, setClient] = useState("")
  const [date, setDate] = useState("")
  const [condition, setCondition] = useState(item.condition)
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{t("Передача / Изъятие")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-6 px-8 py-7">
          <h3 className="font-bold uppercase tracking-wide text-[#586174]">{t("Информация")}:</h3>
          <DetailRow label={t("Тип")} value={item.inventoryType} />
          <DetailRow label={t("Серийный номер")} value={item.serialNumber || "—"} />
          <DetailRow label={t("Инвентарный номер")} value={item.inventoryCode || "—"} />
          <h3 className="pt-3 font-bold uppercase tracking-wide text-[#586174]">{t("Передача")}</h3>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Передать клиенту")}
            <select value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>Doston market</option><option>Pepsi Market</option><option>Usman Dembele</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Дата передачи")}
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Состояние")}
            <select value={condition} onChange={(event) => setCondition(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              {conditions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Комментарий...")} className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button
            onClick={() => onSave({ client, condition, attachDate: date || item.attachDate })}
            className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white"
          >
            {t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (file: File) => Promise<{ created: number; total: number; failed: number }> }) {
  const { t } = useLanguage()
  const [agent, setAgent] = useState("")
  const [zone, setZone] = useState("")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    if (!importFile) return
    setImporting(true)
    try {
      const { created, total, failed } = await onImport(importFile)
      if (!total) window.alert(t("Не удалось найти инвентарь для импорта в выбранном файле"))
      else if (failed) window.alert(`${t("Импортировано")} ${created} ${t("из")} ${total}. ${t("Не удалось сохранить")}: ${failed}`)
      onClose()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[520px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{t("Импорт с Excel")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Агент")}
            <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {responsibles.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Зона")}
            <select value={zone} onChange={(event) => setZone(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>Andijon shaharchasi</option><option>chilonzor</option><option>Yunusobod</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <button
            type="button"
            onClick={() => downloadExcelTable("inventory-import-template.xls", [[t("Серийный номер"), t("Клиент"), t("Тип инвентаря"), t("Инвентарный номер"), t("Склад"), t("Состояние"), t("Ответственный")]])}
            className="block w-full text-center font-semibold text-[#4f71dc]"
          >
            1. {t("Скачать шаблон")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setImportFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[#dbe0e8] text-center text-sm text-[#586174]"
          >
            <FileText className="h-8 w-8" />
            <span>{importFile ? importFile.name : <>{t("Добавьте файл Excel или")} <span className="text-[#4f71dc]">{t("нажмите для выбора")}</span></>}</span>
          </button>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button
            onClick={handleSave}
            disabled={!importFile || importing}
            className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {importing ? t("Импорт...") : t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default InventoryManagementView
