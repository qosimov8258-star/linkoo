import * as XLSX from "xlsx"

import { en } from "@/lib/i18n/dictionaries/en"
import { tk } from "@/lib/i18n/dictionaries/tk"
import { uz } from "@/lib/i18n/dictionaries/uz"

const CSV_FILE = /\.csv$/i

/** CSV text: a BOM decides; else UTF-8 when the bytes are valid UTF-8, else Windows-1251 (Excel's "CSV" on a Russian Windows). */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2))
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "")
  } catch {
    // Not UTF-8: fall through to the Russian Windows code page.
  }
  try {
    return new TextDecoder("windows-1251").decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

/**
 * Reads the first sheet of an uploaded .xlsx/.xls/.csv file into rows of
 * trimmed string cells. Uses the xlsx library so real (binary) Excel files
 * parse correctly — reading them as plain text (FileReader.readAsText)
 * only works for .csv and produces garbage for actual .xlsx/.xls uploads.
 * A .csv is decoded first (UTF-8, UTF-16 with a BOM or Windows-1251): read as
 * bytes, xlsx would take it for Latin-1 and garble every Cyrillic letter.
 */
export function readExcelRows(file: File): Promise<string[][]> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer)
        const workbook = CSV_FILE.test(file.name) ? XLSX.read(decodeCsv(bytes), { type: "string" }) : XLSX.read(bytes, { type: "array" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = sheet
          ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false }) as unknown[][])
          : []
        resolve(rows.map((row) => row.map((cell) => String(cell ?? "").trim())))
      } catch {
        resolve([])
      }
    }
    reader.onerror = () => resolve([])
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Maps flexible spreadsheet header text (Russian/Uzbek/English, with or
 * without notes like "(обязательно)") to canonical field keys, so imports
 * work regardless of column order or which template produced the file.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['"`ʻʼ]/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// normalizeHeader(Russian key) → normalizeHeader of its uz / en / tk values: a template downloaded in one UI
// language (its headers go through t()) is read back whatever language the importing user has chosen.
let translatedHeaders: Map<string, string[]> | null = null

function headerTranslations(): Map<string, string[]> {
  if (translatedHeaders) return translatedHeaders
  const map = new Map<string, string[]>()
  for (const dictionary of [uz, en, tk]) {
    for (const [russian, translation] of Object.entries(dictionary)) {
      const key = normalizeHeader(russian)
      const value = normalizeHeader(translation)
      if (!key || !value || key === value) continue
      const list = map.get(key) ?? []
      if (!list.includes(value)) list.push(value)
      map.set(key, list)
    }
  }
  translatedHeaders = map
  return map
}

/** The aliases plus the uz / en / tk spellings of every Russian alias (an alias of the caller always wins). */
function withTranslations(aliases: Record<string, string>): Record<string, string> {
  const all: Record<string, string> = { ...aliases }
  const translations = headerTranslations()
  for (const [alias, field] of Object.entries(aliases)) {
    for (const spelling of translations.get(alias) ?? []) if (!(spelling in all)) all[spelling] = field
  }
  return all
}

/** A plain number or date cell ("12", "1 250,5", "01.10.2026"): a header row never has one. */
const VALUE_CELL = /^[-+]?\d[\d\s.,:/-]*$/

/**
 * Given a header row and an alias map (normalized header text -> field
 * key), returns the column index for each recognized field. Falls back to
 * treating the file as headerless (no entries) if nothing matches.
 *
 * Matching is exact first (the caller's aliases and their uz / en / tk
 * translations), then falls back to "a caller's alias appears as a whole word
 * in the header" (longest alias wins) — real spreadsheets rarely use the bare word
 * alone (e.g. "Наименование продукта", "Product Name"), so requiring exact
 * equality missed most real-world files. The whole-word fallback is used only
 * for a row that looks like a header (an exact match, or no number / date
 * cell): a data row such as "Товар 1 | 12 | 5000" is never taken for one.
 */
export function mapHeaderColumns(headerRow: string[], aliases: Record<string, string>): Map<number, string> {
  const all = withTranslations(aliases)
  const fieldByIndex = new Map<number, string>()
  const normalized = headerRow.map((cell) => normalizeHeader(String(cell ?? "")))
  normalized.forEach((key, index) => {
    if (key && all[key]) fieldByIndex.set(index, all[key])
  })
  const headerLike = fieldByIndex.size > 0 || !headerRow.some((cell) => VALUE_CELL.test(String(cell ?? "").trim()))
  if (!headerLike) return fieldByIndex
  // The fallback keeps to the caller's own aliases: a short translated word must not claim a longer header.
  const sortedAliases = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)
  normalized.forEach((key, index) => {
    if (!key || fieldByIndex.has(index)) return
    for (const [alias, field] of sortedAliases) {
      const wholeWord = new RegExp(`(^|\\s)${escapeRegExp(alias)}(\\s|$)`)
      if (wholeWord.test(key)) {
        fieldByIndex.set(index, field)
        return
      }
    }
  })
  return fieldByIndex
}

export const IS_HEADER_LABEL = /^(наименование|название|name|товар|product)$/i
