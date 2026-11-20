"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { askDelete } from "@/lib/ask-confirm"
import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { ExcelRowImportDialog, type ExcelImportSpec } from "@/components/analytics/excel-row-import"
import { RI, RefButton, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { downloadExcelTable } from "@/lib/excel-export"
import { importKey, postJson, repeatedInFile, type ImportRowError, type PreparedRow } from "@/lib/excel-row-import"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

import { SupplierDetail } from "./supplier-detail"
import { SupplierFormModal } from "./supplier-form-modal"
import { SupplierReserveDialog } from "./supplier-reserve-dialog"
import type { Supplier } from "./suppliers-data"

// Склад → Поставщики (Linko's #/provider): the list (Id, Наименование, Категория, Дата создания; newest first, the
// values in semibold), the search (name or id, see matchesSearch), the card of a supplier opened in place of its row
// (supplier-detail.tsx) and the dialogs. The address keeps the state as Linko's does:
// - /analytics/suppliers/33 = the opened card (Linko: #/provider/33), the list's query kept;
// - pageSize, page, search; openCreateDialog / openUpdateDialog / providerReserveOpen (true while open, false once
//   closed).

const BASE = "/analytics/suppliers"
const PAGE_SIZES = [10, 25, 50, 100, 200, 500]

/** One row of "Импортировать" (Excel; ours, not in Linko): created through POST /api/suppliers like the form. */
type SupplierImport = { name: string; category: string; address: string; branch: string; organization: string; contacts: [] }

/** Stored names of a reference list by comparison key. */
async function namesOf(url: string): Promise<Map<string, string>> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("load")
  const body = (await response.json()) as unknown
  const names = new Map<string, string>()
  for (const item of Array.isArray(body) ? (body as Array<{ name?: string }>) : []) if (item.name && !names.has(importKey(item.name))) names.set(importKey(item.name), item.name)
  return names
}

// Linko's provider search (probed on its server): the id contains the text, or the name does with Latin letters read as
// Cyrillic on both sides («тест» finds «ABC TEST», «ooo» finds «ООО АБВ»; «x» reads «кс», so «хитой» misses «xitoy»).
const LATIN: Record<string, string> = { a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "й", z: "з" }
const cyrillic = (text: string) => text.toLocaleLowerCase("ru").replace(/[a-z]/g, (letter) => LATIN[letter] ?? letter)
function matchesSearch(row: Supplier, query: string) {
  const term = query.trim()
  if (!term) return true
  return String(row.id).includes(term) || row.name.toLocaleLowerCase("ru").includes(term.toLocaleLowerCase("ru")) || cyrillic(row.name).includes(cyrillic(term))
}

const cardIdOf = (pathname: string | null) => {
  const match = /^\/analytics\/suppliers\/(\d{1,10})\/?$/.exec(pathname ?? "")
  const id = match ? Number(match[1]) : NaN
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Writes the address (keys sorted, as Linko's query-string does); typing in the search replaces the entry. */
function pushAddress(path: string, patch: Record<string, string | null>, replace = false) {
  if (typeof window === "undefined" || !window.location.pathname.startsWith(BASE)) return
  const params = new URLSearchParams(window.location.search)
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) params.delete(name)
    else params.set(name, value)
  }
  params.sort()
  const query = params.toString()
  const url = `${path}${query ? `?${query}` : ""}`
  if (url === `${window.location.pathname}${window.location.search}`) return
  if (replace) window.history.replaceState(null, "", url)
  else window.history.pushState(null, "", url)
}

