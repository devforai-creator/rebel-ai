import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ResolveArgs = Parameters<(typeof import('./prompt-cache'))['resolvePromptCacheDecision']>[0]
type AnthropicResolveArgs = Parameters<
  (typeof import('./prompt-cache'))['resolveAnthropicCacheDecision']
>[0]

const baseArgs: ResolveArgs = {
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  systemPrompt: 'SYSTEM',
  messages: [{ role: 'user', content: 'Hello' }],
  totalInputTokens: 2_048,
}

const baseAnthropicArgs: AnthropicResolveArgs = {
  modelName: 'claude-3-7-sonnet',
}

async function loadModule() {
  const mod = await import('./prompt-cache')
  return mod
}

describe('OpenAI prompt cache decision', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'auto')
  })

  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('skips non-OpenAI providers', async () => {
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision({
      ...baseArgs,
      provider: 'google',
    })

    expect(decision).toBeNull()
  })

  it('defaults to off when mode env is missing', async () => {
    vi.unstubAllEnvs()
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision(baseArgs)

    expect(decision).toBeNull()
  })

  it('returns null when caching mode is off', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'off')
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision(baseArgs)

    expect(decision).toBeNull()
  })

  it('enforces minimum token threshold', async () => {
    const { resolvePromptCacheDecision } = await loadModule()

    const belowThreshold = resolvePromptCacheDecision({
      ...baseArgs,
      totalInputTokens: 1_000,
    })
    const aboveThreshold = resolvePromptCacheDecision({
      ...baseArgs,
      totalInputTokens: 1_500,
    })

    expect(belowThreshold).toBeNull()
    expect(aboveThreshold).not.toBeNull()
  })

  it('uses provided cache key override and degrades retention for non-gpt-5.1 models', async () => {
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision({
      ...baseArgs,
      cacheKeyOverride: 'chat:chat-1',
      retentionPreference: '24h',
    })

    expect(decision).toEqual({
      key: 'chat:chat-1',
      retention: 'in_memory',
    })
  })

  it('keeps 24h retention for gpt-5.1 family when requested', async () => {
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision({
      ...baseArgs,
      modelName: 'gpt-5.1-mini',
      retentionPreference: '24h',
    })

    expect(decision?.retention).toBe('24h')
  })

  it('keeps 24h retention for gpt-5.2 when requested', async () => {
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision({
      ...baseArgs,
      modelName: 'gpt-5.2',
      retentionPreference: '24h',
    })

    expect(decision?.retention).toBe('24h')
  })

  it('generates deterministic ctx cache keys when no override is provided', async () => {
    const { resolvePromptCacheDecision } = await loadModule()

    const decisionA = resolvePromptCacheDecision(baseArgs)
    const decisionB = resolvePromptCacheDecision({
      ...baseArgs,
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(decisionA?.key).toMatch(/^ctx:/)
    expect(decisionA?.key).toBe(decisionB?.key)
  })

  it('falls back to default min tokens when env is invalid', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MIN_TOKENS', '-5')
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision({
      ...baseArgs,
      totalInputTokens: 1_000,
    })

    expect(decision).toBeNull()
  })

  it('uses in_memory retention from env when model supports extended retention', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_RETENTION', 'in_memory')
    const { resolvePromptCacheDecision } = await loadModule()

    const decision = resolvePromptCacheDecision({
      ...baseArgs,
      modelName: 'gpt-5.1-mini',
    })

    expect(decision?.retention).toBe('in_memory')
  })
})

describe('Anthropic prompt cache decision', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHE_MODE', 'auto')
  })

  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('defaults to off when mode env is missing', async () => {
    vi.unstubAllEnvs()
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision(baseAnthropicArgs)
    expect(decision).toBeNull()
  })

  it('returns null when anthropic caching mode is off', async () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHE_MODE', 'off')
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision(baseAnthropicArgs)
    expect(decision).toBeNull()
  })

  it('still returns cache settings below the estimated model threshold', async () => {
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision({
      modelName: 'claude-3-7-sonnet',
    })

    expect(decision).toEqual({
      enabled: true,
      ttl: '5m',
      minTokens: 1_024,
    })
  })

  it('uses default 5m ttl when env is missing', async () => {
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision(baseAnthropicArgs)

    expect(decision).toEqual({
      enabled: true,
      ttl: '5m',
      minTokens: 1_024,
    })
  })

  it('uses explicit 1h ttl from env', async () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHE_TTL', '1h')
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision(baseAnthropicArgs)

    expect(decision).toEqual({
      enabled: true,
      ttl: '1h',
      minTokens: 1_024,
    })
  })

  it('falls back to 5m ttl for invalid env values', async () => {
    vi.stubEnv('ANTHROPIC_PROMPT_CACHE_TTL', 'invalid')
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision(baseAnthropicArgs)

    expect(decision).toEqual({
      enabled: true,
      ttl: '5m',
      minTokens: 1_024,
    })
  })

  it('keeps legacy haiku minimum tokens in metadata', async () => {
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision({
      modelName: 'claude-3-5-haiku',
    })

    expect(decision).toEqual({
      enabled: true,
      ttl: '5m',
      minTokens: 2_048,
    })
  })

  it('keeps higher minimum tokens for haiku 4.5 models in metadata', async () => {
    const { resolveAnthropicCacheDecision } = await loadModule()

    const decision = resolveAnthropicCacheDecision({
      modelName: 'claude-haiku-4-5',
    })

    expect(decision).toEqual({
      enabled: true,
      ttl: '5m',
      minTokens: 4_096,
    })
  })
})
