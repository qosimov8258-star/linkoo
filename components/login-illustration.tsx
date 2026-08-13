export function LoginIllustration() {
  return (
    <svg viewBox="0 0 640 760" className="h-full w-full" role="img" aria-label="Linko: производители, дистрибьюторы">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eef3fb" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id="platform" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dbe6fb" />
          <stop offset="100%" stopColor="#c3d4f5" />
        </linearGradient>
        <linearGradient id="navyFront" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22306b" />
          <stop offset="100%" stopColor="#2d3d85" />
        </linearGradient>
        <linearGradient id="navySide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#161f4a" />
          <stop offset="100%" stopColor="#1c2758" />
        </linearGradient>
        <linearGradient id="greyFront" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8fa3c7" />
          <stop offset="100%" stopColor="#a4b6d6" />
        </linearGradient>
        <linearGradient id="greySide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6f83aa" />
          <stop offset="100%" stopColor="#7d90b6" />
        </linearGradient>
        <linearGradient id="linkoFront" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1a2a63" />
          <stop offset="100%" stopColor="#243775" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7fb2ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#7fb2ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="640" height="760" fill="url(#sky)" />

      {/* distant skyline */}
      <g opacity="0.35">
        <rect x="470" y="70" width="26" height="120" rx="2" fill="#a9bee0" />
        <rect x="502" y="40" width="30" height="150" rx="2" fill="#93aad4" />
        <rect x="538" y="90" width="22" height="100" rx="2" fill="#a9bee0" />
      </g>

      {/* trees */}
      <g fill="#274c8a" opacity="0.85">
        <path d="M96 250 l22 40 h-14 l16 28 h-48 l16-28 h-14 z" />
        <path d="M96 218 l14 26 h-9 l10 18 h-30 l10-18 h-9 z" />
      </g>
      <g fill="#3a63ad" opacity="0.75">
        <path d="M540 300 l18 32 h-11 l13 22 h-40 l13-22 h-11 z" />
      </g>

      {/* ground platform glow */}
      <ellipse cx="330" cy="560" rx="270" ry="60" fill="url(#glow)" />

      {/* connecting circuit lines */}
      <g stroke="#8fb3f2" strokeWidth="2.5" fill="none" opacity="0.7">
        <path d="M180 470 h60 v30 h50" />
        <path d="M330 500 v40 h70 v20" />
        <path d="M420 430 h-40 v25" />
        <circle cx="180" cy="470" r="4" fill="#4f70e7" stroke="none" />
        <circle cx="290" cy="500" r="4" fill="#4f70e7" stroke="none" />
        <circle cx="400" cy="540" r="4" fill="#4f70e7" stroke="none" />
        <circle cx="420" cy="430" r="4" fill="#4f70e7" stroke="none" />
      </g>

      {/* === Производители (manufacturers) building, back-left === */}
      <g>
        <ellipse cx="150" cy="470" rx="118" ry="26" fill="url(#platform)" />
        {/* chimneys */}
        <rect x="90" y="260" width="16" height="110" fill="#7d90b6" />
        <rect x="118" y="245" width="16" height="125" fill="#8fa3c7" />
        <circle cx="98" cy="255" r="9" fill="url(#glow)" />
        <circle cx="126" cy="240" r="9" fill="url(#glow)" />
        {/* building body */}
        <polygon points="70,370 70,300 230,300 230,370" fill="url(#greyFront)" />
        <polygon points="230,300 230,370 260,355 260,290" fill="url(#greySide)" />
        <polygon points="70,300 230,300 260,290 100,290" fill="#b6c5e3" />
        {/* solar roof accents */}
        <g stroke="#5271c9" strokeWidth="2">
          <line x1="115" y1="292" x2="145" y2="292" />
          <line x1="150" y1="292" x2="180" y2="292" />
        </g>
        {/* windows */}
        <g fill="#dfe9fb">
          <rect x="90" y="320" width="18" height="18" />
          <rect x="120" y="320" width="18" height="18" />
          <rect x="150" y="320" width="18" height="18" />
          <rect x="180" y="320" width="18" height="18" />
        </g>
        {/* label */}
        <rect x="82" y="332" width="140" height="22" rx="4" fill="#3255b5" transform="translate(0,10)" opacity="0.92" />
        <text x="152" y="357" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff" letterSpacing="0.3">
          ПРОИЗВОДИТЕЛИ
        </text>
      </g>

      {/* === Дистрибьюторы (distributors) building, front-center === */}
      <g>
        <ellipse cx="330" cy="560" rx="150" ry="32" fill="url(#platform)" />
        <polygon points="230,540 230,400 400,400 400,540" fill="url(#navyFront)" />
        <polygon points="400,400 400,540 440,522 440,382" fill="url(#navySide)" />
        <polygon points="230,400 400,400 440,382 270,382" fill="#3a4d95" />
        {/* windows grid */}
        <g fill="#7fa1f2" opacity="0.85">
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect key={`${row}-${col}`} x={250 + col * 34} y={420 + row * 24} width="16" height="14" />
            )),
          )}
        </g>
        {/* label banner */}
        <rect x="240" y="478" width="150" height="24" rx="4" fill="#2fb0c9" opacity="0.95" />
        <text x="315" y="495" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#ffffff" letterSpacing="0.3">
          ДИСТРИБЬЮТОРЫ
        </text>

        {/* stacked boxes */}
        <g>
          <rect x="405" y="500" width="30" height="30" fill="#d7a066" stroke="#b8834e" />
          <rect x="437" y="512" width="26" height="26" fill="#e2b27a" stroke="#b8834e" />
          <rect x="405" y="470" width="26" height="26" fill="#e2b27a" stroke="#b8834e" />
        </g>

        {/* truck */}
        <g transform="translate(160,505)">
          <rect x="0" y="14" width="52" height="26" rx="3" fill="#3f61d8" />
          <path d="M52 20 h20 l12 12 v8 h-32 z" fill="#5271df" />
          <circle cx="16" cy="44" r="8" fill="#1c2758" />
          <circle cx="16" cy="44" r="3.5" fill="#aebbe0" />
          <circle cx="66" cy="44" r="8" fill="#1c2758" />
          <circle cx="66" cy="44" r="3.5" fill="#aebbe0" />
          <rect x="58" y="24" width="10" height="8" fill="#dfe9fb" opacity="0.85" />
        </g>
      </g>

      {/* === linko building, right === */}
      <g>
        <ellipse cx="500" cy="520" rx="90" ry="22" fill="url(#platform)" />
        <polygon points="450,505 450,400 545,400 545,505" fill="url(#linkoFront)" />
        <polygon points="545,400 545,505 570,492 570,388" fill="#141d47" />
        <polygon points="450,400 545,400 570,388 475,388" fill="#2c3d80" />
        <g fill="#4f70e7" opacity="0.8">
          {[0, 1, 2].map((row) =>
            [0, 1].map((col) => (
              <rect key={`l-${row}-${col}`} x={468 + col * 30} y={420 + row * 26} width="14" height="14" />
            )),
          )}
        </g>
        <text x="497" y="470" textAnchor="middle" fontSize="16" fontWeight="800" fill="#ffffff" fontStyle="italic">
          linko
        </text>
      </g>

      {/* foreground scattered particles */}
      <g fill="#4f70e7" opacity="0.5">
        <circle cx="70" cy="520" r="3" />
        <circle cx="580" cy="470" r="3" />
        <circle cx="120" cy="600" r="2.5" />
        <circle cx="470" cy="610" r="2.5" />
      </g>
    </svg>
  )
}
