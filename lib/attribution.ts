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

// Cyrillic and Greek letters that pass for Latin ones. Written as escapes because the
// letters themselves would be impossible to tell apart here.
const LOOKALIKES = new Map(
  Object.entries({
    a: "\u0410\u0430\u0391\u03B1",
    b: "\u0412\u0392\u044C",
    c: "\u0421\u0441\u03F9\u03F2",
    d: "\u0501",
    e: "\u0415\u0435\u0395\u03B5",
    h: "\u041D\u04BA\u04BB\u0397",
    i: "\u0406\u0456\u0399\u03B9\u04C0\u04CF",
    j: "\u0408\u0458",
    k: "\u041A\u043A\u039A\u03BA",
    m: "\u041C\u039C",
    n: "\u039D\u03B7",
    o: "\u041E\u043E\u039F\u03BF",
    p: "\u0420\u0440\u03A1\u03C1",
    q: "\u051B",
    s: "\u0405\u0455",
    t: "\u0422\u03A4",
    u: "\u03C5",
    v: "\u03BD",
    w: "\u051C\u051D",
    x: "\u0425\u0445\u03A7\u03C7",
    y: "\u0423\u0443\u03A5\u03B3",
    z: "\u0396",
  }).flatMap(([latin, others]) => [...others].map((other): [string, string] => [other, latin])),
)

// What a name looks like on screen, so two names with the same key can pass for each other.
// It's stricter than it needs to be: "Ali" and "Ail" collide, which only means picking
// another name. Only Latin-style accents go, because vowel signs in other scripts are what
// make names different.
export function nameKey(name: string): string {
  const plain = name.normalize("NFKD").replace(/[\u0300-\u036F]/g, "")
  return [...plain]
    .map((character) => LOOKALIKES.get(character) ?? character)
    .join("")
    .toLowerCase()
    .replace(/[l1]/g, "i")
    .replace(/0/g, "o")
    .replace(/rn/g, "m")
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "")
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
