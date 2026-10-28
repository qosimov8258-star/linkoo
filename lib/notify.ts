// Imperative replacement for window.alert: the reference reports failed saves and other notices in its own
// modal alert (blue "!" mark, bold message, full-width OK). <AlertHost /> (mounted in the root layout) renders it.
type Listener = (message: string) => void

let listener: Listener | null = null

export function subscribeNotify(next: Listener | null) {
  listener = next
}

/** Shows a notice in the reference-style alert; messages queue and are shown one after another. */
export function notify(message: string) {
  // Without a host (SSR, tests) fall back to the browser dialog so the message is never lost.
  if (!listener) {
    if (typeof window !== "undefined") window.alert(message)
    return
  }
  listener(message)
}
