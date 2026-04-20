import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DeleteAccountButton from './DeleteAccountButton'
import SummaryPromptsEditor from './SummaryPromptsEditor'
import SummaryModelSettingsForm from './SummaryModelSettingsForm'
import RagSettingsForm from './RagSettingsForm'
import ChatUsageSettingsForm from './ChatUsageSettingsForm'
import ChangePasswordForm from './ChangePasswordForm'
import ReprocessSettingsForm from './ReprocessSettingsForm'
import TranslationModelSettingsForm from './TranslationModelSettingsForm'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'
import type { SelectableLlmApiKey, VoyageEmbeddingsKeyOption } from './options'

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
      'display_name, chunk_summary_prompt, meta_summary_prompt, fact_extraction_prompt, enable_episodic_rag, enable_chat_usage_stats, voyage_embedding_api_key_id, summary_api_key_id, reprocess_prompt, reprocess_api_key_id, translation_api_key_id',
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

  const voyageKeyOptions: VoyageEmbeddingsKeyOption[] = (voyageKeys ?? []).map((key) => ({
    id: key.id,
    key_name: key.key_name,
    is_active: key.is_active,
  }))

  const selectableLlmApiKeys: SelectableLlmApiKey[] =
    summaryKeys
      ?.filter((key) => isLLMProvider(key.provider))
      .map((key) => ({
        id: key.id,
        key_name: key.key_name,
        provider: key.provider,
        model_preference: key.model_preference,
        service_tier: key.service_tier,
      })) ?? []

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
                Connect your own Voyage API key to retrieve relevant episodic facts into context.
                When disabled, new episodic facts are not generated and stored facts are not
                injected into generation context.
              </p>
              <div className="mt-6">
                <RagSettingsForm
                  initialEnabled={profile?.enable_episodic_rag ?? false}
                  initialKeyId={profile?.voyage_embedding_api_key_id ?? null}
                  voyageKeys={voyageKeyOptions}
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
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Chat Usage Panel
                </h2>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Advanced
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Show optional token, cache, and cost details in chat. This is disabled by default so
                the main chat path does not make extra background requests unless you opt in.
              </p>
              <div className="mt-6">
                <ChatUsageSettingsForm initialEnabled={profile?.enable_chat_usage_stats ?? false} />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Summary-dedicated Model
                </h2>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Advanced
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Use a cheaper or different model only for summaries and fact extraction. Leave this
                empty to continue using the same model as chat.
              </p>
              <div className="mt-6">
                <SummaryModelSettingsForm
                  initialKeyId={profile?.summary_api_key_id ?? null}
                  apiKeys={selectableLlmApiKeys}
                />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Message Reprocess
                </h2>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  Experimental
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Configure a custom prompt and model for reprocessing assistant messages. Use this
                for optional translation, style correction, or other text transformations. This does
                not use the main queued chat contract and is not a supported core chat path.
              </p>
              <div className="mt-6">
                <ReprocessSettingsForm
                  initialPrompt={profile?.reprocess_prompt ?? null}
                  initialKeyId={profile?.reprocess_api_key_id ?? null}
                  apiKeys={selectableLlmApiKeys}
                />
              </div>
            </section>

            <section className="border-t border-gray-200 dark:border-gray-700 pt-8">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Bilingual Memory
                </h2>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  Experimental
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Translates older messages in the background and may reduce context cost for some
                chats, but savings are not guaranteed. It adds extra LLM calls and can interact
                poorly with some cache strategies, so this is not a recommended default.
              </p>
              <div className="mt-6">
                <TranslationModelSettingsForm
                  initialKeyId={profile?.translation_api_key_id ?? null}
                  apiKeys={selectableLlmApiKeys}
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
