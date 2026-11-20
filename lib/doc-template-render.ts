// Renders a print template of Справочники → Шаблоны документов (doc_templates.html).
//
// The reference stores these templates in Django's template language and merges them on its server
// (saas/merge_template/): {% load formats %}, {{ path.to.value|filter:arg }}, {% if … %}{% elif %}{% else %}{% endif %},
// {% for x in list %}{% empty %}{% endfor %} with forloop.counter, {% with a=b %}, {# … #} and {% comment %}.
// This is a small, self-contained subset of that language with the reference's "formats" filters
// (number_format, datetime_text_format, num_to_text, multiply, sum, …) and the common Django ones, so the
// stored templates print here as they do in the reference. Values are HTML-escaped (Django's autoescape)
// unless marked |safe. Unknown tags render nothing; unknown filters pass the value through.

export type TemplateContext = Record<string, unknown>
type Filter = (value: unknown, arg: unknown) => unknown

type Node =
  | { kind: "text"; text: string }
  | { kind: "var"; expr: string }
  | { kind: "if"; branches: Array<{ cond: string; body: Node[] }>; otherwise: Node[] }
  | { kind: "for"; names: string[]; source: string; reversed: boolean; body: Node[]; empty: Node[] }
  | { kind: "with"; assigns: Array<[string, string]>; body: Node[] }

type Token = { type: "text" | "var" | "tag"; value: string }

const SAFE = Symbol("safe")
type SafeText = { [SAFE]: true; text: string }
const safe = (text: string): SafeText => ({ [SAFE]: true, text })
const isSafe = (value: unknown): value is SafeText => typeof value === "object" && value !== null && SAFE in value

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\{%\s*([\s\S]*?)\s*%\}|\{\{\s*([\s\S]*?)\s*\}\}|\{#[\s\S]*?#\}/g
  let last = 0
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index > last) tokens.push({ type: "text", value: source.slice(last, match.index) })
    if (match[1] !== undefined) tokens.push({ type: "tag", value: match[1].trim() })
    else if (match[2] !== undefined) tokens.push({ type: "var", value: match[2].trim() })
    last = pattern.lastIndex
  }
  if (last < source.length) tokens.push({ type: "text", value: source.slice(last) })
  return tokens
}

/** Splits on whitespace (or `sep`) outside quotes. */
function splitOutsideQuotes(text: string, sep: RegExp = /\s/): string[] {
  const parts: string[] = []
  let current = ""
  let quote = ""
  for (const char of text) {
    if (quote) {
      current += char
      if (char === quote) quote = ""
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (sep.test(char)) {
      if (current) parts.push(current)
      current = ""
    } else current += char
  }
  if (current) parts.push(current)
  return parts
}

function parse(tokens: Token[]): Node[] {
  let index = 0
  // Reads nodes until one of `stops` (a tag name) and returns them with the tag that stopped.
  const block = (stops: string[]): { nodes: Node[]; stop: string; stopTag: string } => {
    const nodes: Node[] = []
    while (index < tokens.length) {
      const token = tokens[index++]
      if (token.type === "text") nodes.push({ kind: "text", text: token.value })
      else if (token.type === "var") nodes.push({ kind: "var", expr: token.value })
      else {
        const name = token.value.split(/\s+/)[0]
        if (stops.includes(name)) return { nodes, stop: name, stopTag: token.value }
        if (name === "if") {
          const branches: Array<{ cond: string; body: Node[] }> = []
          let cond = token.value.slice(2).trim()
          let otherwise: Node[] = []
          for (;;) {
            const part = block(["elif", "else", "endif"])
            if (part.stop === "else") {
              branches.push({ cond, body: part.nodes })
              otherwise = block(["endif"]).nodes
              break
            }
            branches.push({ cond, body: part.nodes })
            if (part.stop !== "elif") break
            cond = part.stopTag.slice(4).trim()
          }
          nodes.push({ kind: "if", branches, otherwise })
        } else if (name === "for") {
          const match = /^for\s+(.+?)\s+in\s+(.+?)(\s+reversed)?$/.exec(token.value)
          const body = block(["empty", "endfor"])
          const empty = body.stop === "empty" ? block(["endfor"]).nodes : []
          if (match) nodes.push({ kind: "for", names: match[1].split(",").map((item) => item.trim()), source: match[2].trim(), reversed: Boolean(match[3]), body: body.nodes, empty })
        } else if (name === "with") {
          const assigns = splitOutsideQuotes(token.value.slice(4).trim())
            .map((part) => /^([A-Za-z_]\w*)=(.+)$/.exec(part))
            .filter((match): match is RegExpExecArray => match !== null)
            .map((match) => [match[1], match[2]] as [string, string])
          nodes.push({ kind: "with", assigns, body: block(["endwith"]).nodes })
        } else if (name === "comment") {
          block(["endcomment"])
        }
        // load, csrf_token, url and other tags: nothing to print.
      }
    }
    return { nodes, stop: "", stopTag: "" }
  }
  return block([]).nodes
}

class Scope {
  constructor(
    private readonly frames: TemplateContext[],
    readonly filters: Record<string, Filter>,
  ) {}
  push(frame: TemplateContext): Scope {
    return new Scope([frame, ...this.frames], this.filters)
  }
  lookup(name: string): unknown {
    for (const frame of this.frames) if (Object.prototype.hasOwnProperty.call(frame, name)) return frame[name]
    return undefined
  }
}

function member(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    if (/^\d+$/.test(key)) return value[Number(key)]
    if (key === "count" || key === "length") return value.length
    return undefined
  }
  if (typeof value === "object") return (value as Record<string, unknown>)[key]
  if (typeof value === "string" && /^\d+$/.test(key)) return value[Number(key)]
  return undefined
}

