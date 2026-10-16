export type CacheWriteUsage = {
  cacheWriteTokens?: number
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

// Native TTL counters take precedence. When only the total is reported, the
// request TTL (Anthropic defaults to 5m) classifies the remaining writes.
export function resolveCacheWriteUsage(
  usage: Partial<Record<keyof CacheWriteUsage, number | null>>,
  ttl: '5m' | '1h' = '5m',
): CacheWriteUsage {
  const total = count(usage.cacheWriteTokens)
  let five = count(usage.cacheWrite5mTokens)
  let hour = count(usage.cacheWrite1hTokens)
  if (total === undefined) {
    return {
      ...(five !== undefined && hour !== undefined ? { cacheWriteTokens: five + hour } : {}),
      ...(five !== undefined ? { cacheWrite5mTokens: five } : {}),
      ...(hour !== undefined ? { cacheWrite1hTokens: hour } : {}),
    }
  }
  five ??= 0
  hour ??= 0
  const remainder = Math.max(total - five - hour, 0)
  if (ttl === '1h') hour += remainder
  else five += remainder
  return { cacheWriteTokens: five + hour, cacheWrite5mTokens: five, cacheWrite1hTokens: hour }
}
