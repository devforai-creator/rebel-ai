import { describe, expect, it } from 'vitest'
import { defineProviderCatalog, flatPricing } from './helpers'

describe('model catalog helpers', () => {
  it('injects provider defaults and derives visible model order from array order', () => {
    const catalog = defineProviderCatalog({
      provider: 'deepseek',
      defaults: {
        defaultModel: 'model-a',
        lightweightModel: 'model-hidden',
      },
      models: [
        { id: 'model-a', displayName: 'Model A' },
        { id: 'model-hidden', displayName: 'Hidden Model', uiVisible: false },
        { id: 'model-b', displayName: 'Model B' },
      ],
    })

    expect(catalog.models).toEqual([
      {
        id: 'model-a',
        provider: 'deepseek',
        displayName: 'Model A',
        uiVisible: true,
        uiOrder: 1,
      },
      {
        id: 'model-hidden',
        provider: 'deepseek',
        displayName: 'Hidden Model',
        uiVisible: false,
      },
      {
        id: 'model-b',
        provider: 'deepseek',
        displayName: 'Model B',
        uiVisible: true,
        uiOrder: 2,
      },
    ])
  })

  it('builds the common single-tier pricing shape', () => {
    expect(flatPricing({ input: 1, output: 2, cachedInput: 0.1 })).toEqual([
      {
        rates: { input: 1, output: 2, cachedInput: 0.1 },
      },
    ])
  })

  it('rejects defaults that do not reference the provider catalog', () => {
    expect(() =>
      defineProviderCatalog({
        provider: 'deepseek',
        defaults: { defaultModel: 'missing-model' },
        models: [{ id: 'model-a', displayName: 'Model A' }],
      }),
    ).toThrow('Default model missing-model is not registered for deepseek')

    expect(() =>
      defineProviderCatalog({
        provider: 'deepseek',
        defaults: {
          defaultModel: 'model-a',
          lightweightModel: 'missing-lightweight-model',
        },
        models: [{ id: 'model-a', displayName: 'Model A' }],
      }),
    ).toThrow('Lightweight model missing-lightweight-model is not registered for deepseek')
  })

  it('rejects duplicate model IDs within a provider catalog', () => {
    expect(() =>
      defineProviderCatalog({
        provider: 'deepseek',
        defaults: { defaultModel: 'model-a' },
        models: [
          { id: 'model-a', displayName: 'Model A' },
          { id: 'model-a', displayName: 'Model A Duplicate' },
        ],
      }),
    ).toThrow('Duplicate model ID registered for deepseek')
  })
})
