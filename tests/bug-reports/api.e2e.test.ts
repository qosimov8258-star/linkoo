import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { BUG_REPORTS_PER_MINUTE } from "@/lib/bug-reports/types"

// POST /api/bug-reports against a RUNNING server (nothing is started here):
//   E2E_BASE_URL=http://localhost:3000 E2E_COOKIE='<session cookie name>=<value>' pnpm test
// E2E_COOKIE is the Cookie header of a signed-in browser session (DevTools → Application → Cookies).
// The valid reports this sends are real reports on that server (they go to its Telegram chat and AI
// provider when those are configured); their comment says they come from this test. The rate limit
// counts every attempt of the account, so wait a minute between two runs.

const BASE = process.env.E2E_BASE_URL?.trim().replace(/\/+$/, "")
const COOKIE = process.env.E2E_COOKIE?.trim()
const skip = !BASE || !COOKIE ? "E2E_BASE_URL and E2E_COOKIE are not set: start the app and pass a signed-in session cookie" : false

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")

function reportForm(comment: string): FormData {
  const form = new FormData()
  form.set("comment", comment)
  form.set("pageUrl", "/e2e-bug-report-test")
  form.set(
    "context",
    JSON.stringify({ pageUrl: "/e2e-bug-report-test", time: new Date().toISOString(), consoleErrors: [], failedRequests: [], actions: [] }),
  )
  form.set("screenshot", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "screenshot.png")
  return form
}

const VALID_COMMENT = "E2E avtomatik test: bu haqiqiy xato emas (tests/bug-reports/api.e2e.test.ts)"

const post = (form: FormData, cookie?: string) =>
  fetch(`${BASE}/api/bug-reports`, { method: "POST", body: form, headers: cookie ? { cookie } : {}, redirect: "manual" })

describe("POST /api/bug-reports (running server)", { skip }, () => {
  it("answers 401 without a session", async () => {
    const response = await post(reportForm(VALID_COMMENT))
    assert.equal(response.status, 401)
  })

  it("answers 400 on a too short comment", async () => {
    const response = await post(reportForm("abc"), COOKIE)
    assert.equal(response.status, 400)
    const body = (await response.json()) as { field?: string }
    assert.equal(body.field, "comment")
  })

  it("answers 201 with the id of a valid report", async () => {
    const response = await post(reportForm(VALID_COMMENT), COOKIE)
    assert.equal(response.status, 201)
    const body = (await response.json()) as { id: unknown; helper: unknown; delivered: unknown }
    assert.equal(typeof body.id, "number")
    assert.equal(typeof body.delivered, "boolean")
    assert.ok(body.helper === null || typeof body.helper === "object")
  })

  it(`answers 429 once the account sent more than ${BUG_REPORTS_PER_MINUTE} within a minute`, async () => {
    // The two requests above counted already (every attempt counts): the 4th answers 429.
    let status = 0
    for (let attempt = 0; attempt < BUG_REPORTS_PER_MINUTE; attempt++) {
      status = (await post(reportForm(VALID_COMMENT), COOKIE)).status
      if (status === 429) break
      assert.equal(status, 201)
    }
    assert.equal(status, 429)
  })
})
