"use client"

import { ChevronDown, XCircle } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { CashSnackbar, type SnackbarMessage } from "./cash-management-shared"
import { CheckBox, EmptyState, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveLink, grayHead, listRow } from "./catalog-ui"
import { DictionaryDeleteDialog } from "./dictionaries-shared"

// brand / productType are not stored for competitor products here (the reference form does not edit them either), so any chosen filter value leaves no rows.
type RivalProduct = { id: number; name: string; competitor: string; brand?: string; productType?: string }

export function RivalProductsView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<RivalProduct[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filterOpen, setFilterOpen] = useState(false)
  const [brands, setBrands] = useState<string[]>([])
  const [productTypes, setProductTypes] = useState<string[]>([])
  const [filterDraft, setFilterDraft] = useState({ brand: "", productType: "" })
  const [filter, setFilter] = useState({ brand: "", productType: "" })
  const [editing, setEditing] = useState<RivalProduct | null>(null)
  const [deleting, setDeleting] = useState<RivalProduct | null>(null)
  const [draft, setDraft] = useState({ name: "", competitor: "", create: false, newCompetitor: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)

  useEffect(() => {
    fetch("/api/rival-products").then((response) => (response.ok ? response.json() : [])).then(setItems)
  }, [])
  useEffect(() => {
    if (!filterOpen || brands.length || productTypes.length) return
    fetch("/api/brands").then((response) => (response.ok ? response.json() : [])).then((rows: { name: string }[]) => setBrands(rows.map((row) => row.name)))
    fetch("/api/product-types").then((response) => (response.ok ? response.json() : [])).then((rows: { name: string }[]) => setProductTypes(rows.map((row) => row.name)))
  }, [filterOpen, brands.length, productTypes.length])

  const competitors = useMemo(() => Array.from(new Set(items.map((item) => item.competitor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "en")), [items])
  const filtered = items
    .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((item) => !filter.brand || item.brand === filter.brand)
    .filter((item) => !filter.productType || item.productType === filter.productType)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") || a.id - b.id)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function open(item?: RivalProduct) {
    setError("")
    setEditing(item ?? { id: 0, name: "", competitor: "" })
    setDraft({ name: item?.name ?? "", competitor: item?.competitor ?? "", create: false, newCompetitor: "" })
  }

  const competitorName = draft.create ? draft.newCompetitor.trim() : draft.competitor
  const valid = draft.name.trim() !== "" && (!draft.create || competitorName !== "")

  async function save() {
    if (!editing || !valid) return
    setSaving(true)
    setError("")
    try {
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/rival-products/${editing.id}` : "/api/rival-products", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), competitor: competitorName }),
      })
      if (!response.ok) throw new Error("save failed")
      const saved = (await response.json()) as RivalProduct
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
    } catch {
      setError(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  const gridCols = "grid-cols-[615px_1fr]"

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <div className="flex h-[70px] items-center border-b border-[#eef0f4] pl-[20px]">
        <button type="button" onClick={() => open()} className="flex h-[30px] items-center gap-[8px] rounded-[3px] bg-[#4f71dc] px-[12px] text-[13px] font-bold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
          {t("Добавить продукт конкурентов")}
        </button>
      </div>
      <div className="relative">
        <ListToolbar
          addLabel=""
          onAdd={() => setFilterOpen((current) => !current)}
          query={query}
          onQuery={(value) => { setQuery(value); setPage(1) }}
          searchPos={{ left: 335, top: 10 }}
          pageSize={pageSize}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
          from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
          to={Math.min(safePage * pageSize, filtered.length)}
          total={filtered.length}
          onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
          onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
          hideAdd
          compact
          extra={
            <button type="button" onClick={() => { setFilterDraft(filter); setFilterOpen((current) => !current) }} className="ml-[5px] flex items-center gap-[3px] text-[13px] text-[#4f71dc]">
              {t("Показать фильтр")} <ChevronDown className="h-3 w-3" />
            </button>
          }
        />
        {filterOpen && (
          <div className="absolute left-0 top-0 z-20 w-[300px] bg-white px-[20px] pb-[26px] pt-[22px] shadow-[0_2px_14px_rgba(0,0,0,0.25)]">
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-[#777]">{t("Фильтр")}</span>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label={t("Закрыть")} className="text-[#555]"><XCircle className="h-[22px] w-[22px]" /></button>
            </div>
            <div className="mt-[24px]"><LineSelect label={t("Бренд")} value={filterDraft.brand} onChange={(brand) => setFilterDraft({ ...filterDraft, brand })} options={brands} onClear={() => setFilterDraft({ ...filterDraft, brand: "" })} /></div>
            <div className="mt-[22px]"><LineSelect label={t("Тип товара")} value={filterDraft.productType} onChange={(productType) => setFilterDraft({ ...filterDraft, productType })} options={productTypes} onClear={() => setFilterDraft({ ...filterDraft, productType: "" })} /></div>
            <button type="button" onClick={() => { setFilter(filterDraft); setPage(1); setFilterOpen(false) }} className="mt-[22px] h-[36px] rounded-[3px] bg-[#5d6474] px-[16px] text-[12px] font-bold uppercase text-white hover:brightness-110">{t("Применить")}</button>
          </div>
        )}
      </div>

      <div className={`${grayHead} ${gridCols}`}>
        <span>{t("Наименование")}</span><span>{t("Конкурент")}</span>
      </div>
      {visible.map((item) => (
        <div key={item.id} className={`${listRow} ${gridCols}`}>
          <span className="pr-4">{item.name}</span>
          <span>{item.competitor}</span>
          <HoverActions offset={58} onEdit={() => open(item)} onDelete={() => setDeleting(item)} />
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          bodyClassName="pl-[30px] pr-[52px] pb-[24px] pt-[24px]"
          title={editing.id ? t("Изменить продукт конкурента") : t("Добавить продукт конкурента")}
          onClose={() => setEditing(null)}
          footer={<SaveLink disabled={saving || !valid} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="min-h-[252px]">
            <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
            <div className="mt-[26px]"><LineSelect label={t("Конкурент")} value={draft.competitor} onChange={(value) => setDraft({ ...draft, competitor: value })} options={competitors} onClear={() => setDraft({ ...draft, competitor: "" })} /></div>
            <div className="mt-[32px]"><CheckBox checked={draft.create} onChange={(create) => setDraft({ ...draft, create })} label={t("Создать конкурент")} /></div>
            {draft.create && <div className="mt-[14px]"><LineField label={t("Имя конкурента")} value={draft.newCompetitor} onChange={(newCompetitor) => setDraft({ ...draft, newCompetitor })} /></div>}
            {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
          </div>
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api="/api/rival-products"
          id={deleting.id}
          name={`${t("Продукт конкурента")}: ${deleting.name}`}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setItems((list) => list.filter((item) => item.id !== deleting.id))
            setDeleting(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      <CashSnackbar message={notice} onClose={() => setNotice(null)} />
    </div>
  )
}
