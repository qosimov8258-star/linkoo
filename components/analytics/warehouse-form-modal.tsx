"use client"

import { ExternalLink, Loader2, MapPin, X } from "lucide-react"
import dynamic from "next/dynamic"
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react"

import { SearchSelect, type PickOption } from "@/components/analytics/cash-management-shared"
import { MaterialBody, MaterialCheckbox, MaterialDialog, MaterialFooter } from "@/components/analytics/cash-material"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  WAREHOUSES_API,
  WAREHOUSE_STOCK_TYPES,
  warehouseMapUrl,
  warehouseNameKey,
  type Warehouse,
  type WarehouseDetail,
  type WarehouseErrorBody,
  type WarehouseField,
  type WarehousePayload,
  type WarehouseStockType,
} from "./warehouses-data"

// "Добавить склад" / "Изменить склад" (demo module 4351, form StockCreateForm):
// Наименование ★, Полное наименование, Адрес ★, Филиал ★, Зав. склад ★, Тип склада ★,
// Комментарий..., Вэнсел, Отслеживать минимальный остаток, Склад возврата, Активный and
// "отметить местоположение на карте" (Leaflet picker of the clients page; once set: the
// point, "Изменить" and a link that opens it on the map). Employees come from
// GET /api/employees, branches from GET /api/branches; an edited row whose stored branch /
// manager is not in those lists keeps it unchanged. Branch and manager are required like
// in the demo as soon as there is something to pick.
// Shared by the "Склады" page and every "+добавить" shortcut (Приход от поставщика,
// Возврат поставщику, …), so a warehouse created anywhere has the same fields.

const LocationPicker = dynamic(() => import("@/components/clients/location-picker").then((module) => module.LocationPicker), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <Loader2 className="h-8 w-8 animate-spin text-white" />
    </div>
  ),
})

/** Select value of a stored branch / manager that is not in the option list. */
const LEGACY = "legacy"
const REQUIRED = "Обязательное поле"

type Draft = {
  name: string
  fullName: string
  address: string
  branch: string
  manager: string
  stockType: WarehouseStockType | ""
  comment: string
  online: boolean
  trackMinAmount: boolean
  forReturn: boolean
  active: boolean
  lat: number | null
  lon: number | null
}
type Errors = Partial<Record<WarehouseField, string>>
type EmployeeOption = { id: number; name: string; position?: string; active?: boolean }
type BranchOption = { id: number; name: string }
type Options = { employees: EmployeeOption[]; branches: BranchOption[] }

const EMPTY_DRAFT: Draft = {
  name: "",
  fullName: "",
  address: "",
  branch: "",
  manager: "",
  stockType: "",
  comment: "",
  online: false,
  trackMinAmount: false,
  forReturn: false,
  active: true,
  lat: null,
  lon: null,
}

/** Maps a server field name to the dialog field. */
const FIELD_ALIASES: Record<string, WarehouseField> = {
  name: "name",
  fullName: "fullName",
  full_name: "fullName",
  address: "address",
  branch: "branch",
  branchId: "branch",
  manager: "manager",
  managerId: "manager",
  stock_manager: "manager",
  stockType: "stockType",
  stock_type: "stockType",
  comment: "comment",
  location: "location",
  lat: "location",
  lon: "location",
}

function requestErrors(body: WarehouseErrorBody, fallback: string): { fields: Errors; general: string } {
  const fields: Errors = {}
  for (const [key, message] of Object.entries(body.fields ?? {})) if (message && FIELD_ALIASES[key]) fields[FIELD_ALIASES[key]] ??= message
  for (const [key, messages] of Object.entries(body.details?.fieldErrors ?? {})) if (messages?.[0] && FIELD_ALIASES[key]) fields[FIELD_ALIASES[key]] ??= messages[0]
  return { fields, general: Object.keys(fields).length ? "" : body.error || fallback }
}

