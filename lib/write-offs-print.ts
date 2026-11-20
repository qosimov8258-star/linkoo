import "server-only"

import { renderDocTemplate, stripActiveContent, type TemplateContext } from "@/lib/doc-template-render"
import { getDocTemplate } from "@/lib/doc-templates-repo"
import { getWriteOff } from "@/lib/write-offs-repo"
import type { WriteOff } from "@/lib/write-offs-types"

// Printing a write-off (Склад → Списание), like Linko's card print menu: a print template of Справочники → Шаблоны
// документов with the key "writeoff" merged with the write-off, `count` copies. The data carries the names of Linko's
// writeoff_request serializer (id, user, stock, created_date, status, products [product, amount, price, total_price,
// series], total_price, comment).

export const WRITE_OFF_TEMPLATE_KEY = "writeoff"
export const MAX_WRITE_OFF_PRINT_COPIES = 50

export class WriteOffPrintError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const STATUS: Record<WriteOff["status"], string> = { ожидает: "pending", закрыт: "finished", отменен: "canceled" }

function templateContext(row: WriteOff): TemplateContext {
  const productId = (key: string) => {
    const match = /^product:(\d+)$/.exec(key)
    return match ? Number(match[1]) : null
  }
  const products = row.items.map((item, index) => ({
    id: item.id,
    position: index + 1,
    product: { id: productId(item.key), name: item.product, code: item.code || null, measurement: item.unit ? { name: item.unit } : null },
    amount: item.qty,
    price: item.cost,
    total_price: item.sum,
    series: item.series ? { display_name: item.series, displayName: item.series } : null,
    defect: item.defect ? item.qty : 0,
  }))
  const user = row.creator ? { first_name: row.creator, second_name: "", full_name: row.creator } : null
  return {
    id: row.id,
    user,
    created_by: user,
    stock: { name: row.warehouse },
    created_date: row.date || null,
    status: STATUS[row.status],
    comment: row.comment || null,
    products,
    total_price: row.total,
    total_amount: row.items.reduce((sum, item) => sum + item.qty, 0),
  }
}

/** The printed pages: the template merged with the write-off, `count` copies. */
export async function renderWriteOffPrintPages(id: number, templateId: number, count: number): Promise<string[]> {
  const template = await getDocTemplate(templateId)
  if (!template || template.keyName !== WRITE_OFF_TEMPLATE_KEY) throw new WriteOffPrintError("Шаблон не найден", 404)
  const row = await getWriteOff(id)
  if (!row) throw new WriteOffPrintError("Списание не найдено", 404)
  const html = stripActiveContent(renderDocTemplate(template.html, templateContext(row)))
  return Array.from({ length: count }, () => html)
}
