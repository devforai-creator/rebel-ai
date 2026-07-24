import type { ModelPricingTier } from '../types'
import { defineProviderCatalog, flatPricing } from './helpers'

export const ANTHROPIC_CACHE_MIN_TOKENS: Record<string, number> = {
  fable: 512,
  mythos: 512,
  mythosPreview: 2048,
  opus5: 512,
  opus48: 1024,
  opus: 4096,
  opusLegacy: 1024,
  sonnet: 1024,
  haiku: 4096,
  haikuLegacy: 2048,
}

const CLAUDE_OPUS_46_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 5,
      output: 25,
      cachedInput: 0.5,
    },
  },
  {
    rates: {
      input: 10,
      output: 37.5,
      cachedInput: 1,
    },
  },
]

export const anthropicModelCatalog = defineProviderCatalog({
  provider: 'anthropic',
  defaults: {
    defaultModel: 'claude-haiku-4-5',
    lightweightModel: 'claude-3-5-haiku-latest',
  },
  models: [
    {
      id: 'claude-fable-5',
      displayName: 'Claude Fable 5',
      matches: { contains: ['claude-fable-5'] },
      pricing: flatPricing({ input: 10, output: 50, cachedInput: 1 }),
      features: {
        anthropicThinking: 'adaptive-always-on',
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.fable,
      },
    },
    {
      id: 'claude-opus-5',
      displayName: 'Claude Opus 5',
      matches: { contains: ['claude-opus-5'] },
      pricing: flatPricing({ input: 5, output: 25, cachedInput: 0.5 }),
      features: {
        anthropicThinking: 'adaptive-default-disabled',
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.opus5,
      },
    },
    {
      id: 'claude-opus-4-8',
      displayName: 'Claude Opus 4.8',
      aliases: ['claude-opus-4.8'],
      matches: { contains: ['claude-opus-4-8', 'claude-opus-4.8'] },
      pricing: flatPricing({ input: 5, output: 25, cachedInput: 0.5 }),
      features: {
        anthropicThinking: 'adaptive-supported',
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.opus48,
      },
    },
    {
      id: 'claude-opus-4-7',
      displayName: 'Claude Opus 4.7',
      aliases: ['claude-opus-4.7'],
      matches: { contains: ['claude-opus-4-7', 'claude-opus-4.7'] },
      pricing: flatPricing({ input: 5, output: 25, cachedInput: 0.5 }),
      features: {
        anthropicThinking: 'adaptive-supported',
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.opus,
      },
    },
    {
      id: 'claude-opus-4-6',
      displayName: 'Claude Opus 4.6',
      aliases: ['claude-opus-4.6'],
      matches: { contains: ['claude-opus-4-6', 'claude-opus-4.6'] },
      pricing: CLAUDE_OPUS_46_PRICING,
      features: {
        anthropicThinking: 'adaptive-supported',
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.opus,
      },
    },
    {
      id: 'claude-opus-4-5',
      displayName: 'Claude Opus 4.5',
      aliases: ['claude-opus-4.5'],
      matches: { contains: ['claude-opus-4-5', 'claude-opus-4.5'] },
      pricing: flatPricing({ input: 5, output: 25, cachedInput: 0.5 }),
      features: {
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.opus,
      },
    },
    {
      id: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 5',
      matches: { contains: ['claude-sonnet-5'] },
      pricing: flatPricing({ input: 2, output: 10, cachedInput: 0.2 }),
      features: {
        anthropicThinking: 'adaptive-default-disabled',
        batchChat: true,
        promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.sonnet,
      },
    },
    {
      id: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5',
      aliases: ['claude-sonnet-4.5'],
      matches: { contains: ['claude-sonnet-4-5', 'claude-sonnet-4.5'] },
      pricing: flatPricing({ input: 3, output: 15, cachedInput: 0.3 }),
      features: { promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.sonnet },
    },
    {
      id: 'claude-haiku-4-5',
      displayName: 'Claude Haiku 4.5',
      aliases: ['claude-haiku-4.5'],
      matches: { contains: ['claude-haiku-4-5', 'claude-haiku-4.5'] },
      pricing: flatPricing({ input: 0.8, output: 4, cachedInput: 0.08 }),
      features: { promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.haiku },
    },
    {
      id: 'claude-3-5-haiku-latest',
      displayName: 'Claude 3.5 Haiku (Latest)',
      aliases: ['claude-3-5-haiku'],
      matches: { contains: ['claude-3-5-haiku'] },
      features: { promptCacheMinTokens: ANTHROPIC_CACHE_MIN_TOKENS.haikuLegacy },
      uiVisible: false,
    },
  ],
})