function draftFromWarehouse(warehouse: WarehouseDetail, options: Options): Draft {
  const employee =
    options.employees.find((item) => warehouse.managerId !== null && item.id === warehouse.managerId) ??
    options.employees.find((item) => warehouse.manager && warehouseNameKey(item.name) === warehouseNameKey(warehouse.manager))
  const branch = options.branches.find((item) => warehouse.branch && warehouseNameKey(item.name) === warehouseNameKey(warehouse.branch))
  return {
    name: warehouse.name,
    fullName: warehouse.fullName,
    address: warehouse.address,
    branch: branch ? String(branch.id) : warehouse.branch ? LEGACY : "",
    manager: employee ? String(employee.id) : warehouse.manager ? LEGACY : "",
    stockType: warehouse.stockType,
    comment: warehouse.comment,
    online: warehouse.online,
    trackMinAmount: warehouse.trackMinAmount,
    forReturn: warehouse.forReturn,
    active: warehouse.active,
    lat: warehouse.lat,
    lon: warehouse.lon,
  }
}

function validate(draft: Draft, options: Options | null): Errors {
  const errors: Errors = {}
  if (!draft.name.trim()) errors.name = REQUIRED
  if (!draft.address.trim()) errors.address = REQUIRED
  if (!draft.stockType) errors.stockType = REQUIRED
  if (!draft.branch && (options?.branches.length ?? 0) > 0) errors.branch = REQUIRED
  if (!draft.manager && (options?.employees.length ?? 0) > 0) errors.manager = REQUIRED
  return errors
}

async function loadJson<T>(url: string, signal: AbortSignal, fallback: string): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" })
  const body = (await response.json().catch(() => ({}))) as T & WarehouseErrorBody
  if (!response.ok) throw new Error(body.error || fallback)
  return body
}

