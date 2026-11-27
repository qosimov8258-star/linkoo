// Masking of the context a bug report carries (lib/bug-reports/types.ts BugClientContext). The
// browser collects console errors, failed API answers (their bodies) and click labels on its own,
// so they can hold whatever the page showed or the server answered: passwords, tokens, phone and
// card numbers of clients. That text is stored, shown to admins, sent to the AI provider and to
// Telegram, so it is masked on the server before anything is saved. The customer's own comment is
// NOT masked (the admin must read it unchanged; the customer chose to write it).
//
// Every pattern here runs in linear time: the masking runs synchronously on the one Node process
// before the report is saved, and a pattern that backtracks over a long run of letters (an
// unbounded `[\w-]*` in front of a word) let one report block every request of the app for
// minutes. Repetitions are bounded or anchored, and long strings are cut before they are masked.
//
// Pure functions, no server imports: the unit tests (tests/bug-reports/mask.test.ts) run them
// outside Next.

export const MASK = "***"

/** Keys whose value is a secret: the whole value is replaced, whatever it is. */
const SENSITIVE_KEY =
  /passw|passcode|^pass$|^pin$|pwd|parol|пароль|token|secret|authori[sz]ation|cookie|api[\s_-]?key|private[\s_-]?key|credential|session[\s_-]?id/i

/** `key=value` / `"key": "value"` inside a text (a query string, a JSON body cut to 500 characters).
 * The match starts at the word itself: what stands before it in the key ("x_" of "x_password") is
 * left as it is anyway, and matching it too was what made a long run of letters cost O(n²). A quoted
 * value is masked up to its closing quote, spaces and commas included (a value cut before its quote,
 * to the end of the text); a bare one up to a space or a delimiter, together with the scheme word of
 * an Authorization value ("Token 9f8e…", "Bearer …"). */
