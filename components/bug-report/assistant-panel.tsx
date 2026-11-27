"use client"

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { BotMessageSquare, ImagePlus, LoaderCircle, MessageSquarePlus, Send, Trash2, X } from "lucide-react"

import {
  BUG_IMAGE_MAX_FILE_BYTES,
  canvasToJpeg,
  captureViewport,
  drawMarks,
  imageFileToCanvas,
  imageFromClipboard,
  isImageFile,
  type ScreenshotRect,
} from "@/lib/bug-reports/image"
import { collectBugContext, currentPageUrl } from "@/lib/bug-reports/tracker"
import { BUG_COMMENT_MAX, BUG_COMMENT_MIN, BUG_HELPER_STATES, type BugHelperResult } from "@/lib/bug-reports/types"
import { useLanguage } from "@/lib/i18n/language-context"

import { ScreenshotAnnotator } from "./screenshot-annotator"

type Message = {
  id: number
  from: "user" | "assistant"
  text: string
  /** A Russian dictionary key, shown through t(); otherwise the customer's or the AI's own words, shown as they are. */
  fixed?: boolean
  /** The sent picture (object URL), under the customer's first message. */
  image?: string
}

/**
 * compose: the customer writes; sending: the report is being saved and the helper answers (up to ~20 s);
 * feedback: a «yordam» answer waits for «helped / not helped»; question: an «aniqlashtirish» question waits for its
 * one answer; done: the report is with the developer (or the AI solved it).
 */
type Stage = "compose" | "sending" | "feedback" | "question" | "done"

type PostResult = { ok: true; data: unknown } | { ok: false; error: string; status: number }

/** What Tab can reach inside the panel (the focus trap of the aria-modal drawer). */
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

/** The server's own (Russian) message of a refusal, shown through t(). */
function errorOf(data: unknown): string | null {
  return isRecord(data) && typeof data.error === "string" && data.error ? data.error : null
}

function parseHelper(value: unknown): BugHelperResult | null {
  if (!isRecord(value)) return null
  const holat = BUG_HELPER_STATES.find((state) => state === value.holat)
  if (!holat) return null
  return {
    holat,
    mijozga_javob: typeof value.mijozga_javob === "string" ? value.mijozga_javob.trim() : "",
    savol: typeof value.savol === "string" ? value.savol.trim() : "",
  }
}

async function postJson(url: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, error: errorOf(data) ?? "Не удалось отправить сообщение", status: response.status }
    return { ok: true, data }
  } catch {
    return { ok: false, error: "Сервер недоступен, попробуйте ещё раз", status: 0 }
  }
}

