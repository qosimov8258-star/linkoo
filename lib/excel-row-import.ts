import * as XLSX from "xlsx"

import { decodeCsv } from "@/lib/excel-import"
import { translate } from "@/lib/i18n/translate"
import { LANGUAGES } from "@/lib/i18n/types"

// Excel import of the settings lists (Должности, Тип отказа, Филиалы, Организация, Категории приходов /
// расходов, Категории поставщиков, Поставщики, Типы клиентов, Атрибуты, Значение атрибута). The browser
// reads the first sheet and checks every row first (header, encoding, required fields, references, repeats
// inside the file): any error there saves nothing. Then the rows are saved one by one through the same API
// as the page's form, so its validation, unique names and permissions apply; a row the server refuses is
// reported with its Excel line and the other rows are kept. No filled row is ever skipped without a message.
// Messages are Russian i18n keys.

/** Largest accepted file (shared message "Файл слишком большой (максимум 10 МБ)"). */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024
/** Most data rows in one file. */
export const IMPORT_MAX_ROWS = 1000

/** How many filled rows at the top are searched for the header row. */
const HEADER_SEARCH_ROWS = 10
/** Sheet area read at most: a stray or formatted cell far away must not make the browser build millions of cells. */
const MAX_SHEET_ROWS = 100_000
const MAX_SHEET_COLUMNS = 100
const ACCEPTED_FILE = /\.(xlsx|xls|csv)$/i
const CSV_FILE = /\.csv$/i

const ABOVE_HEADER = "Строка выше заголовка: удалите её или перенесите данные под заголовок"
const UNKNOWN_HEADER = "Не удалось определить строку заголовка: используйте заголовки из шаблона"
const BAD_ENCODING = "Неверная кодировка файла: сохраните его как CSV UTF-8"

/** One data row: its line in the sheet (1-based, like Excel) and the cell text per field. */
export type ImportRecord = { line: number; values: Record<string, string> }
/** A refused row: line, what it is (usually its name) and the reason (i18n key or server text). */
export type ImportRowError = { line: number; label?: string; message: string }
/** A checked row ready to be sent. */
export type PreparedRow<T> = { line: number; label: string; item: T }

export type ImportColumn = {
  field: string
  /** Template header (Russian i18n key; its uz / en / tk translations are accepted too). */
  header: string
  /** Other header spellings accepted in a file (Russian ones are translated as well). */
  aliases?: readonly string[]
}

export type SheetSpec = {
  columns: readonly ImportColumn[]
  /** The field whose header marks the header row (and which a data row must fill). */
  keyField: string
}

/** The rows of a file, plus the rows refused while reading it (above the header, unreadable text). */
export type SheetResult = { records: ImportRecord[]; errors: ImportRowError[] } | { error: string }

