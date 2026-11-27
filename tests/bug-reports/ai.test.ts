import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import {
  AI_MESSAGES,
  ANALYSIS_SYSTEM_PROMPT,
  BugAiError,
  FIX_JSON_PROMPT,
  HELPER_SYSTEM_PROMPT,
  MANUAL_SEPARATOR,
  analyzeBugReport,
  askHelper,
  describeAiError,
  failedJsonGeneration,
  validateAnalysis,
  type ChatClient,
  type ChatRequest,
} from "@/lib/bug-reports/ai"

// The AI calls with a mocked OpenAI client: no network, zero waits between retries.

type Answer = string | Error | "hang"

/** A client that answers the queued answers in turn (an Error is thrown, "hang" never answers). */
function mockClient(answers: Answer[]) {
  const calls: ChatRequest[] = []
  const signals: Array<AbortSignal | undefined> = []
  const client: ChatClient = {
    chat: {
      completions: {
        create(body, options) {
          calls.push(JSON.parse(JSON.stringify(body)) as ChatRequest)
          signals.push(options?.signal)
          const next = answers.length > 1 ? answers.shift()! : answers[0]
          if (next === "hang") return new Promise(() => {})
          if (next instanceof Error) return Promise.reject(next)
          return Promise.resolve({ choices: [{ message: { content: next } }] })
        },
      },
    },
  }
  return { client, calls, signals }
}

const httpError = (status: number) => Object.assign(new Error(`${status} error`), { status })

/** Groq's refusal of a JSON-mode answer that is not valid JSON, shaped as the OpenAI SDK throws it
 * (BadRequestError: status, code and the body's error object). */
const jsonValidateFailed = (failedGeneration?: string, codeOnBodyOnly = false) =>
  Object.assign(new Error("400 Failed to generate JSON. Please adjust your prompt."), {
    status: 400,
    ...(codeOnBodyOnly ? {} : { code: "json_validate_failed" }),
    error: {
      message: "Failed to generate JSON. Please adjust your prompt.",
      type: "invalid_request_error",
      code: "json_validate_failed",
      ...(failedGeneration === undefined ? {} : { failed_generation: failedGeneration }),
    },
  })

const VALID = {
  qisqa: "Saqlash tugmasi xato beradi",
  skrinshotda_korinadi: "Qizil xato xabari",
  mijoz_nima_demoqchi: "Buyurtmani saqlamoqchi",
  qayerda: "Savdo → Buyurtmalar → Saqlash → POST /api/orders",
  texnik_sabab: "500 javob",
  yechim: "Server logini tekshirish",
  turi: "bug",
  jiddiylik: "o‘rta",
  ishonch: "taxmin",
  dalillar: ["POST /api/orders 500"],
}

const INPUT = { comment: "Saqlab bo'lmayapti", context: { pageUrl: "/orders", server: { userId: 7, username: "ali", role: "manager" } }, imageDataUrl: "data:image/jpeg;base64,AAAA" }
const FAST = { retryWaitsMs: [0, 0, 0] }

