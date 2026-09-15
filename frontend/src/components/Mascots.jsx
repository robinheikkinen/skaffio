// Skaffio mascot SVG components
// Usage: <MascotFrasse size={120} animation="bob" className="..." />
// Animations: 'bob' | 'wob' | 'jump' | 'pulse' | 'zzz' (keyframes in index.css)

function cls(animation, extra) {
  return [animation && `mascot-${animation}`, extra].filter(Boolean).join(' ')
}

export function MascotFrasse({ size = 120, animation = '', className = '' }) {
  return (
    <svg width={size} viewBox="0 0 150 190" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={cls(animation, className)} style={{ display: 'block' }}>
      <ellipse cx="75" cy="180" rx="42" ry="7" fill="#1E2A1A" opacity="0.08" />
      <rect x="52" y="158" width="11" height="18" rx="5.5" fill="#C8612F" />
      <rect x="87" y="158" width="11" height="18" rx="5.5" fill="#C8612F" />
      <rect x="32" y="30" width="86" height="135" rx="22" fill="#E07A4A" />
      <line x1="40" y1="78" x2="110" y2="78" stroke="#C8612F" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="98" y="42" width="7" height="24" rx="3.5" fill="#C8612F" />
      <rect x="98" y="90" width="7" height="40" rx="3.5" fill="#C8612F" />
      <circle cx="60" cy="108" r="7.5" fill="#1E2A1A" />
      <circle cx="90" cy="108" r="7.5" fill="#1E2A1A" />
      <circle cx="62.5" cy="105.5" r="2.7" fill="white" />
      <circle cx="92.5" cy="105.5" r="2.7" fill="white" />
      <circle cx="49" cy="120" r="6" fill="#FF9F6E" opacity="0.6" />
      <circle cx="101" cy="120" r="6" fill="#FF9F6E" opacity="0.6" />
      <path d="M63 122 Q75 133 87 122" stroke="#1E2A1A" strokeWidth="3.8" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function MascotSkaffi({ size = 120, animation = '', className = '' }) {
  return (
    <svg width={size} viewBox="0 0 150 192" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={cls(animation, className)} style={{ display: 'block' }}>
      <ellipse cx="75" cy="184" rx="40" ry="7" fill="#1E2A1A" opacity="0.08" />
      <rect x="57" y="164" width="12" height="18" rx="6" fill="#C8612F" />
      <rect x="81" y="164" width="12" height="18" rx="6" fill="#C8612F" />
      <path d="M28 108 Q12 118 16 138" stroke="#C8612F" strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="16" cy="143" r="6.5" fill="#C8612F" />
      <path d="M122 108 Q138 118 134 138" stroke="#C8612F" strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="134" cy="143" r="6.5" fill="#C8612F" />
      <path d="M75 46 C114 46 126 95 126 121 C126 153 106 174 75 174 C44 174 24 153 24 121 C24 95 36 46 75 46 Z" fill="#E07A4A" />
      <ellipse cx="53" cy="88" rx="13" ry="20" fill="#FF9F6E" opacity="0.38" />
      <rect x="44" y="44" width="62" height="14" rx="7" fill="#FDF6ED" />
      <path d="M52 46 Q51 8 75 5 Q99 8 98 46 Z" fill="#FDF6ED" />
      <path d="M63 22 Q75 16 87 22" stroke="rgba(30,42,26,0.07)" strokeWidth="2.5" fill="none" />
      <circle cx="62" cy="116" r="10" fill="#1E2A1A" />
      <circle cx="88" cy="116" r="10" fill="#1E2A1A" />
      <circle cx="65" cy="112.5" r="3.8" fill="white" />
      <circle cx="91" cy="112.5" r="3.8" fill="white" />
      <circle cx="44" cy="128" r="8" fill="#C8612F" opacity="0.32" />
      <circle cx="106" cy="128" r="8" fill="#C8612F" opacity="0.32" />
      <path d="M62 134 Q75 147 88 134" stroke="#1E2A1A" strokeWidth="4.2" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function MascotBo({ size = 120, animation = '', className = '' }) {
  return (
    <svg width={size} viewBox="0 0 200 260" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={cls(animation, className)} style={{ display: 'block' }}>
      <ellipse cx="100" cy="250" rx="50" ry="9" fill="#1E2A1A" opacity="0.09" />
      <rect x="76" y="216" width="14" height="24" rx="7" fill="#4ECDA0" />
      <rect x="110" y="216" width="14" height="24" rx="7" fill="#4ECDA0" />
      <path d="M52 92 Q44 100 44 120 L44 198 Q44 214 62 214 L138 214 Q156 214 156 198 L156 120 Q156 100 148 92 Z" fill="#4ECDA0" opacity="0.22" />
      <path d="M52 92 Q44 100 44 120 L44 198 Q44 214 62 214 L138 214 Q156 214 156 198 L156 120 Q156 100 148 92 Z" stroke="#1E2A1A" strokeWidth="4" fill="none" />
      <rect x="58" y="72" width="84" height="18" rx="6" fill="#1E2A1A" />
      <rect x="54" y="48" width="92" height="24" rx="12" fill="#E07A4A" />
      <path d="M44 158 Q66 146 100 156 Q134 166 156 152 L156 198 Q156 214 138 214 L62 214 Q44 214 44 198 Z" fill="#D4872A" opacity="0.28" />
      <circle cx="74" cy="184" r="9" fill="#E07A4A" />
      <circle cx="100" cy="190" r="10" fill="#D4872A" />
      <circle cx="126" cy="182" r="8" fill="#7ACC5A" />
      <path d="M44 134 Q24 142 28 164" stroke="#1E2A1A" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d="M156 134 Q176 142 172 164" stroke="#1E2A1A" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <circle cx="83" cy="120" r="8" fill="#1E2A1A" />
      <circle cx="117" cy="120" r="8" fill="#1E2A1A" />
      <circle cx="86" cy="116" r="2.8" fill="white" />
      <circle cx="120" cy="116" r="2.8" fill="white" />
      <path d="M87 136 Q100 148 113 136" stroke="#1E2A1A" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function MascotKonrad({ size = 120, animation = '', className = '' }) {
  return (
    <svg width={size} viewBox="0 0 170 180" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={cls(animation, className)} style={{ display: 'block' }}>
      <ellipse cx="80" cy="168" rx="40" ry="6" fill="#1E2A1A" opacity="0.08" />
      <path d="M64 36 Q58 28 64 20 Q70 14 64 6" stroke="#C8B8A8" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M88 36 Q82 28 88 20 Q94 14 88 6" stroke="#C8B8A8" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M38 56 L122 56 L114 150 Q113 162 100 162 L60 162 Q47 162 46 150 Z" fill="#FDF6ED" stroke="#E0D5C5" strokeWidth="2" />
      <path d="M42 70 L118 70 L116 88 L44 88 Z" fill="#5C3A1E" />
      <path d="M122 76 Q146 78 144 104 Q142 124 118 122" stroke="#E0D5C5" strokeWidth="8" fill="none" />
      <rect x="64" y="158" width="10" height="16" rx="5" fill="#C8612F" />
      <rect x="88" y="158" width="10" height="16" rx="5" fill="#C8612F" />
      <circle cx="68" cy="112" r="6.5" fill="#1E2A1A" />
      <circle cx="94" cy="112" r="6.5" fill="#1E2A1A" />
      <circle cx="70" cy="110" r="2.2" fill="white" />
      <circle cx="96" cy="110" r="2.2" fill="white" />
      <circle cx="56" cy="124" r="5" fill="#E07A4A" opacity="0.4" />
      <circle cx="106" cy="124" r="5" fill="#E07A4A" opacity="0.4" />
      <path d="M72 124 Q81 132 90 124" stroke="#1E2A1A" strokeWidth="3.2" strokeLinecap="round" fill="none" />
    </svg>
  )
}
