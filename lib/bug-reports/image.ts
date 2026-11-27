// The pictures of a bug report, in the browser: the automatic screenshot of the visible page (modern-screenshot),
// a customer's own image (file or Ctrl+V), the red marks drawn on it and the JPEG sent to POST /api/bug-reports.
// Client-only (canvas, DOM).

import { BUG_REPORT_UI_ATTRIBUTE, pauseAssetTracking } from "./tracker"

/** The sent picture is at most this wide (the analysis model and Telegram need no more). */
export const BUG_IMAGE_MAX_WIDTH = 1600
/** …and about this heavy (the server accepts up to BUG_SCREENSHOT_MAX_BYTES, 1.5 MB). */
export const BUG_IMAGE_TARGET_BYTES = 1_000_000
/** A pasted/uploaded picture taller than this is scaled down too (a full-page phone capture stays readable). */
const MAX_HEIGHT = 6000
/** Larger files are refused before decoding: they are not screenshots and would only freeze the tab. */
export const BUG_IMAGE_MAX_FILE_BYTES = 25 * 1024 * 1024
/** The capture gives up after this long and the report goes on without a screenshot. */
const CAPTURE_TIMEOUT_MS = 8000
/** One picture/stylesheet of the page that does not load within this is replaced by an empty spot. modern-screenshot
 * also waits this long for the finished picture to decode and then draws whatever it has, so a short value turns a
 * heavy page (a long table) into an empty picture. */
const RESOURCE_TIMEOUT_MS = 6000
/** Before copying, modern-screenshot waits for every <img> of the document to load. An off-screen lazy one never
 * does (photo reports, clients), and it would hold every capture for RESOURCE_TIMEOUT_MS; the pictures that are drawn
 * are fetched again for the copy anyway, each within RESOURCE_TIMEOUT_MS, so this first wait is kept short. */
const LOAD_WAIT_MS = 1000
/** Elements that start this far below the visible part are not copied (the rows of a long table or list): a
 * descendant poking up out of a box just below the fold (a tooltip) is still drawn. */
const BELOW_FOLD_MARGIN_PX = 200
/** A copy of more elements than this is given up (no screenshot, the customer can paste one): its last, synchronous
 * steps (serializing the copy, drawing it) grow with it and would freeze the tab. */
const MAX_COPIED_ELEMENTS = 15_000
/** The copy gives the main thread back this often: the customer types on while it runs, and the timeout can fire. */
const YIELD_EVERY_MS = 40
/** Parents in whose flow dropping the children below the fold moves nothing above it. Flex and grid containers are
 * not here (a flex-grow item or a stretched row would take the freed space), nor table rows (a column would go). */
const FLOW_PARENTS = new Set(["block", "flow-root", "list-item", "table", "table-row-group", "table-header-group", "table-footer-group"])
/** Boxes that hold rows: their copied height is dropped, since rows dropped below the fold would otherwise leave
 * that height to the remaining rows, stretching the visible ones (every kept row keeps its own copied height). */
const ROW_HOLDERS = new Set(["table", "inline-table", "table-row-group", "table-header-group", "table-footer-group"])
/** An element below the fold that is or holds one of these is copied anyway: a dialog rendered after a long table
 * (in a plain wrapper) is on screen. */
const ON_SCREEN_INSIDE = '.fixed, [style*="fixed"], [role="dialog"], dialog'

/** Thrown inside the copy to stop it (timeout, too big, no longer wanted). */
class CaptureStopped extends Error {}

/** Red marks: 3 px lines on the sent picture. */
export const BUG_MARK_COLOR = "#e53935"
const MARK_WIDTH = 3

/** A rectangle drawn on the picture, in fractions of its width/height (0…1), so it fits any size of it. */
export type ScreenshotRect = { x: number; y: number; w: number; h: number }

function isTransparent(color: string) {
  return !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color)
}

/**
 * Whether a capture is worth showing: its pixels can be read (a picture from another host would make it unsendable)
 * and it is not one flat colour (what modern-screenshot draws when the page did not decode in time; a real page has
 * at least the navy top bar).
 */
