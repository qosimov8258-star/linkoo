import "server-only"

import OpenAI, { APIConnectionError } from "openai"
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions"

import {
  BUG_CONFIDENCES,
  BUG_HELPER_STATES,
  BUG_SEVERITIES,
  BUG_TYPES,
  type BugAnalysis,
  type BugHelperResult,
} from "@/lib/bug-reports/types"

// The two AI calls of a bug report, through an OpenAI-compatible API (Groq by default):
//  - askHelper: the text model reads the customer's comment, the page and the context (no image) with the
//    system manual (docs/ai-qollanma.md) and answers the customer at once: a step-by-step answer, one
//    question, or "this is a bug". One 20 s attempt: the customer waits for it, so it is never retried.
//  - analyzeBugReport: the vision model explains the report to the developer from the screenshot and the
//    context. It runs in the background after the report was delivered, so it may retry: 30 s per call,
//    on 429 / 5xx / network errors / timeouts again after 5 s, 20 s and 60 s, and an answer that is not
//    valid JSON is asked for once more. In JSON mode Groq does not return such an answer: it refuses it
//    with 400 json_validate_failed (the broken text in failed_generation), which counts as one.
// The configuration is read from the environment at call time (no restart after editing .env in dev),
// and the client and the waits are parameters, so the tests run without a network.

export const ANALYSIS_SYSTEM_PROMPT = `Sen ERP tizimining texnik yordamchisisan. Senga mijozning xato haqidagi izohi, ekran skrinshoti va tizim avtomatik yig'gan kontekst (sahifa, console xatolari, muvaffaqiyatsiz API so'rovlari, oxirgi harakatlar, backend loglari) beriladi.
Vazifang: dasturchiga xatoni aniq va tushunarli qilib tushuntirish.

Faqat shu JSON'ni qaytar:
{
  "qisqa": "nima buzilganini bir jumlada",
  "skrinshotda_korinadi": "ekranda nima ko'rinyapti: xato xabari matni, bo'sh joy, noto'g'ri raqam va h.k.",
  "mijoz_nima_demoqchi": "mijoz aslida nima qilmoqchi bo'lgan, oddiy tilda",
  "qayerda": "modul → sahifa → tugma → API endpoint (kontekstda bo'lsa)",
  "texnik_sabab": "kontekst va loglarga asoslangan sabab",
  "yechim": "dasturchi nimani tekshirishi yoki o'zgartirishi kerak",
  "turi": "bug | dizayn | tushunmovchilik | taklif",
  "jiddiylik": "past | o'rta | yuqori | kritik",
  "ishonch": "aniq | taxmin",
  "dalillar": ["xulosaga asos bo'lgan aniq log qatori yoki ekrandagi matn"]
}

Qoidalar:
- Faqat skrinshot va kontekstdagi dalillarga tayan, hech narsani o'ylab topma. Dalil yetarli bo'lmasa "ishonch": "taxmin" deb yoz va "texnik_sabab"da nima yetishmayotganini ayt.
- Bu xato bo'lmasa-yu, mijoz tizimni noto'g'ri tushungan bo'lsa, "turi": "tushunmovchilik" deb yoz.
- Skrinshotdagi shaxsiy ma'lumotlarni (ism, telefon, summa) javobga ko'chirma.
- Mijoz lotin, kirill yoki rus tilida, imlo xatolari bilan yozishi mumkin. Hammasini tushun. Javobni o'zbek tilida (lotin yozuvida), oddiy va qisqa yoz.
- Muammo pul, to'lov, ma'lumot yo'qolishi yoki tizimga kira olmaslik bilan bog'liq bo'lsa, jiddiylik kamida "yuqori" bo'lsin.`

export const HELPER_SYSTEM_PROMPT = `Sen Mezon ERP tizimining yordamchisisan. Quyida tizim qo'llanmasi berilgan. Mijoz muammosini o'qi. Agar bu tizimni noto'g'ri ishlatish bo'lsa, faqat qo'llanmaga tayanib qisqa, qadam-baqadam yo'l ko'rsat. Qo'llanmada yo'q narsani o'ylab topma. Ishonching komil bo'lmasa, holat 'xato' bo'lsin. Mijoz qaysi tilda yozsa (o'zbek lotin, kirill, rus), shu tilda javob ber. Faqat JSON qaytar.`

