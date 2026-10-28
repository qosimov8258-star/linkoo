"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { CashSnackbar, type SnackbarMessage } from "./cash-management-shared"
import { EmptyState, HoverActions, LineField, ListToolbar, Modal, SaveLink, grayHead, listRow } from "./catalog-ui"

type StoreCategory = { id: number; name: string }

export function StoreCategoriesView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<StoreCategory[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<StoreCategory | null>(null)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)

  useEffect(() => {
    fetch("/api/store-categories").then((response) => (response.ok ? response.json() : [])).then(setItems)
  }, [])

  const filtered = items.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function open(item?: StoreCategory) {
    setError("")
    setEditing(item ?? { id: 0, name: "" })
    setName(item?.name ?? "")
  }

  async function save() {
    if (!editing || !name.trim()) return
    setSaving(true)
    setError("")
    try {
      const isEdit = editing.id > 0
      const response = await fetch(isEdit ? `/api/store-categories/${editing.id}` : "/api/store-categories", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) {
        // 409 "Такая категория магазина уже существует", 400 field errors: the server's reason.
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        window.alert(t(data.error || "Не удалось сохранить"))
        return
      }
      const saved = (await response.json()) as StoreCategory
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
    } catch {
      setError(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  const gridCols = "grid-cols-[526px_1fr]"

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        slim
        addLabel={t("добавить")}
        onAdd={() => open()}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        searchPos={{ left: 342, top: 10 }}
        pageSize={pageSize}
        onPageSize={(size) => { setPageSize(size); setPage(1) }}
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
        <div key={item.id} className={`${listRow} ${gridCols}`}>
          <span>{(safePage - 1) * pageSize + index + 1}</span>
          <span>{item.name}</span>
          <HoverActions offset={31} onEdit={() => open(item)} />
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить категория магазина") : t("Добавить категория магазина")}
          onClose={() => setEditing(null)}
          bodyClassName="pl-[30px] pr-[52px] pb-[24px] pt-[38px]"
          footer={<SaveLink disabled={saving || !name.trim()} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="min-h-[231px]">
            <LineField label={t("Наименование")} value={name} onChange={setName} />
            {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
          </div>
        </Modal>
      )}

      <CashSnackbar message={notice} onClose={() => setNotice(null)} />
    </div>
  )
}