/** Cell text: control characters folded to a space, invisible format characters dropped, whitespace collapsed, trimmed. */
export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "")
    .replace(/[\u0000-\u001f\u007f\u00a0\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Name comparison key: Unicode NFC, case and spaces ignored (like the servers' unique-name rule). */
export function importKey(value: string): string {
  return cleanCell(value).normalize("NFC").toLowerCase()
}

/** A Russian i18n key in Russian and in every UI language: a file filled in one language is read in any other. */
export function everyLanguage(text: string): string[] {
  return [...new Set(LANGUAGES.map((language) => translate(language, text)))]
}

/** Apostrophe look-alikes (typographic, Uzbek ʻ, backtick …) that phones and Word put in "yo'q" / "o'z". */
const APOSTROPHES = /[`\u00b4\u02b9\u02bb\u02bc\u02bd\u2018\u2019\u2032]/g

// Answer words (lowercase object keys: lookup words matched against a cell, never shown): Russian, Uzbek Latin /
// Cyrillic, Turkmen and English, plus the usual on/off spellings.
const ANSWERS: Record<string, boolean> = {
  да: true, yes: true, true: true, "1": true, "+": true, ha: true, ҳа: true, ха: true, bor: true, hawa: true, bar: true,
  есть: true, вкл: true, включено: true, включен: true,
  нет: false, no: false, false: false, "0": false, "-": false, "yo'q": false, yoq: false, йўқ: false, йук: false,
  ýok: false, yok: false, выкл: false, выключено: false, отключен: false,
}

function answerKey(value: string): string {
  return importKey(value).replace(APOSTROPHES, "'")
}

/** "да / нет" cell (plus the page's own words, e.g. "С ограничением" / "Без ограничения"): empty → `fallback`; unknown → null (a row error). */
export function parseYesNo(value: string, fallback = false, words: { yes?: readonly string[]; no?: readonly string[] } = {}): boolean | null {
  const key = answerKey(value)
  if (!key) return fallback
  if (Object.prototype.hasOwnProperty.call(ANSWERS, key)) return ANSWERS[key]
  if ((words.yes ?? []).some((word) => answerKey(word) === key)) return true
  if ((words.no ?? []).some((word) => answerKey(word) === key)) return false
  return null
}

/** Header comparison key: letters and digits of any script, case, ё/е, apostrophes and "(да/нет)" hints ignored. */
function headerKey(raw: string): string {
  return cleanCell(raw)
    .normalize("NFC")
    .toLowerCase()
    // ё and е are one letter in headers ("Учёт" / "Учет"): ё without its diaeresis.
    .replace(/ё/g, (letter) => letter.normalize("NFD").charAt(0))
    .replace(/\([^)]*\)/g, " ")
    .replace(APOSTROPHES, "")
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

type Spellings = { exact: Map<string, string>; /** Longest first. */ words: Array<[string, string]> }

/** Every accepted header spelling → its field: template headers and aliases, in Russian and in each UI language. */
function headerSpellings(columns: readonly ImportColumn[]): Spellings {
  const exact = new Map<string, string>()
  const add = (text: string, field: string) => {
    const key = headerKey(text)
    if (key && !exact.has(key)) exact.set(key, field)
  }
  // A template downloaded in any language must be read back whatever language the importing user has chosen.
  // A column's own header comes first, so it always wins over another column's alias.
  for (const column of columns) for (const spelling of everyLanguage(column.header)) add(spelling, column.field)
  for (const column of columns) for (const alias of column.aliases ?? []) for (const spelling of everyLanguage(alias)) add(spelling, column.field)
  return { exact, words: [...exact.entries()].sort((a, b) => b[0].length - a[0].length) }
}

type HeaderMatch = { field: string; exact: boolean }

/** A header cell's field: the exact spelling, else a spelling found as whole words in it ("Наименование должности"). */
function matchHeader(cell: string, spellings: Spellings): HeaderMatch | null {
  const key = headerKey(cell)
  if (!key) return null
  const field = spellings.exact.get(key)
  if (field) return { field, exact: true }
  const padded = ` ${key} `
  for (const [spelling, wordField] of spellings.words) if (padded.includes(` ${spelling} `)) return { field: wordField, exact: false }
  return null
}

type RowAsHeader = {
  /** Column index → field (exact matches claim a field first; a field is taken once). */
  fields: Map<number, string>
  /** The key column's header is spelled exactly: this row IS the header row. */
  keyExact: boolean
  /** Every filled cell reads as a header and one of them is the key column's: the row looks like a header. */
  headerLike: boolean
}

function readAsHeader(row: string[], spellings: Spellings, keyField: string): RowAsHeader {
  const matches = row.map((cell) => (cell ? matchHeader(cell, spellings) : null))
  const fields = new Map<number, string>()
  const used = new Set<string>()
  for (const exactPass of [true, false]) {
    matches.forEach((match, index) => {
      if (!match || match.exact !== exactPass || used.has(match.field)) return
      fields.set(index, match.field)
      used.add(match.field)
    })
  }
  const allKnown = row.every((cell, index) => !cell || matches[index] !== null)
  return {
    fields,
    keyExact: matches.some((match) => match?.field === keyField && match.exact),
    headerLike: allKnown && matches.some((match) => match?.field === keyField),
  }
}

type SheetRows = { rows: unknown[][]; firstLine: number } | { error: string }

async function readRows(file: File): Promise<SheetRows> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // A CSV read as bytes is decoded as Latin-1 by xlsx: Cyrillic would be garbled.
  const workbook = CSV_FILE.test(file.name) ? XLSX.read(decodeCsv(bytes), { type: "string" }) : XLSX.read(bytes, { type: "array" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet || !sheet["!ref"]) return { rows: [], firstLine: 1 }
  // The declared area may span a whole formatted sheet: read only up to the last cell that holds something.
  const range = XLSX.utils.decode_range(sheet["!ref"])
  let lastRow = range.s.r
  let lastColumn = range.s.c
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue
    const cell = XLSX.utils.decode_cell(address)
    if (cell.r > lastRow) lastRow = cell.r
    if (cell.c > lastColumn) lastColumn = cell.c
  }
  lastRow = Math.min(lastRow, range.e.r)
  lastColumn = Math.min(lastColumn, range.e.c, range.s.c + MAX_SHEET_COLUMNS - 1)
  if (lastRow - range.s.r + 1 > MAX_SHEET_ROWS) return { error: "Слишком много строк (не более {n})" }
  // Blank rows are kept so every row keeps the line number Excel shows.
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: true,
    range: { s: range.s, e: { r: lastRow, c: lastColumn } },
  }) as unknown[][]
  return { rows, firstLine: range.s.r + 1 }
}

function rowLabel(row: string[]): string {
  return row.find(Boolean) ?? ""
}

/**
 * Reads the first sheet of an .xlsx / .xls / .csv file into records. The header row is the first of the top
 * filled rows whose key column header is spelled exactly (any UI language or alias); its columns are found by
 * their header. Filled rows above it are refused, never skipped. Without such a row the columns follow the
 * template order, and a row that still looks like a header (e.g. "Наименование должности") is refused instead of
 * being created as data.
 */
export async function readImportSheet(file: File, spec: SheetSpec): Promise<SheetResult> {
  if (!ACCEPTED_FILE.test(file.name)) return { error: "Поддерживаются только файлы .xlsx, .xls и .csv" }
  if (file.size > IMPORT_MAX_FILE_BYTES) return { error: "Файл слишком большой (максимум 10 МБ)" }
  let sheet: SheetRows
  try {
    sheet = await readRows(file)
  } catch {
    return { error: "Не удалось прочитать файл" }
  }
  if ("error" in sheet) return sheet
  const rows = sheet.rows.map((row) => (Array.isArray(row) ? row.map(cleanCell) : []))
  const filled = rows.flatMap((row, index) => (row.some(Boolean) ? [index] : []))
  if (!filled.length) return { error: "Не удалось найти данные для импорта в выбранном файле" }
  const lineOf = (index: number) => sheet.firstLine + index

  const spellings = headerSpellings(spec.columns)
  const top = filled.slice(0, HEADER_SEARCH_ROWS)
  const headerIndex = top.find((index) => readAsHeader(rows[index], spellings, spec.keyField).keyExact)
  const errors: ImportRowError[] = []
  const fieldByIndex = new Map<number, string>()
  if (headerIndex !== undefined) {
    const header = readAsHeader(rows[headerIndex], spellings, spec.keyField)
    header.fields.forEach((field, index) => fieldByIndex.set(index, field))
    const used = new Set(header.fields.values())
    // A header cell in an unknown spelling keeps its template position.
    spec.columns.forEach((column, index) => {
      if (!fieldByIndex.has(index) && !used.has(column.field) && rows[headerIndex][index]) fieldByIndex.set(index, column.field)
    })
    // A title above the header, or data rows above it: refused, so nothing disappears silently.
    for (const index of filled) {
      if (index >= headerIndex) break
      errors.push({ line: lineOf(index), label: rowLabel(rows[index]), message: ABOVE_HEADER })
    }
  } else {
    spec.columns.forEach((column, index) => fieldByIndex.set(index, column.field))
  }

  const records: ImportRecord[] = []
  for (let index = headerIndex === undefined ? 0 : headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row.some(Boolean)) continue
    if (records.length + errors.length >= IMPORT_MAX_ROWS) {
      // "{n}" is filled in after translation (the dialog shows IMPORT_MAX_ROWS).
      return { error: "Слишком много строк (не более {n})" }
    }
    if (headerIndex === undefined) {
      // Without a recognised header: a row reading like one (a header in an unknown spelling) is not data.
      const asHeader = readAsHeader(row, spellings, spec.keyField)
      if (asHeader.headerLike && (asHeader.keyExact || top.includes(index))) {
        errors.push({ line: lineOf(index), label: rowLabel(row), message: UNKNOWN_HEADER })
        continue
      }
    }
    const values: Record<string, string> = {}
    for (const column of spec.columns) values[column.field] = ""
    fieldByIndex.forEach((field, column) => {
      if (row[column]) values[field] = row[column]
    })
    // Filled only in columns the import does not read (notes, "№" …): nothing to import.
    if (!Object.values(values).some(Boolean)) continue
    if (Object.values(values).some((value) => value.includes("\ufffd"))) {
      errors.push({ line: lineOf(index), label: values[spec.keyField] || rowLabel(row), message: BAD_ENCODING })
      continue
    }
    records.push({ line: lineOf(index), values })
  }
  if (!records.length && !errors.length) return { error: "Не удалось найти данные для импорта в выбранном файле" }
  return { records, errors }
}

/** Marks the rows whose `key` repeats an earlier row of the file. */
export function repeatedInFile<T>(rows: readonly PreparedRow<T>[], key: (row: PreparedRow<T>) => string): ImportRowError[] {
  const seen = new Map<string, number>()
  const errors: ImportRowError[] = []
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    const earlier = seen.get(value)
    if (earlier !== undefined) errors.push({ line: row.line, label: row.label, message: "Повторяется в файле" })
    else seen.set(value, row.line)
  }
  return errors
}

type ErrorBody = {
  error?: unknown
  fields?: Record<string, unknown>
  details?: { fieldErrors?: Record<string, unknown> }
}

/** The most specific message of an API error body (a field message first, then `error`). */
export function responseMessage(body: unknown, fallback: string): string {
  const value = (body && typeof body === "object" ? body : {}) as ErrorBody
  for (const message of Object.values(value.fields ?? {})) if (typeof message === "string" && message) return message
  for (const messages of Object.values(value.details?.fieldErrors ?? {})) {
    if (Array.isArray(messages) && typeof messages[0] === "string" && messages[0]) return messages[0]
  }
  return typeof value.error === "string" && value.error ? value.error : fallback
}

export type SaveResult = { saved: number; errors: ImportRowError[]; /** Stopped early (no access, server unreachable). */ fatal?: string }

/**
 * Sends the rows one after another (`send` is the page's own create request). A refused row is reported
 * and the next one is tried; "not signed in" / "no access" or a network failure stop the import.
 */
export async function saveImportRows<T>(
  rows: readonly PreparedRow<T>[],
  send: (item: T) => Promise<Response>,
  fallback: string,
  onSaved?: (row: PreparedRow<T>, body: unknown) => void,
): Promise<SaveResult> {
  let saved = 0
  const errors: ImportRowError[] = []
  for (const row of rows) {
    let response: Response
    try {
      response = await send(row.item)
    } catch {
      return { saved, errors, fatal: "Сервер недоступен, попробуйте ещё раз" }
    }
    const body: unknown = await response.json().catch(() => null)
    if (response.ok) {
      saved += 1
      onSaved?.(row, body)
      continue
    }
    const message = responseMessage(body, fallback)
    if (response.status === 401 || response.status === 403) return { saved, errors, fatal: message }
    errors.push({ line: row.line, label: row.label, message })
  }
  return { saved, errors }
}

/** POST of a JSON body (the create request of a list page). */
export function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}
