"use client"

import { useEffect, useState } from "react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CheckBox, EmptyState, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveLink, ToggleRow, grayHead, listRow } from "@/components/analytics/catalog-ui"
import { DictionaryDeleteDialog } from "@/components/analytics/dictionaries-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

type ClientType = { id: number; name: string; supplier: string; date: string; parentId: number | null; innRequired: boolean }

const emptyDraft = { name: "", supplier: "", parent: "", hasParent: false, innRequired: false }

export function ClientTypesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [items, setItems] = useState<ClientType[]>([])
  const [editing, setEditing] = useState<ClientType | null>(null)
  const [deleting, setDeleting] = useState<ClientType | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const [deliverers, setDeliverers] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { firstName?: string; lastName?: string }[]) => {
        if (Array.isArray(rows)) setDeliverers([...new Set(rows.map((row) => `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-types")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы клиентов")
        return (await response.json()) as ClientType[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const parentOptions = items.filter((item) => item.parentId === null && item.id !== editing?.id).map((item) => item.name)
  const valid = draft.name.trim() !== "" && draft.supplier !== "" && (!draft.hasParent || draft.parent !== "")

  function openAdd() {
    setError("")
    setEditing({ id: 0, name: "", supplier: "", date: "", parentId: null, innRequired: false })
    setDraft(emptyDraft)
  }
  function openEdit(item: ClientType) {
    setError("")
    setEditing(item)
    const parent = items.find((row) => row.id === item.parentId)
    setDraft({ name: item.name, supplier: item.supplier === "Не указано" ? "" : item.supplier, parent: parent?.name ?? "", hasParent: item.parentId !== null, innRequired: item.innRequired })
  }

  async function save() {
    if (!editing || !valid) return
    setSaving(true)
    setError("")
    try {
      const isEdit = editing.id > 0
      const parentId = draft.hasParent ? items.find((row) => row.name === draft.parent)?.id ?? null : null
      const response = await fetch(isEdit ? `/api/client-types/${editing.id}` : "/api/client-types", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), supplier: draft.supplier, parentId, innRequired: draft.innRequired }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || t("Не удалось сохранить"))
        return
      }
      const list = await fetch("/api/client-types").then((res) => (res.ok ? res.json() : null)).catch(() => null)
      if (Array.isArray(list)) setItems(list as ClientType[])
      setEditing(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  void embedded
  const gridCols = "grid-cols-[422px_312px_1fr]"
  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar slim addLabel={t("добавить тип клиента")} onAdd={openAdd} />
      <div className={`${grayHead} ${gridCols} pt-[2px]`}>
        <span>{t("Наименование")}</span><span>{t("Доставщик")}</span><span>{t("Дата создания")}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className={`${listRow} ${gridCols}`}>
          <span className="pr-4 font-semibold">{item.name}</span>
          <span>{item.supplier}</span>
          <span>{refDate(item.date) || item.date.replace(/\s*г\.$/, "")}</span>
          <HoverActions offset={35} onEdit={() => openEdit(item)} onDelete={() => setDeleting(item)} />
        </div>
      ))}
      {items.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить тип клиента") : t("Добавить тип клиента")}
          onClose={() => setEditing(null)}
          bodyClassName="px-[30px] pb-[24px] pt-[17px]"
          footer={<SaveLink disabled={saving || !valid} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="min-h-[258px]">
            <ToggleRow checked={draft.hasParent} onChange={(hasParent) => setDraft({ ...draft, hasParent })} label={t("Добавить родительскую категорию")} />
            {draft.hasParent && <div className="mt-[31px]"><LineSelect label={t("Родительская категория")} value={draft.parent} onChange={(parent) => setDraft({ ...draft, parent })} options={parentOptions} onClear={() => setDraft({ ...draft, parent: "" })} /></div>}
            <div className={draft.hasParent ? "mt-[12px]" : "mt-[20px]"}><LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} /></div>
            <div className="mt-[27px]"><LineSelect label={t("Доставщик")} required value={draft.supplier} onChange={(value) => setDraft({ ...draft, supplier: value })} onClear={() => setDraft({ ...draft, supplier: "" })} options={deliverers} /></div>
            <div className="mt-[12px]"><CheckBox checked={draft.innRequired} onChange={(innRequired) => setDraft({ ...draft, innRequired })} label={t("Требуется ИНН")} /></div>
            {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
          </div>
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api="/api/client-types"
          id={deleting.id}
          name={`${t("Тип клиента")}: ${deleting.name}`}
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
