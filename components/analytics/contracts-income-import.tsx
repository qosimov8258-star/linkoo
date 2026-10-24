"use client"

import { useState } from "react"

import { LineSelect, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

const BANKS = ["Kapital bank", "Davr bank"]

/** "ИМПОРТ ПРИХОДА" (the bar-chart icon of the Договоры toolbar): bank type + the bank statement Excel. */
export function ContractIncomeImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const [bank, setBank] = useState("")
  const [file, setFile] = useState<File | null>(null)
  return (
    <Modal
      title={t("Импорт прихода")}
      onClose={onClose}
      width={400}
      bodyClassName="px-[30px] pb-[44px] pt-[30px]"
      footer={<SaveButton onClick={() => bank && file && onClose()}>{t("Сохранить")}</SaveButton>}
    >
      <LineSelect label={t("Тип банка")} value={bank} onChange={setBank} options={BANKS} />
      <label className="ml-[20px] mt-[28px] flex h-[200px] w-[304px] cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-[#efefef] text-[13px] text-[#333]">
        <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
        <span>{file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
      </label>
    </Modal>
  )
}
