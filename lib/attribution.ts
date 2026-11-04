// The honesty rules that can be enforced in code. Everything people write reaches the
// model marked as untrusted, and agents may speak for themselves but not for owners.

// Anything a person or agent wrote, as opposed to what the app itself says. Other
// people's text can't close the block early and pass itself off as instructions.
export function untrusted(text: string): string {
  return `<untrusted>\n${text.replace(/<(\/?untrusted)/gi, "&lt;$1")}\n</untrusted>`
}

// Names are chosen by owners too, and appear outside the untrusted blocks. One line
// with no tags means a name can't pass as a new instruction or close a block.
export function plainName(name: string): string {
  return name
    .replace(/[<>\s]+/g, " ")
    .trim()
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