/** Between the helper's system prompt and the manual. */
export const MANUAL_SEPARATOR = "\n\n--- TIZIM QO'LLANMASI ---\n"

/** The helper's prompt names no JSON shape, so the user message does (the system prompt stays verbatim). */
// The three answers as the owner defined them (the system prompt itself is his text, verbatim).
const HELPER_FORMAT = [
  `Javob formati (faqat shu JSON): {"holat": "yordam | aniqlashtirish | xato", "mijozga_javob": "mijozga javob matni", "savol": "holat aniqlashtirish bo'lsa, faqat bitta savol; aks holda bo'sh qator"}`,
  `- "yordam": mijoz tizimni noto'g'ri ishlatgan va qo'llanmaga ko'ra buni o'zi tuzata oladi: "mijozga_javob"da qadam-baqadam yo'l.`,
  `- "aniqlashtirish": izoh juda noaniq (nima qilmoqchi bo'lgani, qaysi sahifa yoki tugma, nima bo'lgani yo'q): "savol"da BITTA aniq savol (masalan, "Qaysi tugmani bosdingiz?"), "mijozga_javob" qisqa.`,
  `- "xato": haqiqiy xato yoki ishonching komil emas: xabar darhol dasturchiga ketadi, shuning uchun "mijozga_javob"da mijozdan qo'shimcha ma'lumot so'rama.`,
].join("\n")

/** The language of a customer's comment, for the helper's answer. Menu labels the customer quotes («Филиалы») are
 * Russian whatever language they write in, so quoted text does not count; Cyrillic Uzbek has its own letters. */
export function commentLanguage(comment: string): "o'zbek (lotin)" | "o'zbek (kirill)" | "rus" {
  const own = comment.replace(/«[^»]*»|"[^"]*"/g, " ")
  const latin = (own.match(/[A-Za-z]/g) ?? []).length
  const cyrillic = (own.match(/[\u0400-\u04FF]/g) ?? []).length
  if (latin >= cyrillic) return "o'zbek (lotin)"
  return /[ўқғҳЎҚҒҲ]/.test(own) ? "o'zbek (kirill)" : "rus"
}

/** Sent after an analysis that was not valid JSON (once). */
export const FIX_JSON_PROMPT = "Faqat to'g'ri JSON qaytar"

export const ANALYSIS_TIMEOUT_MS = 30_000
export const HELPER_TIMEOUT_MS = 20_000
/** Waits before the 2nd, 3rd and 4th analysis call after a retryable failure. */
export const ANALYSIS_RETRY_WAITS_MS: readonly number[] = [5_000, 20_000, 60_000]

/** The context is capped before it goes to a model: the token budget of the provider is small, and the
 * first entries (the newest errors) are the ones that matter. */
const ANALYSIS_CONTEXT_MAX_CHARS = 16_000
// Kept small with the manual excerpt: the whole request must stay well under the provider's per-minute token budget.
const HELPER_CONTEXT_MAX_CHARS = 3_000
const FIELD_MAX_CHARS = 2_000
const EVIDENCE_MAX_ITEMS = 20

/** Russian keys (the admin page passes ai_error through t()). */
export const AI_MESSAGES = {
  noApiKey: "GROQ_API_KEY не задан",
  badJson: "Ответ AI не является корректным JSON",
  timeout: "AI не ответил вовремя",
} as const

/** A failure of an AI call; `retryable` says whether the analysis may try again. */
export class BugAiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "BugAiError"
  }
}

export type ChatRequest = {
  model: string
  messages: ChatCompletionMessageParam[]
  temperature: number
  response_format: { type: "json_object" }
}

/** The part of the OpenAI client the calls use (a mock in the tests). */
export type ChatClient = {
  chat: {
    completions: {
      create(
        body: ChatRequest,
        options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
      ): PromiseLike<{ choices: Array<{ message?: { content?: string | null } | null }> }>
    }
  }
}