const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ["GROQ_API_KEY", "GROQ_VISION_MODEL", "GROQ_TEXT_MODEL", "AI_BASE_URL"]

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe("analyzeBugReport", () => {
  it("parses a valid answer and sends the prompt, the context and the image", async () => {
    const { client, calls } = mockClient([JSON.stringify(VALID)])
    const analysis = await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(analysis.qisqa, VALID.qisqa)
    assert.equal(analysis.jiddiylik, "o'rta")
    assert.equal(analysis.ishonch, "taxmin")
    assert.deepEqual(analysis.dalillar, ["POST /api/orders 500"])
    assert.equal(calls.length, 1)
    const [request] = calls
    assert.equal(request.model, "qwen/qwen3.8-27b")
    assert.equal(request.temperature, 0.2)
    assert.deepEqual(request.response_format, { type: "json_object" })
    assert.deepEqual(request.messages[0], { role: "system", content: ANALYSIS_SYSTEM_PROMPT })
    const parts = request.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    assert.equal(parts[0].type, "text")
    assert.ok(parts[0].text?.includes("Saqlab bo'lmayapti"))
    assert.ok(parts[1].text?.includes('"pageUrl":"/orders"'))
    // The account's id and login are not sent to the provider, the role is.
    assert.ok(!parts[1].text?.includes("ali") && parts[1].text?.includes("manager"))
    assert.deepEqual(parts[2], { type: "image_url", image_url: { url: INPUT.imageDataUrl } })
  })

  it("reads the vision model from the environment at call time", async () => {
    process.env.GROQ_VISION_MODEL = "some/vision-model"
    const { client, calls } = mockClient([JSON.stringify(VALID)])
    await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(calls[0].model, "some/vision-model")
  })

  it("asks once more after an invalid answer, with the bad answer and the fix prompt", async () => {
    const { client, calls } = mockClient(["not json at all", JSON.stringify(VALID)])
    const analysis = await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(analysis.turi, "bug")
    assert.equal(calls.length, 2)
    const second = calls[1].messages
    assert.deepEqual(second.at(-2), { role: "assistant", content: "not json at all" })
    assert.deepEqual(second.at(-1), { role: "user", content: FIX_JSON_PROMPT })
  })

  it("treats Groq's 400 json_validate_failed as an invalid answer and asks once more with its text", async () => {
    const broken = '{"qisqa": "Saqlash tugmasi'
    const { client, calls } = mockClient([jsonValidateFailed(broken), JSON.stringify(VALID)])
    const analysis = await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(analysis.qisqa, VALID.qisqa)
    assert.equal(calls.length, 2)
    const second = calls[1].messages
    assert.deepEqual(second.at(-2), { role: "assistant", content: broken })
    assert.deepEqual(second.at(-1), { role: "user", content: FIX_JSON_PROMPT })
  })

  it("re-asks after json_validate_failed without a failed generation (no empty assistant message)", async () => {
    const { client, calls } = mockClient([jsonValidateFailed(undefined, true), JSON.stringify(VALID)])
    await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(calls.length, 2)
    const second = calls[1].messages
    assert.equal(second.length, 3)
    assert.deepEqual(second.at(-1), { role: "user", content: FIX_JSON_PROMPT })
    assert.ok(second.every((message) => message.role !== "assistant"))
  })

  it("fails as invalid JSON when the re-ask is refused as well, after exactly two calls", async () => {
    const { client, calls } = mockClient([jsonValidateFailed("{oops")])
    await assert.rejects(analyzeBugReport(INPUT, { client, ...FAST }), (error: unknown) => error instanceof BugAiError && error.message === AI_MESSAGES.badJson)
    assert.equal(calls.length, 2)
  })

  it("does not take another 400 for an invalid answer", async () => {
    const { client, calls } = mockClient([httpError(400)])
    await assert.rejects(analyzeBugReport(INPUT, { client, ...FAST }), /400/)
    assert.equal(calls.length, 1)
    assert.equal(failedJsonGeneration(httpError(400)), null)
    assert.equal(failedJsonGeneration(Object.assign(new Error("x"), { status: 422, code: "json_validate_failed" })), null)
    assert.equal(failedJsonGeneration(jsonValidateFailed("{a")), "{a")
  })

  it("cuts long fields on code points and drops lone surrogates (jsonb refuses them)", () => {
    // 1998 letters and 10 emoji: 2018 UTF-16 units, so a cut at unit 1999 would split the first emoji.
    const long = "a".repeat(1998) + "😀".repeat(10)
    const analysis = validateAnalysis({ ...VALID, qisqa: long, dalillar: [long, "x\ud83d y"] })
    assert.ok(analysis)
    for (const text of [analysis.qisqa, ...analysis.dalillar]) {
      assert.ok(text.isWellFormed(), "no lone surrogate")
      assert.ok(!/\\ud[89ab]/i.test(JSON.stringify(text)), "JSON.stringify writes no surrogate escape")
    }
    assert.equal(Array.from(analysis.qisqa).length, 2000)
    assert.ok(analysis.qisqa.endsWith("😀…"))
    assert.equal(analysis.dalillar[1], "x\ufffd y")
    const message = describeAiError(new Error("e".repeat(998) + "😀😀😀"))
    assert.ok(message.isWellFormed() && message.endsWith("😀…"))
  })

  it("treats a JSON with a bad field as invalid", async () => {
    const { client, calls } = mockClient([JSON.stringify({ ...VALID, jiddiylik: "juda" }), JSON.stringify(VALID)])
    await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(calls.length, 2)
  })

  it("fails after two invalid answers", async () => {
    const { client, calls } = mockClient([JSON.stringify({ qisqa: "x" })])
    await assert.rejects(analyzeBugReport(INPUT, { client, ...FAST }), (error: unknown) => error instanceof BugAiError && error.message === AI_MESSAGES.badJson)
    assert.equal(calls.length, 2)
  })

  it("retries a 429 and succeeds", async () => {
    const { client, calls } = mockClient([httpError(429), JSON.stringify(VALID)])
    const waits: number[] = []
    const analysis = await analyzeBugReport(INPUT, { client, retryWaitsMs: [5, 20, 60], sleep: async (ms) => void waits.push(ms) })
    assert.equal(analysis.qisqa, VALID.qisqa)
    assert.equal(calls.length, 2)
    assert.deepEqual(waits, [5])
  })

  it("retries 5xx and network errors", async () => {
    const network = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })
    const { client, calls } = mockClient([httpError(503), network, JSON.stringify(VALID)])
    await analyzeBugReport(INPUT, { client, ...FAST })
    assert.equal(calls.length, 3)
  })

  it("throws after 3 retries when every call fails", async () => {
    const { client, calls } = mockClient([httpError(429)])
    await assert.rejects(analyzeBugReport(INPUT, { client, ...FAST }), /429/)
    assert.equal(calls.length, 4)
  })

  it("does not retry a 4xx other than 429", async () => {
    const { client, calls } = mockClient([httpError(401)])
    await assert.rejects(analyzeBugReport(INPUT, { client, ...FAST }), /401/)
    assert.equal(calls.length, 1)
  })

  it("times out each call, aborts it and retries", async () => {
    const { client, calls, signals } = mockClient(["hang"])
    await assert.rejects(analyzeBugReport(INPUT, { client, ...FAST, timeoutMs: 10 }), (error: unknown) => error instanceof BugAiError && error.message === AI_MESSAGES.timeout)
    assert.equal(calls.length, 4)
    assert.ok(signals.every((signal) => signal?.aborted))
  })

  it("fails fast without GROQ_API_KEY", async () => {
    await assert.rejects(analyzeBugReport(INPUT), (error: unknown) => error instanceof BugAiError && error.message === AI_MESSAGES.noApiKey)
  })
})

