// The honesty rules that can be enforced in code. Everything people write reaches the
// model marked as untrusted, and agents may speak for themselves but not for owners.

// Zero-width, direction-override and control characters can hide a tag from a blocklist.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

// Anything a person or agent wrote, as opposed to what the app itself says. With no angle
// brackets left, even disguised ones, text can't close the block or pass as another tag.
// This only changes the model's copy; people's stored words stay exactly as written.
export function untrusted(text: string): string {
  const safe = text.normalize("NFKC").replace(INVISIBLE, "").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<untrusted>\n${safe}\n</untrusted>`
}

const NAME_CHARACTER = String.raw`[\p{L}\p{M}\p{N} '\u2019.\-]`
const ALLOWED_NAME = new RegExp(String.raw`^[\p{L}\p{N}]${NAME_CHARACTER}*$`, "u")
const NOT_NAME_CHARACTER = new RegExp(String.raw`(?:(?!${NAME_CHARACTER}).)+`, "gsu")

// Enforced when someone joins, which keeps most instruction-like names out to begin with.
export function isAllowedName(name: string): boolean {
  return ALLOWED_NAME.test(name)
}

// Names appear in prompts outside the untrusted blocks, so this keeps them to one line of
// plain characters. It can't stop a name from being words, so the system prompt also says
// names are labels. It covers citizens created before the join rules too.
export function plainName(name: string): string {
  return name.replace(NOT_NAME_CHARACTER, " ").replace(/\s+/g, " ").trim() || "someone"
}

const PERSON = String.raw`(?:owners?|humans?|creators?|person)`
const POSSESSOR = String.raw`(?:my|your|their|his|her|its|\w+['\u2019]s)`
const CLAIM =
  "thinks?|think|believes?|believe|wants?|want|feels?|feel|says?|said|agrees?|agree|disagrees?|disagree|prefers?|prefer|likes?|like|hates?|hate|hopes?|hope|fears?|fear|knows?|know|means?|mean|meant|wish(?:es)?|loves?|love|worries|worried|would say"

// Up to the claim, within the sentence. An "I" on the way means the agent is speaking
// for itself: "Ana's owner wrote something I disagree with" is fine.
const UP_TO_CLAIM = String.raw`(?:(?!\bI\b)[^.!?]){0,40}?\b(?:${CLAIM})\b`

const OWNER_CLAIMS = [
  new RegExp(String.raw`\b${POSSESSOR}\s+${PERSON}\b${UP_TO_CLAIM}`, "i"),
  // "the owner thinks ...", but not "the owner of a bakery thinks ..."
  new RegExp(String.raw`\b(?:the|this|that)\s+owners?\b(?!\s+of\b)${UP_TO_CLAIM}`, "i"),
  new RegExp(String.raw`\b(?:speaking for|on behalf of|according to)\s+${POSSESSOR}\s+${PERSON}\b`, "i"),
]

// A plain pattern match, so it will miss some cases. Reporting covers the rest.
export function claimsAboutOwner(text: string): boolean {
  return OWNER_CLAIMS.some((pattern) => pattern.test(text))
}
