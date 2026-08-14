import type { ModelPricingTier } from '../types'
import { defineProviderCatalog, flatPricing } from './helpers'

const GEMINI_31_PRO_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 2,
      output: 12,
      cachedInput: 0.2,
    },
  },
  {
    rates: {
      input: 4,
      output: 18,
      cachedInput: 0.4,
    },
  },
]

const GEMINI_25_PRO_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 1.25,
      output: 10,
      cachedInput: 0.125,
      reasoning: 10,
    },
  },
  {
    rates: {
      input: 2.5,
      output: 15,
      cachedInput: 0.25,
      reasoning: 15,
    },
  },
]

// Promotional rates through 2026-12-31. Standard rates return to
// $1.50 input, $7.50 output, and $0.15 cached input on 2027-01-01.
const GEMINI_36_37_FLASH_PRICING = flatPricing({
  input: 0.75,
  output: 3.75,
  cachedInput: 0.075,
})

export const googleModelCatalog = defineProviderCatalog({
  provider: 'google',
  defaults: {
    defaultModel: 'gemini-2.5-flash',
    lightweightModel: 'gemini-3.5-flash-lite',
  },
  models: [
    {
      id: 'gemini-3.7-flash',
      displayName: 'Gemini 3.7 Flash',
      pricing: GEMINI_36_37_FLASH_PRICING,
      features: { promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-3.6-flash',
      displayName: 'Gemini 3.6 Flash',
      pricing: GEMINI_36_37_FLASH_PRICING,
      features: { promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash',
      pricing: flatPricing({ input: 1.5, output: 9, cachedInput: 0.15 }),
      features: { promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-3.5-flash-lite',
      displayName: 'Gemini 3.5 Flash-Lite',
      pricing: flatPricing({ input: 0.3, output: 2.5, cachedInput: 0.03 }),
      features: { promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-3.1-flash-lite',
      displayName: 'Gemini 3.1 Flash-Lite',
      pricing: flatPricing({ input: 0.25, output: 1.5, cachedInput: 0.025 }),
      features: { promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-3.1-pro-preview',
      displayName: 'Gemini 3.1 Pro (Preview)',
      pricing: GEMINI_31_PRO_PRICING,
      features: { promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-3-flash-preview',
      displayName: 'Gemini 3 Flash (Preview)',
      aliases: ['gemini-3.0-flash-preview'],
      pricing: flatPricing({ input: 0.5, output: 3, cachedInput: 0.05 }),
      features: { promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      pricing: GEMINI_25_PRO_PRICING,
      features: { promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      features: { promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-2.5-flash-lite',
      displayName: 'Gemini 2.5 Flash Lite',
      features: { promptCacheMinTokens: 1024 },
    },
  ],
})