export type AiDeps = {
  /** The client to call; default: an OpenAI client for AI_BASE_URL with GROQ_API_KEY. */
  client?: ChatClient
  /** Waits between analysis attempts (tests pass zeros). */
  retryWaitsMs?: readonly number[]
  /** Per-call timeout (default ANALYSIS_TIMEOUT_MS / HELPER_TIMEOUT_MS). */
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** The AI configuration, read now (not at import time). */
export function aiConfig() {
  return {
    baseURL: process.env.AI_BASE_URL || "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY || "",
    visionModel: process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b",
    textModel: process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b",
  }
}

/** True when an AI call can be made at all (the helper is skipped without a key). */
export function aiConfigured(): boolean {
  return Boolean(aiConfig().apiKey)
}

declare global {
  var __mezonBugAiClient: { key: string; client: ChatClient } | undefined
}

/** One OpenAI client per base URL and key (keep-alive connections are reused). Its own retries are off:
 * the analysis retries with its own waits, the helper never. */
function defaultClient(): ChatClient {
  const { baseURL, apiKey } = aiConfig()
  if (!apiKey) throw new BugAiError(AI_MESSAGES.noApiKey, false)
  const key = `${baseURL}\n${apiKey}`
  if (globalThis.__mezonBugAiClient?.key !== key) {
    globalThis.__mezonBugAiClient = { key, client: new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: ANALYSIS_TIMEOUT_MS }) }
  }
  return globalThis.__mezonBugAiClient.client
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One call: its answer text ("" when there is none), or an error. The timeout is enforced here as
 * well as passed to the client, so a client that ignores the signal cannot hold the caller. */
async function callOnce(client: ChatClient, body: ChatRequest, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new BugAiError(AI_MESSAGES.timeout, true))
    }, timeoutMs)
  })
  try {
    const completion = await Promise.race([
      Promise.resolve(client.chat.completions.create(body, { signal: controller.signal, timeout: timeoutMs, maxRetries: 0 })),
      timeout,
    ])
    const content = completion?.choices?.[0]?.message?.content
    return typeof content === "string" ? content : ""
  } finally {
    clearTimeout(timer)
  }
}

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETUNREACH", "EHOSTUNREACH"])

/** 429, 5xx, a timeout or a network failure: worth another attempt. A 4xx (bad key, bad request) is not. */
export function isRetryableAiError(error: unknown): boolean {
  if (error instanceof BugAiError) return error.retryable
  if (!error || typeof error !== "object") return false
  const { status, name, code, cause } = error as { status?: unknown; name?: unknown; code?: unknown; cause?: unknown }
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500
  // The SDK's own timeout is an APIConnectionTimeoutError (a subclass).
  if (error instanceof APIConnectionError) return true
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError" || name === "TimeoutError") return true
  if (typeof code === "string" && (NETWORK_CODES.has(code) || code.startsWith("UND_ERR"))) return true
  // Node's fetch: TypeError("fetch failed") with the socket error as its cause.
  if (name === "TypeError" && cause && typeof cause === "object") return true
  return false
}

async function withRetries<T>(fn: () => Promise<T>, waits: readonly number[], sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= waits.length || !isRetryableAiError(error)) throw error
      await sleep(waits[attempt] ?? 0)
    }
  }
}

/** `text` cut to at most `max` characters, "…" included, on code points: a cut between the two halves of
 * an emoji would leave a lone surrogate, which JSON.stringify writes as "\ud83d" and Postgres jsonb (and
 * strict JSON parsers) refuse. */
