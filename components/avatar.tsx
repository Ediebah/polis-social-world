// A citizen's face, worked out from its id. No images, no storage, no API: every citizen
// gets a consistent, distinct little character. Safe in server components (no hooks).

type AvatarProps = {
  seed: string // pass the agent id (stable + unique)
  name?: string // used for the aria-label
  size?: number
  className?: string
}

// FNV-1a hash -> stable 32-bit number from a string.
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const INK = "rgba(16,19,29,0.86)"

function Eyes({ kind }: { kind: number }) {
  switch (kind) {
    case 0:
      return (
        <>
          <circle cx="28" cy="35" r="4.5" fill={INK} />
          <circle cx="52" cy="35" r="4.5" fill={INK} />
        </>
      )
    case 1:
      return (
        <>
          <circle cx="28" cy="35" r="7.5" fill="rgba(255,255,255,0.92)" />
          <circle cx="52" cy="35" r="7.5" fill="rgba(255,255,255,0.92)" />
          <circle cx="30" cy="36" r="3.5" fill={INK} />
          <circle cx="54" cy="36" r="3.5" fill={INK} />
        </>
      )
    case 2:
      return (
        <path d="M22 35q6-6 12 0M46 35q6-6 12 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
      )
    default:
      return (
        <>
          <circle cx="28" cy="35" r="3.5" fill={INK} />
          <path d="M46 35h12" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        </>
      )
  }
}

function Mouth({ kind }: { kind: number }) {
  switch (kind) {
    case 0:
      return <path d="M30 52q10 9 20 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
    case 1:
      return <path d="M32 54h16" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
    case 2:
      return <circle cx="40" cy="54" r="4.5" fill={INK} />
    default:
      return <path d="M30 56q5-6 10 0t10 0" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
  }
}

const SHAPES = [
  <rect key="rounded" width="80" height="80" rx="24" fill="currentColor" />,
  <circle key="round" cx="40" cy="40" r="40" fill="currentColor" />,
  <path key="arch" d="M0 80V36a40 36 0 0 1 80 0v44z" fill="currentColor" />,
  <path key="soft" d="M40 0c26 0 40 12 40 40S66 80 40 80 0 68 0 40 14 0 40 0z" fill="currentColor" />,
]

export function Avatar({ seed, name, size = 40, className }: AvatarProps) {
  const h = hashString(seed)
  const hue = h % 360
  // Unsigned shifts: h can be above 2^31, and >> would turn it negative.

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={className}
      style={{ color: `oklch(0.8 0.1 ${hue})` }}
      role="img"
      aria-label={name ? `${name}'s avatar` : "citizen avatar"}
    >
      {SHAPES[(h >>> 3) % SHAPES.length]}
      <Eyes kind={(h >>> 6) % 4} />
      <Mouth kind={(h >>> 9) % 4} />
    </svg>
  )
}
