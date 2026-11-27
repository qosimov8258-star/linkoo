import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CONTEXT_STRING_MAX, MASK, cleanText, maskContext, maskPageUrl, maskText } from "@/lib/bug-reports/mask"

// The context of a bug report is masked before it is stored, shown or sent to the AI / Telegram.

describe("maskContext", () => {
  it("replaces the values of secret keys at any depth", () => {
    const masked = maskContext({
      password: "hunter2",
      user: { accessToken: "abc.def", name: "Ali" },
      headers: [{ Authorization: "Bearer zzz", Cookie: "sid=1" }],
      apiKey: 12345,
      emptyPassword: "",
    }) as Record<string, unknown>
    assert.deepEqual(masked, {
      password: MASK,
      user: { accessToken: MASK, name: "Ali" },
      headers: [{ Authorization: MASK, Cookie: MASK }],
      apiKey: MASK,
      emptyPassword: "",
    })
  })

  it("masks the strings inside and keeps numbers, booleans and null", () => {
    const masked = maskContext({ consoleErrors: [{ message: "call +998 90 123 45 67" }], count: 3, ok: true, none: null }) as {
      consoleErrors: Array<{ message: string }>
      count: number
      ok: boolean
      none: null
    }
    assert.equal(masked.consoleErrors[0].message, "call +*** ** *** ** 67")
    assert.equal(masked.count, 3)
    assert.equal(masked.ok, true)
    assert.equal(masked.none, null)
  })

  it("cuts a long string before masking it, and drops a number cut in two", () => {
    const long = maskContext({ message: "x".repeat(199_000) }) as { message: string }
    assert.equal(long.message, `${"x".repeat(CONTEXT_STRING_MAX)}…`)
    const atCut = maskContext({ message: `${"y".repeat(CONTEXT_STRING_MAX - 10)} +998 90 123 45 67` }) as { message: string }
    assert.equal(atCut.message, `${"y".repeat(CONTEXT_STRING_MAX - 10)}…`)
  })

  it("keeps __proto__ an own key and does not touch the prototype", () => {
    const masked = maskContext(JSON.parse('{"__proto__": {"x": 1}}')) as Record<string, unknown>
    assert.ok(Object.prototype.hasOwnProperty.call(masked, "__proto__"))
    assert.equal(({} as Record<string, unknown>).x, undefined)
  })
})

describe("maskText", () => {
  it("masks Bearer tokens and JWTs", () => {
    const text = maskText("Authorization: Bearer abc.DEF-123_xyz")
    assert.ok(!text.includes("abc.DEF"))
    const jwt = maskText("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig")
    assert.ok(!jwt.includes("eyJ"))
  })

  it("masks secrets written as key=value or JSON inside a text", () => {
    assert.equal(maskText('{"password":"secret1","name":"Ali"}'), `{"password":"${MASK}","name":"Ali"}`)
    assert.equal(maskText("/api/x?access_token=abc123&page=2"), `/api/x?access_token=${MASK}&page=2`)
    assert.equal(maskText("parol: qwerty"), `parol: ${MASK}`)
    assert.equal(maskText("x_password=abc&y=1"), `x_password=${MASK}&y=1`)
  })

  it("masks a quoted secret up to its closing quote, spaces and punctuation included", () => {
    assert.equal(maskText('{"password":"Qwe rty 12"}'), `{"password":"${MASK}"}`)
    assert.equal(maskText('{"password":"Abc,123;x"}'), `{"password":"${MASK}"}`)
    assert.equal(maskText('{"password":"a\\"b c","name":"Ali"}'), `{"password":"${MASK}","name":"Ali"}`)
    assert.equal(maskText('"newPassword": "x y"'), `"newPassword": "${MASK}"`)
    // A body cut before the closing quote: the rest of the text is the value.
    assert.equal(maskText('{"token":"abc def'), `{"token":"${MASK}`)
  })

  it("masks the scheme and the credentials of an Authorization value", () => {
    assert.equal(maskText("Authorization: Token 9f8e7d6c5b4a"), `Authorization: ${MASK}`)
    assert.equal(maskText("Authorization: Bearer abc.DEF-123_xyz"), `Authorization: ${MASK}`)
  })

  it("masks card numbers keeping the last 4 digits", () => {
    assert.equal(maskText("card 8600 1234 5678 9012"), "card **** **** **** 9012")
    assert.equal(maskText("4111-1111-1111-1111"), "****-****-****-1111")
    assert.equal(maskText("4111111111111111"), "************1111")
  })

  it("masks phone numbers keeping the last 2 digits", () => {
    assert.equal(maskText("+998 90 123 45 67"), "+*** ** *** ** 67")
    assert.equal(maskText("+998901234567"), "+**********67")
    assert.equal(maskText("tel (90) 123-45-67"), "tel (**) ***-**-67")
    assert.equal(maskText("90 123 45 67"), "** *** ** 67")
    assert.equal(maskText("901234567"), "*******67")
    assert.equal(maskText("998 90 1234567"), "*** ** *****67")
    assert.equal(maskText("90 1234567"), "** *****67")
  })

  it("masks URL-encoded phone and card numbers, keeping the encoding of the rest", () => {
    assert.equal(maskText("/clients?search=90+123+45+67"), "/clients?search=**+***+**+67")
    assert.equal(maskText("/clients?search=%2B998+90+123+45+67"), "/clients?search=%2B***+**+***+**+67")
    assert.equal(maskText("/clients?search=90%20123%2045%2067"), "/clients?search=**%20***%20**%2067")
    assert.equal(maskText("/api/clients?q=998%2090%20123%2045%2067"), "/api/clients?q=***%20**%20***%20**%2067")
    assert.equal(maskText("8600%201234%205678%209012"), "****%20****%20****%209012")
    assert.equal(maskText("/clients?search=%D0%90%D0%BB%D0%B8+90+123+45+67"), "/clients?search=%D0%90%D0%BB%D0%B8+**+***+**+67")
  })

  it("leaves dates, times, short numbers and amounts alone", () => {
    for (const text of [
      "2026-11-27T10:00:00.000Z",
      "2026-11-27 10:00",
      "2026-11-27T10:00:00+05:00",
      "order 12345",
      "Сумма 1 500 000",
      "Сумма 150 000 000",
      "/orders?amount=1+500+000&date=2026-11-27",
      "/clients?select=1-2-3-45-67",
      "HTTP 500",
      "id=42",
    ]) {
      assert.equal(maskText(text), text)
    }
  })

  it("drops NUL and broken UTF-16 halves", () => {
    assert.equal(cleanText("a\u0000b"), "ab")
    assert.equal(cleanText("x\ud800y"), "x�y")
  })
})

