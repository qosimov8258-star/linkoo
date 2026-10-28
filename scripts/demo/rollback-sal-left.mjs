// Restores the "Опросник" records (ref_records kind 'survey') to the state saved before
// scripts' enrichment with the reference quizzes (organization, flags, questions...).
// Backup: scripts/demo/data/surveys-before-enrich.json  (reference data: scripts/demo/data/reference-quizzes.json)
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const before = JSON.parse(fs.readFileSync(new URL('./data/surveys-before-enrich.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
for (const survey of before) {
  await c.query(`UPDATE ref_records SET data = $1 WHERE kind = 'survey' AND id = $2`, [JSON.stringify(survey), String(survey.id)])
}
await c.query('COMMIT')
console.log('restored', before.length)
await c.end()
