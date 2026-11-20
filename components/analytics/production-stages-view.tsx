"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { Pencil, Plus } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { CashSnackbar, SearchSelect, useCanManage, type PickOption, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { ActivityTab } from "@/components/analytics/production/stage-activity"
import { deleteRecord, EquipmentTab, OperationsTab, PRODUCTION_WRITE, ProductsTab, RollerLoader, StaffTab, type Equipment, type StaffMember } from "@/components/analytics/production/stage-tabs"
import { Field, inputClass, Modal, SaveButton, useApiData, type Stage } from "@/components/analytics/production/production-ui"
import { notify } from "@/lib/notify"

type Tab = "products" | "operations" | "staff" | "equipment" | "activity"
type View = { stageId: number | null; tab: Tab }
type Warehouse = { id: number; name: string }
type Employee = { id: number; name: string; active?: boolean; job?: string }

const TABS: Array<[Tab, string]> = [
  ["products", "Продукция"],
  ["operations", "Операции"],
  ["staff", "Персонал"],
  ["equipment", "Оборудование"],
  ["activity", "Активность"],
]

const CARD_SHADOW = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

/** Twin of the server's textKey: names match case- and spacing-insensitively (NBSP counts as a space). */
const nameKey = (value: string | null | undefined) =>
  String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

/** ?stage={id}&tab={tab} — the reference's #/manufacture/{tab}/{id}. */
function readView(params: URLSearchParams): View {
  const id = Number(params.get("stage"))
  const value = params.get("tab")
  return { stageId: Number.isSafeInteger(id) && id > 0 ? id : null, tab: TABS.find(([key]) => key === value)?.[0] ?? "products" }
}

/** The stage list of this browser tab. The reference loads it once per session, so a later visit shows the list at
 * once (and refreshes it behind). Written by effects only, so the server render never sees it. */
let stageListCache: Stage[] | null = null

