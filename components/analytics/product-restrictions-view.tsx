"use client"

import { Check, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { RefPager } from "@/components/ref/pager-controls"
import { RefTabStrip } from "@/components/ref/tab-strip"
import { useLanguage } from "@/lib/i18n/language-context"

import { ProductPickerDialog, type PickerItem } from "./product-picker-dialog"

type Restriction = { id: number; employee: string; items: string[] }
type Tab = "products" | "types"
type Mode = "add" | "remove" | "replace"

function SolidIcon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden="true"><path d={d} /></svg>
}
const ICON_BOX = [
  "M247,250.3l1.9,0.8l8.7-4.1c0.1,0,0.1-0.1,0.1-0.2s0-0.1-0.1-0.2l-1.5-0.7c0,0-0.1,0-0.1,0l-8.9,3.9 c-0.1,0-0.1,0.1-0.1,0.2S247,250.2,247,250.3z",
  "M255.5,255l-3.3-1.5v4.7c0,0,0,0.1-0.1,0.1c0,0,0,0-0.1,0c0,0,0,0-0.1,0l-3.5-1.7c0,0-0.1-0.1-0.1-0.1v-4.7l-2.1-0.9 c-0.1,0-0.1,0-0.2,0c-0.1,0-0.1,0.1-0.1,0.1v10.6c0,0.1,0,0.1,0.1,0.2l9.2,4.2c0,0,0.1,0,0.1,0c0,0,0.1,0,0.1,0 c0.1,0,0.1-0.1,0.1-0.1v-10.6C255.6,255.1,255.5,255.1,255.5,255z",
  "M265.9,250.9c-0.1,0-0.1,0-0.2,0l-9.2,4.2c-0.1,0-0.1,0.1-0.1,0.2v10.6c0,0.1,0,0.1,0.1,0.1c0,0,0.1,0,0.1,0 c0,0,0.1,0,0.1,0l9.2-4.2c0.1,0,0.1-0.1,0.1-0.2V251C266,251,266,250.9,265.9,250.9z",
  "M265.1,250.1c0-0.1,0-0.1-0.1-0.2l-3.1-1.4c0,0-0.1,0-0.1,0l-8.9,4.2l3.1,1.5c0,0,0,0,0.1,0c0,0,0.1,0,0.1,0l8.9-4 C265,250.2,265.1,250.2,265.1,250.1z",
]
const ICON_TRASH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const ICON_SHIELD = "M19 1H5c-1.1 0-1.99.9-1.99 2L3 15.93c0 .69.35 1.3.88 1.66L12 23l8.11-5.41c.53-.36.88-.97.88-1.66L21 3c0-1.1-.9-2-2-2zm-9 15l-5-5 1.41-1.41L10 13.17l7.59-7.59L19 7l-9 9z"
const ICON_EYE_OFF = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
const ICON_DONE_ALL = "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
const ICON_LIST_CHECK = "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z"

const nameCollator = new Intl.Collator("en", { caseFirst: "lower" })
const nameKey = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "")

/** The original lists product types alphabetically, ignoring case and punctuation (Latin before Cyrillic). */
function sortByName(items: PickerItem[]) {
  return [...items].sort((a, b) => nameCollator.compare(nameKey(a.name), nameKey(b.name)))
}

const copy = {
  products: {
    tab: "По продуктам",
    count: "Количество продуктов",
    add: "Добавить продукты",
    remove: "Убрать продукты",
    titles: { add: "Добавить продукты", remove: "Убрать продукты", replace: "Установить продукты" },
  },
  types: {
    tab: "По типам продуктов",
    count: "Количество тип продуктов",
    add: "Добавить тип продукты",
    remove: "Убрать тип продукты",
    titles: { add: "Добавить тип продукты", remove: "Убрать тип продукты", replace: "Установить тип продукты" },
  },
} as const

