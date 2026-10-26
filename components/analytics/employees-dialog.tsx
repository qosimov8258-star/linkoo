"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

import { LineField } from "@/components/analytics/catalog-ui"
import { LinePick } from "@/components/analytics/settings-list-kit"
import { Check as StaffCheck, MultiSelectField, Switch, type Option } from "@/components/staff/staff-kit"
import type { Employee, EmployeeOptions } from "@/components/analytics/employees-data"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Добавить / Изменить сотрудника" (demo users form): name, phone, job, branches, access switches, organizations and — once
// "Доступ к системе" is on — login, access right, password, subscription, supervisor, stocks, price lists and currencies.

type Draft = {
  firstName: string
  lastName: string
  phone: string
  integrationCode: string
  jobId: string
  branchIds: string[]
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  locationPointIds: string[]
  otherLocation: boolean
  organizationIds: string[]
  login: string
  accessRightId: string
  password: string
  passwordConfirm: string
  licenseKey: string
  supervisorId: string
  deliveryManId: string
  auditAgentIds: string[]
  stockIds: string[]
  requestStockIds: string[]
  priceListIds: string[]
  marketPriceListIds: string[]
  currencyIds: string[]
}

const toStrings = (ids: number[]) => ids.map(String)
const toNumbers = (ids: string[]) => ids.map(Number)

function draftFrom(employee: Employee | null): Draft {
  return {
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    phone: employee?.phone ?? "",
    integrationCode: employee?.integrationCode ?? "",
    jobId: employee?.jobId ? String(employee.jobId) : "",
    branchIds: toStrings(employee?.branchIds ?? []),
    systemAccess: employee?.systemAccess ?? false,
    showInTracking: employee?.showInTracking ?? false,
    twoStepCheck: employee?.twoStepCheck ?? false,
    sessionLimit: employee?.sessionLimit ?? false,
    gpsCheck: employee?.gpsCheck ?? true,
    startPoint: employee?.startPoint ?? false,
    locationPointIds: toStrings(employee?.locationPointIds ?? []),
    otherLocation: false,
    organizationIds: toStrings(employee?.organizationIds ?? []),
    login: employee?.login ?? "",
    accessRightId: employee?.accessRightId ? String(employee.accessRightId) : "",
    password: "",
    passwordConfirm: "",
    licenseKey: "",
    supervisorId: employee?.supervisorId ? String(employee.supervisorId) : "",
    deliveryManId: employee?.deliveryManId ? String(employee.deliveryManId) : "",
    auditAgentIds: toStrings(employee?.auditAgentIds ?? []),
    stockIds: toStrings(employee?.stockIds ?? []),
    requestStockIds: toStrings(employee?.requestStockIds ?? []),
    priceListIds: toStrings(employee?.priceListIds ?? []),
    marketPriceListIds: toStrings(employee?.marketPriceListIds ?? []),
    currencyIds: toStrings(employee?.currencyIds ?? []),
  }
}

function CheckGrid({ items, value, onChange, columns = 3 }: { items: Option[]; value: string[]; onChange: (value: string[]) => void; columns?: number }) {
  const set = new Set(value)
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div key={item.value} className="flex h-[40px] min-w-0 items-center">
          <Check
            className="min-w-0"
            checked={set.has(item.value)}
            onChange={(checked) => onChange(checked ? [...value, item.value] : value.filter((id) => id !== item.value))}
            label={<span className="block max-w-[170px] truncate" title={item.label}>{item.label}</span>}
          />
        </div>
      ))}
    </div>
  )
}

/** The reference keeps the label 2 px after the 24 px checkbox glyph in this dialog. */
function Check(props: Parameters<typeof StaffCheck>[0]) {
  return <StaffCheck {...props} className={`!gap-[2px] ${props.className ?? ""}`} />
}

function Caption({ children, required }: { children: ReactNode; required?: boolean }) {
  return <p className="mb-[6px] mt-[29px] text-[14px] italic text-[#666]">{children}{required && <span className="text-[#f44336]">*</span>}</p>
}

