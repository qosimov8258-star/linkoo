// Sets `key -> key` (leave Russian) in lib/i18n/dictionaries/<lang>.ts for the keys listed in a JSON file.
// The reference app shows any string that is absent from its own dictionary in Russian, so for keys the
// reference page displays in Russian we do the same. Usage: node scripts/i18n-identity-apply.mjs <lang> <keys.json>
import fs from 'node:fs'
const [lang, keysFile] = process.argv.slice(2)
const keys = new Set(JSON.parse(fs.readFileSync(keysFile, 'utf8')))
const file = new URL(`../lib/i18n/dictionaries/${lang}.ts`, import.meta.url)
const lineRe = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*")(,?\s*)$/
let changed = 0
const out = fs.readFileSync(file, 'utf8').split('\n').map((line) => {
  const m = lineRe.exec(line)
  if (!m) return line
  let key
  try { key = JSON.parse(m[2]) } catch { return line }
  if (!keys.has(key)) return line
  if (m[4] === m[2]) return line
  changed++
  return `${m[1]}${m[2]}${m[3]}${m[2]}${m[5]}`
})
fs.writeFileSync(file, out.join('\n'))
console.log(lang, 'identity-mapped', changed, 'of', keys.size)
