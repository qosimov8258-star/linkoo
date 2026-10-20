"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Factory, Pencil, Plus } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { ActivityTab } from "@/components/analytics/production/stage-activity"
import { EquipmentTab, OperationsTab, ProductsTab, StaffTab, type Equipment, type StaffMember } from "@/components/analytics/production/stage-tabs"
import { api, Field, inputClass, Modal, RobotEmpty, SaveButton, useApiData, type Stage } from "@/components/analytics/production/production-ui"

type Tab = "products" | "operations" | "staff" | "equipment" | "activity"
type Warehouse = { id: number; name: string }
type Employee = { id: number; name: string }

const TABS: Array<[Tab, string]> = [
  ["products", "Продукция"],
  ["operations", "Операции"],
  ["staff", "Персонал"],
  ["equipment", "Оборудование"],
  ["activity", "Активность"],
]

export function ProductionStagesView() {
  const { t } = useLanguage()
  const { data: stages, reload: reloadStages, loading } = useApiData<Stage[]>("/api/production/stages", [])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>("products")
  const [stageDialog, setStageDialog] = useState<Stage | "new" | null>(null)
  const stage = stages.find((entry) => entry.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId !== null && !stages.some((entry) => entry.id === selectedId)) setSelectedId(null)
  }, [selectedId, stages])

  const { data: allEquipment, reload: reloadEquipment } = useApiData<Equipment[]>(stage ? `/api/production/equipment?stageId=${stage.id}` : null, [])
  const { data: allStaff, reload: reloadStaff } = useApiData<StaffMember[]>(stage ? `/api/production/staff?stageId=${stage.id}` : null, [])
  // Until the selected stage's lists arrive, the previous stage's are still in state.
  const equipment = allEquipment.filter((entry) => entry.stageId === stage?.id)
  const staff = allStaff.filter((entry) => entry.stageId === stage?.id)

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 text-slate-800">
      <header className="px-8 py-4">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-semibold text-blue-600" />
          <span className="text-2xl text-slate-500">|</span>
          <span className="text-2xl font-semibold text-slate-600">{t("Этапы производства")}</span>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-8.5rem)] md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-r border-slate-300">
          <div className="flex items-center justify-between border-b border-slate-300 px-6 py-5">
            <h2 className="font-semibold">{t("Этапы производства")}</h2>
            <button onClick={() => setStageDialog("new")} aria-label={t("Добавить этап")} title={t("Добавить этап")} className="rounded bg-[#5b7ce6] p-1.5 text-white">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto">
            {stages.map((entry) => (
              <div key={entry.id} className={`group flex items-center border-b border-slate-200 ${selectedId === entry.id ? "bg-white text-blue-600 shadow-sm" : "hover:bg-white/70"}`}>
                <button onClick={() => setSelectedId(entry.id)} className="flex min-w-0 flex-1 items-center gap-3 px-6 py-4 text-left">
                  <Factory className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="truncate">{entry.name}</span>
                </button>
                <button onClick={() => setStageDialog(entry)} aria-label={t("Изменить")} className="mr-3 p-1 text-slate-400 opacity-0 hover:text-blue-600 group-hover:opacity-100 focus:opacity-100">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            ))}
            {!stages.length && !loading && <p className="px-6 py-8 text-center text-sm text-slate-400">{t("Этапов пока нет — добавьте первый этап")}</p>}
          </div>
        </aside>

        <section className="min-w-0 px-6 pb-10 md:px-8">
          <nav className="grid grid-cols-3 overflow-hidden rounded-sm bg-white shadow sm:grid-cols-5">
            {TABS.map(([value, label]) => (
              <button key={value} onClick={() => setTab(value)} className={`border-b-2 px-3 py-5 ${tab === value ? "border-blue-600 font-semibold text-blue-600" : "border-transparent"}`}>
                {t(label)}
              </button>
            ))}
          </nav>

          {!stage ? (
            <div className="mt-6 flex min-h-[370px] items-center justify-center bg-white shadow">
              <RobotEmpty text="Выберите производство..." size={190} />
            </div>
          ) : (
            <div key={stage.id}>
              <p className="mt-5 text-slate-500">
                {t("Производство")}: <strong className="text-slate-700">{stage.name}</strong>
                {stage.warehouse && <> · {t("Склад")}: <strong className="text-slate-700">{stage.warehouse}</strong></>}
                {stage.responsible && <> · {t("Ответственный")}: <strong className="text-slate-700">{stage.responsible}</strong></>}
              </p>
              {tab === "products" && <ProductsTab stage={stage} equipment={equipment} />}
              {tab === "operations" && <OperationsTab stage={stage} equipment={equipment} />}
              {tab === "staff" && <StaffTab stage={stage} staff={staff} reload={reloadStaff} />}
              {tab === "equipment" && <EquipmentTab stage={stage} equipment={equipment} reload={reloadEquipment} />}
              {tab === "activity" && <ActivityTab stage={stage} equipment={equipment} staff={staff} />}
            </div>
          )}
        </section>
      </div>

      {stageDialog && (
        <StageDialog
          stage={stageDialog === "new" ? null : stageDialog}
          onClose={() => setStageDialog(null)}
          onSaved={(saved) => {
            setStageDialog(null)
            if (saved) setSelectedId(saved.id)
            reloadStages()
          }}
        />
      )}
    </main>
  )
}

function StageDialog({ stage, onClose, onSaved }: { stage: Stage | null; onClose: () => void; onSaved: (stage: Stage | null) => void }) {
  const { t } = useLanguage()
  const { data: warehouses } = useApiData<Warehouse[]>("/api/warehouses", [])
  const { data: employees } = useApiData<Employee[]>("/api/employees", [])
  const [name, setName] = useState(stage?.name ?? "")
  const [warehouse, setWarehouse] = useState(stage?.warehouse ?? "")
  const [responsible, setResponsible] = useState(stage?.responsible ?? "")
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const responsibleId = employees.find((entry) => entry.name === responsible)?.id ?? (responsible !== "" && responsible === stage?.responsible ? (stage?.responsibleId ?? null) : null)
      onSaved(await api<Stage>(stage ? `/api/production/stages/${stage.id}` : "/api/production/stages", { method: stage ? "PUT" : "POST", body: { name, warehouse, responsible, responsibleId } }))
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!stage || !window.confirm(`${t("Удалить этап")} «${stage.name}»?`)) return
    try {
      await api(`/api/production/stages/${stage.id}`, { method: "DELETE" })
      onSaved(null)
    } catch (error) {
      window.alert((error as Error).message)
    }
  }

  return (
    <Modal
      title={t(stage ? "Изменение этапа" : "Добавление этапа")}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {stage && <button type="button" onClick={remove} className="mr-auto text-sm text-red-500 hover:underline">{t("Удалить")}</button>}
          <SaveButton saving={saving} />
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Наименование" required><input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <Field label="Склад" required>
          <select required value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {warehouse && !warehouses.some((entry) => entry.name === warehouse) && <option>{warehouse}</option>}
            {warehouses.map((entry) => <option key={entry.id}>{entry.name}</option>)}
          </select>
        </Field>
        <p className="-mt-3 text-xs text-slate-500">{t("Сырье списывается с этого склада, готовая продукция поступает на него.")}</p>
        <Field label="Ответственный">
          <select value={responsible} onChange={(event) => setResponsible(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {responsible && !employees.some((entry) => entry.name === responsible) && <option>{responsible}</option>}
            {employees.map((entry) => <option key={entry.id}>{entry.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  )
}
