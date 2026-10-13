"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { EmptyState, LineField, ListToolbar, Modal, SaveButton, grayHead, listRow } from "./catalog-ui"

type StoreCategory = { id: number; name: string }

const pageSize = 25

export function StoreCategoriesView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<StoreCategory[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<StoreCategory | null>(null)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/store-categories").then((response) => (response.ok ? response.json() : [])).then(setItems)
  }, [])

  const filtered = items.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function open(item?: StoreCategory) {
    setEditing(item ?? { id: 0, name: "" })
    setName(item?.name ?? "")
  }

  async function save() {
    if (!editing || !name.trim()) return
    setSaving(true)
    try {
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/store-categories/${editing.id}` : "/api/store-categories", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) throw new Error("save failed")
      const saved = (await response.json()) as StoreCategory
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
    } catch {
      window.alert(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  const gridCols = "grid-cols-[570px_1fr]"

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        addLabel={t("добавить")}
        onAdd={() => open()}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        pageSize={pageSize}
        from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
        to={Math.min(safePage * pageSize, filtered.length)}
        total={filtered.length}
        onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
        onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
      />
      <div className={`${grayHead} ${gridCols}`}>
        <span>№</span><span>{t("Наименование")}</span>
      </div>
      {visible.map((item, index) => (
        <div key={item.id} onClick={() => open(item)} className={`${listRow} ${gridCols}`}>
          <span>{(safePage - 1) * pageSize + index + 1}</span>
          <span>{item.name}</span>
          <button type="button" onClick={(event) => { event.stopPropagation(); open(item) }} aria-label={t("Изменить")} className="absolute right-[24px] top-1/2 -translate-y-1/2 text-[#555]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          </button>
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить категорию магазина") : t("Добавить категорию магазина")}
          onClose={() => setEditing(null)}
          footer={<SaveButton disabled={saving || !name.trim()} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
        >
          <LineField label={t("Наименование")} required value={name} onChange={setName} />
        </Modal>
      )}
    </div>
  )
}
