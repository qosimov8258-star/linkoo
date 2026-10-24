"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useEffect, useState, type FormEvent } from "react"
import { Factory, Pencil, Plus } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { ActivityTab } from "@/components/analytics/production/stage-activity"
import { EquipmentTab, OperationsTab, ProductsTab, StaffTab, type Equipment, type StaffMember } from "@/components/analytics/production/stage-tabs"
import { api, Field, inputClass, Modal, RobotEmpty, SaveButton, useApiData, type Stage } from "@/components/analytics/production/production-ui"
import { notify } from "@/lib/notify"

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

  const CARD_SHADOW = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
  return (
    <RefPage>
      <RefHeader title={t("Этапы производства")} />

      <div className="-mx-7 flex items-start">
        <aside className="w-[280px] shrink-0 font-sans text-[13px] text-[#333]">
          <div className="flex h-[57px] items-center justify-between pl-[30px] pr-[10px]">
            <h2 className="text-[13px] font-bold">{t("Этапы производства")}</h2>
            <button onClick={() => setStageDialog("new")} aria-label={t("Добавить этап")} title={t("Добавить этап")} className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[#4f71dc] text-white">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="shadow-[1px_0_6px_rgba(0,0,0,0.2)]">
            {stages.map((entry) => (
              <div key={entry.id} className={`group flex h-[50px] items-center border-b border-[#e9ecf0] ${selectedId === entry.id ? "bg-white" : "hover:bg-white/60"}`}>
                <button onClick={() => setSelectedId(entry.id)} className="flex h-full min-w-0 flex-1 items-center pl-[30px] text-left">
                  <Factory className="mr-[10px] h-5 w-5 shrink-0 text-[#5d6474]" strokeWidth={1.5} />
                  <span className="truncate">{entry.name}</span>
                </button>
                <button onClick={() => setStageDialog(entry)} aria-label={t("Изменить")} className="mr-3 p-1 text-[#9aa1ae] opacity-0 hover:text-[#4f71dc] group-hover:opacity-100 focus:opacity-100">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            ))}
            {!stages.length && !loading && <p className="px-6 py-8 text-center text-[#888]">{t("Этапов пока нет — добавьте первый этап")}</p>}
          </div>
        </aside>

        <section className="ml-[30px] mr-[30px] min-w-0 flex-1">
          <nav className={`flex h-[54px] bg-white text-[13px] text-black ${CARD_SHADOW}`}>
            {TABS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setTab(value)} className="h-[54px] px-[6px]">
                <span className={`flex h-[52px] items-center border-b-2 px-[20px] ${tab === value ? "border-[#4f71dc] font-semibold text-[#4f71dc]" : "border-transparent"}`}>{t(label)}</span>
              </button>
            ))}
          </nav>

          {!stage ? (
            <div className={`mt-5 flex h-[294px] flex-col items-center justify-center bg-white ${CARD_SHADOW}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="w-[112px]" />
              <p className="mt-[14px] text-[15px] text-[#666]">{t("Выберите производство...")}</p>
            </div>
          ) : (
            <div key={stage.id}>
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
    </RefPage>
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
      onSaved(await api<Stage>(stage ? `/api/production/stages/${stage.id}` : "/api/production/stages", { method: stage ? "PUT" : "POST", body: { name, warehouse, responsible } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!stage || !(await askDelete(stage.name))) return
    try {
      await api(`/api/production/stages/${stage.id}`, { method: "DELETE" })
      onSaved(null)
    } catch (error) {
      notify((error as Error).message)
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
        <Field label="Наименование" required><input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
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
