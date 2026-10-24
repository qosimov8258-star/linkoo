"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"

import { LineField, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { DictionaryDeleteDialog } from "@/components/analytics/dictionaries-shared"
import { AddLink, EmptyRows, RowActions, SettingsToolbar, kitHead, kitRow } from "@/components/analytics/settings-list-kit"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

// "Тип отказа" (demo #/type-failure, Settings → Тип отказа; API market/rejection_type/).
// "+ добавить", search, paginator and the grid № | Наименование | Решение (newest first) with
// hover ✎ / 🗑; the dialog has Название тип отказа ★ and Решение ★, delete asks for confirmation.

type RefusalType = { id: number; name: string; resolution: string }

const API = "/api/refusal-types"

// Reference grid: 12 xs columns inside the 30px gutters (№ 3 | Наименование 4 | Решение 5).
const COLUMNS = "3fr 4fr 5fr 0fr"

export function RefusalTypesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const canEdit = useCanWrite()
  const [items, setItems] = useState<RefusalType[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState("")
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 })
  const [editing, setEditing] = useState<RefusalType | null>(null)
  const [draft, setDraft] = useState({ name: "", resolution: "" })
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<RefusalType | null>(null)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])

  const load = useCallback(() => {
    fetch(API, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы отказов")
        setItems(((await response.json()) as RefusalType[]).sort((a, b) => b.id - a.id))
      })
      .catch(() => setNotice({ text: "Не удалось загрузить типы отказов с сервера", tone: "error" }))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle) || item.resolution.toLowerCase().includes(needle)) : items
  }, [items, query])
  const lastPage = Math.max(1, Math.ceil(rows.length / paging.pageSize))
  const page = Math.min(paging.page, lastPage)
  const pageRows = rows.slice((page - 1) * paging.pageSize, page * paging.pageSize)

  function open(item?: RefusalType) {
    setEditing(item ?? { id: 0, name: "", resolution: "" })
    setDraft(item ? { name: item.name, resolution: item.resolution } : { name: "", resolution: "" })
    setTouched(false)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setTouched(true)
    if (!draft.name.trim() || !draft.resolution.trim()) return
    setSaving(true)
    try {
      const response = await fetch(editing?.id ? `${API}/${editing.id}` : API, {
        method: editing?.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), resolution: draft.resolution.trim() }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setNotice({ text: t(data.error || "Не удалось сохранить тип отказа"), tone: "error" })
        return
      }
      setEditing(null)
      setNotice({ text: "Успешно сохранено", tone: "success" })
      load()
    } catch {
      setNotice({ text: t("Сервер недоступен, попробуйте ещё раз"), tone: "error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> {t("Тип отказа")}
          </h1>
        </header>
      )}

      <section className={embedded ? "bg-white text-[13px] text-[#333]" : "overflow-hidden rounded bg-white text-[13px] text-[#333] shadow"}>
        <SettingsToolbar
          left={canEdit ? <AddLink onClick={() => open()}>{t("добавить")}</AddLink> : undefined}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setPaging((current) => ({ ...current, page: 1 }))
          }}
          pager={{
            pageSize: paging.pageSize,
            onPageSize: (size) => setPaging({ page: 1, pageSize: size }),
            from: rows.length ? (page - 1) * paging.pageSize + 1 : 0,
            to: Math.min(rows.length, page * paging.pageSize),
            total: rows.length,
            onPrev: page > 1 ? () => setPaging((current) => ({ ...current, page: page - 1 })) : undefined,
            onNext: page * paging.pageSize < rows.length ? () => setPaging((current) => ({ ...current, page: page + 1 })) : undefined,
          }}
        />

        <div className={`${kitHead} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
          <span>№</span>
          <span className="pl-[8px]">{t("Наименование")}</span>
          <span className="pl-[8px]">{t("Решение")}</span>
          <span />
        </div>
        {pageRows.map((item) => (
          <div key={item.id} className={`${kitRow} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
            <span>{item.id}</span>
            <span className="pr-4">{item.name}</span>
            <span className="pr-4">{item.resolution}</span>
            <span />
            {canEdit && <RowActions onEdit={() => open(item)} onDelete={() => setDeleting(item)} />}
          </div>
        ))}
        {loaded && rows.length === 0 && <EmptyRows />}
      </section>

      {editing && (
        <Modal
          title={editing.id ? t("Изменить тип отказа") : t("Добавить тип отказа")}
          onClose={() => setEditing(null)}
          width={450}
          anchorTop={263.5} // the reference's dialog sits 8px above the exact center
          bodyClassName="min-h-[240px] px-[30px] pt-[42px]"
          footer={
            <SaveButton disabled={saving} onClick={() => void save({ preventDefault() {} } as FormEvent)}>
              {t("Сохранить")}
            </SaveButton>
          }
        >
          <LineField label={t("Название тип отказа")} required autoFocus value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          {touched && !draft.name.trim() && <p className="mt-1 text-[12px] text-[#e57373]">{t("Обязательное поле")}</p>}
          <div className="mt-[12px]">
            <LineField label={t("Решение")} required value={draft.resolution} onChange={(value) => setDraft({ ...draft, resolution: value })} />
          </div>
          {touched && !draft.resolution.trim() && <p className="mt-1 text-[12px] text-[#e57373]">{t("Обязательное поле")}</p>}
        </Modal>
      )}

      {deleting && (
        <DictionaryDeleteDialog
          api={API}
          id={deleting.id}
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
            load()
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      <CashSnackbar message={notice} onClose={closeNotice} />
    </main>
  )
}