describe("askHelper", () => {
  const HELPER_INPUT = { comment: "Hisobotni qanday ochaman?", pageUrl: "/reports", context: {}, manual: "# Qo'llanma\nHisobotlar menyusi." }

  it("sends the helper prompt with the manual and parses the answer", async () => {
    const { client, calls } = mockClient([JSON.stringify({ holat: "yordam", mijozga_javob: "1. Menyu → Hisobotlar", savol: "" })])
    const result = await askHelper(HELPER_INPUT, { client })
    assert.deepEqual(result, { holat: "yordam", mijozga_javob: "1. Menyu → Hisobotlar", savol: "" })
    const [request] = calls
    assert.equal(request.model, "openai/gpt-oss-120b")
    assert.equal(request.temperature, 0.2)
    assert.deepEqual(request.response_format, { type: "json_object" })
    assert.equal(request.messages[0].content, HELPER_SYSTEM_PROMPT + MANUAL_SEPARATOR + HELPER_INPUT.manual)
    const user = String(request.messages[1].content)
    assert.ok(user.includes(HELPER_INPUT.comment) && user.includes("Sahifa: /reports"))
  })

  it("turns a question without a question into xato", async () => {
    const { client } = mockClient([JSON.stringify({ holat: "aniqlashtirish", mijozga_javob: "", savol: "  " })])
    assert.equal((await askHelper(HELPER_INPUT, { client })).holat, "xato")
  })

  it("keeps the one question of aniqlashtirish", async () => {
    const { client } = mockClient([JSON.stringify({ holat: "aniqlashtirish", mijozga_javob: "Aniqlashtiring", savol: "Qaysi hisobot?" })])
    assert.deepEqual(await askHelper(HELPER_INPUT, { client }), { holat: "aniqlashtirish", mijozga_javob: "Aniqlashtiring", savol: "Qaysi hisobot?" })
  })

  it("turns help without an answer into xato", async () => {
    const { client } = mockClient([JSON.stringify({ holat: "yordam", mijozga_javob: "" })])
    assert.equal((await askHelper(HELPER_INPUT, { client })).holat, "xato")
  })

  it("throws on an unknown state or broken JSON, and never retries", async () => {
    const bad = mockClient([JSON.stringify({ holat: "balki", mijozga_javob: "?" })])
    await assert.rejects(askHelper(HELPER_INPUT, { client: bad.client }), (error: unknown) => error instanceof BugAiError)
    const broken = mockClient(["{oops", JSON.stringify({ holat: "xato" })])
    await assert.rejects(askHelper(HELPER_INPUT, { client: broken.client }))
    assert.equal(broken.calls.length, 1)
    const limited = mockClient([httpError(429), JSON.stringify({ holat: "xato" })])
    await assert.rejects(askHelper(HELPER_INPUT, { client: limited.client }), /429/)
    assert.equal(limited.calls.length, 1)
  })

  it("gives up after its timeout", async () => {
    const { client, calls } = mockClient(["hang"])
    await assert.rejects(askHelper(HELPER_INPUT, { client, timeoutMs: 10 }), (error: unknown) => error instanceof BugAiError && error.message === AI_MESSAGES.timeout)
    assert.equal(calls.length, 1)
  })

  it("fails fast without GROQ_API_KEY", async () => {
    await assert.rejects(askHelper(HELPER_INPUT), (error: unknown) => error instanceof BugAiError && error.message === AI_MESSAGES.noApiKey)
  })
})
