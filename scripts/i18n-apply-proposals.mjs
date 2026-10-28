// Applies crawl-derived proposals (see uzt2 crawl): identity mappings (the reference leaves the string Russian) and value replacements.
// Re-reads the dictionary right before writing and only touches lines whose current value differs. Usage: node scripts/i18n-apply-proposals.mjs <uz|en> <proposals.json>
import fs from 'node:fs'
const [lang, file] = process.argv.slice(2)
const p = JSON.parse(fs.readFileSync(file, 'utf8'))
const path = new URL(`../lib/i18n/dictionaries/${lang}.ts`, import.meta.url)
const lines = fs.readFileSync(path, 'utf8').split('\n')
const want = new Map()
for (const x of p.identity ?? []) want.set(x.key, x.key)
for (const x of p.replace ?? []) want.set(x.key, x.to)
const lineRe = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*")(,?\s*)$/
let changed = 0
const out = lines.map((line) => {
  const m = lineRe.exec(line)
  if (!m) return line
  let key, val
  try { key = JSON.parse(m[2]); val = JSON.parse(m[4]) } catch { return line }
  if (!want.has(key) || want.get(key) === val) return line
  changed++
  return `${m[1]}${m[2]}${m[3]}${JSON.stringify(want.get(key))}${m[5]}`
})
fs.writeFileSync(path, out.join('\n'))
console.log(lang, 'lines changed', changed, 'of', want.size, 'proposals')
