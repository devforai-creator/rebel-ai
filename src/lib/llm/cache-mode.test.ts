import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadModule() {
  return await import('./cache-mode')
}

describe('resolveProviderCacheMode', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('defaults to off when mode env is missing', async () => {
    const { resolveProviderCacheMode } = await loadModule()

    expect(resolveProviderCacheMode({ modeEnvName: 'OPENAI_PROMPT_CACHE_MODE' })).toBe('off')
  })

  it('accepts auto mode case-insensitively', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'AUTO')
    const { resolveProviderCacheMode } = await loadModule()

    expect(resolveProviderCacheMode({ modeEnvName: 'OPENAI_PROMPT_CACHE_MODE' })).toBe('auto')
  })

  it('falls back to off and warns for invalid mode values', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'enabled')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { resolveProviderCacheMode } = await loadModule()

    expect(resolveProviderCacheMode({ modeEnvName: 'OPENAI_PROMPT_CACHE_MODE' })).toBe('off')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid OPENAI_PROMPT_CACHE_MODE value "enabled"'),
    )
  })

  it('ignores legacy enabled env vars instead of using them as fallback', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_ENABLED', 'true')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { resolveProviderCacheMode } = await loadModule()

    expect(
      resolveProviderCacheMode({
        modeEnvName: 'OPENAI_PROMPT_CACHE_MODE',
        legacyEnvNames: ['OPENAI_PROMPT_CACHE_ENABLED'],
      }),
    ).toBe('off')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring legacy env var OPENAI_PROMPT_CACHE_ENABLED'),
    )
  })

  it('prefers explicit mode over ignored legacy env vars', async () => {
    vi.stubEnv('OPENAI_PROMPT_CACHE_MODE', 'auto')
    vi.stubEnv('OPENAI_PROMPT_CACHE_ENABLED', 'false')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { resolveProviderCacheMode } = await loadModule()

    expect(
      resolveProviderCacheMode({
        modeEnvName: 'OPENAI_PROMPT_CACHE_MODE',
        legacyEnvNames: ['OPENAI_PROMPT_CACHE_ENABLED'],
      }),
    ).toBe('auto')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring legacy env var OPENAI_PROMPT_CACHE_ENABLED'),
    )
  })
})
