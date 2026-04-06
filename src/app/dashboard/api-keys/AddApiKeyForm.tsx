'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { listUiModelIdsByProvider } from '@/lib/models'
import { createApiKey, type ApiKeyFormState } from './actions'
import GoogleApiKeySidePanel from './GoogleApiKeySidePanel'
import { MAX_API_KEY_LENGTH, PROVIDER_OPTIONS, PROVIDER_RULES } from './providerRules'

type ProviderValue = (typeof PROVIDER_OPTIONS)[number]['value']

const OPENAI_SERVICE_TIER_OPTIONS = [
  {
    value: 'standard',
    label: 'Standard (Default)',
    description: 'Normal processing speed and SLA',
  },
  {
    value: 'flex',
    label: 'Flex (50% discount)',
    description: 'Slower responses and occasional 429 errors',
  },
] as const

const REASONING_EFFORT_OPTIONS = [
  { value: 'none', label: 'None (No reasoning)' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const

type ServiceTierValue = (typeof OPENAI_SERVICE_TIER_OPTIONS)[number]['value']
type ReasoningEffortValue = (typeof REASONING_EFFORT_OPTIONS)[number]['value']

const INITIAL_FORM_STATE: ApiKeyFormState = {
  error: null,
  success: false,
}

export default function AddApiKeyForm() {
  const [provider, setProvider] = useState<ProviderValue>('google')
  const [serviceTier, setServiceTier] = useState<ServiceTierValue>('standard')
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortValue>('none')
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [displayError, setDisplayError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [formState, formAction] = useActionState<ApiKeyFormState, FormData>(
    createApiKey,
    INITIAL_FORM_STATE,
  )
  const formRef = useRef<HTMLFormElement | null>(null)
  const providerRule = PROVIDER_RULES[provider]

  useEffect(() => {
    if (formState.error) {
      setDisplayError(formState.error)
      setShowSuccess(false)
      return
    }

    setDisplayError(null)
  }, [formState.error])

  useEffect(() => {
    if (!formState.success) {
      return
    }

    setShowSuccess(true)
    formRef.current?.reset()
    setProvider('google')
    setServiceTier('standard')
    setReasoningEffort('none')
    const timeout = setTimeout(() => setShowSuccess(false), 3000)
    return () => clearTimeout(timeout)
  }, [formState.success])

  useEffect(() => {
    if (provider !== 'openai') {
      setServiceTier('standard')
      setReasoningEffort('none')
    }
  }, [provider])

  return (
    <>
      <form
        id="add-api-key-form"
        action={formAction}
        ref={formRef}
        className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700"
      >
        {/* Guide Button */}
        {provider === 'google' && (
          <button
            type="button"
            onClick={() => setIsGuideOpen(true)}
            className="w-full mb-4 py-3 px-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span>Google API Key Guide</span>
          </button>
        )}

        {displayError && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm"
          >
            {displayError}
          </div>
        )}

        {showSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 px-4 py-3 rounded-lg text-sm"
          >
            API key registered securely!
          </div>
        )}

        <div className="space-y-4">
          {/* Provider 선택 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Provider
            </label>
            <select
              name="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderValue)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} {p.recommended ? '(Recommended)' : ''}
                </option>
              ))}
            </select>
            {providerRule.docsUrl && (
              <a
                href={providerRule.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                View Setup Guide
              </a>
            )}
          </div>

          {/* Key Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Key Name
            </label>
            <input
              type="text"
              name="key_name"
              placeholder="e.g., My Personal Gemini Key"
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              API Key
            </label>
            <input
              type="password"
              name="api_key"
              placeholder={providerRule.placeholder}
              required
              maxLength={providerRule.maxLength ?? MAX_API_KEY_LENGTH}
              pattern={providerRule.pattern.source}
              title={providerRule.hint}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{providerRule.hint}</p>
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              Encrypted and stored securely
            </p>
          </div>

          {provider !== 'openai' && <input type="hidden" name="service_tier" value="standard" />}

          {provider === 'openai' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                OpenAI Service Tier
              </label>
              <select
                name="service_tier"
                value={serviceTier}
                onChange={(event) => setServiceTier(event.target.value as ServiceTierValue)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                {OPENAI_SERVICE_TIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Flex is 50% cheaper but may be slower and occasionally return 429 errors.
              </p>
            </div>
          )}

          {provider === 'openai' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reasoning Effort
              </label>
              <select
                name="reasoning_effort"
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffortValue)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                {REASONING_EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Controls reasoning intensity for supported models (GPT-5+). &quot;None&quot;
                disables reasoning tokens.
              </p>
            </div>
          )}

          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default Model (Optional)
            </label>
            <select
              name="model_preference"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">None</option>
              {listUiModelIdsByProvider(provider).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          {/* 제출 버튼 */}
          <SubmitButton />
        </div>
      </form>

      {/* Side Panel */}
      <GoogleApiKeySidePanel isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Registering...' : 'Register API Key'}
    </button>
  )
}
