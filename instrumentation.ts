// Next.js calls register() once when the server starts (next start, the standalone server.js, next dev;
// never during next build). It starts the timer of the bug-report sweep (lib/bug-reports/deliver.ts):
// reports a customer left waiting for the helper, Telegram messages a restart or a Telegram failure left
// unsent, and analyses a restart left PENDING are handled within minutes, not only when someone happens
// to send a report or open «Xato xabarlari». Node runtime only (the sweep needs the database driver);
// the import is lazy and behind the runtime check, so an Edge bundle of this file never pulls it in.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBugReportSweep } = await import("@/lib/bug-reports/deliver")
    startBugReportSweep()
  }
}
