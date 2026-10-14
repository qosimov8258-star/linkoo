import * as XLSX from "xlsx"
import { NextResponse } from "next/server"

import { formatDotDate } from "@/lib/finance/dates"
import { getServerT } from "@/lib/i18n/server"
import { parseRecommendedPaging, recommendedList, recommendedRequest, recommendedSheet } from "@/lib/stock-recommended"

// GET /api/stock/recommended/export?<the list filters>&ordering → .xlsx of every row ("Скачать все").
export async function GET(request: Request) {
  const parsed = await recommendedRequest(request.url)
  if (parsed.error) return parsed.error
  try {
    const t = await getServerT()
    const { results } = await recommendedList(parsed.filters, { ...parseRecommendedPaging(parsed.params), page: 1, pageSize: 0 })
    const sheet = recommendedSheet(results, t)
    const worksheet = XLSX.utils.aoa_to_sheet(sheet)
    worksheet["!cols"] = sheet[0].map((_, index) => ({ wch: Math.min(60, Math.max(10, ...sheet.map((row) => String(row[index] ?? "").length + 2))) }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
    const fileName = `${t("Рекомендованный запас")} ${formatDotDate(parsed.filters.from)} - ${formatDotDate(parsed.filters.to)}.xlsx`
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="recommended-stock.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("recommended stock export:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
