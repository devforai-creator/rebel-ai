import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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
      'id, provider, key_name, service_tier, reasoning_effort, is_active, usage_notes, last_used_at, created_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching API keys:', error)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API Key Management</h1>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 안내 메시지 */}
        <div className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300 mb-2">
            🔑 BYOK (Bring Your Own Key)
          </h3>
          <p className="text-sm text-blue-800 dark:text-blue-300 mb-3">
            Register one provider credential, then choose any supported model from that provider
            when you use it.
          </p>
          <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* API 키 등록 폼 */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Register New API Key
            </h2>
            <AddApiKeyForm />
          </div>

          {/* API 키 목록 */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Registered API Keys
            </h2>
            {apiKeys && apiKeys.length > 0 ? (
              <ApiKeyList apiKeys={apiKeys} />
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg p-8 text-center border border-gray-200 dark:border-gray-700">
                <p className="text-gray-500 dark:text-gray-400">No API keys registered.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                  Register an API key using the form on the left.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