export function SuppliersView() {
  const { t, language } = useLanguage()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [rows, setRows] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])
  const canImport = useCanManage(["procurement.manage"])

  const openedId = cardIdOf(pathname)
  const search = searchParams.get("search") ?? ""
  const sizeParam = Number(searchParams.get("pageSize"))
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 25
  const pageParam = Number(searchParams.get("page"))
  const createOpen = searchParams.get("openCreateDialog") === "true"
  const updateOpen = openedId !== null && searchParams.get("openUpdateDialog") === "true"
  const reserveOpen = openedId !== null && searchParams.get("providerReserveOpen") === "true"

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/suppliers", { cache: "no-store" })
      if (!response.ok) throw new Error("failed")
      setRows((await response.json()) as Supplier[])
      setLoadError("")
    } catch {
      setLoadError("Не удалось загрузить поставщиков с сервера")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const importSpec: ExcelImportSpec<SupplierImport> = {
    templateName: "suppliers-template",
    columns: [
      { field: "name", header: "Название", aliases: ["Наименование", "Поставщик", "Name"] },
      { field: "category", header: "Категория", aliases: ["Category"] },
      { field: "address", header: "Адрес", aliases: ["Местоположение", "Address"] },
      { field: "branch", header: "Филиал", aliases: ["Branch"] },
      { field: "organization", header: "Организация", aliases: ["Organization"] },
    ],
    keyField: "name",
    prepare: async (records) => {
      // Category, branch and organization must exist (by name); they are sent as stored.
      const [categoriesByKey, branchesByKey, organizationsByKey] = await Promise.all([namesOf("/api/supplier-categories"), namesOf("/api/branches"), namesOf("/api/organizations")])
      const prepared: PreparedRow<SupplierImport>[] = []
      const errors: ImportRowError[] = []
      for (const { line, values } of records) {
        const label = values.name || t("Название")
        const category = categoriesByKey.get(importKey(values.category))
        const branch = values.branch ? branchesByKey.get(importKey(values.branch)) : ""
        const organization = values.organization ? organizationsByKey.get(importKey(values.organization)) : ""
        if (!values.name) errors.push({ line, label, message: "Название обязательно" })
        else if (!values.category) errors.push({ line, label, message: "Выберите категорию" })
        else if (!category) errors.push({ line, label: `${label}, ${values.category}`, message: "Категория не найдена" })
        else if (!values.address) errors.push({ line, label, message: "Адрес обязателен" })
        else if (branch === undefined) errors.push({ line, label: `${label}, ${values.branch}`, message: "Филиал не найден" })
        else if (organization === undefined) errors.push({ line, label: `${label}, ${values.organization}`, message: "Организация не найдена" })
        else prepared.push({ line, label, item: { name: values.name, category, address: values.address, branch, organization, contacts: [] } })
      }
      return { rows: prepared, errors: [...errors, ...repeatedInFile(prepared, (row) => importKey(row.item.name))] }
    },
    send: (item) => postJson("/api/suppliers", item),
    fallbackError: "Не удалось сохранить поставщика",
  }

  const filtered = useMemo(() => rows.filter((row) => matchesSearch(row, search)), [rows, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1, pageCount)
  const start = (page - 1) * pageSize
  const end = Math.min(start + pageSize, filtered.length)
  const visible = filtered.slice(start, end)
  const opened = openedId !== null ? (rows.find((row) => row.id === openedId) ?? null) : null

  const listPath = () => BASE
  const cardPath = (id: number) => `${BASE}/${id}`

  function openCard(id: number | null) {
    pushAddress(id === null ? listPath() : cardPath(id), {})
  }

  const setDialog = (name: "openCreateDialog" | "openUpdateDialog" | "providerReserveOpen", open: boolean) => pushAddress(window.location.pathname, { [name]: open ? "true" : "false" })

  async function removeRow(row: Supplier) {
    if (!(await askDelete(row.name))) return
    try {
      const response = await fetch(`/api/suppliers/${row.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setNotice({ text: t(data.error || "Удаление невозможно из-за связи с другими данными"), tone: "error" })
        return
      }
      setRows((current) => current.filter((item) => item.id !== row.id))
      pushAddress(listPath(), {})
      setNotice({ text: "Успешно удалено", tone: "success" })
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadList() {
    downloadExcelTable("Поставщики", [
      ["Id", t("Наименование"), t("Категория"), t("Дата создания")],
      ...filtered.map((row) => [row.id, row.name, row.category, formatDateText(row.createdDate, language)]),
    ])
  }

  const notSet = (value: string) => (value.trim() ? value : t("Не указано"))
  const importButton = canImport ? <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => setImportOpen(true)} /> : null

  return (
    <RefPage>
      <RefHeader title={t("Поставщики")}>
        {importButton}
        {/* Linko's button sits 8 px in from the right edge, with the hint «Добавить поставщика». */}
        <span className="mr-[8px]" title={t("Добавить поставщика")}>
          <RefButton green icon={RI.add} label={t("Добавить")} onClick={() => setDialog("openCreateDialog", true)} />
        </span>
      </RefHeader>
      <SplitDetailList
        rows={visible}
        selectedKey={openedId}
        rowKey={(row) => row.id}
        toolbar={
          <RefToolbar
            hideFilter
            query={search}
            onQuery={(value) => pushAddress(window.location.pathname, { search: value || null, page: null }, true)}
            pageSize={pageSize}
            onPageSize={(size) => pushAddress(window.location.pathname, { pageSize: String(size), page: null })}
            from={filtered.length ? start + 1 : 0}
            to={end}
            total={filtered.length}
            page={page}
            pageCount={pageCount}
            onPage={(next) => pushAddress(window.location.pathname, { page: next > 1 ? String(next) : null })}
            icons={
              <button type="button" title={t("Скачать Excel")} aria-label={t("Скачать")} onClick={downloadList} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.download} /></svg>
              </button>
            }
          />
        }
        detailClassName="-mx-[15px] my-[20px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
        detail={(row) => (
          <SupplierDetail
            supplier={row}
            onClose={() => openCard(null)}
            onReserve={() => setDialog("providerReserveOpen", true)}
            onEdit={() => setDialog("openUpdateDialog", true)}
            onDelete={() => void removeRow(row)}
          />
        )}
        tableProps={{
          cols: "97fr 380fr 230fr 200fr",
          heads: ["Id", t("Наименование"), t("Категория"), t("Дата создания")],
          rowKey: (row) => row.id,
          onRowClick: (row) => openCard(row.id),
          empty: loading ? t("Загрузка поставщиков...") : t(loadError) || t("По вашему запросу ничего не найдено"),
          // Linko's rows are links: every value in semibold.
          render: (row) => [
            <span key="id" className="font-semibold">{row.id}</span>,
            <span key="name" className="font-semibold">{row.name}</span>,
            <span key="category" className="font-semibold">{notSet(row.category)}</span>,
            <span key="date" className="font-semibold" data-no-translate>{formatDateText(row.createdDate, language)}</span>,
          ],
        }}
      />

      {(createOpen || (updateOpen && opened)) && (
        <SupplierFormModal
          key={createOpen ? "create" : `update-${opened?.id}`}
          supplier={createOpen ? null : opened}
          onClose={() => setDialog(createOpen ? "openCreateDialog" : "openUpdateDialog", false)}
          onSaved={(saved) => {
            setRows((current) => (current.some((row) => row.id === saved.id) ? current.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...current]))
            setDialog(createOpen ? "openCreateDialog" : "openUpdateDialog", false)
            setNotice({ text: "Успешно сохранено", tone: "success" })
          }}
        />
      )}

      {reserveOpen && opened && (
        <SupplierReserveDialog
          supplier={opened}
          onClose={() => setDialog("providerReserveOpen", false)}
          onSaved={(saved) => {
            setRows((current) => current.map((item) => (item.id === saved.id ? saved : item)))
            setDialog("providerReserveOpen", false)
            setNotice({ text: "Успешно сохранено", tone: "success" })
          }}
        />
      )}

      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={() => void reload()}
          onDone={(summary) => {
            setImportOpen(false)
            notify(summary)
          }}
        />
      )}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </RefPage>
  )
}
