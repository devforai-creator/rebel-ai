import { describe, expect, it } from 'vitest'
import { resolveAlternateModelSelection } from './alternate-models'

describe('resolveAlternateModelSelection', () => {
  it('returns the selected model when alternate models are disabled', () => {
    const result = resolveAlternateModelSelection({
      alternateModels: {
        enabled: false,
        primaryApiKeyId: 'a',
        primaryModelName: 'model-a',
        secondaryApiKeyId: 'b',
        secondaryModelName: 'model-b',
      },
      selectedModel: { apiKeyId: 'primary', modelName: 'selected-model' },
      messages: [],
    })

    expect(result).toEqual({ apiKeyId: 'primary', modelName: 'selected-model' })
  })

  it('returns the selected model when the secondary selection is incomplete', () => {
    const result = resolveAlternateModelSelection({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'a',
        primaryModelName: 'model-a',
        secondaryApiKeyId: null,
        secondaryModelName: null,
      },
      selectedModel: { apiKeyId: 'primary', modelName: 'selected-model' },
      messages: [],
    })

    expect(result).toEqual({ apiKeyId: 'primary', modelName: 'selected-model' })
  })

  it('starts with the primary model', () => {
    const result = resolveAlternateModelSelection({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'shared-key',
        primaryModelName: 'model-a',
        secondaryApiKeyId: 'shared-key',
        secondaryModelName: 'model-b',
      },
      selectedModel: { apiKeyId: 'shared-key', modelName: 'model-a' },
      messages: [],
    })

    expect(result).toEqual({ apiKeyId: 'shared-key', modelName: 'model-a' })
  })

  it('alternates models that share one provider credential', () => {
    const result = resolveAlternateModelSelection({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'shared-key',
        primaryModelName: 'model-a',
        secondaryApiKeyId: 'shared-key',
        secondaryModelName: 'model-b',
      },
      selectedModel: { apiKeyId: 'shared-key', modelName: 'model-a' },
      messages: [
        {
          role: 'assistant',
          debug_info: {
            modelConfig: { apiKeyId: 'shared-key', modelName: 'model-a' },
          },
        },
      ],
    })

    expect(result).toEqual({ apiKeyId: 'shared-key', modelName: 'model-b' })
  })

  it('alternates back after the secondary model', () => {
    const result = resolveAlternateModelSelection({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'a',
        primaryModelName: 'model-a',
        secondaryApiKeyId: 'b',
        secondaryModelName: 'model-b',
      },
      selectedModel: { apiKeyId: 'a', modelName: 'model-a' },
      messages: [
        {
          role: 'assistant',
          debug_info: { modelConfig: { apiKeyId: 'b', modelName: 'model-b' } },
        },
      ],
    })

    expect(result).toEqual({ apiKeyId: 'a', modelName: 'model-a' })
  })
})
