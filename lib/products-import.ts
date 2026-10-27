import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { mapHeaderColumns } from "@/lib/excel-import"
import { MAX_PRICE, priceListKey } from "@/lib/item-prices"
import { readCatalogRow, rowToItem, splitBarcodes } from "@/lib/products-catalog"
import { CATALOG_TABLE, catalogDb } from "@/lib/products-schema"
import {
  catalogKey,
  cleanText,
  quantityInput,
  type CatalogImportError,
  type CatalogImportMode,
  type CatalogImportResult,
  type CatalogKind,
  type CatalogPrice,
} from "@/lib/products-types"
import { CatalogError, createCatalogItemTx, lockCatalog, updateCatalogItemTx, type CatalogPatch } from "@/lib/products-write"
import { MAX_DB_ID, strictNumber } from "@/lib/strict-number"

// "Импорт" (create) and "Обновить с excel" (update) of products / raw materials. The page
// reads the sheet (lib/excel-import.ts) and posts its rows; the first row is the header.
// Columns are found by header text (ru / uz / en); prices by "Нал: <прайс-лист>" /
// "Безнал: <прайс-лист>". Update finds each row's item by ID, else Артикул, else
// Штрих-код, else Наименование; empty cells keep the stored value. Both modes are
// all-or-nothing: any row error rolls the whole file back and lists the rows.

const ALIASES: Record<string, string> = {
  id: "id",
  ид: "id",
  "№": "id",
  наименование: "name",
  название: "name",
  "наименование продукта": "name",
  "наименование сырья": "name",
  товар: "name",
  продукт: "name",
  nomi: "name",
  name: "name",
  "полное наименование": "fullName",
  "полное название": "fullName",
  "full name": "fullName",
  "to liq nomi": "fullName",
  "штрих код": "barcodes",
  штрихкод: "barcodes",
  "штрих код товара": "barcodes",
  "штрих коды": "barcodes",
  "штрих коды товара": "barcodes",
  barcode: "barcodes",
  "shtrix kod": "barcodes",
  артикул: "article",
  article: "article",
  "vendor code": "article",
  artikul: "article",
  "код для интеграции": "code",
  "код интеграции": "code",
  "integration code": "code",
  "integratsiya uchun kod": "code",
  "тип продукта": "type",
  "тип товара": "type",
  тип: "type",
  type: "type",
  "mahsulot turi": "type",
  подкатегория: "subcategory",
  subcategory: "subcategory",
  "kichik toifa": "subcategory",
  мера: "unit",
  "единица измерения": "unit",
  "ед изм": "unit",
  unit: "unit",
  "o lchov birligi": "unit",
  "olchov birligi": "unit",
  группа: "boxUnit",
  group: "boxUnit",
  guruh: "boxUnit",
  "кол во в группе": "boxAmount",
  "в кейсе": "boxAmount",
  организация: "organization",
  организации: "organization",
  organization: "organization",
  tashkilot: "organization",
  бренд: "brand",
  brand: "brand",
  поставщик: "supplier",
  supplier: "supplier",
  "yetkazib beruvchi": "supplier",
  цвет: "color",
  color: "color",
  rang: "color",
  "порядковый номер": "orderNumber",
  "order number": "orderNumber",
  "tartib raqami": "orderNumber",
  "минимальный остаток": "minStock",
  "мин остаток": "minStock",
  "min stock": "minStock",
  описание: "description",
  description: "description",
  izoh: "description",
  икпу: "ikpu",
  ikpu: "ikpu",
  "код ед изм в фактуре": "invoiceUnitCode",
  ндс: "vat",
  vat: "vat",
  qqs: "vat",
  "масса кг": "weight",
  масса: "weight",
  вес: "weight",
  weight: "weight",
  "вес нетто": "netWeight",
  "net weight": "netWeight",
  объем: "volume",
  объём: "volume",
  volume: "volume",
  hajmi: "volume",
  "можно продавать": "canSell",
  "can sell": "canSell",
  "можно продать за кол во балов": "salePoints",
  балл: "salePoints",
  баллы: "salePoints",
}

