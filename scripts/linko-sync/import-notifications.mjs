// Уведомления: the notifications of the Linko administrator (notification/notifications: "Заказ доставлен",
// "Перечислена") into user_notifications for the local administrator account(s) (users.role = 'admin', RECIPIENT env
// = one users.id instead), in the form the app writes them: the template's Russian i18n key + its values (params), so
// the bell and /notifications show and translate them like the app's own. Linko ids are kept (id = Linko id), and a
// row with a recipient is never touched by the legacy-seed cleanup (that one only removes recipient-less demo rows).
//
//   node scripts/linko-sync/import-notifications.mjs        (raw file: notifications)
import { connect, ensureRegistry, raw, register, runId, utcIso } from "./lib.mjs"

const run = runId("notifications")
const items = raw("notifications")

const TEMPLATES = {
  order_delivered: {
    title: "Заказ доставлен",
    text: "Заказ №{id} был доставлен клиенту {client} доставщиком {delivery_man}",
    parse: (text) => {
      const m = /^Заказ №(\d+) был доставлен клиенту (.*) доставщиком (.*)$/s.exec(text)
      return m ? { id: Number(m[1]), client: m[2].trim(), delivery_man: m[3].trim() } : null
    },
    link: (item) => `/analytics/sales/${item.object_id}`,
  },
  transfer_create: {
    title: "Перечислена",
    text: "В {cashboxname} перечислена {amount} {currency_name}, пожалуйста, подтвердите",
    parse: (text) => {
      const m = /^В (.*) перечислена (\S+) (\S+)[,\s]+пожалуйста[,\s]+подтвердите\s*$/s.exec(text)
      return m ? { cashboxname: m[1].trim(), amount: m[2], currency_name: m[3] } : null
    },
    link: () => "/analytics/cash-management",
  },
}

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, raw: 0 }
try {
  await client.query("BEGIN")
  const recipients = process.env.RECIPIENT
    ? [Number(process.env.RECIPIENT)]
    : (await client.query("SELECT id FROM users WHERE role = 'admin' AND username <> 'qa_import' ORDER BY id")).rows.map((row) => Number(row.id))
  if (!recipients.length) throw new Error("No administrator account to receive the notifications")
  // One recipient keeps the Linko ids; further recipients get their own copies (new ids).
  for (const [index, recipient] of recipients.entries()) {
    for (const item of items) {
      const name = typeof item.template === "object" ? item.template?.name : item.template
      const template = TEMPLATES[name]
      const params = template?.parse(String(item.text ?? "")) ?? null
      const values = {
        title: params ? template.title : String(item.title ?? ""),
        text: params ? template.text : String(item.text ?? ""),
        template: String(name ?? ""),
        object_id: Number(item.object_id) || 0,
        viewed: item.viewed ? 1 : 0,
        created_date: utcIso(item.created_date).slice(0, 19),
        recipient_id: recipient,
        link: template ? template.link(item) : "",
        params: JSON.stringify(params ?? {}),
      }
      if (!params) stats.raw++
      if (index === 0) {
        const current = (await client.query("SELECT title, text, template, object_id, viewed, created_date, recipient_id, link, params FROM user_notifications WHERE id = $1", [item.id])).rows[0]
        if (!current) {
          await client.query(
            `INSERT INTO user_notifications (id, title, text, template, object_id, viewed, created_date, recipient_id, link, params)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [item.id, ...Object.values(values)],
          )
          await register(client, run, "user_notifications", item.id, "insert")
          stats.insert++
        } else if (Object.keys(values).some((key) => String(current[key]) !== String(values[key]))) {
          await client.query(
            `UPDATE user_notifications SET title = $2, text = $3, template = $4, object_id = $5, viewed = $6, created_date = $7, recipient_id = $8, link = $9, params = $10 WHERE id = $1`,
            [item.id, ...Object.values(values)],
          )
          await register(client, run, "user_notifications", item.id, "update", current)
          stats.update++
        } else stats.same++
      } else {
        const exists = await client.query("SELECT 1 FROM user_notifications WHERE recipient_id = $1 AND template = $2 AND object_id = $3 AND created_date = $4", [recipient, values.template, values.object_id, values.created_date])
        if (exists.rowCount) {
          stats.same++
          continue
        }
        const row = (await client.query(
          `INSERT INTO user_notifications (title, text, template, object_id, viewed, created_date, recipient_id, link, params)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          Object.values(values),
        )).rows[0]
        await register(client, run, "user_notifications", row.id, "insert")
        stats.insert++
      }
    }
  }
  await client.query("SELECT setval(pg_get_serial_sequence('user_notifications', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM user_notifications), 1))")
  await client.query("COMMIT")
  console.log(`notifications: ${items.length} in Linko → recipients ${recipients.join(",")}:`, JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
