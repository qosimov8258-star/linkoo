"use client"

import { Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, EyeOff, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

import { ProductPickerDialog, type PickerItem } from "./product-picker-dialog"

type Restriction = { id: number; employee: string; items: string[] }
type Tab = "products" | "types"
type Mode = "add" | "remove" | "replace"

const PAGE_SIZES = [10, 25, 50, 100]

function SolidIcon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden="true"><path d={d} /></svg>
}
const ICON_BOX = "M21 7.5l-9-5.25L3 7.5v9l9 5.25 9-5.25v-9zM12 4.55l5.9 3.45L12 11.45 6.1 8 12 4.55zM5 9.7l6 3.5v6.9l-6-3.5V9.7zm8 10.4v-6.9l6-3.5v6.9l-6 3.5z"
const ICON_TRASH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const ICON_SHIELD = "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"
const ICON_LIST_CHECK = "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z"

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
  const [pageSizeOpen, setPageSizeOpen] = useState(false)
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
    if (tab === "products" && !products) load("/api/products").then((data: PickerItem[]) => setProducts(data))
    if (tab === "types" && !productTypes) load("/api/product-types").then((data: PickerItem[]) => setProductTypes(data))
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
  const iconBtn = "flex h-5 w-5 items-center justify-center rounded-full border text-slate-500 disabled:opacity-40"
  const gridCols = selectMode ? "grid-cols-[48px_468px_488px_1fr]" : "grid-cols-[503px_494px_1fr]"

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] px-[28px] pb-10 pt-[18px] text-[13px] text-[#333]">
      <h1 className="mb-[17px] flex h-[26px] items-center gap-[7px] text-[18px] font-bold text-[#5d6474]">
        <FavoritesButton className="flex items-center gap-[7px] text-[#4a6ee0]" />
        <span className="font-normal text-[#5d6474]">|</span>
        {t("Ограничение продуктов")}
      </h1>

      <section className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
        <div className="grid grid-cols-2">
          {(["products", "types"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`relative h-10 text-center text-[13px] text-black ${tab === id ? "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-[#4c6dd4] after:shadow-[0_-4px_8px_rgba(76,109,212,0.25)]" : ""}`}
            >
              {t(copy[id].tab)}
            </button>
          ))}
        </div>

        <div className="relative flex h-[50px] items-center whitespace-nowrap border-t border-[#eef0f4] pb-[2px] pr-[5px]">
          <label className="absolute left-[402px] top-[10px] w-[300px]">
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder={t("Поиск")}
              className="h-[30px] w-full border-b border-[#dfe3ea] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#4c6dd4]"
            />
            <Search className="absolute right-2 top-1.5 h-[18px] w-[18px] text-[#c4cad4]" />
          </label>

          <div className="relative ml-auto shrink-0">
            <button type="button" onClick={() => setPageSizeOpen((open) => !open)} className="flex items-center gap-1 text-[13px]">
              {pageSize}<ChevronDown className="h-3.5 w-3.5 text-slate-300" />
            </button>
            {pageSizeOpen && (
              <ul className="absolute left-0 top-7 z-20 w-16 bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
                {PAGE_SIZES.map((size) => (
                  <li key={size}>
                    <button type="button" onClick={() => { setPageSize(size); setPage(1); setPageSizeOpen(false) }} className={`block w-full px-3 py-1.5 text-left font-semibold ${size === pageSize ? "bg-[#e3effd]" : "text-slate-500 hover:bg-slate-50"}`}>{size}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <span className="ml-[34px] shrink-0 text-[13px]">
            {(safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className={`ml-[12px] ${iconBtn} border-slate-300`}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className={`ml-[9px] ${iconBtn} border-slate-700 text-slate-700`}><ChevronRight className="h-4 w-4" /></button>

          <div className="group relative ml-[36px] shrink-0">
            <button type="button" onClick={toggleSelectMode} aria-label={t("Выбрать из списка")} className="flex h-6 w-6 items-center justify-center text-slate-700">
              {selectMode ? <EyeOff className="h-6 w-6" /> : <SolidIcon d={ICON_LIST_CHECK} className="h-6 w-6" />}
            </button>
            <span className="pointer-events-none absolute right-[calc(100%+26px)] top-[-6px] hidden whitespace-nowrap rounded-[3px] bg-[#3a3f4a] px-5 py-[9px] text-[13px] leading-4 text-white group-hover:block">{t("Выбрать из списка")}</span>
          </div>

          <div className="ml-[13px] flex shrink-0 items-center gap-[5px]">
            <button type="button" onClick={() => setDialog("add")} className="flex h-9 items-center gap-2 rounded-[3px] bg-[#4db6ac] px-[14px] font-bold text-white hover:brightness-95">
              <SolidIcon d={ICON_BOX} />{t(labels.add)}
            </button>
            <button type="button" onClick={() => setDialog("remove")} className="flex h-9 items-center gap-2 rounded-[3px] bg-[#ff8a65] px-[14px] font-bold text-white hover:brightness-95">
              <SolidIcon d={ICON_TRASH} />{t(labels.remove)}
            </button>
            <button type="button" onClick={() => setDialog("replace")} className="flex h-9 items-center gap-2 rounded-[3px] bg-[#4f71dc] px-[14px] font-bold text-white hover:brightness-95">
              <SolidIcon d={ICON_SHIELD} />{t("Стереть и добавить")}
            </button>
          </div>
        </div>

        <div className={`grid h-[50px] items-center bg-[#5d6474] font-bold text-white ${gridCols}`}>
          {selectMode && (
            <button
              type="button"
              onClick={() => setChecked(allChecked ? [] : visible.map((row) => row.id))}
              aria-label={t("Выбрать все")}
              className="flex h-full items-center justify-end pr-2"
            >
              <CheckCheck className="h-5 w-5" />
            </button>
          )}
          <span className={selectMode ? "pl-[2px]" : "pl-[30px]"}>№</span>
          <span className="pl-[30px]">{t("Сотрудник")}</span>
          <span className="pl-[30px]">{t(labels.count)}</span>
        </div>

        {error && <p className="px-[30px] py-3 text-red-500">{error}</p>}

        {visible.map((row, index) => (
          <div key={row.id} className={`grid min-h-[50px] items-center border-b border-dashed border-[#dfe3ea] hover:bg-slate-50 ${gridCols}`}>
            {selectMode && (
              <label className="flex h-full cursor-pointer items-center justify-end pr-3">
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
            <span className={selectMode ? "pl-[2px]" : "pl-[30px]"}>{(safePage - 1) * pageSize + index + 1}</span>
            <span className="pl-[30px] text-[#4a6ee0]">{row.employee}</span>
            <span className="pl-[30px]">{row.items.length}</span>
          </div>
        ))}

        {visible.length === 0 && (
          <div className="flex h-[276px] flex-col items-center pt-[58px]">
            <img src="/robot-empty.png" alt="" className="h-[162px] w-[162px] object-contain" />
            <p className="mt-[8px] text-[13px] text-[#6b7280]">{t("По вашему запросу ничего не найдено")}</p>
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
    </main>
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
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">{t("Список товаров")}</h3>
          <button type="button" onClick={() => setPickerOpen(true)} className="pr-[16px] text-[13px] text-[#4f6fe0] hover:underline">{t("добавить из списка")}</button>
        </div>

        {chosen.length === 0 ? (
          <div className="mt-[35px] flex flex-col items-center text-center leading-[18px] text-[#9e9e9e]">
            <img src="/empty-basket.svg" alt="" className="mb-[20px] h-[72px] w-[72px]" />
            <p>
              {t("Вы еще не выбрали ни одного товара.")}<br />
              <button type="button" onClick={() => setPickerOpen(true)} className="text-[#0a9bd9]">{t("Добавить")}</button> {t("товар?")}
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
        <button type="button" onClick={() => setConfirmOpen(true)} disabled={saving} className="rounded-[3px] px-[16px] py-[8px] text-[13px] font-bold uppercase text-[#0a9bd9] hover:bg-[#ececec] disabled:opacity-50">{t("Сохранить")}</button>
      </footer>

      {confirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 pt-[200px]">
          <div className="w-[305px] bg-white shadow-xl">
            <div className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
              <h3 className="text-[13px] font-bold uppercase">{t("Выполнить")}</h3>
              <button type="button" onClick={() => setConfirmOpen(false)} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
            </div>
            <p className="h-[184px] px-[30px] pt-[20px] text-[13px]">{t("Подтверждение запроса")}</p>
            <div className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] px-[45px]">
              <button type="button" onClick={confirmSave} className="text-[13px] font-bold uppercase text-[#0a9bd9] hover:underline">{t("Да")}</button>
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