export function ProductRestrictionsView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<Tab>("products")
  const [rows, setRows] = useState<Record<Tab, Restriction[]>>({ products: [], types: [] })
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])
  const [dialog, setDialog] = useState<Mode | null>(null)
  const [products, setProducts] = useState<PickerItem[] | null>(null)
  const [productTypes, setProductTypes] = useState<PickerItem[] | null>(null)
  const [error, setError] = useState("")

  const restrictions = rows[tab]

  function loadRestrictions(scope: Tab) {
    return fetch(`/api/product-restrictions?scope=${scope}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed")
        return (await response.json()) as Restriction[]
      })
      .then((data) => setRows((current) => ({ ...current, [scope]: data })))
      .catch(() => {})
  }

  useEffect(() => {
    void loadRestrictions(tab)
  }, [tab])

  // Catalogues are only needed once a dialog opens.
  useEffect(() => {
    if (!dialog) return
    const load = (url: string) => fetch(url).then((response) => (response.ok ? response.json() : []))
    if (tab === "products" && !products) load("/api/products").then((data: Array<PickerItem & { deleted?: boolean; isInventory?: boolean }>) =>
      // The reference's list (main/product/for_select/) leaves out deleted products and inventory items.
      setProducts(data.filter((item) => !item.deleted && !item.isInventory)))
    if (tab === "types" && !productTypes) load("/api/product-types").then((data: PickerItem[]) => setProductTypes(sortByName(data)))
  }, [dialog, tab, products, productTypes])

  const filtered = useMemo(() => restrictions.filter((row) => row.employee.toLowerCase().includes(query.toLowerCase())), [restrictions, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const allChecked = visible.length > 0 && visible.every((row) => checked.includes(row.id))

  function switchTab(next: Tab) {
    setTab(next)
    setPage(1)
    setChecked([])
    setQuery("")
  }

  function toggleSelectMode() {
    setSelectMode((current) => !current)
    setChecked([])
  }

  /** Applies the operation to the checked rows only. As in the original, nothing is sent when no row is checked. */
  async function apply(mode: Mode, items: string[]) {
    setError("")
    const targets = restrictions.filter((row) => checked.includes(row.id)).map((row) => row.employee)
    if (!targets.length) return true
    try {
      const responses = await Promise.all(
        targets.map((employee) =>
          fetch("/api/product-restrictions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope: tab, employee, mode, items }),
          }),
        ),
      )
      if (responses.some((response) => !response.ok)) throw new Error("save failed")
      await loadRestrictions(tab)
      setChecked([])
      return true
    } catch {
      setError(t("Не удалось сохранить ограничения"))
      return false
    }
  }

  const labels = copy[tab]
  const gridCols = selectMode ? "grid-cols-[474.67px_1fr_1fr]" : "grid-cols-3"
  const actionBtn = "flex h-9 items-center whitespace-nowrap rounded-[5px] pl-3 text-[13px] font-semibold leading-9 text-white hover:brightness-95"

  return (
    <RefPage>
      <RefHeader title={t("Ограничение продуктов")} titleTop={1} />

      <div className="relative">
        <RefTabStrip
          tabs={[{ value: "products", label: copy.products.tab }, { value: "types", label: copy.types.tab }]}
          value={tab}
          onChange={switchTab}
          weightClass="font-medium"
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#f1f4f7]" />
      </div>

      <section className="relative z-20 bg-white [box-shadow:0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative flex h-[50px] items-center whitespace-nowrap px-[5px]">
          <div className="absolute left-[377.5px] top-0 flex h-[40px] w-[300px] items-start border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder={t("Поиск")}
              className="h-12 w-[262px] shrink-0 bg-transparent text-[13px] outline-none placeholder:text-black/30"
            />
            <svg viewBox="0 0 24 24" className="ml-[12px] mt-[12px] h-6 w-6 shrink-0 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </div>

          <div className="relative z-10 ml-auto flex shrink-0 items-center text-[#5d6474]">
            <RefPager
              flushMenu
              pageSize={pageSize}
              onPageSize={(size) => { setPageSize(size); setPage(1) }}
              from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
              to={Math.min(safePage * pageSize, filtered.length)}
              total={filtered.length}
              page={safePage}
              pageCount={pageCount}
              onPage={setPage}
            />

            <div className="group relative ml-5 shrink-0">
              <button type="button" onClick={toggleSelectMode} aria-label={t("Выбрать из списка")} className="flex h-12 w-12 items-center justify-center">
                <SolidIcon d={selectMode ? ICON_EYE_OFF : ICON_LIST_CHECK} className="h-6 w-6 text-[#5d6474]" />
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-[5px]">
              <button type="button" onClick={() => setDialog("add")} className={`${actionBtn} bg-[#4db6ac]`}>
                <svg viewBox="244 244 24 24" className="h-6 w-6 fill-current" aria-hidden="true">{ICON_BOX.map((d) => <path key={d} d={d} />)}</svg><span className="pl-2 pr-4">{t(labels.add)}</span>
              </button>
              <button type="button" onClick={() => setDialog("remove")} className={`${actionBtn} bg-[#ff8a65]`}>
                <SolidIcon d={ICON_TRASH} className="h-6 w-6" /><span className="pl-2 pr-4">{t(labels.remove)}</span>
              </button>
              <button type="button" onClick={() => setDialog("replace")} className={`${actionBtn} bg-[#4f71dc]`}>
                <SolidIcon d={ICON_SHIELD} className="h-6 w-6" /><span className="pl-2 pr-4">{t("Стереть и добавить")}</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`grid h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white ${gridCols}`}>
          <div className="flex items-center">
            {selectMode && (
              <button
                type="button"
                onClick={() => setChecked(allChecked ? [] : visible.map((row) => row.id))}
                aria-label={t("Выбрать все")}
                className="-ml-[10px] mr-[6px] flex h-6 w-6 items-center justify-center"
              >
                <SolidIcon d={ICON_DONE_ALL} className="h-6 w-6" />
              </button>
            )}
            <span className="leading-[18px]">№</span>
          </div>
          <span className="pl-2 leading-[16.3px]">{t("Сотрудник")}</span>
          <span className="pl-2 leading-[16.3px]">{t(labels.count)}</span>
        </div>

        {error && <p className="px-[30px] py-3 text-red-500">{error}</p>}

        {visible.map((row, index) => (
          <div key={row.id} className={`grid min-h-[50px] items-center border-b border-dotted border-[#d6d6d6] px-[30px] hover:bg-[#f2f5f8] ${gridCols}`}>
            <div className="flex items-center">
              {selectMode && (
                <label className="-ml-[10px] mr-[6px] flex h-6 w-6 cursor-pointer items-center justify-center">
                  <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 ${checked.includes(row.id) ? "border-[#5d6474] bg-[#5d6474]" : "border-[#333]"}`}>
                    {checked.includes(row.id) && <Check className="h-3 w-3 stroke-[3] text-white" />}
                    <input
                      type="checkbox"
                      checked={checked.includes(row.id)}
                      onChange={() => setChecked((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))}
                      className="sr-only"
                    />
                  </span>
                </label>
              )}
              <span>{(safePage - 1) * pageSize + index + 1}</span>
            </div>
            <span className="pl-2 text-[#4f71dc]">{row.employee}</span>
            <span className="pl-2">{row.items.length}</span>
          </div>
        ))}

        {visible.length === 0 && (
          <div className="flex h-[276.3px] flex-col items-center pt-[57px]">
            <img src="/robot-empty.png" alt="" className="relative left-px h-[162px] w-[162px] object-contain" />
            <p className="mt-[11px] text-[13px] leading-[16.25px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {dialog && (
        <RestrictionDialog
          title={t(labels.titles[dialog])}
          items={tab === "products" ? products : productTypes}
          showFilters={tab === "products"}
          onClose={() => setDialog(null)}
          onSave={async (items) => {
            if (await apply(dialog, items)) setDialog(null)
          }}
        />
      )}
    </RefPage>
  )
}

function RestrictionDialog({
  title,
  items,
  showFilters,
  onSave,
  onClose,
}: {
  title: string
  items: PickerItem[] | null
  showFilters: boolean
  onSave: (names: string[]) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [chosen, setChosen] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pickerWasOpen = useRef(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pickerWasOpen.current) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    pickerWasOpen.current = pickerOpen
  }, [pickerOpen])

  // Saving always asks for confirmation first, even with an empty list, like the original.
  async function confirmSave() {
    setConfirmOpen(false)
    if (!chosen.length) return
    setSaving(true)
    await onSave(chosen)
    setSaving(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
        <h2 className="text-[13px] font-bold uppercase">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pt-[31px]">
        <div className="flex items-start justify-between pt-[1px]">
          <h3 className="text-[13px] font-semibold leading-[16.25px]">{t("Список товаров")}</h3>
          <button type="button" onClick={() => setPickerOpen(true)} className="pr-[16px] pt-[1.5px] text-[13px] leading-[16.25px] text-[#4f71dc] hover:underline">{t("добавить из списка")}</button>
        </div>

        {chosen.length === 0 ? (
          <div className="mt-[37.5px] flex flex-col items-center text-center leading-[16.25px] text-[#adadad]">
            <img src="/empty-basket.svg" alt="" className="mb-[21px] h-[70px] w-[70px]" />
            <p>
              {t("Вы еще не выбрали ни одного товара.")}<br />
              <button type="button" onClick={() => setPickerOpen(true)} className="text-[#129fdd]">{t("Добавить")}</button> {t("товар?")}
            </p>
          </div>
        ) : (
          <div className="mt-[41px] px-[5px]">
            <div className="flex text-[12px] font-bold">
              <span className="flex-1">{t("Наименование")}</span>
              <span className="mr-[526px] w-[80px] text-left">{t("Статус")}</span>
            </div>
            {chosen.map((name, index) => (
              <div key={name} className="mt-[20px] flex h-[22px] items-center">
                <span className="flex-1"><b className="mr-[8px]">{index + 1}.</b>{name}</span>
                <label className="mr-[526px] flex w-[80px] cursor-pointer items-center">
                  <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[3px] bg-[#5d6474]">
                    <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" /></svg>
                    <input type="checkbox" checked onChange={() => setChosen((current) => current.filter((value) => value !== name))} aria-label={t("Удалить")} className="sr-only" />
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
        <button type="button" onClick={() => setConfirmOpen(true)} disabled={saving} className="rounded-[3px] px-[16px] py-[8px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#ececec] disabled:opacity-50">{t("Сохранить")}</button>
      </footer>

      {confirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/[0.54] pt-[180px]">
          <div className="w-[305px] bg-white">
            <div className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
              <h3 className="text-[13px] font-bold uppercase">{t("Выполнить")}</h3>
              <button type="button" onClick={() => setConfirmOpen(false)} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
            </div>
            <p className="h-[184px] px-[30px] pt-[19px] text-[13px]">{t("Подтверждение запроса")}</p>
            <div className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] px-[45px]">
              <button type="button" onClick={confirmSave} className="text-[13px] font-semibold uppercase text-[#129fdd] hover:underline">{t("Да")}</button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <ProductPickerDialog
          items={items}
          selected={chosen}
          filters={showFilters}
          onClose={() => setPickerOpen(false)}
          onSave={(names) => {
            setChosen(names)
            setPickerOpen(false)
          }}
        />
      )}
    </div>,
    document.body,
  )
}
