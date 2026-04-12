import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import EmptyState from '@/app/dashboard/components/EmptyState'
import {
  DashboardCallout,
  DashboardPageShell,
  DashboardSectionHeading,
} from '@/app/dashboard/components/DashboardPageShell'
import ApiKeyList from './ApiKeyList'
import AddApiKeyForm from './AddApiKeyForm'

export default async function ApiKeysPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // API 키 목록 가져오기
  const { data: apiKeys, error } = await supabase
    .from('api_keys')
    .select(
      'id, provider, key_name, model_preference, service_tier, reasoning_effort, is_active, usage_notes, last_used_at, created_at, updated_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching API keys:', error)
  }

  return (
    <DashboardPageShell
      width="wide"
      title="API Key Management"
      eyebrow="Bring Your Own Key"
      description="Register and rotate provider keys with one visual language so model setup reads like product onboarding, not raw configuration."
      backHref="/dashboard"
      backLabel="Back to Dashboard"
    >
      <DashboardCallout
        tone="info"
        eyebrow="Cost Control"
        title="Bring your own provider keys"
        description="Use your own keys to unlock higher-performance models while keeping cost, provider choice, and rollout pace under your control."
      >
        <ul className="space-y-1">
          <li>
            * <strong>Google Gemini:</strong> Pay as you go
          </li>
          <li>
            * <strong>OpenAI GPT:</strong> Pay as you go
          </li>
          <li>
            * <strong>Anthropic Claude:</strong> Pay as you go
          </li>
          <li>
            * <strong>DeepSeek:</strong> Pay as you go
          </li>
          <li>
            * <strong>OpenRouter:</strong> Pay as you go (GLM-5, Qwen, etc.)
          </li>
        </ul>
      </DashboardCallout>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div id="add-api-key" className="space-y-4">
          <DashboardSectionHeading
            title="Register New API Key"
            description="Add a new provider key, choose the model preference, and keep the setup aligned with the shared dashboard controls."
          />
          <AddApiKeyForm />
        </div>

        <div className="space-y-4">
          <DashboardSectionHeading
            title="Registered API Keys"
            description="Review provider coverage, activity, and model preferences before you rotate or retire a key."
          />
          {apiKeys && apiKeys.length > 0 ? (
            <ApiKeyList apiKeys={apiKeys} />
          ) : (
            <EmptyState
              title="No API keys registered"
              description="Register an API key using the setup form on the left to unlock BYOK model access."
              action={
                <Link
                  href="#add-api-key"
                  className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_34px_-18px_rgba(37,99,235,0.78)] transition-colors hover:bg-blue-700"
                >
                  Open setup form
                </Link>
              }
            />
          )}
        </div>
      </div>
    </DashboardPageShell>
  )
}
