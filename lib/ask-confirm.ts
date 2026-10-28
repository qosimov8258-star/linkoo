// Imperative replacement for window.confirm: the reference confirms every destructive action in its own
// "ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ / ОТМЕНЫ" dialog. <ConfirmHost /> (mounted once in the root layout) renders it.
export type ConfirmRequest = {
  /** Name of the thing being deleted (the bold band under the question). */
  item?: string
  kind: "delete" | "cancel" | "action"
  /** kind "action": dialog title, text and the confirm button label. */
  title?: string
  text?: string
  confirmLabel?: string
  resolve: (ok: boolean) => void
}

type Listener = (request: ConfirmRequest) => void

let listener: Listener | null = null

export function subscribeConfirm(next: Listener | null) {
  listener = next
}

function ask(kind: ConfirmRequest["kind"], item?: string, extra: Partial<ConfirmRequest> = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // Without a host (SSR, tests) fall back to the browser dialog so the action is never silently confirmed.
    if (!listener) {
      resolve(typeof window !== "undefined" ? window.confirm(item ?? "") : false)
      return
    }
    listener({ item, kind, resolve, ...extra })
  })
}

/** "ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ": resolves true after «УДАЛИТЬ», false when dismissed. */
export const askDelete = (item?: string) => ask("delete", item)

/** "ПОДТВЕРЖДЕНИЕ ОТМЕНЫ": resolves true after «ДА». */
export const askCancel = (item?: string) => ask("cancel", item)

/** A non-destructive confirmation (e.g. «Передать возврат»): own title, text and confirm label. */
export const askAction = (title: string, text: string, confirmLabel = "Да") => ask("action", undefined, { title, text, confirmLabel })