function usable(canvas: HTMLCanvasElement) {
  if (!canvas.width || !canvas.height) return false
  try {
    const probe = document.createElement("canvas")
    probe.width = 24
    probe.height = 24
    const context = probe.getContext("2d", { willReadFrequently: true })
    if (!context) return false
    context.drawImage(canvas, 0, 0, probe.width, probe.height)
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data
    for (let index = 4; index < pixels.length; index += 4) {
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(pixels[index + channel] - pixels[channel]) > 8) return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * The visible part of the page (the window's scroll respected) as a canvas, or null when it cannot be taken in
 * CAPTURE_TIMEOUT_MS, is too big, or `signal` is aborted. The assistant's panel is left out, so it is taken while the
 * panel is open; the copy gives the main thread back every YIELD_EVERY_MS, so the panel stays usable meanwhile.
 */
export async function captureViewport(signal?: AbortSignal): Promise<HTMLCanvasElement | null> {
  if (typeof window === "undefined" || signal?.aborted) return null
  const resume = pauseAssetTracking()
  let timer: ReturnType<typeof setTimeout> | undefined
  // Set once the picture is no longer wanted: the copy then stops at its next element instead of running on in the
  // background (the race below only stops the waiting, not the work).
  let stopped = false
  const capture = (async () => {
    // Loaded on the first capture only: the top navigation (and so this module) is on every page.
    const { createContext, destroyContext, domToCanvas } = await import("modern-screenshot")
    if (stopped) return null
    const root = document.documentElement
    const width = root.clientWidth || window.innerWidth
    const height = root.clientHeight || window.innerHeight
    const { scrollX, scrollY } = window
    const bodyPosition = getComputedStyle(document.body).position
    const htmlBackground = getComputedStyle(root).backgroundColor
    const bodyBackground = getComputedStyle(document.body).backgroundColor
    // In page coordinates: the page scrolled behind the panel while the copy runs does not move the line.
    const foldLine = scrollY + height + BELOW_FOLD_MARGIN_PX
    const flowParents = new WeakMap<Element, boolean>()
    let copied = 0
    let dropped = 0
    let lastYield = performance.now()

    /** Whether an element lies wholly below the visible part, where leaving it out moves nothing that is drawn. */
    function belowFold(element: Element) {
      if (element.getBoundingClientRect().top + window.scrollY < foldLine) return false
      const parent = element.parentElement
      if (!parent) return false
      let flow = flowParents.get(parent)
      if (flow === undefined) {
        flow = FLOW_PARENTS.has(getComputedStyle(parent).display)
        flowParents.set(parent, flow)
      }
      return flow && !element.matches(ON_SCREEN_INSIDE) && !element.querySelector(ON_SCREEN_INSIDE)
    }

    const context = await createContext(root, {
      width,
      height,
      scale: Math.min(1, BUG_IMAGE_MAX_WIDTH / width),
      backgroundColor: !isTransparent(htmlBackground) ? htmlBackground : !isTransparent(bodyBackground) ? bodyBackground : "#ffffff",
      timeout: LOAD_WAIT_MS,
      // The page's font comes from fonts.googleapis.com, which the CSP (connect-src 'self') does not let a script
      // fetch: the picture is drawn with the system font instead of failing on it.
      font: false,
      // Scrolled tables and lists are drawn as the customer sees them.
      features: { restoreScrollPosition: true },
      // Called for every child before it is copied: what is not copied costs nothing, unlike a timer, which cannot
      // fire while the copy runs.
      filter: (node) => {
        if (stopped) throw new CaptureStopped()
        if (!(node instanceof Element)) return true
        if (node.getAttribute(BUG_REPORT_UI_ATTRIBUTE) === "panel") return false
        if (belowFold(node)) {
          dropped += 1
          return false
        }
        copied += 1
        if (copied > MAX_COPIED_ELEMENTS) throw new CaptureStopped()
        return true
      },
      onCloneEachNode: (clone) => {
        if (dropped && clone instanceof HTMLElement) {
          const display = clone.style.getPropertyValue("display") || (clone instanceof HTMLTableElement ? "table" : clone instanceof HTMLTableSectionElement ? "table-row-group" : "")
          // Both names: the computed style lists the logical property too, and either one pins the height.
          if (ROW_HOLDERS.has(display)) {
            clone.style.removeProperty("height")
            clone.style.removeProperty("block-size")
          }
        }
        if (performance.now() - lastYield < YIELD_EVERY_MS) return
        return new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            lastYield = performance.now()
            if (stopped) reject(new CaptureStopped())
            else resolve()
          }, 0)
        })
      },
      onCloneNode: (clone) => {
        if (!(clone instanceof HTMLElement)) return
        const body = Array.from(clone.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "BODY")
        if (!body || (!scrollX && !scrollY)) return
        // modern-screenshot moves the scrolled window's content with a transform on <body>, which also drags the
        // sticky top bar and every position: fixed dialog off the picture. A negative margin scrolls the layout
        // instead: sticky elements stick, fixed ones stay where the customer sees them, and position: relative keeps
        // elements placed in page coordinates (absolute, on the body) moving with it.
        body.style.removeProperty("transform")
        body.style.setProperty("margin-top", `${-scrollY}px`, "important")
        body.style.setProperty("margin-left", `${-scrollX}px`, "important")
        if (bodyPosition === "static") body.style.setProperty("position", "relative", "important")
      },
    })
    try {
      // Only the wait before the copy is short: the copy's own pictures and its decoding keep the long timeout.
      context.timeout = RESOURCE_TIMEOUT_MS
      // modern-screenshot makes its sandbox iframe (where it reads default styles) on first use and points it at a
      // srcdoc. The copy yields to the browser (onCloneEachNode), and in such a pause the iframe navigates to that
      // srcdoc: its document is replaced and `body` is null for a moment ("reading 'appendChild'"), which killed
      // every capture. A sandbox that has finished loading before the copy starts never changes under it.
      context.sandbox = await loadedSandbox()
      if (stopped) return null
      const canvas = await domToCanvas(context)
      return usable(canvas) ? canvas : null
    } finally {
      // Also after a stopped copy: its hidden sandbox iframe would otherwise stay in the page.
      destroyContext(context)
    }
  })()
  // The page's failed picture requests stay out of the report until the capture is really over (also after a timeout).
  capture.then(resume, resume)
  try {
    return await Promise.race([
      capture,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)
        signal?.addEventListener("abort", () => resolve(null), { once: true })
      }),
    ])
  } catch {
    return null
  } finally {
    stopped = true
    clearTimeout(timer)
  }
}