function cutChars(text: string, max: number): string {
  if (text.length <= max) return text
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`
}

/** The text of an AI failure, as stored in ai_error (≤ 1000 characters). */
export function describeAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const text = message.trim() || (error instanceof Error ? error.name : "AI error")
  return cutChars(text.toWellFormed(), 1000)
}

/** Groq's answer to a JSON-mode completion that is not valid JSON: 400 json_validate_failed, the broken
 * text in error.failed_generation. That text ("" when there is none), or null for any other error. */
export function failedJsonGeneration(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const { status, code, error: body } = error as { status?: unknown; code?: unknown; error?: unknown }
  if (status !== 400) return null
  const details = body && typeof body === "object" ? (body as { code?: unknown; failed_generation?: unknown }) : {}
  if (code !== "json_validate_failed" && details.code !== "json_validate_failed") return null
  return typeof details.failed_generation === "string" ? details.failed_generation : ""
}

// --- Answer parsing ------------------------------------------------------------------------------

/** The JSON object of a model answer: code fences and text around the object are tolerated. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
  const candidates = [trimmed]
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start > 0 || (start >= 0 && end < trimmed.length - 1)) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      // the next candidate
    }
  }
  return null
}

const APOSTROPHES = /[ʻʼ’‘`´']/g
const enumKey = (value: string) => value.trim().toLowerCase().replace(APOSTROPHES, "")

/** `value` as one of `allowed` ("O‘rta", "orta" → "o'rta"), or null. */
function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null
  const key = enumKey(value)
  return allowed.find((item) => enumKey(item) === key) ?? null
}

/** A text field of a model answer as it may be stored (jsonb): no NUL, no lone surrogate (a model can
 * send "\ud83d" in its JSON as well), at most FIELD_MAX_CHARS characters. */
function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null
  return cutChars(value.replace(/\u0000/g, "").toWellFormed().trim(), FIELD_MAX_CHARS)
}

const ANALYSIS_TEXT_FIELDS = ["qisqa", "skrinshotda_korinadi", "mijoz_nima_demoqchi", "qayerda", "texnik_sabab", "yechim"] as const

/** The analysis when every field is there and valid, else null. */
export function validateAnalysis(raw: unknown): BugAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const texts = {} as Record<(typeof ANALYSIS_TEXT_FIELDS)[number], string>
  for (const field of ANALYSIS_TEXT_FIELDS) {
    const text = cleanField(value[field])
    if (text === null) return null
    texts[field] = text
  }
  if (!texts.qisqa) return null
  const turi = normalizeEnum(value.turi, BUG_TYPES)
  const jiddiylik = normalizeEnum(value.jiddiylik, BUG_SEVERITIES)
  const ishonch = normalizeEnum(value.ishonch, BUG_CONFIDENCES)
  if (!turi || !jiddiylik || !ishonch) return null
  if (!Array.isArray(value.dalillar)) return null
  const dalillar: string[] = []
  for (const item of value.dalillar) {
    const text = typeof item === "number" ? String(item) : cleanField(item)
    if (text === null) return null
    if (text) dalillar.push(text)
  }
  return { ...texts, turi, jiddiylik, ishonch, dalillar: dalillar.slice(0, EVIDENCE_MAX_ITEMS) }
}

/** The helper's answer, or null when it is not one. A question without a question, or help without an
 * answer, is treated as "xato" (the report goes to the developer). */
export function validateHelperResult(raw: unknown): BugHelperResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const holat = normalizeEnum(value.holat, BUG_HELPER_STATES)
  if (!holat) return null
  const answer = value.mijozga_javob === undefined || value.mijozga_javob === null ? "" : cleanField(value.mijozga_javob)
  const question = value.savol === undefined || value.savol === null ? "" : cleanField(value.savol)
  if (answer === null || question === null) return null
  if (holat === "aniqlashtirish" && !question) return { holat: "xato", mijozga_javob: answer, savol: "" }
  if (holat === "yordam" && !answer) return { holat: "xato", mijozga_javob: "", savol: "" }
  return { holat, mijozga_javob: answer, savol: holat === "aniqlashtirish" ? question : "" }
}

// --- Context for the models ----------------------------------------------------------------------

/** The stored context as the models see it: without the account's id and login (the AI needs the role,
 * not who it is), as JSON capped at `max` characters. */
export function contextForModel(context: unknown, max: number): string {
  let value = context ?? {}
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { server, ...rest } = value as Record<string, unknown>
    if (server && typeof server === "object" && !Array.isArray(server)) {
      const { role, receivedAt, backendErrors } = server as Record<string, unknown>
      value = { ...rest, server: { role, receivedAt, backendErrors } }
    }
  }
  let text: string
  try {
    text = JSON.stringify(value) ?? "{}"
  } catch {
    text = "{}"
  }
  // On code points: a lone surrogate at the cut would make the request body invalid JSON for the provider.
  return text.length > max ? `${Array.from(text).slice(0, max).join("")} …(qisqartirildi)` : text
}