function Field({ children, error }: { children: ReactNode; error?: string }) {
  return (
    <div>
      {children}
      {error && <span className="mt-[2px] block text-[12px] text-[#e57373]">{error}</span>}
    </div>
  )
}

export function EmployeeDialog({
  employee,
  options,
  onClose,
  onSaved,
}: {
  employee: Employee | null
  options: EmployeeOptions
  onClose: () => void
  onSaved: (employee: Employee) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(() => draftFrom(employee))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const required = t("Обязательное поле")
  const accessRight = options.accessRights.find((item) => String(item.id) === draft.accessRightId)
  const isManager = Boolean(accessRight?.groups.includes("Завсклад"))
  const peopleWithGroup = (group: string): Option[] => {
    const rightIds = new Set(options.accessRights.filter((item) => item.groups.includes(group)).map((item) => item.id))
    return options.employees.filter((item) => item.id !== employee?.id && (rightIds.size === 0 || rightIds.has(item.accessRightId ?? -1))).map((item) => ({ value: String(item.id), label: item.name }))
  }
  const supervisors = useMemo(() => peopleWithGroup("Супервайзер"), [options, employee]) // eslint-disable-line react-hooks/exhaustive-deps
  const deliverers = useMemo(() => peopleWithGroup("Доставщик"), [options, employee]) // eslint-disable-line react-hooks/exhaustive-deps
  const agents = useMemo(() => options.employees.filter((item) => item.id !== employee?.id && /агент/i.test(options.accessRights.find((right) => right.id === item.accessRightId)?.name ?? "")).map((item) => ({ value: String(item.id), label: item.name })), [options, employee])

  const jobOptions = options.jobs.map((item) => ({ value: String(item.id), label: item.name }))
  const branchOptions = options.branches.map((item) => ({ value: String(item.id), label: item.name }))
  const orgItems = options.organizations.map((item) => ({ value: String(item.id), label: item.name }))
  const stockItems = options.warehouses.map((item) => ({ value: String(item.id), label: item.name }))
  const priceItems = options.priceLists.map((item) => ({ value: String(item.id), label: item.name }))
  const currencyItems = options.currencies.map((item) => ({ value: String(item.id), label: item.name }))
  const locationOptions = options.startLocations.map((item) => ({ value: String(item.id), label: item.name }))

  function validate(): Record<string, string> {
    const found: Record<string, string> = {}
    if (!draft.firstName.trim()) found.firstName = required
    if (!draft.lastName.trim()) found.lastName = required
    if (!draft.phone.trim()) found.phone = required
    if (!draft.jobId) found.jobId = required
    if (!draft.branchIds.length) found.branchIds = required
    if (!draft.organizationIds.length) found.organizationIds = required
    if (draft.systemAccess) {
      if (!draft.login.trim()) found.login = required
      if (!draft.accessRightId) found.accessRightId = required
      if (draft.password !== draft.passwordConfirm) found.passwordConfirm = t("Пароли не совпадают")
    }
    return found
  }

  async function save() {
    if (saving) return
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const withAccess = draft.systemAccess
      const response = await fetch(employee ? `/api/employees/${employee.id}` : "/api/employees", {
        method: employee ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          phone: draft.phone.trim(),
          integrationCode: draft.integrationCode.trim(),
          jobId: Number(draft.jobId),
          branchIds: toNumbers(draft.branchIds),
          organizationIds: toNumbers(draft.organizationIds),
          systemAccess: draft.systemAccess,
          showInTracking: draft.showInTracking,
          twoStepCheck: draft.twoStepCheck,
          sessionLimit: draft.sessionLimit,
          gpsCheck: draft.gpsCheck,
          startPoint: draft.startPoint,
          locationPointIds: draft.startPoint ? toNumbers(draft.locationPointIds) : [],
          login: withAccess ? draft.login.trim() : "",
          accessRightId: withAccess && draft.accessRightId ? Number(draft.accessRightId) : null,
          password: withAccess ? draft.password : "",
          licenseKey: !employee && withAccess ? draft.licenseKey : "",
          supervisorId: draft.supervisorId ? Number(draft.supervisorId) : null,
          deliveryManId: draft.deliveryManId ? Number(draft.deliveryManId) : null,
          auditAgentIds: toNumbers(draft.auditAgentIds),
          stockIds: toNumbers(draft.stockIds),
          requestStockIds: toNumbers(draft.requestStockIds),
          priceListIds: toNumbers(draft.priceListIds),
          marketPriceListIds: toNumbers(draft.marketPriceListIds),
          currencyIds: toNumbers(draft.currencyIds),
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> }
        if (body.fields && Object.keys(body.fields).length) setErrors(Object.fromEntries(Object.entries(body.fields).map(([key, message]) => [key, t(message)])))
        else notify(t(body.error || "Не удалось сохранить сотрудника"))
        return
      }
      onSaved((await response.json()) as Employee)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 pt-[80px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[768px] max-w-full bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[10px]">
          <h3 className="text-[13px] font-bold uppercase">{employee ? t("Изменить сотрудника") : t("Добавить сотрудника")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70"><X className="h-6 w-6" strokeWidth={1.6} /></button>
        </header>
        <div className="px-[30px] pb-[14px] pt-[14px]">
          <div className="flex items-start gap-[27px] pr-[16px]">
            <div className="min-w-0 flex-1 space-y-[12px]">
              <Field error={errors.firstName}><LineField label={t("Имя")} required value={draft.firstName} onChange={(firstName) => patch({ firstName })} /></Field>
              <Field error={errors.lastName}><LineField label={t("Фамилия")} required value={draft.lastName} onChange={(lastName) => patch({ lastName })} /></Field>
              <Field error={errors.phone}><LineField label={t("Телефон")} required value={draft.phone} onChange={(phone) => patch({ phone })} /></Field>
              <LineField label={t("Код для интеграции")} value={draft.integrationCode} onChange={(integrationCode) => patch({ integrationCode })} />
              <div className="pt-[16px]">
                <Field error={errors.jobId}><LinePick label={t("Должность")} required value={draft.jobId} options={jobOptions} onChange={(jobId) => patch({ jobId })} /></Field>
              </div>
              <Field error={errors.branchIds}><div className="-mt-[6px]"><MultiSelectField label={t("Филиалы")} required options={branchOptions} value={draft.branchIds} onChange={(branchIds) => patch({ branchIds })} /></div></Field>
            </div>
            <div className="mt-[16px] flex h-[145px] w-[150px] shrink-0 flex-col items-center justify-center gap-[3px] border border-dashed border-[#ddd] text-[13px] text-[#555]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#bdbdbd]"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
              {t("Добавьте фото")}
            </div>
          </div>

          <div className="mt-[15px] flex w-[692px] max-w-full items-center justify-between">
            <Check className="!pr-[10px]" checked={draft.systemAccess} onChange={(systemAccess) => patch({ systemAccess })} label={t("Доступ к системе")} />
            <Check className="!pr-[10px]" checked={draft.showInTracking} onChange={(showInTracking) => patch({ showInTracking })} label={t("Показывать в отслеживании")} />
            <Check className="!pr-[10px]" checked={draft.twoStepCheck} onChange={(twoStepCheck) => patch({ twoStepCheck })} label={t("Двухэтапная проверка")} />
          </div>
          <div className="mt-[26px]">
            <Check checked={draft.sessionLimit} onChange={(sessionLimit) => patch({ sessionLimit })} label={t("Поставить ограничения на сессию (может работать только на одном устройстве)")} />
          </div>
          <div className="-ml-[5px] mt-[22px]">
            <Switch checked={draft.gpsCheck} onChange={(gpsCheck) => patch({ gpsCheck })} label={draft.gpsCheck ? t("Проверка GPS включена") : t("Проверка GPS отключено")} tone={draft.gpsCheck ? "#71ce87" : "#fa8072"} />
          </div>
          <div className="-ml-[5px] mt-[19px]">
            <Switch checked={draft.startPoint} onChange={(startPoint) => patch({ startPoint })} label={t("Указать исходную точку")} hint={t("Для автоматического формирования маршрута")} />
          </div>
          {draft.startPoint && (
            <div className="mt-[20px] w-[400px] max-w-full">
              <MultiSelectField label={t("Точки локации")} options={locationOptions} value={draft.locationPointIds} onChange={(locationPointIds) => patch({ locationPointIds })} />
              <div className="mt-[6px]"><Check checked={draft.otherLocation} onChange={(otherLocation) => patch({ otherLocation })} label={t("Другая локация")} /></div>
            </div>
          )}

          <Caption required>{t("Организации")}</Caption>
          <Field error={errors.organizationIds}>
            <CheckGrid items={orgItems} value={draft.organizationIds} onChange={(organizationIds) => patch({ organizationIds })} />
          </Field>

          {draft.systemAccess && (
            <>
              <div className="mt-[16px] grid grid-cols-2 gap-x-[20px] gap-y-[8px]">
                <Field error={errors.login}><LineField label={t("Логин")} required value={draft.login} onChange={(login) => patch({ login })} /></Field>
                <LineField label={employee ? t("Изменить пароль") : t("Пароль")} value={draft.password} onChange={(password) => patch({ password })} />
                <Field error={errors.accessRightId}>
                  <LinePick label={t("Права доступа")} required value={draft.accessRightId} options={options.accessRights.map((item) => ({ value: String(item.id), label: item.name }))} onChange={(accessRightId) => patch({ accessRightId })} />
                </Field>
                <Field error={errors.passwordConfirm}><LineField label={t("Подтвердите пароль")} value={draft.passwordConfirm} onChange={(passwordConfirm) => patch({ passwordConfirm })} /></Field>
              </div>
              {!employee && (
                <div className="mt-[8px]">
                  <LinePick
                    label={t("Подписка")}
                    value={draft.licenseKey}
                    options={options.licenses.map((license) => ({ value: license.key, label: `${license.name} - ${t("Доступно")} ${license.available} ${t("шт.")}` }))}
                    onChange={(licenseKey) => patch({ licenseKey })}
                  />
                </div>
              )}
              <div className="mt-[8px]"><LinePick label={t("Супервайзер")} value={draft.supervisorId} options={supervisors} onChange={(supervisorId) => patch({ supervisorId })} /></div>
              <div className="mt-[8px]"><LinePick label={t("Связанный доставщик")} value={draft.deliveryManId} options={deliverers} onChange={(deliveryManId) => patch({ deliveryManId })} /></div>
              <div className="mt-[8px]"><MultiSelectField label={t("Агенты для аудита")} options={agents} value={draft.auditAgentIds} onChange={(auditAgentIds) => patch({ auditAgentIds })} /></div>
              {accessRight && (
                <>
                  <Caption>{t("Связанные склады")}</Caption>
                  <CheckGrid items={stockItems} value={draft.stockIds} onChange={(stockIds) => patch({ stockIds })} />
                  {isManager && (
                    <>
                      <Caption>{t("Может отправить запрос к этим складам")}</Caption>
                      <CheckGrid items={stockItems} value={draft.requestStockIds} onChange={(requestStockIds) => patch({ requestStockIds })} />
                    </>
                  )}
                </>
              )}
              <Caption>{t("Поддерживаемый прайс лист")}</Caption>
              <CheckGrid items={priceItems} value={draft.priceListIds} onChange={(priceListIds) => patch({ priceListIds })} />
              <div className="mt-[16px]">
                <MultiSelectField label={t("Поддерживаемый прайс лист клиентов")} placeholder={t("Выберите из списка")} options={priceItems} value={draft.marketPriceListIds} onChange={(marketPriceListIds) => patch({ marketPriceListIds })} />
              </div>
              <Caption>{t("Валюты")}</Caption>
              <CheckGrid items={currencyItems} value={draft.currencyIds} onChange={(currencyIds) => patch({ currencyIds })} />
            </>
          )}
        </div>
        <footer className="sticky bottom-0 flex h-[57px] items-center justify-end border-t border-[#e8ebf0] bg-white pr-[10px]">
          <button type="button" onClick={() => void save()} disabled={saving} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:opacity-80 disabled:opacity-40">{t("Сохранить")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
