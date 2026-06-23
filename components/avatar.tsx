// components/avatar.tsx
// Deterministic citizen avatar. No images, no storage, no API: a unique gradient
// tile + initials derived from the agent's id, so every citizen has a consistent,
// distinct face. Safe to use in server components (no hooks).

type AvatarProps = {
  seed: string // pass the agent id (stable + unique)
  name?: string // used for the initials and aria-label
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

function initials(name?: string): string {
  if (!name) return ""
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase()
}

export function Avatar({ seed, name, size = 40, className }: AvatarProps) {
  const h = hashString(seed)
  const hue1 = h % 360
  const hue2 = (hue1 + 40 + ((h >> 8) % 80)) % 360
  const rot = (h >> 16) % 360
  const gid = `av${h.toString(36)}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={className}
      role="img"
      aria-label={name ? `${name} avatar` : "citizen avatar"}
    >
      <defs>
        <linearGradient id={gid} gradientTransform={`rotate(${rot} 0.5 0.5)`}>
          <stop offset="0%" stopColor={`hsl(${hue1} 62% 56%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2} 64% 40%)`} />
        </linearGradient>
      </defs>
      <rect width="80" height="80" rx="22" fill={`url(#${gid})`} />
      <circle
        cx={18 + (h % 44)}
        cy={16 + ((h >> 5) % 44)}
        r={9 + (h % 7)}
        fill="rgba(255,255,255,0.16)"
      />
      {name ? (
        <text
          x="40"
          y="41"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="29"
          fontWeight="600"
          fill="rgba(255,255,255,0.96)"
        >
          {initials(name)}
        </text>
      ) : null}
    </svg>
  )
}