const INLINE_SECRET =
  /((?:passw(?:or)?d|passcode|pwd|parol|token|secret|authori[sz]ation|cookie|api[_-]?key|apikey|private[_-]?key|session[_-]?id)[\w-]{0,64}["']?\s{0,16}[:=]\s{0,16})(?:(")[^"\\]*(?:\\[\s\S][^"\\]*)*("?)|(')[^'\\]*(?:\\[\s\S][^'\\]*)*('?)|(?:(?:Bearer|Basic|Token|Digest|Negotiate|NTLM|ApiKey|Key)[ \t]+)?[^\s"'&,;}\]]+)/gi
const BEARER = /\b(Bearer)\s+[\w\-.~+/]+=*/gi
/** Basic credentials are base64: only a long enough run counts ("Basic plan" is plain text). */
const BASIC = /\b(Basic)\s+[A-Za-z0-9+/]{8,}={0,2}/g
/** A JSON Web Token (header.payload.signature, the header always starts with "eyJ"). It must start a
 * run of token characters: with `\b` every "eyJ" inside "eyJ-eyJ-…" was a new start that scanned to
 * the end of the run. */
const JWT = /(?<![\w-])eyJ[\w-]{10,4096}\.[\w-]{10,8192}\.[\w-]{0,8192}/g

/** A card number: 13–19 digits, optionally grouped by single spaces or dashes. */
const CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g
/** An international phone number: "+" and 9–15 digits with spaces, dashes, dots or brackets. */
const PHONE_INTERNATIONAL = /\+\d(?:[ \-().]{0,2}\d){8,14}(?!\d)/g
/** A local phone number grouped like "90 123 45 67", "(90) 123-45-67", "998 90 123-45-67", or with
 * the last seven digits together ("90 1234567", "998 90 1234567"). Dates ("2026-11-27") never fit:
 * their groups are 4-2-2; amounts neither: their groups are 3-3-3. */
const PHONE_LOCAL = /(?<![\d-])(?:\d{3}[ -])?(?:\(?\d{2,3}\)?[ -]\d{3}[ -]\d{2}[ -]\d{2}|\(?\d{2}\)?[ -]\d{7})(?![\d-])/g
/** A bare run of 9–12 digits (a phone written without spaces). */
const DIGIT_RUN = /(?<!\d)\d{9,12}(?!\d)/g

/** One piece of a URL (a path segment, a query key or value) or a word of a text. A search typed into
 * a page reaches the address bar URL-encoded: "+998 90 123 45 67" becomes "%2B998+90+123+45+67", which
 * the number patterns above do not see. */
const URL_SEGMENT = /[^\s"'<>\\&=?#/]+/g
const ENCODED_MARK = /%[0-9a-f]{2}|\+/i
const HEX_PAIR = /^[0-9a-f]{2}$/i

/** Deeper nesting than this is cut: the browser's context is flat, deeper data is noise. */
const MAX_DEPTH = 24
/** A string of the context is cut to this length before it is masked. The tracker never sends more
 * than 500 characters; only an address (the page, a failed request) can be longer. */
export const CONTEXT_STRING_MAX = 2_000
/** How far back from a cut digits and number separators are dropped (an encoded card is the longest). */
const NUMBER_TAIL_MAX = 80
const NUMBER_CHAR = /[\d\s()+%.-]/
/** Any origin: only the path and the query of the parsed page address are kept. */
const PAGE_BASE = "http://page.invalid"

const digitCount = (text: string) => (text.match(/\d/g) ?? []).length

/** Every digit but the last `keep` becomes "*"; spaces, dashes and the "+" stay (the shape stays readable). */
function maskDigits(text: string, keep: number): string {
  let left = digitCount(text) - keep
  return text.replace(/\d/g, (digit) => (left-- > 0 ? "*" : digit))
}

/** Removes what Postgres cannot store (NUL in TEXT / JSONB) and broken UTF-16 halves. */
export function cleanText(text: string): string {
  return text.replace(/\u0000/g, "").toWellFormed()
}

/** True for a key whose value must never be stored (password, token, cookie, …). */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** The first `max` characters of a text. Digits and number separators right before the cut go with it:
 * a card or phone number cut in two no longer looks like one, and its first half would stay readable. */
export function cutForMask(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max
  const stop = Math.max(0, max - NUMBER_TAIL_MAX)
  while (end > stop && NUMBER_CHAR.test(text[end - 1])) end -= 1
  return text.slice(0, end)
}

function maskInlineSecret(_match: string, prefix: string, doubleQuote?: string, doubleEnd?: string, singleQuote?: string, singleEnd?: string): string {
  if (doubleQuote) return `${prefix}"${MASK}${doubleEnd ?? ""}`
  if (singleQuote) return `${prefix}'${MASK}${singleEnd ?? ""}`
  return `${prefix}${MASK}`
}

/** Card and phone numbers. Only digits change (to "*"), so the text keeps its length. */
function maskNumbers(input: string): string {
  let text = input.replace(CARD, (match) => {
    const digits = digitCount(match)
    return digits >= 13 && digits <= 19 ? maskDigits(match, 4) : match
  })
  text = text.replace(PHONE_INTERNATIONAL, (match) => {
    const digits = digitCount(match)
    return digits >= 9 && digits <= 15 ? maskDigits(match, 2) : match
  })
  text = text.replace(PHONE_LOCAL, (match) => maskDigits(match, 2))
  return text.replace(DIGIT_RUN, (match) => maskDigits(match, 2))
}

/** Card and phone numbers written URL-encoded ("90+123+45+67", "%2B998%2090…", "8600%201234…"). Each
 * piece is read decoded ("+" a space, "%XX" its character), masked like plain text, and only the digits
 * that changed are replaced: every other character keeps its own encoding, so an address stays valid
 * and a plain word with a "+" stays unchanged. */
function maskEncodedNumbers(text: string): string {
  return text.replace(URL_SEGMENT, (segment) => {
    if (!ENCODED_MARK.test(segment)) return segment
    const pieces: string[] = []
    let decoded = ""
    for (let index = 0; index < segment.length; ) {
      let piece = segment[index]
      let char = piece === "+" ? " " : piece
      if (piece === "%" && HEX_PAIR.test(segment.slice(index + 1, index + 3))) {
        piece = segment.slice(index, index + 3)
        const code = Number.parseInt(piece.slice(1), 16)
        // A byte of a non-ASCII character is never a digit or a separator: one neutral character each.
        char = code < 0x80 ? String.fromCharCode(code) : "�"
      }
      pieces.push(piece)
      decoded += char
      index += piece.length
    }
    const masked = maskNumbers(decoded)
    if (masked === decoded) return segment
    // maskNumbers only turns digits into "*", so the decoded and the masked text line up character by character.
    if (masked.length !== decoded.length) return maskNumbers(segment)
    return pieces.map((piece, index) => (masked[index] === decoded[index] ? piece : masked[index])).join("")
  })
}

/** Masks secrets, card numbers and phone numbers inside a text, URL-encoded ones included. Cards keep their
 * last 4 digits, phones their last 2. */
export function maskText(input: string): string {
  let text = cleanText(input)
  text = text.replace(BEARER, `$1 ${MASK}`).replace(BASIC, `$1 ${MASK}`).replace(JWT, MASK)
  text = text.replace(INLINE_SECRET, maskInlineSecret)
  text = maskEncodedNumbers(text)
  return maskNumbers(text)
}

/** The page of a report, as it is stored and shown: a masked path of this app ("/clients?search=…") of at
 * most `max` characters. The browser sends exactly such a path (location.pathname + search). Anything else
 * came from a forged request: a full address keeps only its path and query, and a "//host/…" path (which a
 * browser opens as another site) loses its host, so neither the admin page nor the Telegram line ever
 * offers another site as the page of a report. A non-http address ("javascript:…") is dropped. */
export function maskPageUrl(value: string, max: number): string {
  const text = cleanText(cutForMask(value.trim(), max))
  if (!text) return ""
  let url: URL
  try {
    url = new URL(text, PAGE_BASE)
  } catch {
    return ""
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return ""
  return maskText(`/${url.pathname.replace(/^\/+/, "")}${url.search}`).slice(0, max)
}

/** A masked deep copy of parsed JSON: sensitive keys → "***", every string through maskText (cut to
 * CONTEXT_STRING_MAX first, with "…" where it was cut). */
export function maskContext(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const cut = cutForMask(value, CONTEXT_STRING_MAX)
    return cut.length < value.length ? `${maskText(cut)}…` : maskText(value)
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (depth >= MAX_DEPTH) return null
  if (Array.isArray(value)) return value.map((item) => maskContext(item, depth + 1))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [rawKey, item] of Object.entries(value as Record<string, unknown>)) {
      const key = cleanText(rawKey)
      const masked = isSensitiveKey(key) && item !== null && item !== "" ? MASK : maskContext(item, depth + 1)
      // "__proto__" stays an own key, exactly as JSON.parse produced it.
      Object.defineProperty(out, key, { value: masked, enumerable: true, writable: true, configurable: true })
    }
    return out
  }
  return null
}
