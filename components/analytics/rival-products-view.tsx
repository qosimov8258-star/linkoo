"use client"

import { ChevronDown } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { EmptyState, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveButton, grayHead, listRow } from "./catalog-ui"

type RivalProduct = { id: number; name: string; competitor: string }

const pageSize = 25

export function RivalProductsView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<RivalProduct[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [competitorFilter, setCompetitorFilter] = useState("")
  const [editing, setEditing] = useState<RivalProduct | null>(null)
  const [draft, setDraft] = useState({ name: "", competitor: "" })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/rival-products").then((response) => (response.ok ? response.json() : [])).then(setItems)
  }, [])

  const competitors = useMemo(() => Array.from(new Set(items.map((item) => item.competitor).filter(Boolean))), [items])
  const filtered = items
    .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((item) => !competitorFilter || item.competitor === competitorFilter)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function open(item?: RivalProduct) {
    setEditing(item ?? { id: 0, name: "", competitor: "" })
    setDraft({ name: item?.name ?? "", competitor: item?.competitor ?? "" })
  }

  async function save() {
    if (!editing || !draft.name.trim()) return
    setSaving(true)
    try {
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/rival-products/${editing.id}` : "/api/rival-products", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), competitor: draft.competitor.trim() }),
      })
      if (!response.ok) throw new Error("save failed")
      const saved = (await response.json()) as RivalProduct
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
    } catch {
      window.alert(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    const response = await fetch(`/api/rival-products/${id}`, { method: "DELETE" })
    if (response.ok) {
      setItems((list) => list.filter((item) => item.id !== id))
      setEditing(null)
    }
  }

  const gridCols = "grid-cols-[666px_1fr]"

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
          pageSize={pageSize}
          from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
          to={Math.min(safePage * pageSize, filtered.length)}
          total={filtered.length}
          onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
          onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
          hideAdd
          compact
          extra={
            <button type="button" onClick={() => setFilterOpen((current) => !current)} className="ml-[5px] flex items-center gap-[3px] pt-[8px] text-[13px] text-[#4f71dc]">
              {t("Показать фильтр")} <ChevronDown className="h-3 w-3" />
            </button>
          }
        />
        {filterOpen && (
          <div className="absolute left-[5px] top-[50px] z-20 w-[260px] bg-white px-[20px] pb-[20px] pt-[10px] shadow-[0_2px_14px_rgba(0,0,0,0.25)]">
            <LineSelect label={t("Конкурент")} value={competitorFilter} onChange={(value) => { setCompetitorFilter(value); setPage(1); setFilterOpen(false) }} options={competitors} onClear={() => setCompetitorFilter("")} />
          </div>
        )}
      </div>

      <div className={`${grayHead} ${gridCols}`}>
        <span>{t("Наименование")}</span><span>{t("Конкурент")}</span>
      </div>
      {visible.map((item) => (
        <div key={item.id} onClick={() => open(item)} className={`${listRow} ${gridCols}`}>
          <span className="pr-4">{item.name}</span>
          <span>{item.competitor}</span>
          <HoverActions offset={70} onEdit={() => open(item)} onDelete={() => void remove(item.id)} />
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить продукт конкурентов") : t("Добавить продукт конкурентов")}
          onClose={() => setEditing(null)}
          footer={<SaveButton disabled={saving || !draft.name.trim()} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
        >
          <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <div className="mt-[27px]"><LineField label={t("Конкурент")} value={draft.competitor} onChange={(value) => setDraft({ ...draft, competitor: value })} /></div>
        </Modal>
      )}
    </div>
  )
}
