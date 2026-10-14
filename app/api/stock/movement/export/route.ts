import * as XLSX from "xlsx"

import { formatDotDate } from "@/lib/finance/dates"
import { getServerT } from "@/lib/i18n/server"
import { movementFailure, movementRequest, stockMovementRows, stockMovementSheet } from "@/lib/stock-movement-report"

// GET /api/stock/movement/export?<the list filters>&ordering&variant=full|simple&showOthers=1
// → .xlsx of every row: "Скачать" (full: the table's columns) or
// "Скачать упрощенный список" (simple: begin / Приход / Расход / end).
export async function GET(request: Request) {
  const parsed = await movementRequest(request.url)
  if (parsed.error) return parsed.error
  const { filters, params } = parsed
  const variant = params.get("variant") === "simple" ? "simple" : "full"
  try {
    const t = await getServerT()
    const { rows, needPriceList } = await stockMovementRows(filters, (params.get("ordering") ?? "").trim())
    const withValue = filters.mode === "cost" || (filters.mode === "price" && !needPriceList)
    const sheet = stockMovementSheet(rows, filters, { variant, showOthers: ["1", "true"].includes(params.get("showOthers") ?? ""), withValue }, t)
    const worksheet = XLSX.utils.aoa_to_sheet(sheet)
    worksheet["!cols"] = sheet[0].map((_, index) => ({ wch: Math.min(60, Math.max(10, ...sheet.map((row) => String(row[index] ?? "").length + 2))) }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
    const title = variant === "simple" ? `${t("Остаток на определенную дату")} (${t("упрощенный")})` : t("Остаток на определенную дату")
    const fileName = `${title} ${formatDotDate(filters.from)} - ${formatDotDate(filters.to)}.xlsx`
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stock-movement.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    return movementFailure(error)
  }
}
