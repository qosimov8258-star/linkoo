// Aligns our uz/en dictionaries with the reference app's own translations (extracted from its bundle into
// scripts/demo/data/reference-i18n-dicts.json: [uz, en, tr]). Only values of keys we already have are replaced,
// and only when both values use the same interpolation placeholders. Usage: node scripts/i18n-sync-reference.mjs [--dry]
import fs from 'node:fs'
const dry = process.argv.includes('--dry')
const ref = JSON.parse(fs.readFileSync(new URL('./demo/data/reference-i18n-dicts.json', import.meta.url), 'utf8'))
const targets = [['uz', 0], ['en', 1]]
const ph = (v) => (v.match(/\{[^{}]*\}|%[sd]|\$\{[^}]*\}|\{\{[^}]*\}\}/g) ?? []).sort().join('|')
const lineRe = /^(\s*)("(?:[^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*")(,?\s*)$/
for (const [lang, idx] of targets) {
  const file = new URL(`../lib/i18n/dictionaries/${lang}.ts`, import.meta.url)
  const refMap = ref[idx].map
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let changed = 0, skippedPh = 0
  const skipped = []
  const out = lines.map((line) => {
    const m = lineRe.exec(line)
    if (!m) return line
    let key, val
    try { key = JSON.parse(m[2]); val = JSON.parse(m[4]) } catch { return line }
    let rv = refMap[key]
    if (rv === undefined) {
      // The reference prints ALL-CAPS labels through CSS (text-transform) from a sentence-case key: "СВОЯ" <- "Своя" => "O'ZINIKI".
      const hasLetters = /[А-Яа-яЁё]/.test(key)
      const isUpper = hasLetters && key === key.toUpperCase()
      const sentence = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
      const alt = isUpper ? (refMap[sentence] ?? refMap[key.toLowerCase()]) : undefined
      if (alt === undefined || alt.trim() === '') return line
      rv = alt.toLocaleUpperCase(lang === 'uz' ? 'uz' : 'en')
    }
    if (rv === val || rv.trim() === '') return line
    if (ph(rv) !== ph(val)) { skippedPh++; if (skipped.length < 10) skipped.push([key, val, rv]); return line }
    changed++
    return `${m[1]}${m[2]}${m[3]}${JSON.stringify(rv)}${m[5]}`
  })
  console.log(lang, 'replaced', changed, 'skipped (placeholders differ)', skippedPh)
  if (skipped.length) console.log(JSON.stringify(skipped))
  if (!dry) fs.writeFileSync(file, out.join('\n'))
}
