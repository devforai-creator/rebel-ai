import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SurfaceCard from '@/app/dashboard/components/SurfaceCard'
import {
  DashboardPageShell,
  DashboardSectionHeading,
} from '@/app/dashboard/components/DashboardPageShell'
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
    <DashboardPageShell
      width="narrow"
      title="Account Settings"
      eyebrow="Preferences"
      description="Tune long-term memory, dedicated models, experimental assistants, and security controls without losing the shared product language."
      backHref="/dashboard"
      backLabel="Back to Dashboard"
    >
      <SurfaceCard padding="none" className="overflow-hidden">
        <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800/80">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Signed in as
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-base font-semibold text-slate-950 dark:text-white">
              {profile?.display_name || user.email}
            </p>
            <span className="rounded-full border border-slate-200/80 bg-white/75 px-3 py-1 text-xs text-slate-600 dark:border-slate-700/80 dark:bg-slate-950/45 dark:text-slate-300">
              {user.email}
            </span>
          </div>
        </div>

        <div className="px-6 py-8 space-y-8">
          <section className="space-y-6">
            <DashboardSectionHeading
              title="Episodic Memory RAG"
              description="Connect your own Voyage API key to include only the most relevant facts in context, even in long conversations."
            />
            <RagSettingsForm
              initialEnabled={profile?.enable_episodic_rag ?? false}
              initialKeyId={profile?.voyage_embedding_api_key_id ?? null}
              voyageKeys={(voyageKeys ?? []).map((key) => ({
                id: key.id,
                key_name: key.key_name,
                is_active: key.is_active,
              }))}
            />
          </section>

          <section className="space-y-6 border-t border-slate-200/80 pt-8 dark:border-slate-800/80">
            <DashboardSectionHeading
              title="Long-term Memory System Prompts"
              description="Customize the style of auto-generated summaries and fact extraction when conversations grow long. Leave empty to use default prompts."
            />
            <SummaryPromptsEditor
              initialChunkPrompt={profile?.chunk_summary_prompt ?? null}
              initialMetaPrompt={profile?.meta_summary_prompt ?? null}
              initialFactPrompt={profile?.fact_extraction_prompt ?? null}
            />
          </section>

          <section className="space-y-6 border-t border-slate-200/80 pt-8 dark:border-slate-800/80">
            <DashboardSectionHeading
              title="Summary-dedicated Model"
              badge="Advanced"
              description="Use a cheaper or different model only for summaries and fact extraction. Leave this empty to continue using the same model as chat."
            />
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
          </section>

          <section className="space-y-6 border-t border-slate-200/80 pt-8 dark:border-slate-800/80">
            <DashboardSectionHeading
              title="Message Reprocess"
              badge="Experimental"
              description="Configure a custom prompt and model for reprocessing assistant messages. Use this for optional translation, style correction, or other text transformations."
            />
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
          </section>

          <section className="space-y-6 border-t border-slate-200/80 pt-8 dark:border-slate-800/80">
            <DashboardSectionHeading
              title="Bilingual Memory"
              badge="Experimental"
              description="Translate older messages in the background when it helps memory cost or clarity, while keeping the core chat path unchanged."
            />
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
          </section>

          <section className="space-y-6 border-t border-slate-200/80 pt-8 dark:border-slate-800/80">
            <DashboardSectionHeading
              title="Change Password"
              description="Enter a new password to strengthen your account security."
            />
            <ChangePasswordForm />
          </section>

          <section className="space-y-6 border-t border-slate-200/80 pt-8 dark:border-slate-800/80">
            <DashboardSectionHeading
              title="Delete Account"
              description="Deleting your account permanently removes saved characters, chat history, and API key information. This action cannot be undone."
            />
            <DeleteAccountButton />
          </section>
        </div>
      </SurfaceCard>
    </DashboardPageShell>
  )
}