/** The sandbox iframe modern-screenshot would make itself (same id prefix, so it never copies it), loaded. */
function loadedSandbox(): Promise<HTMLIFrameElement> {
  const sandbox = document.createElement("iframe")
  sandbox.id = `__SANDBOX__bug-report-${Math.random().toString(36).slice(2)}`
  sandbox.width = "0"
  sandbox.height = "0"
  sandbox.style.visibility = "hidden"
  sandbox.style.position = "fixed"
  sandbox.setAttribute("aria-hidden", "true")
  return new Promise((resolve) => {
    const done = () => resolve(sandbox)
    sandbox.addEventListener("load", done, { once: true })
    // A browser that never fires load for it still gets the sandbox (as the library would use it).
    setTimeout(done, 2000)
    sandbox.srcdoc = '<!DOCTYPE html><meta charset="UTF-8"><title></title><body>'
    document.body.appendChild(sandbox)
  })
}

function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("canvas 2d is not available")
  return { canvas, context }
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image": a phone photo keeps its EXIF orientation.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // Older Safari: falls back to an <img>.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/** A customer's picture (file or pasted) as a canvas of at most BUG_IMAGE_MAX_WIDTH × 6000 px. */
export async function imageFileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const decoded = await decode(file)
  try {
    if (!decoded.width || !decoded.height) throw new Error("empty image")
    const scale = Math.min(1, BUG_IMAGE_MAX_WIDTH / decoded.width, MAX_HEIGHT / decoded.height)
    const { canvas, context } = newCanvas(decoded.width * scale, decoded.height * scale)
    context.imageSmoothingQuality = "high"
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    decoded.release()
  }
}

export function isImageFile(file: Blob) {
  return file.type.startsWith("image/")
}

/** The picture of a paste (Ctrl+V of a screenshot), if it carries one. */
export function imageFromClipboard(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile()
  }
  return null
}

/** The picture with the customer's red rectangles drawn into it (a new canvas; the original stays clean for undo). */
export function drawMarks(base: HTMLCanvasElement, rects: ScreenshotRect[]): HTMLCanvasElement {
  const { canvas, context } = newCanvas(base.width, base.height)
  context.drawImage(base, 0, 0)
  context.strokeStyle = BUG_MARK_COLOR
  context.lineWidth = MARK_WIDTH
  context.lineJoin = "miter"
  for (const rect of rects) {
    // Kept inside the picture, so a mark at its edge does not lose a side.
    const x = Math.min(Math.max(rect.x * base.width, MARK_WIDTH / 2), base.width - MARK_WIDTH / 2)
    const y = Math.min(Math.max(rect.y * base.height, MARK_WIDTH / 2), base.height - MARK_WIDTH / 2)
    const right = Math.min((rect.x + rect.w) * base.width, base.width - MARK_WIDTH / 2)
    const bottom = Math.min((rect.y + rect.h) * base.height, base.height - MARK_WIDTH / 2)
    context.strokeRect(x, y, Math.max(1, right - x), Math.max(1, bottom - y))
  }
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob gave nothing"))), type, quality)
  })
}

/**
 * The JPEG that is sent: at most BUG_IMAGE_MAX_WIDTH wide; the quality steps down from 0.85 until it weighs about
 * BUG_IMAGE_TARGET_BYTES or less, and when even the lowest quality is too heavy the picture is made smaller.
 */
export async function canvasToJpeg(source: HTMLCanvasElement): Promise<Blob> {
  let width = Math.min(source.width, BUG_IMAGE_MAX_WIDTH)
  let last: Blob | null = null
  for (let round = 0; round < 5; round += 1) {
    const { canvas, context } = newCanvas(width, (source.height * width) / source.width)
    // JPEG has no transparency: a transparent pasted picture would turn black without a white ground.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingQuality = "high"
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      last = await toBlob(canvas, "image/jpeg", quality)
      if (last.size <= BUG_IMAGE_TARGET_BYTES) return last
    }
    width = Math.round(width * 0.75)
    if (width < 320) break
  }
  if (!last) throw new Error("no JPEG")
  return last
}
