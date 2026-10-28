"use client"

import { useEffect, useState } from "react"

import { KpiDialogAction, KpiDialogFrame } from "@/components/analytics/branch-kpi-shared"
import { Check, MultiSelect, type PickItem } from "@/components/analytics/kpi-form-fields"
import { useLanguage } from "@/lib/i18n/language-context"

export type KpiLockValue = { disableChange: boolean; onlyForSystem: boolean; visibleOnlyOperator: boolean; operators: PickItem[] }

/** The reference's "ИЗМЕНИЕ БЛОКИРОВКИ" dialog of a KPI (lock icon of the detail card). */
export function KpiLockDialog({ initial, onClose, onSave }: { initial: KpiLockValue; onClose: () => void; onSave: (value: KpiLockValue) => Promise<void> }) {
  const { t } = useLanguage()
  const [value, setValue] = useState(initial)
  const [users, setUsers] = useState<PickItem[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!value.visibleOnlyOperator || users.length) return
    fetch("/api/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ id: number; firstName?: string; lastName?: string }>) => setUsers(rows.map((row) => ({ id: row.id, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() })).filter((row) => row.name)))
      .catch(() => {})
  }, [value.visibleOnlyOperator, users.length])

  return (
    <KpiDialogFrame
      title={t("Измение блокировки")}
      width={500}
      onClose={onClose}
      footer={
        <KpiDialogAction
          label={t("Сохранить")}
          disabled={saving}
          onClick={() => {
            setSaving(true)
            void onSave(value).finally(() => setSaving(false))
          }}
        />
      }
    >
      <div className="px-[30px] py-[20px] text-[13px] text-[#333]">
        <Check className="mb-0 h-[50px] items-center" checked={value.disableChange} label={t("Заблокировать изменение")} onToggle={() => setValue({ ...value, disableChange: !value.disableChange })} />
        <Check className="mb-0 h-[50px] items-center" checked={value.onlyForSystem} label={t("Системный КПИ")} onToggle={() => setValue({ ...value, onlyForSystem: !value.onlyForSystem })} />
        <Check className="mb-0 h-[50px] items-center" checked={value.visibleOnlyOperator} label={t("Может видеть только выбранные операторы")} onToggle={() => setValue({ ...value, visibleOnlyOperator: !value.visibleOnlyOperator })} />
        {value.visibleOnlyOperator && (
          <div className="pt-[10px]">
            <MultiSelect label={t("Операторы")} items={users} selected={value.operators} onChange={(operators) => setValue({ ...value, operators })} />
          </div>
        )}
      </div>
    </KpiDialogFrame>
  )
}

/** Confirmation of "Сделать не активный" / "Сделать активный". */
export function KpiActiveConfirm({ name, active, onConfirm, onClose }: { name: string; active: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <KpiDialogFrame title={t("Подтверждение")} width={450} onClose={onClose} footer={<KpiDialogAction label={t("Подтвердить")} onClick={onConfirm} />}>
      <div className="px-[30px] py-[20px] text-[13px] text-[#333]">
        <p className="pb-[20px]">{t(active ? "Не активировать этот KPI" : "Активировать этот KPI")}</p>
        <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-[20px] font-semibold">{name}</div>
      </div>
    </KpiDialogFrame>
  )
}