function Bubble({ from, image, children }: { from: Message["from"]; image?: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className={`flex ${from === "user" ? "justify-end" : "justify-start"}`}>
      {/* Plain text (React escapes it), line breaks kept; the DOM translator leaves the customer's and the AI's words alone. */}
      <div
        data-no-translate
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-[14px] px-[12px] py-[8px] text-[13px] leading-[18px] ${
          from === "user" ? "rounded-br-[4px] bg-[#1E4A9A] text-white" : "rounded-bl-[4px] bg-[#f2f5f8] text-[#333]"
        }`}
      >
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={t("Снимок экрана")} className="mb-[6px] max-h-[160px] w-auto rounded-[6px] bg-white" />
        )}
        {children}
      </div>
    </div>
  )
}

type Props = {
  /** The comment typed before the panel was last closed without sending. */
  draft: string
  onDraftChange: (value: string) => void
  onClose: () => void
}

/**
 * «AI yordamchi»: the customer's bug report / question as a chat in a right-hand drawer (like Настройки). The report
 * is saved by POST /api/bug-reports first; the helper model's answer then decides what follows (lib/bug-reports/types.ts).
 * The screenshot of the page is taken once the panel is open (and again for «Новое сообщение»): the panel is left
 * out of it, and the customer can type while it is taken.
 */
export function AssistantPanel({ draft, onDraftChange, onClose }: Props) {
  const { t } = useLanguage()
  const titleId = useId()
  const commentId = useId()
  const hintId = useId()
  const answerId = useId()
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null)
  const [shotFailed, setShotFailed] = useState(false)
  const [capturing, setCapturing] = useState(true)
  const [rects, setRects] = useState<ScreenshotRect[]>([])
  const [comment, setComment] = useState(draft)
  const [messages, setMessages] = useState<Message[]>([])
  const [stage, setStage] = useState<Stage>("compose")
  const [reportId, setReportId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState("")
  const dialogRef = useRef<HTMLDivElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const feedbackRef = useRef<HTMLButtonElement>(null)
  const newMessageRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  /** The page the screenshot shows, recorded with it and sent as the report's page: Back/Forward changes the page
   * under the open panel, and the report must not pair the picture with another page. */
  const shotPage = useRef("")
  /** The running capture, stopped when it is no longer wanted (a picture pasted, a new one started, the panel closed). */
  const captureAbort = useRef<AbortController | null>(null)
  /** The saved report that still waits for the customer — the choice on a «yordam» answer or the one answer to a
   * question: closing the panel or leaving the page sends it to the developer (feedback helped=false, which the
   * server also takes for a report awaiting its answer), so it never stays stuck. */
  const awaiting = useRef<number | null>(null)
  const sending = useRef(false)
  const mounted = useRef(true)
  const objectUrls = useRef<string[]>([])
  const nextMessageId = useRef(1)

  const releasePending = useCallback(() => {
    const id = awaiting.current
    if (id === null) return
    awaiting.current = null
    // keepalive: the request outlives the panel, and the page too when the tab is being closed.
    fetch(`/api/bug-reports/${id}/feedback`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ helped: false }),
    }).catch(() => {})
  }, [])

  const close = useCallback(() => {
    releasePending()
    onClose()
  }, [releasePending, onClose])

  useEffect(() => {
    mounted.current = true
    const urls = objectUrls.current
    window.addEventListener("pagehide", releasePending)
    return () => {
      mounted.current = false
      window.removeEventListener("pagehide", releasePending)
      releasePending()
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.length = 0
    }
  }, [releasePending])

  useEffect(() => {
    // aria-modal: Tab and Shift+Tab go round the panel's own controls and never reach the page behind the overlay
    // (also when the focus fell to <body>).
    function trapTab(event: KeyboardEvent) {
      const dialog = dialogRef.current
      if (!dialog) return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getClientRects().length > 0)
      const active = document.activeElement
      const inside = active instanceof Node && dialog.contains(active) && active !== dialog
      const first = items[0]
      const last = items[items.length - 1]
      let target: HTMLElement | null = null
      if (!first || !last) target = dialog
      else if (!inside) target = event.shiftKey ? last : first
      else if (event.shiftKey && active === first) target = last
      else if (!event.shiftKey && active === last) target = first
      if (!target) return
      event.preventDefault()
      target.focus()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        trapTab(event)
        return
      }
      if (event.key !== "Escape") return
      event.preventDefault()
      close()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [close])

  // Each stage puts the focus on its first control (the comment when the panel opens), since the finished stage's
  // control unmounts with the focus in it; while the report is sent, the panel itself holds it. A request that ends
  // (busy → false) gives it back to a button that was disabled meanwhile.
  useEffect(() => {
    if (busy) return
    const target =
      stage === "compose"
        ? commentRef.current
        : stage === "question"
          ? answerRef.current
          : stage === "feedback"
            ? feedbackRef.current
            : stage === "done"
              ? newMessageRef.current
              : dialogRef.current
    target?.focus()
  }, [stage, busy])

  // The conversation follows its newest message (the form keeps its own scroll).
  useEffect(() => {
    if (stage !== "compose") endRef.current?.scrollIntoView({ block: "end" })
  }, [messages, stage])

  const stopCapture = useCallback(() => {
    captureAbort.current?.abort()
    captureAbort.current = null
  }, [])

  // The screenshot of the page with the panel open (the panel is left out of it): it shows «Снимаем экран…» and
  // the customer types meanwhile; the page is recorded with it.
  const takeShot = useCallback(async () => {
    stopCapture()
    const controller = new AbortController()
    captureAbort.current = controller
    shotPage.current = currentPageUrl()
    setCapturing(true)
    setShotFailed(false)
    // Never throws: null when the page could not be captured (the panel then offers an upload).
    const canvas = await captureViewport(controller.signal)
    // Stopped: a pasted picture, a newer capture or the closed panel took over.
    if (controller.signal.aborted || !mounted.current) return
    captureAbort.current = null
    setCapturing(false)
    setShot(canvas)
    setShotFailed(!canvas)
  }, [stopCapture])

  useEffect(() => {
    void takeShot()
    return stopCapture
  }, [takeShot, stopCapture])

  const acceptImage = useCallback(async (file: File) => {
    if (!isImageFile(file)) {
      setError("Можно загрузить только изображение")
      return
    }
    if (file.size > BUG_IMAGE_MAX_FILE_BYTES) {
      setError("Файл слишком большой")
      return
    }
    try {
      const canvas = await imageFileToCanvas(file)
      if (!mounted.current) return
      // The customer's own picture wins over the screenshot still being taken.
      stopCapture()
      setCapturing(false)
      setShot(canvas)
      setRects([])
      setShotFailed(false)
      setError(null)
    } catch {
      if (mounted.current) setError("Не удалось открыть изображение")
    }
  }, [stopCapture])

  // Ctrl+V of a picture anywhere while the report is written replaces the screenshot. Text pasted into a field
  // stays text (Excel and Word put a picture of the copied cells next to the text).
  useEffect(() => {
    if (stage !== "compose") return
    function handlePaste(event: ClipboardEvent) {
      const target = event.target
      const editing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
      if (editing && event.clipboardData?.types.includes("text/plain")) return
      const file = imageFromClipboard(event)
      if (!file) return
      event.preventDefault()
      void acceptImage(file)
    }
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [stage, acceptImage])

  function message(from: Message["from"], text: string, fixed = false, image?: string): Message {
    const id = nextMessageId.current
    nextMessageId.current += 1
    return { id, from, text, fixed, image }
  }

  function backToCompose(errorText: string) {
    if (!mounted.current) return
    setMessages([])
    setStage("compose")
    setError(errorText)
  }

  async function submit() {
    const text = comment.trim()
    if (sending.current || stage !== "compose" || capturing) return
    if (text.length < BUG_COMMENT_MIN) {
      setError("Комментарий слишком короткий")
      commentRef.current?.focus()
      return
    }
    sending.current = true
    setError(null)
    setStage("sending")
    try {
      let jpeg: Blob | null = null
      if (shot) {
        try {
          jpeg = await canvasToJpeg(rects.length ? drawMarks(shot, rects) : shot)
        } catch {
          // The report goes without the picture rather than not at all.
          jpeg = null
        }
      }
      const preview = jpeg ? URL.createObjectURL(jpeg) : undefined
      if (preview) objectUrls.current.push(preview)
      if (mounted.current) setMessages([message("user", text, false, preview)])

      // The page of the screenshot, not the one under the panel now.
      const pageUrl = shotPage.current || currentPageUrl()
      const form = new FormData()
      form.set("comment", text)
      form.set("pageUrl", pageUrl)
      form.set("context", JSON.stringify(collectBugContext(pageUrl)))
      if (jpeg) form.set("screenshot", new File([jpeg], "screenshot.jpg", { type: "image/jpeg" }))

      let data: unknown
      try {
        const response = await fetch("/api/bug-reports", { method: "POST", body: form })
        data = await response.json().catch(() => null)
        if (!response.ok || !isRecord(data) || !Number.isFinite(Number(data.id))) {
          backToCompose(errorOf(data) ?? "Не удалось отправить сообщение")
          return
        }
      } catch {
        backToCompose("Сервер недоступен, попробуйте ещё раз")
        return
      }

      const id = Number(data.id)
      const helper = parseHelper(data.helper)
      const delivered = data.delivered === true
      const waits = !delivered && (helper?.holat === "yordam" || helper?.holat === "aniqlashtirish")
      // The report is saved: the draft is done with, even when the panel was closed meanwhile.
      onDraftChange("")
      if (!mounted.current) {
        // Closed while the assistant was answering: the report still goes to the developer (also a question that
        // can no longer be answered).
        if (waits) {
          awaiting.current = id
          releasePending()
        }
        return
      }

      const reply: Message[] = []
      let next: Stage = "done"
      if (!helper) {
        reply.push(message("assistant", "Спасибо, ваше сообщение принято", true))
      } else if (waits && helper.holat === "yordam") {
        if (helper.mijozga_javob) reply.push(message("assistant", helper.mijozga_javob))
        next = "feedback"
      } else if (waits) {
        const question = helper.savol || helper.mijozga_javob
        reply.push(question ? message("assistant", question) : message("assistant", "Уточните, пожалуйста, подробнее", true))
        next = "question"
      } else {
        if (helper.holat !== "aniqlashtirish" && helper.mijozga_javob) reply.push(message("assistant", helper.mijozga_javob))
        reply.push(message("assistant", "Спасибо, отправлено разработчику", true))
      }
      if (next !== "done") awaiting.current = id
      setComment("")
      setRects([])
      setReportId(id)
      setMessages((current) => [...current, ...reply])
      setStage(next)
    } finally {
      sending.current = false
    }
  }

  async function sendFeedback(helped: boolean) {
    if (stage !== "feedback" || busy || reportId === null) return
    setBusy(true)
    setError(null)
    // The choice is on its way: closing the panel now must not send a second, opposite one.
    awaiting.current = null
    const result = await postJson(`/api/bug-reports/${reportId}/feedback`, { helped })
    if (!result.ok) {
      // 404 / 409: the report no longer waits (the server's sweep delivered it), so nothing is left to release.
      if (result.status !== 404 && result.status !== 409) awaiting.current = reportId
      if (!mounted.current) {
        releasePending()
        return
      }
      setBusy(false)
      setError(result.error)
      // No longer waiting: the buttons would only be refused again, so the conversation ends (with «Новое сообщение»).
      if (result.status === 409) setStage("done")
      return
    }
    if (!mounted.current) return
    setBusy(false)
    setMessages((current) => [
      ...current,
      message("user", helped ? "Помогло, спасибо" : "Не помогло, отправить разработчику", true),
      message("assistant", helped ? "Рады, что смогли помочь!" : "Спасибо, отправлено разработчику", true),
    ])
    setStage("done")
  }

  async function sendAnswer() {
    const text = answer.trim()
    if (stage !== "question" || busy || reportId === null || !text) return
    setBusy(true)
    setError(null)
    // The answer is on its way: closing the panel now must not deliver the report without it.
    awaiting.current = null
    const result = await postJson(`/api/bug-reports/${reportId}/clarify`, { answer: text })
    if (!result.ok) {
      // 404 / 409: the report no longer waits (the server's sweep delivered it), so nothing is left to release.
      if (result.status !== 404 && result.status !== 409) awaiting.current = reportId
      if (!mounted.current) {
        releasePending()
        return
      }
      setBusy(false)
      setError(result.error)
      if (result.status === 409) setStage("done")
      return
    }
    if (!mounted.current) return
    setBusy(false)
    setAnswer("")
    setMessages((current) => [...current, message("user", text), message("assistant", "Спасибо, отправлено разработчику", true)])
    setStage("done")
  }

  // A new report from the same panel: a fresh screenshot of the page (the panel is left out of it).
  function startNew() {
    if (capturing) return
    setMessages([])
    setRects([])
    setComment("")
    setAnswer("")
    setReportId(null)
    setError(null)
    setShot(null)
    setStage("compose")
    void takeShot()
  }

  function sendOnCtrlEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>, send: () => void) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      send()
    }
  }

  const trimmedLength = comment.trim().length
  const tooShort = trimmedLength < BUG_COMMENT_MIN
  const canSend = stage === "compose" && !tooShort && !capturing

  return (
    // data-bug-report="panel" (BUG_REPORT_UI_ATTRIBUTE): the panel and its overlay are left out of the screenshot
    // (captureViewport) and of the tracked clicks.
    <div data-bug-report="panel">
      <div aria-hidden onClick={close} className="fixed inset-0 z-[1200] bg-black/[0.54]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Focusable by script only: it holds the focus while the report is sent (no control to put it on then).
        tabIndex={-1}
        className="fixed right-0 top-0 z-[1300] flex h-full w-[420px] max-w-full flex-col bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] outline-none"
      >
        <div className="flex h-[69px] shrink-0 items-center justify-between border-b border-[#efefef] py-[10px] pl-[20px] pr-[10px]">
          <div className="flex items-center gap-[10px]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0D2350] text-white">
              <BotMessageSquare className="h-5 w-5" />
            </span>
            <p id={titleId} className="text-[16px] font-semibold leading-5">
              {t("AI помощник")}
            </p>
          </div>
          <button type="button" onClick={close} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center rounded-[5px] hover:bg-[#f2f5f8]">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[20px] py-[16px]">
          <div className="flex flex-col gap-[10px]">
            <Bubble from="assistant">{t("Опишите проблему или задайте вопрос")}</Bubble>

            {stage === "compose" ? (
              <div className="rounded-[10px] border border-[#efefef] p-[10px]">
                {capturing ? (
                  <div className="flex h-[140px] items-center justify-center gap-[8px] text-[12px] text-[#777]">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {t("Снимаем экран…")}
                  </div>
                ) : shot ? (
                  <ScreenshotAnnotator image={shot} rects={rects} onChange={setRects} />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-[6px] rounded-[5px] border border-dashed border-[#cfd8e3] px-[12px] py-[18px] text-center text-[12px] leading-4 text-[#777]">
                    {shotFailed && <p className="font-semibold text-[#b26a00]">{t("Скриншот не получен, можно загрузить изображение")}</p>}
                    <ImagePlus className="h-6 w-6 text-[#9aa5b5]" />
                    <p>{t("Вставьте изображение (Ctrl+V) или загрузите файл")}</p>
                  </div>
                )}
                <div className="mt-[8px] flex flex-wrap gap-[6px]">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-8 items-center gap-[6px] rounded-[5px] border border-[#e6e6e6] px-[10px] text-[12px] font-semibold text-[#1E4A9A] transition-colors hover:bg-[#f2f5f8]"
                  >
                    <ImagePlus className="h-4 w-4" />
                    {t("Загрузить изображение")}
                  </button>
                  {shot && !capturing && (
                    <button
                      type="button"
                      onClick={() => {
                        setShot(null)
                        setRects([])
                        setShotFailed(false)
                      }}
                      className="flex h-8 items-center gap-[6px] rounded-[5px] border border-[#e6e6e6] px-[10px] text-[12px] text-[#555] transition-colors hover:bg-[#f2f5f8]"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("Удалить снимок")}
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // Cleared, so choosing the same file again still fires a change.
                    event.target.value = ""
                    if (file) void acceptImage(file)
                  }}
                />
              </div>
            ) : null}

            {/* The conversation: a live region, so a screen reader reads the AI's answer when it arrives. Always
                mounted (empty while the report is written), since a region that appears together with its text is
                not announced; it is also the end the conversation scrolls to. */}
            <div ref={endRef} aria-live="polite" className="flex flex-col gap-[10px]">
              {stage !== "compose" &&
                messages.map((item) => (
                  <Bubble key={item.id} from={item.from} image={item.image}>
                    {item.fixed ? t(item.text) : item.text}
                  </Bubble>
                ))}
              {stage === "sending" && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-[8px] rounded-[14px] rounded-bl-[4px] bg-[#f2f5f8] px-[12px] py-[8px] text-[13px] text-[#777]">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {t("AI помощник думает…")}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#efefef] px-[20px] py-[12px]">
          {error && (
            <p role="alert" className="mb-[8px] text-[13px] leading-[18px] text-[#e53935]">
              {t(error)}
            </p>
          )}

          {stage === "compose" && (
            <>
              <label htmlFor={commentId} className="mb-[4px] block text-[13px] font-semibold">
                {t("Комментарий")} <span className="text-[#e53935]">*</span>
              </label>
              <textarea
                ref={commentRef}
                id={commentId}
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value)
                  onDraftChange(event.target.value)
                }}
                onKeyDown={(event) => sendOnCtrlEnter(event, () => void submit())}
                rows={3}
                maxLength={BUG_COMMENT_MAX}
                required
                aria-describedby={hintId}
                placeholder={t("Что случилось? Что вы ожидали увидеть?")}
                className="block w-full resize-none rounded-[5px] border border-[#e6e6e6] px-[10px] py-[8px] text-[13px] leading-[18px] outline-none placeholder:text-[#999] focus:border-[#1E4A9A]"
              />
              <div className="mt-[4px] flex items-center justify-between gap-[8px] text-[12px] text-[#777]">
                <span id={hintId}>{tooShort ? `${t("Минимум")} ${BUG_COMMENT_MIN} ${t("символов")}` : ""}</span>
                <span>
                  {comment.length}/{BUG_COMMENT_MAX}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                className="mt-[8px] flex h-10 w-full items-center justify-center gap-[8px] rounded-[5px] bg-[#1E4A9A] text-[14px] font-semibold text-white transition-colors hover:bg-[#17346B] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {t("Отправить сообщение")}
              </button>
            </>
          )}

          {stage === "sending" && <p className="text-center text-[12px] text-[#777]">{t("Отправка...")}</p>}

          {stage === "feedback" && (
            <div className="flex flex-col gap-[8px]">
              <button
                ref={feedbackRef}
                type="button"
                onClick={() => void sendFeedback(true)}
                disabled={busy}
                className="flex h-10 w-full items-center justify-center rounded-[5px] bg-[#2bcd53] px-[10px] text-[14px] font-semibold text-white transition-colors hover:bg-[#25b649] disabled:opacity-50"
              >
                {t("Помогло, спасибо")}
              </button>
              <button
                type="button"
                onClick={() => void sendFeedback(false)}
                disabled={busy}
                className="flex h-10 w-full items-center justify-center rounded-[5px] border border-[#1E4A9A] px-[10px] text-[14px] font-semibold text-[#1E4A9A] transition-colors hover:bg-[#f2f5f8] disabled:opacity-50"
              >
                {t("Не помогло, отправить разработчику")}
              </button>
            </div>
          )}

          {stage === "question" && (
            <div className="flex items-end gap-[8px]">
              <label htmlFor={answerId} className="sr-only">
                {t("Ваш ответ")}
              </label>
              <textarea
                ref={answerRef}
                id={answerId}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => sendOnCtrlEnter(event, () => void sendAnswer())}
                rows={2}
                maxLength={BUG_COMMENT_MAX}
                // Read-only rather than disabled while the answer is sent: a disabled field would drop the focus.
                readOnly={busy}
                placeholder={t("Ваш ответ")}
                className="block min-w-0 flex-1 resize-none rounded-[5px] border border-[#e6e6e6] px-[10px] py-[8px] text-[13px] leading-[18px] outline-none placeholder:text-[#999] focus:border-[#1E4A9A]"
              />
              <button
                type="button"
                onClick={() => void sendAnswer()}
                disabled={busy || !answer.trim()}
                aria-label={t("Отправить сообщение")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] bg-[#1E4A9A] text-white transition-colors hover:bg-[#17346B] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          )}

          {stage === "done" && (
            <button
              ref={newMessageRef}
              type="button"
              onClick={startNew}
              className="flex h-10 w-full items-center justify-center gap-[8px] rounded-[5px] border border-[#1E4A9A] text-[14px] font-semibold text-[#1E4A9A] transition-colors hover:bg-[#f2f5f8]"
            >
              <MessageSquarePlus className="h-4 w-4" />
              {t("Новое сообщение")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
