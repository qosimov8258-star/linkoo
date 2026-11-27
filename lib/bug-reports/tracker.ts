// The browser-side context of a bug report (lib/bug-reports/types.ts BugClientContext): what went wrong on the page
// before the customer opened the AI assistant. A light tracker installed once per tab from the assistant button of
// the top navigation (it is on every signed-in page): failed fetches, console errors / uncaught errors, and the last
// button and link clicks. Client-only; every function is a no-op without a window, so importing it from a client
// component never breaks server rendering.

import type { BugClientContext } from "./types"

/** Elements of the assistant itself (its button, its panel): their clicks are not the customer's steps. The panel
 * is marked "panel" and is also left out of the screenshot (lib/bug-reports/image.ts captureViewport). */
export const BUG_REPORT_UI_ATTRIBUTE = "data-bug-report"

const KEEP = 10
const MESSAGE_MAX = 500
const BODY_MAX = 500
const LABEL_MAX = 80
const TARGET_MAX = 120
/** The reports' own requests (a 429 of a second report…) are not part of the page's trouble. */
const OWN_API_PREFIX = "/api/bug-reports"

type Store = {
  installed: boolean
  /** > 0 while a screenshot is taken: modern-screenshot fetches the page's pictures and fonts through window.fetch,
   * and a refused one (CSP, another host) is not a failure of the page. */
  capturing: number
  consoleErrors: BugClientContext["consoleErrors"]
  failedRequests: BugClientContext["failedRequests"]
  actions: BugClientContext["actions"]
}

declare global {
  interface Window {
    // On window rather than in a module variable: a hot reload re-runs this module, and a second install would wrap
    // fetch and console.error twice.
    __mezonBugTracker?: Store
  }
}

function store(): Store | null {
  if (typeof window === "undefined") return null
  window.__mezonBugTracker ??= { installed: false, capturing: 0, consoleErrors: [], failedRequests: [], actions: [] }
  return window.__mezonBugTracker
}

function keepLast<T>(list: T[], item: T) {
  list.push(item)
  if (list.length > KEEP) list.splice(0, list.length - KEEP)
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** One console/error argument as text: never throws, never walks a huge object (React elements, DOM trees). */
function describe(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    const stack = (value.stack ?? "").split("\n").slice(1, 4).map((line) => line.trim()).join(" ")
    return `${value.name}: ${value.message}${stack ? ` ${stack}` : ""}`
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return typeof value === "function" ? `[function ${value.name || "anonymous"}]` : String(value)
  }
  if (typeof Element !== "undefined" && value instanceof Element) return `<${value.tagName.toLowerCase()}>`
  try {
    const seen = new WeakSet<object>()
    // The replacer runs once per value: after this many the rest is dropped, so a big object costs little.
    let budget = 200
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (--budget < 0) return undefined
      if (typeof item === "bigint") return item.toString()
      if (typeof item === "function") return "[function]"
      if (typeof Element !== "undefined" && item instanceof Element) return `<${item.tagName.toLowerCase()}>`
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[circular]"
        seen.add(item)
      }
      return item
    })
    return json ?? Object.prototype.toString.call(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function recordError(args: unknown[]) {
  const tracker = store()
  if (!tracker) return
  const message = clip(args.map(describe).join(" ").trim(), MESSAGE_MAX)
  if (message) keepLast(tracker.consoleErrors, { time: new Date().toISOString(), message })
}

/** At most this much of an address: a page like Клиенты can carry thousands of ids in its query (select=1-2-3…),
 * which would push the report over the server's context limit (BUG_CONTEXT_MAX_CHARS). */
const URL_MAX = 2_000

/** A request URL without this site's origin (other hosts keep theirs, without the query). */
function shortUrl(raw: string): string {
  try {
    const url = new URL(raw, window.location.href)
    return clip(url.origin === window.location.origin ? `${url.pathname}${url.search}` : `${url.origin}${url.pathname}`, URL_MAX)
  } catch {
    return clip(raw, TARGET_MAX)
  }
}

function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase()
  return { url: shortUrl(raw), method }
}

function installFetch(tracker: Store) {
  const originalFetch = window.fetch
  window.fetch = async function trackedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const { url, method } = requestParts(input, init)
    const isOwn = url.startsWith(OWN_API_PREFIX)
    const skip = () => isOwn || (tracker.capturing > 0 && !url.startsWith("/api/"))
    let response: Response
    try {
      response = await originalFetch.call(window, input, init)
    } catch (error) {
      // A request the page cancelled itself (a newer search replaced it) is not a failure.
      const aborted = error instanceof DOMException && error.name === "AbortError"
      if (!aborted && !skip()) {
        // The message only: the stack of a network error is this wrapper's own frames.
        const body = error instanceof Error ? `${error.name}: ${error.message}` : describe(error)
        keepLast(tracker.failedRequests, { time: new Date().toISOString(), method, url, status: 0, body: clip(body, BODY_MAX) })
      }
      throw error
    }
    if (response.status >= 400 && !skip()) {
      const entry = { time: new Date().toISOString(), method, url, status: response.status, body: "" }
      keepLast(tracker.failedRequests, entry)
      // The body is read from a copy, in the background: the caller gets the untouched response at once.
      try {
        response
          .clone()
          .text()
          .then((text) => {
            entry.body = clip(text, BODY_MAX)
          })
          .catch(() => {})
      } catch {
        // A body already used elsewhere cannot be copied; the status alone is kept.
      }
    }
    return response
  }
}