export function WarehouseFormModal({
  warehouse = null,
  warehouseId = null,
  onClose,
  onSaved,
}: {
  /** Row to edit (its id is used; the dialog loads the full row). */
  warehouse?: Warehouse | null
  /** null (and no `warehouse`) = create. */
  warehouseId?: number | null
  onClose: () => void
  onSaved: (warehouse: WarehouseDetail) => void
}) {
  const { t } = useLanguage()
  const editId = warehouseId ?? warehouse?.id ?? null
  const isEdit = editId !== null
  const [options, setOptions] = useState<Options | null>(null)
  const [stored, setStored] = useState<WarehouseDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState("")
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      loadJson<EmployeeOption[]>("/api/employees", controller.signal, "Не удалось загрузить данные").catch(() => []),
      loadJson<BranchOption[]>("/api/branches", controller.signal, "Не удалось загрузить данные").catch(() => []),
      editId === null ? Promise.resolve(null) : loadJson<WarehouseDetail>(`${WAREHOUSES_API}/${editId}`, controller.signal, "Склад не найден"),
    ])
      .then(([employees, branches, loaded]) => {
        const next = { employees: Array.isArray(employees) ? employees : [], branches: Array.isArray(branches) ? branches : [] }
        setOptions(next)
        setStored(loaded)
        setDraft(loaded ? draftFromWarehouse(loaded, next) : EMPTY_DRAFT)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [editId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mapOpen) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, mapOpen])

  const legacy = stored && options ? draftFromWarehouse(stored, options) : null

  const managerOptions = useMemo<PickOption[]>(() => {
    const list = (options?.employees ?? [])
      .filter((item) => item.active !== false || String(item.id) === draft?.manager)
      .map((item) => ({ value: String(item.id), label: item.name, hint: item.position ? t(item.position) : undefined }))
    if (stored && legacy?.manager === LEGACY) list.unshift({ value: LEGACY, label: stored.manager, hint: t("Нет в списке сотрудников") })
    return list
  }, [options, stored, legacy?.manager, draft?.manager, t])

  const branchOptions = useMemo<PickOption[]>(() => {
    const list = (options?.branches ?? []).map((item) => ({ value: String(item.id), label: item.name }))
    if (stored && legacy?.branch === LEGACY) list.unshift({ value: LEGACY, label: stored.branch })
    return list
  }, [options, stored, legacy?.branch])

  const typeOptions = useMemo<PickOption[]>(() => WAREHOUSE_STOCK_TYPES.map((item) => ({ value: item.value, label: t(item.label) })), [t])

  function change(patch: Partial<Draft>, field: WarehouseField | null) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    if (field) setServerErrors((current) => ({ ...current, [field]: undefined }))
    setError("")
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (!draft || saving) return
    setTouched(true)
    if (Object.keys(validate(draft, options)).length) return
    const payload: WarehousePayload = {
      name: draft.name.trim(),
      fullName: draft.fullName.trim(),
      address: draft.address.trim(),
      stockType: draft.stockType || "basic",
      comment: draft.comment.trim(),
      online: draft.online,
      trackMinAmount: draft.trackMinAmount,
      forReturn: draft.forReturn,
      active: draft.active,
      lat: draft.lat,
      lon: draft.lon,
      ...(draft.branch === LEGACY ? {} : { branchId: draft.branch ? Number(draft.branch) : null }),
      ...(draft.manager === LEGACY ? {} : { managerId: draft.manager ? Number(draft.manager) : null }),
    }
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${WAREHOUSES_API}/${editId}` : WAREHOUSES_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as WarehouseDetail & WarehouseErrorBody
      if (!response.ok) {
        const errors = requestErrors(body, "Не удалось сохранить склад")
        setServerErrors(errors.fields)
        setError(errors.general)
        return
      }
      onSaved(body)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const clientErrors = touched && draft ? validate(draft, options) : {}
  const fieldError = (field: WarehouseField) => {
    const message = clientErrors[field] || serverErrors[field]
    return message ? t(message) : ""
  }
  const busy = saving || (!draft && !loadError)
  const hasPoint = draft?.lat != null && draft?.lon != null

  const text = (field: WarehouseField, value: string, onChange: (next: string) => void, maxLength: number, label: string, required?: boolean, gap?: number) => (
    <MField label={label} required={required} filled={Boolean(value)} error={fieldError(field)} gap={gap}>
      <input
        aria-label={label}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={`absolute inset-x-0 bottom-0 h-[26px] border-b bg-transparent text-[13px] outline-none ${fieldError(field) ? "border-[#f44336]" : "border-[#e0e0e0]"}`}
      />
    </MField>
  )

  return (
    <>
      <MaterialDialog
        title={isEdit ? t("Изменить склад") : t("Добавить склад")}
        onClose={onClose}
        width={500}
        maxHeight={540}
        closeInset={15}
        onSubmit={() => void save()}
        footer={<MaterialFooter label={saving ? t("Сохранение...") : t("Сохранить")} busy={busy} disabled={Boolean(loadError)} error={error ? t(error) : undefined} />}
      >
        <MaterialBody className="relative pb-[24px] pt-[29px]" minHeight={200}>
          {busy && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          {loadError ? (
            <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p>
          ) : (
            draft && (
              <>
                {text("name", draft.name, (value) => change({ name: value }, "name"), 255, t("Наименование"), true)}
                {text("fullName", draft.fullName, (value) => change({ fullName: value }, "fullName"), 255, t("Полное наименование"))}
                {text("address", draft.address, (value) => change({ address: value }, "address"), 500, t("Адрес"), true, 30)}
                <MField label={t("Филиал")} required={branchOptions.length > 0} filled={Boolean(draft.branch)} error={fieldError("branch")} gap={26}>
                  <div className="absolute inset-x-0 bottom-0">
                    <SearchSelect variant="underline" value={draft.branch} onChange={(value) => change({ branch: value }, "branch")} options={branchOptions} invalid={Boolean(fieldError("branch"))} />
                  </div>
                </MField>
                <MField label={t("Завскладь")} required={managerOptions.length > 0} filled={Boolean(draft.manager)} error={fieldError("manager")} gap={26}>
                  <div className="absolute inset-x-0 bottom-0">
                    <SearchSelect variant="underline" value={draft.manager} onChange={(value) => change({ manager: value }, "manager")} options={managerOptions} invalid={Boolean(fieldError("manager"))} />
                  </div>
                </MField>
                <MField label={t("Тип склада")} required filled={Boolean(draft.stockType)} error={fieldError("stockType")} gap={26}>
                  <div className="absolute inset-x-0 bottom-0">
                    <SearchSelect
                      variant="underline"
                      value={draft.stockType}
                      onChange={(value) => change({ stockType: value === "basic" || value === "manufacturing" ? value : "" }, "stockType")}
                      options={typeOptions}
                      invalid={Boolean(fieldError("stockType"))}
                    />
                  </div>
                </MField>
                <MField label={`${t("Комментарий")}...`} filled={Boolean(draft.comment)} error={fieldError("comment")} height={47}>
                  <textarea
                    aria-label={t("Комментарий")}
                    value={draft.comment}
                    maxLength={2000}
                    rows={2}
                    onChange={(event) => change({ comment: event.target.value }, "comment")}
                    className="absolute inset-x-0 bottom-0 h-[44px] resize-none border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none"
                  />
                </MField>
                <div className="grid gap-3 pt-1">
                  <MaterialCheckbox label={t("Вэнсел")} checked={draft.online} onChange={(online) => change({ online }, null)} />
                  <MaterialCheckbox label={t("Отслеживать минимальный остаток")} checked={draft.trackMinAmount} onChange={(trackMinAmount) => change({ trackMinAmount }, null)} />
                  <MaterialCheckbox label={t("Склад возврата")} checked={draft.forReturn} onChange={(forReturn) => change({ forReturn }, null)} />
                  <MaterialCheckbox label={t("Активный")} checked={draft.active} onChange={(active) => change({ active }, null)} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[13px]">
                  {hasPoint ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-[#586174]">
                        <MapPin className="h-4 w-4 text-[#999]" /> {draft.lat!.toFixed(6)} {draft.lon!.toFixed(6)}
                      </span>
                      <button type="button" onClick={() => setMapOpen(true)} className="text-[#129fdd] hover:underline">
                        {t("Изменить")}
                      </button>
                      <a href={warehouseMapUrl(draft.lat!, draft.lon!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#129fdd] hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" /> {t("Открыть на карте")}
                      </a>
                      <button type="button" onClick={() => change({ lat: null, lon: null }, "location")} aria-label={t("Очистить")} title={t("Очистить")} className="text-[#9aa3b6] hover:text-[#e57373]">
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setMapOpen(true)} className="inline-flex items-center gap-1 text-[#129fdd] hover:underline">
                      <MapPin className="h-4 w-4" /> {t("отметить местоположение на карте")}
                    </button>
                  )}
                  {fieldError("location") && <span className="w-full text-[12px] text-[#e57373]">{fieldError("location")}</span>}
                </div>
              </>
            )
          )}
        </MaterialBody>
      </MaterialDialog>
      {mapOpen && draft && (
        <div onMouseDown={(event) => event.stopPropagation()}>
          <LocationPicker
            initialLat={draft.lat ?? undefined}
            initialLng={draft.lon ?? undefined}
            onCancel={() => setMapOpen(false)}
            onConfirm={(lat, lng) => {
              change({ lat: Number(lat.toFixed(6)), lon: Number(lng.toFixed(6)) }, "location")
              setMapOpen(false)
            }}
          />
        </div>
      )}
    </>
  )
}

/** Material field block like the reference: the bold label sits on the underline and floats up (10 px) once filled. */
function MField({ label, required, filled, error, height = 36, gap = 16, children }: { label: string; required?: boolean; filled: boolean; error?: string; height?: number; gap?: number; children: ReactNode }) {
  return (
    <div className="relative" style={{ height, marginBottom: gap }}>
      <span className={`pointer-events-none absolute left-0 z-[1] font-bold text-black ${filled ? "top-[-12px] text-[10px] leading-3" : "bottom-[8px] text-[13px] leading-4"}`}>
        {label}
        {required && <span className="text-[#f44336]"> *</span>}
      </span>
      {children}
      {error && <span className="absolute -bottom-[16px] left-0 text-[11px] text-[#f44336]">{error}</span>}
    </div>
  )
}
