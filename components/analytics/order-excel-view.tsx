"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { EmptyState, Modal, SaveButton, ToggleRow } from "./catalog-ui"
import { MdEdit } from "./material-icons"
import { ORDER_EXCEL_API, type OrderExcelListResult, type OrderExcelSetting } from "./order-excel-data"

// "Настройка EXCEL заказов" (demo #/order-excel-settings/, Settings → Конструкторы). One row per
// Excel layout: № | Наименование | Активные (green tiles of the switched-on column numbers) |
// "Изменить" → dialog "Настройка EXCEL заказов" with a switch per numbered column.
// API: GET /api/order-excel-settings?search, PUT /api/order-excel-settings/[id] {codes}.

const GRID = "grid-cols-[109px_304px_607px_1fr]"

export function OrderExcelView() {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [list, setList] = useState<OrderExcelSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState<OrderExcelSetting | null>(null)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])
  const [version, setVersion] = useState(0)
  const firstLoad = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetch(`${ORDER_EXCEL_API}?search=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Не удалось загрузить данные")
          setList(((await response.json()) as OrderExcelListResult).results)
          setError("")
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, firstLoad.current ? 0 : 500)
    firstLoad.current = false
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, version])

  return (
    <CatalogPageLayout>
      <div className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
        <div className="relative h-[60px]">
          <label className="absolute left-[15px] top-[19px] w-[300px]">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#dfe3ea] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#4c6dd4]" />
            <svg viewBox="0 0 24 24" className="absolute right-2 top-1.5 h-[18px] w-[18px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </label>
        </div>
        <div className={`grid h-[50px] items-center bg-[#5d6474] pl-[30px] font-semibold text-white ${GRID}`}>
          <span>N°</span>
          <span>{t("Наименование")}</span>
          <span>{t("Активные")}</span>
          <span />
        </div>
        <div className={loading && list.length ? "opacity-60" : undefined}>
          {list.map((item) => (
            <div key={item.id} className={`grid min-h-[50px] items-center border-b-2 border-dotted border-[#d9e0e5] pb-[5px] pl-[30px] pt-[7px] last:border-b-0 ${GRID}`}>
              <span>{item.id}</span>
              <span>{t(item.name)}</span>
              <div className="flex w-[577px] flex-wrap gap-x-[11px] gap-y-[13px]">
                {item.codes.map((entry) => (
                  <span key={entry.code} className={`flex h-[25px] min-w-[27px] items-center justify-center rounded-[2px] px-[9px] text-[13px] font-semibold ${entry.isActive ? "bg-[#2ecc71] text-white" : "bg-[#e6e9ed] text-[#555]"}`}>
                    {entry.code}
                  </span>
                ))}
              </div>
              <button type="button" onClick={() => setEditing(item)} className="ml-[67px] flex h-[30px] w-[120px] items-center justify-center gap-[8px] rounded-[3px] bg-[#4f70e7] text-[13px] font-bold text-white hover:brightness-95">
                <MdEdit className="h-[18px] w-[18px]" />
                {t("Изменить")}
              </button>
            </div>
          ))}
        </div>
        {!list.length && (loading ? <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p> : error ? <p className="py-10 text-center text-red-600">{t(error)}</p> : <EmptyState />)}
      </div>

      {editing && (
        <OrderExcelDialog
          key={editing.id}
          setting={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            setVersion((value) => value + 1)
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </CatalogPageLayout>
  )
}

function OrderExcelDialog({ setting, onClose, onSaved, onFailed }: { setting: OrderExcelSetting; onClose: () => void; onSaved: () => void; onFailed: (message: string) => void }) {
  const { t } = useLanguage()
  const [active, setActive] = useState<Set<string>>(() => new Set(setting.codes.filter((entry) => entry.isActive).map((entry) => entry.code)))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const codes = setting.codes.filter((entry) => active.has(entry.code)).map((entry) => Number(entry.code))
      const response = await fetch(`${ORDER_EXCEL_API}/${setting.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes }) })
      if (!response.ok) throw new Error("failed")
      onSaved()
    } catch {
      onFailed(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("Настройка EXCEL заказов")}
      onClose={onClose}
      anchorTop={80}
      scrollAll
      bodyClassName="px-[10px] pt-[2px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      {setting.codes.map((entry) => (
        <div key={entry.code} className="h-[39px]">
          <ToggleRow
            checked={active.has(entry.code)}
            onChange={(value) => setActive((current) => { const next = new Set(current); if (value) next.add(entry.code); else next.delete(entry.code); return next })}
            label={`${t(setting.name)} ${entry.code}`}
          />
        </div>
      ))}
    </Modal>
  )
}
