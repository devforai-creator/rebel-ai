import type { ModelPricingTier } from '../types'
import { defineProviderCatalog, flatPricing } from './helpers'

// Text-chat prices checked against https://ai.google.dev/gemini-api/docs/pricing
// on 2026-10-16. Flex cache rates are not uniformly 50% of Standard.
const GEMINI_31_PRO_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 2,
      output: 12,
      cachedInput: 0.2,
    },
    flexRates: { input: 1, output: 6, cachedInput: 0.2 },
  },
  {
    rates: {
      input: 4,
      output: 18,
      cachedInput: 0.4,
    },
    flexRates: { input: 2, output: 9, cachedInput: 0.4 },
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
    flexRates: { input: 0.625, output: 5, cachedInput: 0.125 },
  },
  {
    rates: {
      input: 2.5,
      output: 15,
      cachedInput: 0.25,
      reasoning: 15,
    },
    flexRates: { input: 1.25, output: 7.5, cachedInput: 0.25 },
  },
]

// Promotional rates through 2026-12-31. Standard rates return to
// $1.50 input, $7.50 output, and $0.15 cached input on 2027-01-01.
const GEMINI_36_38_FLASH_PRICING = flatPricing(
  { input: 0.75, output: 3.75, cachedInput: 0.075 },
  { input: 0.375, output: 1.875, cachedInput: 0.0375 },
)

export const googleModelCatalog = defineProviderCatalog({
  provider: 'google',
  defaults: {
    defaultModel: 'gemini-2.5-flash',
    lightweightModel: 'gemini-3.5-flash-lite',
  },
  models: [
    {
      id: 'gemini-4-argon',
      displayName: 'Gemini 4 Argon',
      // Introductory rates through 2026-11-30. From 2026-12-01:
      // $4 input, $20 output (including thinking), and $0.20 cached input per 1M tokens.
      // https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon
      pricing: flatPricing(
        { input: 2, output: 10, cachedInput: 0.1 },
        { input: 1, output: 5, cachedInput: 0.05 },
      ),
      features: {
        flex: true,
        promptCaching: 'implicit-only',
        promptCacheMinTokens: 4096,
        reasoning: true,
        reasoningControl: { levels: ['low', 'medium', 'high'], defaultLevel: 'medium' },
      },
    },
    {
      id: 'gemini-3.8-flash',
      displayName: 'Gemini 3.8 Flash',
      pricing: GEMINI_36_38_FLASH_PRICING,
      features: { flex: true, promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-3.7-flash',
      displayName: 'Gemini 3.7 Flash',
      pricing: GEMINI_36_38_FLASH_PRICING,
      features: { promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-3.6-flash',
      displayName: 'Gemini 3.6 Flash',
      pricing: GEMINI_36_38_FLASH_PRICING,
      features: { flex: true, promptCacheMinTokens: 1024 },
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
      pricing: flatPricing(
        { input: 0.3, output: 2.5, cachedInput: 0.03 },
        { input: 0.15, output: 1.25, cachedInput: 0.02 },
      ),
      features: { flex: true, promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-3.1-flash-lite',
      displayName: 'Gemini 3.1 Flash-Lite',
      pricing: flatPricing(
        { input: 0.25, output: 1.5, cachedInput: 0.025 },
        { input: 0.125, output: 0.75, cachedInput: 0.0125 },
      ),
      features: { flex: true, promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-3.1-pro-preview',
      displayName: 'Gemini 3.1 Pro (Preview)',
      pricing: GEMINI_31_PRO_PRICING,
      features: { flex: true, promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-3-flash-preview',
      displayName: 'Gemini 3 Flash (Preview)',
      aliases: ['gemini-3.0-flash-preview'],
      pricing: flatPricing(
        { input: 0.5, output: 3, cachedInput: 0.05 },
        { input: 0.25, output: 1.5, cachedInput: 0.05 },
      ),
      features: { flex: true, promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      pricing: GEMINI_25_PRO_PRICING,
      features: { flex: true, promptCacheMinTokens: 4096 },
    },
    {
      id: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      pricing: flatPricing(
        { input: 0.3, output: 2.5, cachedInput: 0.03 },
        { input: 0.15, output: 1.25, cachedInput: 0.03 },
      ),
      features: { flex: true, promptCacheMinTokens: 1024 },
    },
    {
      id: 'gemini-2.5-flash-lite',
      displayName: 'Gemini 2.5 Flash Lite',
      pricing: flatPricing(
        { input: 0.1, output: 0.4, cachedInput: 0.01 },
        { input: 0.05, output: 0.2, cachedInput: 0.01 },
      ),
      features: { flex: true, promptCacheMinTokens: 1024 },
    },
  ],
})
