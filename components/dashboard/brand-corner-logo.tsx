export function BrandCornerLogo() {
  return (
    <div
      aria-label="Linko"
      // Decorative only: it must never swallow clicks meant for the page under it
      // (e.g. the checkbox of the last table row).
      className="pointer-events-none fixed bottom-2 left-2 z-[100] flex h-7 w-7 select-none items-center justify-center rounded-[7px] border border-slate-200 bg-white opacity-90 shadow-md print:hidden"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#fff" />
        <path
          d="M4.5 10.2C4.5 6.75 7.3 4 10.75 4h2.5c3.45 0 6.25 2.75 6.25 6.2"
          fill="none"
          stroke="#596ff2"
          strokeWidth="2.35"
          strokeLinecap="round"
        />
        <path
          d="M8 17.8v-4.15c0-1.65 1.3-2.95 2.95-2.95h2.1c1.65 0 2.95 1.3 2.95 2.95v4.15"
          fill="none"
          stroke="#ef43b4"
          strokeWidth="2.35"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