function literal(text: string, scope: Scope): unknown {
  if (/^"[\s\S]*"$|^'[\s\S]*'$/.test(text)) return text.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === "None") return null
  if (text === "True") return true
  if (text === "False") return false
  const [head, ...rest] = text.split(".")
  return rest.reduce<unknown>((value, key) => member(value, key), scope.lookup(head))
}

/** `value|filter:arg|filter2` */
function evaluate(expr: string, scope: Scope): unknown {
  const [base, ...filters] = splitOutsideQuotes(expr, /\|/)
  let value = literal((base ?? "").trim(), scope)
  for (const raw of filters) {
    const [name, ...argParts] = splitOutsideQuotes(raw.trim(), /:/)
    const arg = argParts.length ? literal(argParts.join(":").trim(), scope) : undefined
    if (name === "safe") {
      value = safe(display(value))
      continue
    }
    const filter = scope.filters[name.trim()]
    if (filter) value = filter(isSafe(value) ? value.text : value, arg)
  }
  return value
}

function truthy(value: unknown): boolean {
  if (isSafe(value)) return value.text !== ""
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return Boolean(value)
}

function equal(a: unknown, b: unknown): boolean {
  // Python: 1 == 1.0, but "0" != 0.
  if (typeof a === "number" && typeof b === "number") return a === b
  return a === b || (a === null && b === undefined) || (a === undefined && b === null)
}

function compare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case "==":
      return equal(a, b)
    case "!=":
      return !equal(a, b)
    case "<":
      return Number(a) < Number(b)
    case ">":
      return Number(a) > Number(b)
    case "<=":
      return Number(a) <= Number(b)
    case ">=":
      return Number(a) >= Number(b)
    case "in":
      return Array.isArray(b) ? b.some((item) => equal(item, a)) : typeof b === "string" ? b.includes(String(a ?? "")) : false
    case "not in":
      return !compare(a, "in", b)
  }
  return false
}

/** Django's {% if %}: or < and < not < comparisons. */
function condition(text: string, scope: Scope): boolean {
  // Comparison operators written without spaces ("a=="0"") are split off first.
  const words = splitOutsideQuotes(text.replace(/(==|!=|<=|>=)/g, " $1 "))
  let position = 0
  const peek = () => words[position]
  const orExpr = (): boolean => {
    let value = andExpr()
    while (peek() === "or") {
      position++
      const right = andExpr()
      value = value || right
    }
    return value
  }
  const andExpr = (): boolean => {
    let value = notExpr()
    while (peek() === "and") {
      position++
      const right = notExpr()
      value = value && right
    }
    return value
  }
  const notExpr = (): boolean => {
    if (peek() === "not") {
      position++
      return !notExpr()
    }
    const left = evaluate(words[position++] ?? "", scope)
    let op = peek()
    if (op === "not" && words[position + 1] === "in") {
      position++
      op = "not in"
    }
    if (op && ["==", "!=", "<", ">", "<=", ">=", "in", "not in"].includes(op)) {
      position++
      return compare(left, op, evaluate(words[position++] ?? "", scope))
    }
    return truthy(left)
  }
  return orExpr()
}

function display(value: unknown): string {
  if (isSafe(value)) return value.text
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 1e9) / 1e9) : ""
  if (typeof value === "boolean") return value ? "True" : "False"
  if (Array.isArray(value)) return `[${value.map(display).join(", ")}]`
  if (typeof value === "object") return ""
  return String(value)
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