describe("maskPageUrl", () => {
  it("keeps the browser's path and query, masked", () => {
    assert.equal(maskPageUrl("/clients?showTab=1", 2000), "/clients?showTab=1")
    assert.equal(maskPageUrl("/clients?search=%2B998+90+123+45+67", 2000), "/clients?search=%2B***+**+***+**+67")
  })

  it("never keeps another site: a full address keeps its path and query, a //host path loses its host", () => {
    assert.equal(maskPageUrl("https://mezon-login.example/clients?a=1#top", 2000), "/clients?a=1")
    assert.equal(maskPageUrl("//evil.example/x", 2000), "/x")
    assert.equal(maskPageUrl("/\\evil.example/x", 2000), "/x")
    assert.equal(maskPageUrl("/\t/evil.example/x", 2000), "/x")
    assert.equal(maskPageUrl("https://app.example//evil.example/a", 2000), "/evil.example/a")
    assert.equal(maskPageUrl("javascript:alert(1)", 2000), "")
    assert.equal(maskPageUrl("   ", 2000), "")
  })

  it("is cut to its maximum", () => {
    assert.equal(maskPageUrl(`/${"a".repeat(2_000_000)}`, 2000).length, 2000)
  })
})

// The masking runs synchronously on the server's one process before a report is saved: a pattern that backtracks
// over a long run (O(n²)) blocks every request of the app. Each of these took seconds to hours before.
describe("masking time", () => {
  const LIMIT_MS = 200
  const inputs: Array<[string, string]> = [
    ["200k letters", "a".repeat(200_000)],
    ['"eyJ-" × 50k', "eyJ-".repeat(50_000)],
    ['"password" × 25k', "password".repeat(25_000)],
    ['"token" × 40k', "token".repeat(40_000)],
    ['\'"password":"\' × 15k', '"password":"'.repeat(15_000)],
    ['"%20" × 70k', "%20".repeat(70_000)],
    ['"+1" × 100k', "+1".repeat(100_000)],
    ['"1 " × 100k', "1 ".repeat(100_000)],
    ["200k digits", "9".repeat(200_000)],
  ]

  for (const [name, input] of inputs) {
    it(`masks ${name} in under ${LIMIT_MS} ms`, () => {
      maskText("warm up 90 123 45 67")
      const started = performance.now()
      maskText(input)
      const elapsed = performance.now() - started
      assert.ok(elapsed < LIMIT_MS, `${name}: ${elapsed.toFixed(1)} ms`)
    })
  }

  it(`masks a 2 MB page address in under ${LIMIT_MS} ms`, () => {
    const started = performance.now()
    maskPageUrl("a".repeat(2_000_000), 2000)
    assert.ok(performance.now() - started < LIMIT_MS)
  })
})
