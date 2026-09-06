"use client"

import { useRouter } from "next/navigation"
import { BarChart3, Download } from "lucide-react"
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
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <p className="text-[15px] font-semibold text-slate-700">{t(title)}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-95"
        >
          <Download className="h-3.5 w-3.5" />
          {t("Скачать")}
        </button>
        <button
          type="button"
          onClick={handleOpenReport}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#4f70e7] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-95"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t("Отчет")}
        </button>
      </div>
      <p className="w-full text-sm font-medium text-slate-500">{t("Нет данных за выбранный период")}</p>
    </div>
  )
}
