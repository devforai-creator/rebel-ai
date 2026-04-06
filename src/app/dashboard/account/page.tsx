import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DeleteAccountButton from './DeleteAccountButton'
import SummaryPromptsEditor from './SummaryPromptsEditor'
import SummaryModelSettingsForm from './SummaryModelSettingsForm'
import RagSettingsForm from './RagSettingsForm'
import ChangePasswordForm from './ChangePasswordForm'
import ReprocessSettingsForm from './ReprocessSettingsForm'
import TranslationModelSettingsForm from './TranslationModelSettingsForm'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'

export default async function AccountPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'display_name, chunk_summary_prompt, meta_summary_prompt, fact_extraction_prompt, enable_episodic_rag, voyage_embedding_api_key_id, summary_api_key_id, reprocess_prompt, reprocess_api_key_id, translation_api_key_id',
    )
    .eq('id', user.id)
    .single()

  const { data: voyageKeys } = await supabase
    .from('api_keys')
    .select('id, key_name, is_active, provider, created_at')
    .eq('user_id', user.id)
    .eq('provider', 'voyage_embeddings')
    .order('created_at', { ascending: true })

  const { data: summaryKeys } = await supabase
    .from('api_keys')
    .select('id, key_name, provider, model_preference, is_active, service_tier')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  const summaryModelKeys = summaryKeys?.filter((key) => isLLMProvider(key.provider)) ?? []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        >
          <span aria-hidden>←</span>
          Back to Dashboard
        </Link>

        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-6 border-b border-gray-200 dark:border-gray-700">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Account Settings
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {profile?.display_name || user.email} ({user.email})
            </p>
          </div>

          <div className="px-6 py-8 space-y-8">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Episodic Memory RAG
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Connect your own Voyage API key to include only the most relevant facts in context,
                even in long conversations.
              </p>
              <div className="mt-6">
                <RagSettingsForm
                  initialEnabled={profile?.enable_episodic_rag ?? false}
                  initialKeyId={profile?.voyage_embedding_api_key_id ?? null}
                  voyageKeys={(voyageKeys ?? []).map((key) => ({
                    id: key.id,
                    key_name: key.key_name,
                    is_active: key.is_active,
                  }))}
                />
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Long-term Memory System Prompts
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Customize the style of auto-generated summaries and fact extraction when
                conversations grow long. Leave empty to use default prompts.
              </p>
              <div className="mt-6">
                <SummaryPromptsEditor
                  initialChunkPrompt={profile?.chunk_summary_prompt ?? null}
                  initialMetaPrompt={profile?.meta_summary_prompt ?? null}
                  initialFactPrompt={profile?.fact_extraction_prompt ?? null}
                />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Summary-dedicated Model
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Summaries and fact extraction can use a different model/API key than chat. Leave
                empty to continue using the model from your recent chat.
              </p>
              <div className="mt-6">
                <SummaryModelSettingsForm
                  initialKeyId={profile?.summary_api_key_id ?? null}
                  apiKeys={summaryModelKeys.map((key) => ({
                    id: key.id,
                    key_name: key.key_name,
                    provider: key.provider,
                    model_preference: key.model_preference,
                    service_tier: key.service_tier,
                  }))}
                />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Message Reprocess
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Configure a custom prompt and model for reprocessing assistant messages. Use this
                for translation, style correction, or any text transformation.
              </p>
              <div className="mt-6">
                <ReprocessSettingsForm
                  initialPrompt={profile?.reprocess_prompt ?? null}
                  initialKeyId={profile?.reprocess_api_key_id ?? null}
                  apiKeys={summaryModelKeys.map((key) => ({
                    id: key.id,
                    key_name: key.key_name,
                    provider: key.provider,
                    model_preference: key.model_preference,
                    service_tier: key.service_tier,
                  }))}
                />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Bilingual Memory (Experimental)
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Automatically translate messages to English in the background for token efficiency.
                Recent 2 turns stay in original language for natural style. Recommended for
                non-English conversations with expensive models.
              </p>
              <div className="mt-6">
                <TranslationModelSettingsForm
                  initialKeyId={profile?.translation_api_key_id ?? null}
                  apiKeys={summaryModelKeys.map((key) => ({
                    id: key.id,
                    key_name: key.key_name,
                    provider: key.provider,
                    model_preference: key.model_preference,
                    service_tier: key.service_tier,
                  }))}
                />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Change Password
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Enter a new password to strengthen your account security.
              </p>
              <div className="mt-6">
                <ChangePasswordForm />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Delete Account
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Deleting your account will permanently remove all saved characters, chat history,
                and API key information. This action cannot be undone.
              </p>
              <div className="mt-6">
                <DeleteAccountButton />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
