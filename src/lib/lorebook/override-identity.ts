export type LorebookOverrideKey = `v2:${string}:${string}` | `v1:${string}:${number}` | string

export type LorebookEntryIdentityInput = Readonly<{
  key: string
  content: string
  secondkey?: string | null
  comment?: string | null
  mode?: string | null
  insertorder?: number | null
  alwaysActive?: boolean | null
  selective?: boolean | null
  folder?: string | null
  useRegex?: boolean | null
}>

function normalizeIdentityInput(entry: LorebookEntryIdentityInput) {
  return [
    entry.mode ?? '',
    entry.key ?? '',
    entry.secondkey ?? '',
    entry.comment ?? '',
    entry.folder ?? '',
    String(entry.insertorder ?? 0),
    entry.alwaysActive ? '1' : '0',
    entry.selective ? '1' : '0',
    entry.useRegex ? '1' : '0',
    entry.content ?? '',
  ].join('\n')
}

export function computeLorebookEntryFingerprint(
  moduleId: string,
  entry: LorebookEntryIdentityInput,
) {
  // FNV-1a 64-bit over a normalized identity string.
  // - Runs in both browser and Node (no BigInt; works with older TS targets)
  // - Collision risk is extremely low for our usage
  const input = `${moduleId}\n${normalizeIdentityInput(entry)}`
  let hashHi = 0xcbf29ce4
  let hashLo = 0x84222325

  // 0x00000100000001B3
  const primeHi = 0x00000100
  const primeLo = 0x000001b3

  const mul32To64 = (a: number, b: number) => {
    const a0 = a & 0xffff
    const a1 = a >>> 16
    const b0 = b & 0xffff
    const b1 = b >>> 16

    const c0 = a0 * b0
    const c1 = a1 * b0 + a0 * b1
    const c2 = a1 * b1

    const sum = c0 + ((c1 & 0xffff) << 16)
    const lo = sum >>> 0
    const carry = sum >= 0x100000000 ? 1 : 0
    const hi = (c2 + (c1 >>> 16) + (c0 >>> 16) + carry) >>> 0

    return { hi, lo }
  }

  for (let i = 0; i < input.length; i++) {
    hashLo = (hashLo ^ input.charCodeAt(i)) >>> 0

    const loMul = mul32To64(hashLo, primeLo)
    const hiFromLo = (loMul.hi + Math.imul(hashLo, primeHi) + Math.imul(hashHi, primeLo)) >>> 0

    hashHi = hiFromLo
    hashLo = loMul.lo
  }

  return `${hashHi.toString(16).padStart(8, '0')}${hashLo.toString(16).padStart(8, '0')}`
}

export function getLorebookOverrideKeyV2(
  moduleId: string,
  fingerprint: string,
): LorebookOverrideKey {
  return `v2:${moduleId}:${fingerprint}`
}

export function getLorebookOverrideKeyLegacy(
  entryKey: string,
  insertorder: number,
): LorebookOverrideKey {
  return `v1:${entryKey}:${insertorder}`
}

export function parseLegacyOverrideKey(key: string) {
  // Supports both `v1:entryKey:insertorder` and the old `entryKey:insertorder` format.
  if (key.startsWith('v1:')) {
    const rest = key.slice(3)
    const lastColon = rest.lastIndexOf(':')
    if (lastColon <= 0) return null
    const entryKey = rest.slice(0, lastColon)
    const insertorder = Number(rest.slice(lastColon + 1))
    if (!Number.isFinite(insertorder)) return null
    return { entryKey, insertorder }
  }

  const lastColon = key.lastIndexOf(':')
  if (lastColon <= 0) return null
  const entryKey = key.slice(0, lastColon)
  const insertorder = Number(key.slice(lastColon + 1))
  if (!Number.isFinite(insertorder)) return null
  return { entryKey, insertorder }
}
