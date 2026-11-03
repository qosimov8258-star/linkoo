export function BrandCornerLogo() {
  return (
    <div
      aria-label="Mezon"
      // Decorative only: it must never swallow clicks meant for the page under it
      // (e.g. the checkbox of the last table row).
      className="pointer-events-none fixed bottom-2 left-2 z-[100] flex h-7 w-7 select-none items-center justify-center rounded-[7px] border border-slate-200 bg-white opacity-90 shadow-md print:hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mezon-icon.png" alt="" aria-hidden="true" className="h-6 w-6" />
    </div>
  )
}
