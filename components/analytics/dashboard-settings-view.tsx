"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { ConfirmDelete, EmptyState, ErrorAlert, LineField, Modal, SaveLink } from "./catalog-ui"
import { MdDelete, MdEdit, MdEye } from "./material-icons"

// "Дашборды" (demo #/dashboard-settings, Settings → Конструкторы): search, "+ добавить дашборд",
// the list № | Наименование | Просмотреть | Изменить | Удалить (№ and Наименование sort), the
// dialog "Создать дашборд" (also used to rename, as in the demo) and the delete confirm.

type Dashboard = { id: number; name: string }
type Dialog = { kind: "form"; item?: Dashboard } | { kind: "delete"; item: Dashboard } | null

const GRID = "grid-cols-[109px_506px_203px_202px_1fr]"
const buttonCls = "flex h-[30px] items-center justify-center rounded-[3px] text-[13px] font-semibold text-white hover:brightness-95"

export function DashboardSettingsView() {
  const { t } = useLanguage()
  const router = useRouter()
  const [items, setItems] = useState<Dashboard[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [ordering, setOrdering] = useState("")
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/custom-dashboards", { cache: "no-store" })
      if (!response.ok) throw new Error("failed")
      setItems((await response.json()) as Dashboard[])
      setLoadError("")
    } catch {
      setLoadError("Не удалось загрузить данные")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const found = items.filter((item) => item.name.toLowerCase().includes(needle))
    if (!ordering) return [...found].sort((a, b) => a.id - b.id)
    const desc = ordering.startsWith("-")
    const sorted = [...found].sort((a, b) => (ordering.replace("-", "") === "id" ? a.id - b.id : a.name.localeCompare(b.name, "ru", { sensitivity: "base" })) || a.id - b.id)
    return desc ? sorted.reverse() : sorted
  }, [items, query, ordering])

  const sort = (field: string) => setOrdering(ordering === field ? `-${field}` : ordering === `-${field}` ? "" : field)
  const header = (field: string, label: string) => (
    <button type="button" onClick={() => sort(field)} className="flex items-center gap-[10px] text-left font-bold">
      {label}
      {ordering === field ? <ArrowDown className="h-4 w-4 text-white/60" /> : ordering === `-${field}` ? <ArrowUp className="h-4 w-4 text-white/60" /> : null}
    </button>
  )

  function view(item: Dashboard) {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, "0")
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    router.push(`/analytics/flexible-dashboard?dashboardCategory=dashboard${item.id}&beginDate=${now.getFullYear()}-${pad(now.getMonth() + 1)}-01&endDate=${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}`)
  }

  return (
    <CatalogPageLayout>
      <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
        <div className="relative h-[60px]">
          <label className="absolute left-[15px] top-[19px] w-[300px]">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#e0e0e0] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#5d6474] focus:shadow-[inset_0_-1px_0_#5d6474]" />
            <svg viewBox="0 0 24 24" className="absolute right-2 top-1.5 h-[18px] w-[18px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </label>
          <button type="button" onClick={() => setDialog({ kind: "form" })} className="absolute right-[44px] top-[22px] text-[13px] text-[#4f71dc] hover:underline">+ {t("добавить дашборд")}</button>
        </div>
        <div className={`grid h-[50px] items-center bg-[#5d6474] pl-[30px] font-semibold text-white ${GRID}`}>
          {header("id", "N°")}
          {header("name", t("Наименование"))}
          <span>{t("Просмотреть")}</span>
          <span>{t("Изменить")}</span>
          <span>{t("Удалить")}</span>
        </div>
        {rows.map((item) => (
          <div key={item.id} className={`grid h-[50px] items-center pl-[30px] ${GRID}`}>
            <span>{item.id}</span>
            <span className="truncate pr-4">{item.name}</span>
            <span>
              <button type="button" onClick={() => view(item)} className={`${buttonCls} w-[141px] bg-[#71ce87]`}><MdEye className="mr-[8px] h-[18px] w-[18px]" />{t("Просмотреть")}</button>
            </span>
            <span>
              <button type="button" onClick={() => setDialog({ kind: "form", item })} className={`${buttonCls} w-[165px] bg-[#4f71dc]`}><MdEdit className="mr-[8px] h-[18px] w-[18px]" />{t("Изменить статус")}</button>
            </span>
            <span>
              <button type="button" onClick={() => setDialog({ kind: "delete", item })} className={`${buttonCls} w-[109px] bg-[#fa8072]`}><MdDelete className="mr-[8px] h-[18px] w-[18px]" />{t("Удалить")}</button>
            </span>
          </div>
        ))}
        {!rows.length && (loading ? <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p> : loadError ? <p className="py-10 text-center text-red-600">{t(loadError)}</p> : <EmptyState />)}
      </section>

      {dialog?.kind === "form" && (
        <DashboardFormDialog
          key={dialog.item?.id ?? "create"}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            void load()
          }}
        />
      )}
      {dialog?.kind === "delete" && <DeleteDialog item={dialog.item} onClose={() => setDialog(null)} onDone={(message) => { setDialog(null); setNotice(message); void load() }} />}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </CatalogPageLayout>
  )
}

function DashboardFormDialog({ item, onClose, onSaved }: { item?: Dashboard; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(item?.name ?? "")
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState("")

  async function save() {
    if (saving) return
    if (!name.trim()) return setAlert(`name: ${t("Это поле обязательно к заполнению")}`)
    setSaving(true)
    try {
      const response = await fetch(item ? `/api/custom-dashboards/${item.id}` : "/api/custom-dashboards", {
        method: item ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (response.ok) return onSaved()
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      setAlert(t(data.error || "Не удалось сохранить дашборд"))
    } catch {
      setAlert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        title={t("Создать дашборд")}
        onClose={onClose}
        bodyClassName="min-h-[170px] pl-[30px] pr-[52px] pt-[53px]"
        footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
      >
        <LineField label={t("Наименование")} required value={name} onChange={setName} />
      </Modal>
      {alert && <ErrorAlert message={alert} onClose={() => setAlert("")} />}
    </>
  )
}

function DeleteDialog({ item, onClose, onDone }: { item: Dashboard; onClose: () => void; onDone: (message: SnackbarMessage) => void }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      const response = await fetch(`/api/custom-dashboards/${item.id}`, { method: "DELETE" })
      if (response.ok) return onDone({ text: "Успешно удалено", tone: "success" })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      onDone({ text: t(data.error || "Удаление невозможно из-за связи с другими данными"), tone: "error" })
    } catch {
      onDone({ text: t("Сервер недоступен, попробуйте ещё раз"), tone: "error" })
    }
  }

  return <ConfirmDelete name={item.name} busy={busy} onConfirm={() => void remove()} onClose={onClose} />
}