const PRICE_HEADER = /^\s*(нал|наличные|cash|naqd|безнал|безналичные|transfer|o'tkazma)\s*:\s*(.+?)\s*$/i
const CASHLESS = /^(безнал|безналичные|transfer|o'tkazma)$/i

type Columns = { fields: Map<number, string>; prices: Array<{ index: number; priceList: string; cashless: boolean }> }

function columnsOf(header: string[]): Columns {
  const prices: Columns["prices"] = []
  const plainHeader = header.map((cell, index) => {
    const match = PRICE_HEADER.exec(cell)
    if (!match) return cell
    prices.push({ index, priceList: match[2], cashless: CASHLESS.test(match[1]) })
    return ""
  })
  return { fields: mapHeaderColumns(plainHeader, ALIASES), prices }
}

function bool(value: string): boolean | undefined {
  const key = catalogKey(value)
  if (["да", "yes", "true", "1", "ha", "+"].includes(key)) return true
  if (["нет", "no", "false", "0", "yo'q", "yoq", "-"].includes(key)) return false
  return undefined
}

/** A number cell as the item form takes it: a number ("1e-7" too), "12,5", "1 000", "0 шт." or a
 * placeholder ("-" = 0). Other text ("abc", "12abc", "0x10") is NaN, never a silent 0 / 12. */
function cellNumber(cell: string): number {
  const plain = strictNumber(cell, { locale: true })
  return Number.isFinite(plain) ? plain : quantityInput(cell)
}

const BAD_NUMBER = "Некорректное число"
const BAD_PRICE = "Некорректная цена"

/** Cells of one row → patch of the non-empty cells; `error` = the first unreadable number cell (a row error). */
function rowPatch(row: string[], columns: Columns): { patch: CatalogPatch; id: number | null; prices: Map<string, { name: string; cash?: number; nonCash?: number }>; error: string | null } {
  const patch: CatalogPatch = {}
  let id: number | null = null
  let error: string | null = null
  for (const [index, field] of columns.fields) {
    const cell = String(row[index] ?? "").trim()
    if (!cell) continue
    switch (field) {
      case "id": {
        // An id an INTEGER column can hold, else no id (the row is matched by Артикул / Штрих-код /
        // Наименование): "0x10" never selects item 16, 99999999999 never reaches Postgres.
        const value = strictNumber(cell)
        id = Number.isInteger(value) && value > 0 && value <= MAX_DB_ID ? value : null
        break
      }
      case "barcodes":
        patch.barcodes = splitBarcodes(cell)
        break
      case "canSell": {
        const value = bool(cell)
        if (value !== undefined) patch.canSell = value
        break
      }
      case "boxAmount":
      case "minStock":
      case "weight":
      case "netWeight":
      case "volume":
      case "salePoints": {
        // The same bounds as the item body (lib/products-api.ts amount): 0 ≤ x < 1e15.
        const value = cellNumber(cell)
        if (Number.isFinite(value) && value >= 0 && value < 1e15) patch[field] = value
        else error ??= BAD_NUMBER
        break
      }
      case "type":
      case "subcategory":
      case "organization":
      case "brand":
      case "supplier":
      case "color":
      case "description":
      case "boxUnit":
        patch[field] = cleanText(cell)
        break
      default:
        ;(patch as Record<string, unknown>)[field] = cell
    }
  }
  const prices = new Map<string, { name: string; cash?: number; nonCash?: number }>()
  for (const column of columns.prices) {
    const cell = String(row[column.index] ?? "").trim()
    if (!cell) continue
    const key = priceListKey(column.priceList)
    const entry = prices.get(key) ?? { name: column.priceList }
    // A price: 0 ≤ x ≤ 1e13 (contract 3); text that is not a number is a row error.
    const value = cellNumber(cell)
    if (!(Number.isFinite(value) && value >= 0 && value <= MAX_PRICE)) {
      error ??= BAD_PRICE
      continue
    }
    if (column.cashless) entry.nonCash = value
    else entry.cash = value
    prices.set(key, entry)
  }
  return { patch, id, prices, error }
}

class ImportFailed extends Error {
  constructor(readonly errors: CatalogImportError[]) {
    super("Ошибка в файле")
  }
}

/**
 * The item a row of "Обновить с excel" points at (ID → Артикул → Штрих-код → Наименование). Live
 * items win over deleted ones; a code shared by two items of the same group is a row error
 * instead of silently taking the first one.
 */
async function findTarget(tx: PgDb, kind: CatalogKind, id: number | null, patch: CatalogPatch): Promise<number | null> {
  const table = CATALOG_TABLE[kind]
  if (id) return (await tx.prepare(`SELECT id FROM ${table} WHERE id = @id`).get({ id })) ? id : null
  const one = async (sql: string, params: Record<string, unknown>, ambiguous: string) => {
    const rows = (await tx.prepare(`SELECT id, COALESCE(deleted, 0) AS deleted FROM (${sql}) m ORDER BY COALESCE(deleted, 0), id LIMIT 3`).all(params)) as Array<{
      id: number
      deleted: number
    }>
    if (!rows.length) return null
    const group = rows.filter((row) => Number(row.deleted) === Number(rows[0].deleted))
    if (group.length > 1) throw new CatalogError(ambiguous)
    return Number(rows[0].id)
  }
  if (patch.article) {
    const found = await one(`SELECT id, deleted FROM ${table} WHERE lower(btrim(article)) = lower(btrim(@article))`, { article: patch.article }, AMBIGUOUS_ARTICLE)
    if (found) return found
  }
  for (const code of patch.barcodes ?? []) {
    const found = await one(
      `SELECT id, deleted FROM ${table} WHERE @code = ANY(SELECT btrim(x) FROM unnest(string_to_array(replace(replace(barcode, ';', ','), chr(10), ','), ',')) AS x)`,
      { code },
      AMBIGUOUS_BARCODE,
    )
    if (found) return found
  }
  if (patch.name) return one(`SELECT id, deleted FROM ${table} WHERE fin_key(name) = fin_key(@name)`, { name: patch.name }, AMBIGUOUS_NAME)
  return null
}

const AMBIGUOUS_ARTICLE = "Артикул есть у нескольких товаров, укажите ID"
const AMBIGUOUS_BARCODE = "Штрих-код есть у нескольких товаров, укажите ID"
const AMBIGUOUS_NAME = "Наименование есть у нескольких товаров, укажите ID"

function mergePrices(current: CatalogPrice[], changes: Map<string, { name: string; cash?: number; nonCash?: number }>): CatalogPrice[] {
  const next = current.map((entry) => ({ ...entry }))
  for (const [key, change] of changes) {
    const found = next.find((entry) => priceListKey(entry.name) === key)
    if (found) {
      if (change.cash !== undefined) found.cash = change.cash
      if (change.nonCash !== undefined) found.nonCash = change.nonCash
    } else {
      const cash = change.cash ?? 0
      next.push({ name: change.name.trim(), cash, nonCash: change.nonCash ?? cash, min: 0, max: 0 })
    }
  }
  return next
}

export async function importCatalogRows(kind: CatalogKind, mode: CatalogImportMode, rows: string[][]): Promise<CatalogImportResult> {
  await catalogDb()
  const [header, ...body] = rows
  const columns = columnsOf(header ?? [])
  const mapped = new Set(columns.fields.values())
  if (mode === "create" && !mapped.has("name")) throw new CatalogError("Не найден столбец «Наименование»", 400)
  if (mode === "update" && !["id", "name", "article", "barcodes"].some((field) => mapped.has(field))) {
    throw new CatalogError("Не найден столбец ID, «Наименование», «Артикул» или «Штрих-код»", 400)
  }
  const result: CatalogImportResult = { created: 0, updated: 0, errors: [] }
  try {
    await withTransaction(async (tx) => {
      await lockCatalog(tx)
      const seen = new Set<string>()
      for (const [position, row] of body.entries()) {
        const line = position + 2
        if (!row.some((cell) => String(cell ?? "").trim())) continue
        const { patch, id, prices, error: cellError } = rowPatch(row, columns)
        try {
          if (cellError) throw new CatalogError(cellError)
          if (mode === "create") {
            if (!patch.name) throw new CatalogError("Обязательное поле: Наименование")
            if (!patch.unit) throw new CatalogError("Обязательное поле: Мера")
            if (seen.has(catalogKey(patch.name))) throw new CatalogError("Наименование повторяется в файле")
            seen.add(catalogKey(patch.name))
            patch.priceLists = mergePrices([], prices)
            await createCatalogItemTx(tx, kind, patch)
            result.created += 1
          } else {
            const target = await findTarget(tx, kind, id, patch)
            if (!target) throw new CatalogError("Продукт не найден")
            const row = await readCatalogRow(tx, kind, target)
            if (prices.size && row) patch.priceLists = mergePrices(rowToItem(kind, row).priceLists, prices)
            await updateCatalogItemTx(tx, kind, target, patch)
            result.updated += 1
          }
        } catch (error) {
          if (!(error instanceof CatalogError)) throw error
          result.errors.push({ row: line, error: error.message })
        }
      }
      if (result.errors.length) throw new ImportFailed(result.errors)
    })
  } catch (error) {
    if (error instanceof ImportFailed) return { created: 0, updated: 0, errors: error.errors }
    throw error
  }
  return result
}