export function ProductionStagesView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const canManage = useCanManage(PRODUCTION_WRITE)
  const { data: stageList, setData: setStageList, reload: reloadStages, loading } = useApiData<Stage[] | null>("/api/production/stages", stageListCache)
  // The first response decides: until then the reference's loader, never a false «Этапов пока нет».
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle")
  useEffect(() => {
    if (loading) setPhase("loading")
    else setPhase((current) => (current === "loading" ? "done" : current))
  }, [loading])
  useEffect(() => {
    if (stageList) stageListCache = stageList
  }, [stageList])
  const stages = useMemo(() => stageList ?? [], [stageList])
  const listLoading = stageList === null && phase !== "done"

  // Like the reference, every stage or tab click is a history entry (Back returns to the previous stage and tab,
  // Forward again) and a reload or a shared link opens the same view. An unknown or deleted stage id stays in the
  // address with nothing selected.
  const [view, setView] = useState<View>(() => readView(new URLSearchParams(searchParams.toString())))
  // The address decides the view, whoever changed it: go() below, Back / Forward, or an in-app link that changes only
  // the query. Next keeps this page mounted across such a link, so the view follows the router's search params (the
  // top menu's «Этапы производства» returns to the unselected list on Продукция, as the reference's does). The
  // address itself is read: during quick clicks the router may still hold an earlier one.
  const stageParam = searchParams.get("stage")
  const tabParam = searchParams.get("tab")
  useEffect(() => {
    const next = readView(new URLSearchParams(window.location.search))
    setView((current) => (current.stageId === next.stageId && current.tab === next.tab ? current : next))
  }, [stageParam, tabParam])

  function go(next: View, mode: "push" | "replace" = "push") {
    const params = new URLSearchParams(window.location.search)
    // A tab switch drops the previous tab's own state (the reference pushes the bare tab route); a stage switch
    // keeps it (the operations list, for one, is the same under every stage).
    if (next.tab !== view.tab) for (const key of [...params.keys()]) if (key !== "stage" && key !== "tab") params.delete(key)
    if (next.stageId !== null) params.set("stage", String(next.stageId))
    else params.delete("stage")
    if (next.tab !== "products") params.set("tab", next.tab)
    else params.delete("tab")
    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`
    if (url !== `${window.location.pathname}${window.location.search}`) {
      // No state of our own: Next's patched history methods then keep theirs on the entry and move the router (and
      // so its search params, which the view follows) to this address as well.
      if (mode === "push") window.history.pushState(null, "", url)
      else window.history.replaceState(null, "", url)
    }
    setView(next)
  }

  const stage = stages.find((entry) => entry.id === view.stageId) ?? null
  const [stageDialog, setStageDialog] = useState<Stage | "new" | null>(null)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const closeMessage = useCallback(() => setMessage(null), [])

  const { data: allEquipment, reload: reloadEquipment } = useApiData<Equipment[]>(stage ? `/api/production/equipment?stageId=${stage.id}` : null, [])
  const { data: allStaff, reload: reloadStaff } = useApiData<StaffMember[]>(stage ? `/api/production/staff?stageId=${stage.id}` : null, [])
  // Until the selected stage's lists arrive, the previous stage's are still in state.
  const equipment = allEquipment.filter((entry) => entry.stageId === stage?.id)
  const staff = allStaff.filter((entry) => entry.stageId === stage?.id)

  return (
    <RefPage>
      <RefHeader title={t("Этапы производства")} />

      {/* Below md (phones) the stage list stands above the tab content, and the tabs scroll in their bar. */}
      <div className="-mx-7 flex flex-col md:flex-row md:items-start">
        <aside className="w-full font-sans text-[13px] text-[#333] md:w-[280px] md:shrink-0">
          <div className="flex h-[57px] items-center justify-between pl-[30px] pr-[10px]">
            <h2 className="text-[13px] font-bold">{t("Этапы производства")}</h2>
            {/* The reference provisions stages itself; here a company that migrated manages them (Mezon's own). */}
            {canManage && (
              <button type="button" onClick={() => setStageDialog("new")} aria-label={t("Добавить этап")} title={t("Добавить этап")} className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[#1E4A9A] text-white hover:brightness-110">
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* The reference's list: a white card, rows #f2f5f8 with #efefef lines (no hover change), the selected one
              white after a 0.3 s fade, icons at 80 %. */}
          <div className={`bg-white ${CARD_SHADOW}`}>
            {listLoading ? (
              <RollerLoader className="h-[300px] pt-[100px]" />
            ) : (
              <ul className="border-r border-[#efefef]">
                {stages.map((entry) => (
                  <li key={entry.id} className={`group flex h-[50px] items-center border-b border-[#efefef] transition-colors duration-300 ease-in-out ${view.stageId === entry.id ? "bg-white" : "bg-[#f2f5f8]"}`}>
                    <button type="button" onClick={() => go({ stageId: entry.id, tab: view.tab })} className="flex h-full min-w-0 flex-1 cursor-pointer items-center pl-[30px] text-left">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/production-stage.svg" alt="" className="mr-[10px] h-5 w-5 shrink-0 opacity-80" />
                      {/* A stored name: the page translator must not touch it (it rewrote «этап 1» and dropped digits). */}
                      <span data-no-translate className="truncate">
                        {entry.name}
                      </span>
                    </button>
                    {canManage && (
                      <button type="button" onClick={() => setStageDialog(entry)} aria-label={t("Изменить")} title={t("Изменить")} className="mr-3 p-1 text-[#9aa1ae] opacity-0 hover:text-[#1E4A9A] focus:opacity-100 group-hover:opacity-100">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
                {/* Only after a response with no stages, and only to whoever can add one. */}
                {stageList !== null && !stages.length && canManage && <li className="px-6 py-8 text-center text-[#888]">{t("Этапов пока нет — добавьте первый этап")}</li>}
              </ul>
            )}
          </div>
        </aside>

        <section className="mx-7 mt-5 min-w-0 md:mx-[30px] md:mt-0 md:flex-1">
          <nav className={`flex h-[54px] overflow-x-auto bg-white text-[13px] text-black ${CARD_SHADOW}`}>
            {TABS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => go({ stageId: view.stageId, tab: value })} className={`h-[54px] shrink-0 whitespace-nowrap px-[6px] font-[Arial,sans-serif] ${view.tab === value ? "cursor-default" : "cursor-pointer"}`}>
                <span className={`flex h-[52px] items-center border-b-2 px-[20px] transition-all duration-300 ${view.tab === value ? "border-[#1E4A9A] font-semibold text-[#1E4A9A]" : "border-transparent"}`}>{t(label)}</span>
              </button>
            ))}
          </nav>

          {view.tab === "operations" ? (
            // Operations are global (the reference lists them all, with or without a stage).
            <OperationsTab />
          ) : !stage ? (
            view.stageId !== null && listLoading ? (
              <div className={`mt-5 ${CARD_SHADOW}`}>
                <RollerLoader className="h-[294px] pt-[100px]" />
              </div>
            ) : (
              <div className={`mt-5 flex h-[294px] flex-col items-center justify-center bg-white ${CARD_SHADOW}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/robot-empty.png" alt="" className="w-[196px]" />
                <p className="-mt-[8px] text-[15px] text-[#666]">{t("Выберите производство...")}</p>
              </div>
            )
          ) : (
            <div key={stage.id}>
              {view.tab === "products" && <ProductsTab stage={stage} equipment={equipment} />}
              {view.tab === "staff" && <StaffTab stage={stage} staff={staff} reload={reloadStaff} />}
              {view.tab === "equipment" && <EquipmentTab stage={stage} equipment={equipment} reload={reloadEquipment} />}
              {view.tab === "activity" && <ActivityTab stage={stage} equipment={equipment} staff={staff} />}
            </div>
          )}
        </section>
      </div>

      {stageDialog && (
        <StageDialog
          stage={stageDialog === "new" ? null : stageDialog}
          onClose={() => setStageDialog(null)}
          onSaved={(saved) => {
            const created = stageDialog === "new"
            setStageDialog(null)
            // Shown at once (the list is id DESC, a new stage first), then refreshed.
            setStageList((current) => (created ? [saved, ...(current ?? []).filter((entry) => entry.id !== saved.id)] : (current ?? []).map((entry) => (entry.id === saved.id ? saved : entry))))
            reloadStages()
            // A new stage opens; an edited one leaves the selection alone.
            if (created) {
              go({ stageId: saved.id, tab: view.tab })
              setMessage({ text: "Успешно сохранено", tone: "success" })
            }
          }}
          onDeleted={(id) => {
            setStageDialog(null)
            setStageList((current) => (current ?? []).filter((entry) => entry.id !== id))
            reloadStages()
            if (view.stageId === id) go({ stageId: null, tab: view.tab }, "replace")
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeMessage} />
    </RefPage>
  )
}

type StageField = "name" | "warehouse" | "responsible"
const FIELD_ERROR = "mt-1 block text-[12px] font-normal text-[#f44336]"
/** Select values of what the stage holds but the lists do not offer (a deactivated warehouse, a free-text
 * responsible of older data): kept as they are on save. */
const CURRENT = "current"

/** «Добавление / Изменение этапа» (Mezon's own: the reference has no stage form). Склад and Ответственный are
 * searchable and picked by id; the messages are the app's, under the fields. */
function StageDialog({ stage, onClose, onSaved, onDeleted }: { stage: Stage | null; onClose: () => void; onSaved: (stage: Stage) => void; onDeleted: (id: number) => void }) {
  const { t } = useLanguage()
  const { data: warehouses, loading: warehousesLoading } = useApiData<Warehouse[]>("/api/warehouses", [])
  const { data: employees, loading: employeesLoading } = useApiData<Employee[]>("/api/employees", [])
  const [name, setName] = useState(stage?.name ?? "")
  const [warehousePick, setWarehousePick] = useState<string | null>(null)
  const initialResponsible = stage?.responsibleId ? String(stage.responsibleId) : stage?.responsible ? CURRENT : ""
  const [responsibleValue, setResponsibleValue] = useState(initialResponsible)
  const [errors, setErrors] = useState<Partial<Record<StageField, string>>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const clear = (field: StageField) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  // The stock keys a warehouse by its name, so same-named warehouses are one: one option per name, by name.
  const warehouseOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: PickOption[] = []
    for (const entry of [...warehouses].sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
      const key = nameKey(entry.name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      options.push({ value: String(entry.id), label: entry.name })
    }
    return options
  }, [warehouses])
  const currentWarehouse = stage?.warehouse ?? ""
  const matchedWarehouse = currentWarehouse ? warehouseOptions.find((option) => nameKey(option.label) === nameKey(currentWarehouse)) : undefined
  const warehouseValue = warehousePick ?? matchedWarehouse?.value ?? (currentWarehouse ? CURRENT : "")

  // Active employees (and the current responsible); namesakes show their position and number. The picker is kept
  // from the page translator (the names are data), so the position goes through t() here: it is shown translated,
  // as on Сотрудники (the default positions «Агент», «Доставщик» … are dictionary texts).
  const employeeOptions = useMemo(() => {
    const shown = employees.filter((entry) => entry.active !== false || entry.id === stage?.responsibleId)
    const counts = new Map<string, number>()
    for (const entry of shown) counts.set(nameKey(entry.name), (counts.get(nameKey(entry.name)) ?? 0) + 1)
    const job = (entry: Employee) => (entry.job ? t(entry.job) : "")
    return [...shown]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((entry): PickOption => ({ value: String(entry.id), label: entry.name, hint: (counts.get(nameKey(entry.name)) ?? 0) > 1 ? [job(entry), `№${entry.id}`].filter(Boolean).join(" · ") : job(entry) || undefined }))
  }, [employees, stage?.responsibleId, t])

  function validate(): Partial<Record<StageField, string>> {
    const found: Partial<Record<StageField, string>> = {}
    if (!name.trim()) found.name = "Заполните наименование"
    else if (name.trim().length > 255) found.name = "Не более 255 символов"
    if (!warehouseValue) found.warehouse = "Укажите склад"
    return found
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const found = validate()
    if (Object.keys(found).length) {
      setErrors(found)
      return
    }
    const warehouse =
      warehouseValue === CURRENT ? { warehouse: currentWarehouse } : { warehouseId: Number(warehouseValue), warehouse: warehouseOptions.find((option) => option.value === warehouseValue)?.label ?? "" }
    const responsible =
      responsibleValue === ""
        ? { responsible: "", responsibleId: null }
        : responsibleValue === CURRENT
          ? { responsible: stage?.responsible ?? "", responsibleId: null }
          : { responsible: employeeOptions.find((option) => option.value === responsibleValue)?.label ?? stage?.responsible ?? "", responsibleId: Number(responsibleValue) }
    setSaving(true)
    try {
      const response = await fetch(stage ? `/api/production/stages/${stage.id}` : "/api/production/stages", {
        method: stage ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...warehouse, ...responsible }),
      })
      const data = (await response.json().catch(() => ({}))) as Stage & { error?: unknown; field?: unknown }
      if (response.ok) {
        onSaved(data)
        return
      }
      const text = typeof data.error === "string" && data.error ? data.error : "Не удалось выполнить запрос"
      // 409 here is the duplicate name.
      const field = data.field === "warehouseId" ? "warehouse" : data.field === "responsibleId" ? "responsible" : data.field === "name" || data.field === "warehouse" || data.field === "responsible" ? data.field : response.status === 409 ? "name" : null
      if (field) setErrors({ [field]: text })
      else notify(text)
    } catch {
      notify("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!stage || deleting || !(await askDelete(stage.name))) return
    setDeleting(true)
    // A stage that still holds anything is refused with what holds it: «…: Партии (1), Персонал (2)».
    const failure = await deleteRecord(`/api/production/stages/${stage.id}`, t)
    setDeleting(false)
    if (failure) notify(failure)
    else onDeleted(stage.id)
  }

  return (
    <Modal
      title={t(stage ? "Изменение этапа" : "Добавление этапа")}
      tall
      closeOnEscape
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {stage && (
            <button type="button" onClick={remove} disabled={deleting} className="ml-[30px] mr-auto text-sm text-red-500 hover:underline disabled:opacity-50">
              {t("Удалить")}
            </button>
          )}
          <SaveButton saving={saving} />
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Наименование" required>
          <input value={name} onChange={(event) => { setName(event.target.value); clear("name") }} aria-invalid={Boolean(errors.name)} className={`${inputClass} ${errors.name ? "!border-[#f44336]" : ""}`} />
          {errors.name && <span className={FIELD_ERROR}>{t(errors.name)}</span>}
        </Field>
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">
            {t("Склад")} <span className="text-[#f44336]">*</span>
          </span>
          {/* Stored warehouse / employee names: rawLabels keeps them from the page translator (the picker's own texts
              go through t()). */}
          <SearchSelect
            variant="underline"
            rawLabels
            value={warehouseValue}
            onChange={(value) => { setWarehousePick(value); clear("warehouse") }}
            options={warehouseOptions}
            selectedLabel={warehouseValue === CURRENT ? currentWarehouse : undefined}
            loading={warehousesLoading}
            invalid={Boolean(errors.warehouse)}
          />
          {errors.warehouse && <span className={FIELD_ERROR}>{t(errors.warehouse)}</span>}
        </div>
        <p className="-mt-3 text-xs text-slate-500">{t("Сырье списывается с этого склада, готовая продукция поступает на него.")}</p>
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">{t("Ответственный")}</span>
          <SearchSelect
            variant="underline"
            rawLabels
            value={responsibleValue}
            onChange={(value) => { setResponsibleValue(value); clear("responsible") }}
            options={employeeOptions}
            selectedLabel={responsibleValue === initialResponsible ? stage?.responsible : undefined}
            loading={employeesLoading}
            invalid={Boolean(errors.responsible)}
          />
          {errors.responsible && <span className={FIELD_ERROR}>{t(errors.responsible)}</span>}
        </div>
      </div>
    </Modal>
  )
}
