"use client"

import { useRouter } from "next/navigation"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

export function ReportListRow({ title }: { title: string }) {
  const { t } = useLanguage()
  const router = useRouter()

  function handleDownload() {
    downloadExcelTable(t(title), [[t(title)], [t("Нет данных за выбранный период")]])
  }

  function handleOpenReport() {
    router.push("/analytics/report-builder")
  }

  return (
    <div className="shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="flex h-10 items-center justify-between bg-white px-[10px]">
        <p className="text-[13px] font-semibold">{t(title)}</p>
        <div className="flex items-center gap-[10px]">
          <button type="button" onClick={handleDownload} className="flex h-[30px] items-center rounded-[5px] bg-[#4db6ac] pl-3 text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white" aria-hidden>
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            <span className="pl-2 pr-4">{t("Скачать")}</span>
          </button>
          <button type="button" onClick={handleOpenReport} className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white" aria-hidden>
              <path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z" />
            </svg>
            <span className="pl-2 pr-4">{t("Отчет")}</span>
          </button>
        </div>
      </div>
      <p className="border-t border-[#efefef] bg-white text-[22px] font-semibold leading-[26px]">{t("Нет данных за выбранный период")}</p>
    </div>
  )
}