function installConsole() {
  const originalError = console.error
  console.error = function trackedConsoleError(...args: unknown[]) {
    try {
      recordError(args)
    } catch {
      // Recording must never stop the page's own error output.
    }
    return originalError.apply(this, args)
  }
  window.addEventListener("error", (event: ErrorEvent) => {
    // A failed <img>/<script> load reaches window listeners only in the capture phase, so this one sees script errors.
    const where = event.filename ? `(${shortUrl(event.filename)}:${event.lineno}:${event.colno})` : ""
    recordError([event.error instanceof Error ? event.error : event.message, where])
  })
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    recordError(["Unhandled rejection:", event.reason])
  })
}

/** What a click hit, for a developer reading the report: a link's path, else the tag, its id/type and its area. */
function describeTarget(element: Element): string {
  if (element instanceof HTMLAnchorElement && element.getAttribute("href")) return clip(shortUrl(element.href), TARGET_MAX)
  let selector = element.tagName.toLowerCase()
  if (element.id) selector += `#${element.id}`
  const type = element.getAttribute("type")
  if (type && type !== "button") selector += `[type=${type}]`
  const area = element.parentElement?.closest("form, dialog, [role=dialog], table, nav, header, aside")
  if (area) selector += ` in ${area.getAttribute("role") === "dialog" ? "dialog" : area.tagName.toLowerCase()}${area.id ? `#${area.id}` : ""}`
  return clip(selector, TARGET_MAX)
}

function installClicks(tracker: Store) {
  document.addEventListener(
    "click",
    (event) => {
      try {
        const start = event.target instanceof Element ? event.target : null
        const element = start?.closest('button, a, [role="button"]')
        if (!element || element.closest(`[${BUG_REPORT_UI_ATTRIBUTE}]`)) return
        const text = element instanceof HTMLElement ? element.innerText : (element.textContent ?? "")
        const label = (text || element.getAttribute("aria-label") || element.getAttribute("title") || "").replace(/\s+/g, " ").trim()
        keepLast(tracker.actions, {
          time: new Date().toISOString(),
          kind: element.tagName === "A" ? "link" : "button",
          label: clip(label, LABEL_MAX),
          target: describeTarget(element),
        })
      } catch {
        // A click is never blocked by the tracker.
      }
    },
    // Capture phase: recorded even when the page's own handler stops the event.
    true,
  )
}

/** Installs the tracker once per tab (idempotent; safe to call on every mount). */
export function installBugTracker() {
  const tracker = store()
  if (!tracker || tracker.installed) return
  tracker.installed = true
  installFetch(tracker)
  installConsole()
  installClicks(tracker)
}

/** While a screenshot is taken, the page's picture/font requests that fail are not recorded; call the returned
 * function when the capture has settled. */
export function pauseAssetTracking(): () => void {
  const tracker = store()
  if (!tracker) return () => {}
  tracker.capturing += 1
  let resumed = false
  return () => {
    if (resumed) return
    resumed = true
    tracker.capturing = Math.max(0, tracker.capturing - 1)
  }
}

function parseBrowser(ua: string): string {
  const rules: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/YaBrowser\/(\d+)/, "Yandex Browser"],
    [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[.\d]* (?:Mobile\/\S+ )?Safari\//, "Safari"],
  ]
  for (const [pattern, name] of rules) {
    const match = pattern.exec(ua)
    if (match) return `${name} ${match[1]}`
  }
  return "unknown"
}

function parseOs(ua: string): string {
  const windows = /Windows NT (\d+\.\d+)/.exec(ua)
  if (windows) {
    const names: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" }
    return `Windows ${names[windows[1]] ?? windows[1]}`
  }
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua)
  if (android) return `Android ${android[1]}`
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/.exec(ua)
  if (ios) return `iOS ${ios[1]}.${ios[2]}`
  const mac = /Mac OS X (\d+)[_.](\d+)/.exec(ua)
  if (mac) return `macOS ${mac[1]}.${mac[2]}`
  if (/CrOS/.test(ua)) return "ChromeOS"
  if (/Linux/.test(ua)) return "Linux"
  return "unknown"
}

/** The current page as a report names it: path and query, without the origin. */
export function currentPageUrl(): string {
  return typeof window === "undefined" ? "" : clip(`${window.location.pathname}${window.location.search}`, URL_MAX)
}

/**
 * The context sent with a report: the page, the browser, the screen and the tracker's last records. `pageUrl` is the
 * page the report is about — the one its screenshot shows, recorded when the panel opened, since Back/Forward can
 * change the page under the open panel; the current page when not given.
 */
export function collectBugContext(pageUrl?: string): BugClientContext {
  const tracker = store()
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  const hasWindow = typeof window !== "undefined"
  return {
    pageUrl: pageUrl ?? currentPageUrl(),
    time: new Date().toISOString(),
    userAgent: ua,
    browser: parseBrowser(ua),
    os: parseOs(ua),
    language: typeof navigator === "undefined" ? "" : navigator.language,
    screen: {
      width: hasWindow ? window.screen.width : 0,
      height: hasWindow ? window.screen.height : 0,
      pixelRatio: hasWindow ? window.devicePixelRatio : 1,
    },
    viewport: { width: hasWindow ? window.innerWidth : 0, height: hasWindow ? window.innerHeight : 0 },
    consoleErrors: tracker ? tracker.consoleErrors.map((item) => ({ ...item })) : [],
    failedRequests: tracker ? tracker.failedRequests.map((item) => ({ ...item })) : [],
    actions: tracker ? tracker.actions.map((item) => ({ ...item })) : [],
  }
}