function renderNodes(nodes: Node[], scope: Scope): string {
  let out = ""
  for (const node of nodes) {
    if (node.kind === "text") out += node.text
    else if (node.kind === "var") {
      const value = evaluate(node.expr, scope)
      out += isSafe(value) ? value.text : escapeHtml(display(value))
    } else if (node.kind === "if") {
      const branch = node.branches.find((item) => condition(item.cond, scope))
      out += renderNodes(branch ? branch.body : node.otherwise, scope)
    } else if (node.kind === "with") {
      const frame: TemplateContext = {}
      for (const [name, expr] of node.assigns) frame[name] = evaluate(expr, scope)
      out += renderNodes(node.body, scope.push(frame))
    } else {
      const source = evaluate(node.source, scope)
      const list = Array.isArray(source) ? [...source] : source && typeof source === "object" ? Object.entries(source as Record<string, unknown>) : []
      if (node.reversed) list.reverse()
      if (!list.length) {
        out += renderNodes(node.empty, scope)
        continue
      }
      list.forEach((item, index) => {
        const frame: TemplateContext = {
          forloop: { counter: index + 1, counter0: index, revcounter: list.length - index, revcounter0: list.length - index - 1, first: index === 0, last: index === list.length - 1 },
        }
        if (node.names.length === 1) frame[node.names[0]] = item
        else node.names.forEach((name, position) => (frame[name] = member(item, String(position))))
        out += renderNodes(node.body, scope.push(frame))
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

/** "10 000", "1 234,5": grouped by spaces, a decimal comma, up to five decimals (the reference's money precision). */
export function formatTemplateNumber(value: unknown, maxFraction = 5): string {
  const number = toNumber(value)
  const [whole, fraction] = Math.abs(number).toFixed(maxFraction).replace(/\.?0+$/, "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  const text = fraction ? `${grouped},${fraction}` : grouped
  return number < 0 && text !== "0" ? `-${text}` : text
}

const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** A stored moment ("2026-07-17T08:24:09", "2026-07-17 08:24") as its parts, without time zone conversion. */
function momentParts(value: unknown): { year: string; month: number; day: string; time: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value ?? ""))
  if (!match) return null
  return { year: match[1], month: Number(match[2]), day: match[3], time: match[4] ? `${match[4]}:${match[5]}` : "" }
}

/** "17 июля 2026, 08:24" */
function datetimeText(value: unknown): string {
  const parts = momentParts(value)
  if (!parts) return display(value)
  const day = `${parts.day} ${MONTHS_GENITIVE[parts.month - 1] ?? ""} ${parts.year}`
  return parts.time ? `${day}, ${parts.time}` : day
}

function dateText(value: unknown): string {
  const parts = momentParts(value)
  return parts ? `${parts.day} ${MONTHS_GENITIVE[parts.month - 1] ?? ""} ${parts.year}` : display(value)
}

const ONES_MALE = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
const ONES_FEMALE = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"]
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"]
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"]
const SCALES: Array<{ forms: [string, string, string]; female: boolean }> = [
  { forms: ["", "", ""], female: false },
  { forms: ["тысяча", "тысячи", "тысяч"], female: true },
  { forms: ["миллион", "миллиона", "миллионов"], female: false },
  { forms: ["миллиард", "миллиарда", "миллиардов"], female: false },
  { forms: ["триллион", "триллиона", "триллионов"], female: false },
]

function plural(count: number, forms: [string, string, string]): string {
  const rest100 = count % 100
  const rest10 = count % 10
  if (rest100 >= 11 && rest100 <= 14) return forms[2]
  if (rest10 === 1) return forms[0]
  if (rest10 >= 2 && rest10 <= 4) return forms[1]
  return forms[2]
}

function triadWords(value: number, female: boolean): string[] {
  const words: string[] = []
  words.push(HUNDREDS[Math.floor(value / 100)])
  const rest = value % 100
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10])
  else {
    words.push(TENS[Math.floor(rest / 10)])
    words.push((female ? ONES_FEMALE : ONES_MALE)[rest % 10])
  }
  return words.filter(Boolean)
}

/** A whole number in Russian words ("десять тысяч"). */
export function integerToRussianWords(value: number, female = false): string {
  let rest = Math.floor(Math.abs(value))
  if (rest === 0) return "ноль"
  const words: string[] = []
  for (let scale = 0; rest > 0 && scale < SCALES.length; scale++) {
    const triad = rest % 1000
    rest = Math.floor(rest / 1000)
    if (!triad) continue
    const { forms, female: scaleFemale } = SCALES[scale]
    const part = triadWords(triad, scale === 0 ? female : scaleFemale)
    if (scale > 0) part.push(plural(triad, forms))
    words.unshift(...part)
  }
  return `${value < 0 ? "минус " : ""}${words.join(" ")}`
}

/** An amount in Russian words: "десять тысяч", "одна целая пять десятых". */
export function numberToRussianWords(value: unknown): string {
  const number = toNumber(value)
  const cents = Math.round(Math.abs(number) * 100) % 100
  if (!cents) return integerToRussianWords(Math.round(number))
  const whole = Math.trunc(number)
  const sign = number < 0 && whole === 0 ? "минус " : ""
  const wholeText = `${sign}${integerToRussianWords(whole, true)} ${plural(Math.abs(whole), ["целая", "целых", "целых"])}`
  if (cents % 10 === 0) return `${wholeText} ${integerToRussianWords(cents / 10, true)} ${plural(cents / 10, ["десятая", "десятых", "десятых"])}`
  return `${wholeText} ${integerToRussianWords(cents, true)} ${plural(cents, ["сотая", "сотых", "сотых"])}`
}

const FILTERS: Record<string, Filter> = {
  number_format: (value) => formatTemplateNumber(value),
  intcomma: (value) => formatTemplateNumber(value),
  money_format: (value) => formatTemplateNumber(value),
  datetime_text_format: (value) => datetimeText(value),
  date_text_format: (value) => dateText(value),
  null_or_text: (value) => (value === null || value === undefined || String(value).trim() === "" ? "-" : value),
  num_to_text: (value) => numberToRussianWords(value),
  multiply: (value, arg) => toNumber(value) * toNumber(arg),
  plus: (value, arg) => toNumber(value) + toNumber(arg),
  minus: (value, arg) => toNumber(value) - toNumber(arg),
  divide: (value, arg) => (toNumber(arg) ? toNumber(value) / toNumber(arg) : 0),
  get_box: (value, arg) => (toNumber(arg) ? formatTemplateNumber(toNumber(value) / toNumber(arg), 2) : "-"),
  sum: (value, arg) => (Array.isArray(value) ? value.reduce((total: number, item) => total + toNumber(arg === undefined ? item : member(item, String(arg))), 0) : 0),
  add: (value, arg) => (typeof value === "number" || typeof arg === "number" ? toNumber(value) + toNumber(arg) : `${display(value)}${display(arg)}`),
  default: (value, arg) => (truthy(value) ? value : arg),
  default_if_none: (value, arg) => (value === null || value === undefined ? arg : value),
  length: (value) => (Array.isArray(value) ? value.length : display(value).length),
  upper: (value) => display(value).toUpperCase(),
  lower: (value) => display(value).toLowerCase(),
  title: (value) => display(value).replace(/(^|\s)(\S)/g, (_, space: string, char: string) => space + char.toUpperCase()),
  capfirst: (value) => display(value).replace(/^\S/, (char) => char.toUpperCase()),
  first: (value) => (Array.isArray(value) ? value[0] : display(value)[0]),
  last: (value) => (Array.isArray(value) ? value[value.length - 1] : display(value).slice(-1)),
  join: (value, arg) => (Array.isArray(value) ? value.map(display).join(display(arg)) : value),
  floatformat: (value, arg) => {
    const places = arg === undefined ? -1 : Math.trunc(toNumber(arg))
    const number = toNumber(value)
    if (places < 0) return Number.isInteger(Math.round(number * 10 ** -places) / 10 ** -places) ? String(Math.round(number)) : number.toFixed(-places)
    return number.toFixed(places)
  },
  date: (value) => dateText(value),
  time: (value) => momentParts(value)?.time ?? "",
  cut: (value, arg) => display(value).split(display(arg)).join(""),
  yesno: (value, arg) => {
    const [yes = "yes", no = "no", none = no] = display(arg ?? "yes,no").split(",")
    return value === null || value === undefined ? none : truthy(value) ? yes : no
  },
}

/** Renders a stored template with `context`; `extraFilters` add to (or replace) the built-in filters. */
export function renderDocTemplate(source: string, context: TemplateContext, extraFilters: Record<string, Filter> = {}): string {
  const scope = new Scope([context], { ...FILTERS, ...extraFilters })
  return renderNodes(parse(tokenize(source)), scope)
}

/** Drops what a printed page must never run (scripts, frames, plug-ins, inline handlers, javascript: links). The
 * page's Content-Security-Policy blocks them anyway; this keeps the markup clean. */
export function stripActiveContent(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|frameset|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|iframe|object|embed|frame|frameset|base|meta|link|noscript)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"')
}