// --- The calls -----------------------------------------------------------------------------------

export type AnalysisInput = {
  comment: string
  /** The stored (masked) context. */
  context: unknown
  /** The screenshot as a data URL (data:image/jpeg;base64,…), or null when the report has none. */
  imageDataUrl: string | null
}

/** The vision model's analysis of a report (validated), or an error after the retries. */
export async function analyzeBugReport(input: AnalysisInput, deps: AiDeps = {}): Promise<BugAnalysis> {
  const client = deps.client ?? defaultClient()
  const { visionModel } = aiConfig()
  const waits = deps.retryWaitsMs ?? ANALYSIS_RETRY_WAITS_MS
  const sleep = deps.sleep ?? realSleep
  const timeoutMs = deps.timeoutMs ?? ANALYSIS_TIMEOUT_MS
  const content: ChatCompletionContentPart[] = [
    { type: "text", text: `Mijoz izohi:\n${input.comment}` },
    { type: "text", text: `Kontekst (JSON):\n${contextForModel(input.context, ANALYSIS_CONTEXT_MAX_CHARS)}` },
    input.imageDataUrl ? { type: "image_url", image_url: { url: input.imageDataUrl } } : { type: "text", text: "Skrinshot yo'q." },
  ]
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
    { role: "user", content },
  ]
  const ask = (list: ChatCompletionMessageParam[]) =>
    withRetries(
      () => callOnce(client, { model: visionModel, messages: list, temperature: 0.2, response_format: { type: "json_object" } }, timeoutMs),
      waits,
      sleep,
    )
  // A JSON-mode refusal of an invalid answer (failedJsonGeneration) is that invalid answer, not a failure.
  const askForText = async (list: ChatCompletionMessageParam[]) => {
    try {
      return await ask(list)
    } catch (error) {
      const failed = failedJsonGeneration(error)
      if (failed === null) throw error
      return failed
    }
  }
  const first = await askForText(messages)
  const analysis = validateAnalysis(parseJsonObject(first))
  if (analysis) return analysis
  // Once more, with the broken answer in the conversation, so the model fixes that one (an empty
  // assistant message is left out: providers refuse one).
  const broken: ChatCompletionMessageParam[] = first.trim() ? [{ role: "assistant", content: first }] : []
  const second = await askForText([...messages, ...broken, { role: "user", content: FIX_JSON_PROMPT }])
  const fixed = validateAnalysis(parseJsonObject(second))
  if (fixed) return fixed
  throw new BugAiError(AI_MESSAGES.badJson, false)
}

export type HelperInput = {
  comment: string
  pageUrl: string
  context: unknown
  /** docs/ai-qollanma.md (lib/bug-reports/manual.ts), "" when there is none. */
  manual: string
}

/** The text model's answer to the customer (validated). One attempt within HELPER_TIMEOUT_MS; any
 * failure throws, and the caller then delivers the report without it. */
export async function askHelper(input: HelperInput, deps: AiDeps = {}): Promise<BugHelperResult> {
  const client = deps.client ?? defaultClient()
  const { textModel } = aiConfig()
  const timeoutMs = deps.timeoutMs ?? HELPER_TIMEOUT_MS
  const user = [
    `Mijoz izohi:\n${input.comment}`,
    `Sahifa: ${input.pageUrl || "-"}`,
    `Kontekst (JSON):\n${contextForModel(input.context, HELPER_CONTEXT_MAX_CHARS)}`,
    `Mijoz yozgan til: ${commentLanguage(input.comment)}. "mijozga_javob" va "savol" shu tilda bo'lsin.`,
    HELPER_FORMAT,
  ].join("\n\n")
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: HELPER_SYSTEM_PROMPT + MANUAL_SEPARATOR + input.manual },
    { role: "user", content: user },
  ]
  const answer = await callOnce(client, { model: textModel, messages, temperature: 0.2, response_format: { type: "json_object" } }, timeoutMs)
  const result = validateHelperResult(parseJsonObject(answer))
  if (!result) throw new BugAiError(AI_MESSAGES.badJson, false)
  return result
}
