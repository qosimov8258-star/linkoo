#!/usr/bin/env node
// Lists every user-facing Russian string in the source that has no full
// uz / tk / en translation. Russian text is the dictionary key
// (lib/i18n/dictionaries/{uz,tk,en}.ts).
//
//   npm run i18n:check            report (exit code 1 when something is missing)
//   npm run i18n:check -- --json  machine readable
//
// Seed/demo data is not UI text; exclude it in scripts/i18n-ignore.json:
//   { "files": ["path/prefix or *suffix"], "strings": ["exact text"] }
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const CYR = /[А-Яа-яЁё]/
const LANGS = ["uz", "tk", "en"]
const SCAN = ["app", "components", "lib"]

const ignore = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "scripts/i18n-ignore.json"), "utf8"))
  } catch {
    return { files: [], strings: [] }
  }
})()
const ignoredFile = (rel) => rel.startsWith("lib/i18n/") || ignore.files.some((rule) => (rule.startsWith("*") ? rel.endsWith(rule.slice(1)) : rel.startsWith(rule)))

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function dictionary(lang) {
  const text = fs.readFileSync(path.join(root, `lib/i18n/dictionaries/${lang}.ts`), "utf8")
  const keys = new Set()
  for (const match of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) keys.add(JSON.parse(`"${match[1]}"`))
  return keys
}

const MONTH = /(?<![А-Яа-яЁё])(январ[ьяю]|феврал[ьяю]|март[а]?|апрел[ьяю]|ма[йя]|июн[ьяю]?|июл[ьяю]?|август[а]?|сентябр[ьяю]|октябр[ьяю]|ноябр[ьяю]|декабр[ьяю]|янв\.?|фев(?:р\.?)?|мар\.?|апр\.?|авг\.?|сен(?:т\.?)?|окт\.?|ноя(?:б\.?)?|дек\.?)(?![А-Яа-яЁё])/gi
const normalize = (text) => text.replace(/\d+(?:[ .,]\d+)*/g, "{n}")
const clean = (text) => text.replace(/\s+/g, " ").trim()

function extract(file) {
  const source = fs.readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = new Set()
  const add = (text) => {
    const value = clean(text)
    if (value && CYR.test(value)) found.add(value)
  }
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.JsxText:
        if (!(node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)))) add(node.text ?? "")
        break
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const dicts = Object.fromEntries(LANGS.map((lang) => [lang, dictionary(lang)]))
const monthOnly = (text) => MONTH.test((MONTH.lastIndex = 0, text)) && !CYR.test(text.replace(MONTH, "").replace(/\sна\s|\sг\./g, " "))
const covered = (lang, text) => dicts[lang].has(text) || dicts[lang].has(normalize(text)) || monthOnly(text)

const missing = new Map()
for (const dir of SCAN) {
  for (const file of walk(path.join(root, dir))) {
    const rel = path.relative(root, file)
    if (ignoredFile(rel)) continue
    for (const text of extract(file)) {
      if (ignore.strings.includes(text)) continue
      const langs = LANGS.filter((lang) => !covered(lang, text))
      if (langs.length) {
        const entry = missing.get(text) ?? { langs, files: new Set() }
        entry.files.add(rel)
        missing.set(text, entry)
      }
    }
  }
}

// A key that exists in one dictionary but not in the others is also a gap.
const everyKey = new Set(LANGS.flatMap((lang) => [...dicts[lang]]))
for (const key of everyKey) {
  const langs = LANGS.filter((lang) => !dicts[lang].has(key))
  if (langs.length && !missing.has(key) && !ignore.strings.includes(key)) missing.set(key, { langs, files: new Set(["lib/i18n/dictionaries"]) })
}

const entries = [...missing.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"))
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(entries.map(([text, v]) => ({ text, langs: v.langs, files: [...v.files] })), null, 1))
} else if (entries.length === 0) {
  console.log("i18n: every Russian string in the source has uz / tk / en translations.")
} else {
  console.log(`i18n: ${entries.length} string(s) without a full translation:\n`)
  for (const [text, v] of entries) console.log(`  [${v.langs.join(",")}] ${text}\n      ${[...v.files].slice(0, 3).join(", ")}`)
  console.log("\nAdd them to lib/i18n/dictionaries/{uz,tk,en}.ts (key = the Russian text).")
}
process.exit(entries.length ? 1 : 0)
