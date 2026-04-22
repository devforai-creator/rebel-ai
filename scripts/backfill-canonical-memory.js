#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')

const CANONICAL_CHUNK_SIZE = 10
const CANONICAL_META_SIZE = 100
const DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES = 100
const DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES = 4
const SUPPORTED_LLM_PROVIDERS = new Set(['google', 'openai', 'anthropic', 'deepseek', 'openrouter'])

function loadEnv(cwd = process.cwd()) {
  for (const file of ['.env.local', '.env']) {
    const envPath = path.join(cwd, file)
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath })
    }
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    chatIds: [],
    apiKeyId: null,
    modelName: null,
    origin: null,
    dryRun: false,
    purgeOnly: false,
    force: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--chat-id') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --chat-id')
      }
      parsed.chatIds.push(...splitChatIds(value))
      index += 1
      continue
    }

    if (arg === '--api-key-id') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --api-key-id')
      }
      parsed.apiKeyId = value
      index += 1
      continue
    }

    if (arg === '--model-name') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --model-name')
      }
      parsed.modelName = value
      index += 1
      continue
    }

    if (arg === '--origin') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --origin')
      }
      parsed.origin = value
      index += 1
      continue
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true
      continue
    }

    if (arg === '--purge-only') {
      parsed.purgeOnly = true
      continue
    }

    if (arg === '--force') {
      parsed.force = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  parsed.chatIds = [...new Set(parsed.chatIds)]
  return parsed
}

function splitChatIds(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function resolveSummaryGenerationOrigin({ origin, env = process.env } = {}) {
  const explicit = origin?.trim()
  if (explicit) {
    return normalizeOrigin(explicit)
  }

  const configured = env.INTERNAL_API_ORIGIN?.trim()
  if (configured) {
    return normalizeOrigin(configured)
  }

  if (env.NODE_ENV !== 'production') {
    return 'http://127.0.0.1:3000'
  }

  throw new Error(
    'Unable to resolve summary generation origin. Pass --origin or set INTERNAL_API_ORIGIN.',
  )
}

function normalizeOrigin(candidate) {
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error(`Invalid origin: ${candidate}`)
  }

  return parsed.origin
}

function createSupabaseFromEnv(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.')
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function resolveChatMemoryConfig(modelConfig) {
  if (!modelConfig || typeof modelConfig !== 'object' || !modelConfig.memory) {
    return {
      mode: 'summary_window',
      sealEveryMessages: DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES,
      retainTailMessages: DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES,
    }
  }

  const memory = modelConfig.memory
  const mode = memory.mode === 'prefix_live_blocks' ? 'prefix_live_blocks' : 'summary_window'
  const sealEveryMessages =
    typeof memory.sealEveryMessages === 'number' && Number.isFinite(memory.sealEveryMessages)
      ? Math.trunc(memory.sealEveryMessages)
      : DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES
  const retainTailMessages =
    typeof memory.retainTailMessages === 'number' && Number.isFinite(memory.retainTailMessages)
      ? Math.trunc(memory.retainTailMessages)
      : DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES

  return {
    mode,
    sealEveryMessages,
    retainTailMessages,
  }
}

function countProjectedConversationMessages(turnRows = []) {
  return turnRows.reduce((count, row) => {
    let next = count
    if (row.user_message_id) {
      next += 1
    }
    if (row.active_assistant_message_id) {
      next += 1
    }
    return next
  }, 0)
}

function isCanonicalChunkRange(startSeq, endSeq) {
  return (
    Number.isInteger(startSeq) &&
    Number.isInteger(endSeq) &&
    startSeq >= 1 &&
    endSeq === startSeq + CANONICAL_CHUNK_SIZE - 1 &&
    (startSeq - 1) % CANONICAL_CHUNK_SIZE === 0
  )
}

function isCanonicalMetaRange(startSeq, endSeq) {
  return (
    Number.isInteger(startSeq) &&
    Number.isInteger(endSeq) &&
    startSeq >= 1 &&
    endSeq === startSeq + CANONICAL_META_SIZE - 1 &&
    (startSeq - 1) % CANONICAL_META_SIZE === 0
  )
}

function keyForRange(range) {
  return `${range.start_seq}-${range.end_seq}`
}

function buildExpectedCanonicalMetaRanges(chunkRows) {
  const chunkKeySet = new Set(chunkRows.map(keyForRange))
  const expected = []

  let startSeq = 1
  while (true) {
    const chunkRanges = Array.from(
      { length: CANONICAL_META_SIZE / CANONICAL_CHUNK_SIZE },
      (_, index) => {
        const chunkStart = startSeq + index * CANONICAL_CHUNK_SIZE
        return {
          start_seq: chunkStart,
          end_seq: chunkStart + CANONICAL_CHUNK_SIZE - 1,
        }
      },
    )

    if (!chunkRanges.every((range) => chunkKeySet.has(keyForRange(range)))) {
      break
    }

    expected.push({
      start_seq: startSeq,
      end_seq: startSeq + CANONICAL_META_SIZE - 1,
    })
    startSeq += CANONICAL_META_SIZE
  }

  return expected
}

function buildExpectedCanonicalChunkRanges(totalMessages, memoryConfig) {
  const normalizedTotalMessages = Math.max(0, Math.trunc(totalMessages))
  const sealedThroughSeq =
    memoryConfig.mode === 'prefix_live_blocks'
      ? normalizedTotalMessages - memoryConfig.retainTailMessages
      : normalizedTotalMessages - CANONICAL_CHUNK_SIZE
  const lastCanonicalChunkEnd =
    Math.floor(Math.max(0, sealedThroughSeq) / CANONICAL_CHUNK_SIZE) * CANONICAL_CHUNK_SIZE

  return Array.from({ length: lastCanonicalChunkEnd / CANONICAL_CHUNK_SIZE }, (_, index) => {
    const startSeq = index * CANONICAL_CHUNK_SIZE + 1
    return {
      start_seq: startSeq,
      end_seq: startSeq + CANONICAL_CHUNK_SIZE - 1,
    }
  })
}

function minimumMessagesForArtifacts(memoryConfig) {
  if (memoryConfig.mode === 'prefix_live_blocks') {
    return CANONICAL_CHUNK_SIZE + memoryConfig.retainTailMessages
  }

  return CANONICAL_CHUNK_SIZE * 2
}

function analyzeChatMemoryRows({
  summaryRows = [],
  factRows = [],
  totalMessages = 0,
  memoryConfig,
  episodicMemoryEnabled = true,
}) {
  const chunkRows = summaryRows.filter((row) => row.level === 0)
  const metaRows = summaryRows.filter((row) => row.level === 1)
  const superMetaRows = summaryRows.filter((row) => row.level >= 2)
  const expectedChunkRanges = buildExpectedCanonicalChunkRanges(totalMessages, memoryConfig)
  const expectsFactRows = episodicMemoryEnabled === true

  const malformedChunkRanges = chunkRows.filter(
    (row) => !isCanonicalChunkRange(row.start_seq, row.end_seq),
  )
  const malformedMetaRanges = metaRows.filter(
    (row) => !isCanonicalMetaRange(row.start_seq, row.end_seq),
  )
  const malformedFactRanges = factRows.filter(
    (row) => !isCanonicalChunkRange(row.start_seq, row.end_seq),
  )

  const canonicalChunkRows = chunkRows.filter((row) => !malformedChunkRanges.includes(row))
  const canonicalFactRows = factRows.filter((row) => !malformedFactRanges.includes(row))
  const canonicalMetaRows = metaRows.filter((row) => !malformedMetaRanges.includes(row))

  const canonicalChunkKeys = new Set(canonicalChunkRows.map(keyForRange))
  const canonicalFactKeys = new Set(canonicalFactRows.map(keyForRange))
  const canonicalMetaKeys = new Set(canonicalMetaRows.map(keyForRange))

  const missingChunkRanges = expectedChunkRanges.filter(
    (row) => !canonicalChunkKeys.has(keyForRange(row)),
  )
  const missingFactRanges = expectsFactRows
    ? expectedChunkRanges.filter((row) => !canonicalFactKeys.has(keyForRange(row)))
    : []
  const orphanFactRanges = canonicalFactRows.filter(
    (row) => !expectedChunkRanges.some((expected) => keyForRange(expected) === keyForRange(row)),
  )

  const expectedMetaRanges = buildExpectedCanonicalMetaRanges(expectedChunkRanges)
  const missingMetaRanges = expectedMetaRanges.filter(
    (row) => !canonicalMetaKeys.has(keyForRange(row)),
  )
  const orphanMetaRanges = canonicalMetaRows.filter(
    (row) => !expectedMetaRanges.some((expected) => keyForRange(expected) === keyForRange(row)),
  )

  const totalRows = summaryRows.length + factRows.length
  const noRowsButShouldExist =
    totalRows === 0 && totalMessages >= minimumMessagesForArtifacts(memoryConfig)

  const issues = []
  if (malformedChunkRanges.length > 0) issues.push('malformed_chunk_ranges')
  if (malformedMetaRanges.length > 0) issues.push('malformed_meta_ranges')
  if (malformedFactRanges.length > 0) issues.push('malformed_fact_ranges')
  if (!noRowsButShouldExist && malformedChunkRanges.length === 0 && missingChunkRanges.length > 0) {
    issues.push('missing_chunk_ranges')
  }
  if (!noRowsButShouldExist && malformedFactRanges.length === 0 && missingFactRanges.length > 0) {
    issues.push('missing_fact_ranges')
  }
  if (orphanFactRanges.length > 0) issues.push('orphan_fact_ranges')
  if (!noRowsButShouldExist && malformedMetaRanges.length === 0 && missingMetaRanges.length > 0) {
    issues.push('missing_meta_ranges')
  }
  if (orphanMetaRanges.length > 0) issues.push('orphan_meta_ranges')
  if (superMetaRows.length > 0) issues.push('legacy_super_meta_ranges')
  if (noRowsButShouldExist) issues.push('missing_all_artifacts')

  return {
    needsRebuild: issues.length > 0,
    issues,
    counts: {
      summaries: summaryRows.length,
      chunkSummaries: chunkRows.length,
      metaSummaries: metaRows.length,
      superMetaSummaries: superMetaRows.length,
      facts: factRows.length,
      totalMessages,
    },
    malformedChunkRanges,
    malformedMetaRanges,
    malformedFactRanges,
    missingChunkRanges,
    missingFactRanges,
    orphanFactRanges,
    missingMetaRanges,
    orphanMetaRanges,
    noRowsButShouldExist,
  }
}

async function fetchChatMemoryState(supabase, chatId) {
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, user_id, model_config')
    .eq('id', chatId)
    .single()

  if (chatError) {
    throw new Error(`Failed to load chat ${chatId}: ${chatError.message}`)
  }

  if (!chat) {
    throw new Error(`Chat not found: ${chatId}`)
  }

  const [
    { data: summaryRows, error: summaryError },
    { data: factRows, error: factError },
    { data: turnRows, error: turnError },
  ] = await Promise.all([
    supabase
      .from('chat_summaries')
      .select('level, start_seq, end_seq')
      .eq('chat_id', chatId)
      .order('level', { ascending: true })
      .order('start_seq', { ascending: true }),
    supabase
      .from('chat_facts')
      .select('start_seq, end_seq')
      .eq('chat_id', chatId)
      .order('start_seq', { ascending: true }),
    supabase
      .from('chat_turns')
      .select('user_message_id, active_assistant_message_id')
      .eq('chat_id', chatId)
      .order('turn_index', { ascending: true }),
  ])

  if (summaryError) {
    throw new Error(`Failed to load summaries for ${chatId}: ${summaryError.message}`)
  }
  if (factError) {
    throw new Error(`Failed to load facts for ${chatId}: ${factError.message}`)
  }
  if (turnError) {
    throw new Error(`Failed to load turns for ${chatId}: ${turnError.message}`)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('enable_episodic_rag')
    .eq('id', chat.user_id)
    .maybeSingle()

  if (profileError && profileError.code !== 'PGRST116') {
    throw new Error(
      `Failed to load episodic memory setting for ${chat.user_id}: ${profileError.message}`,
    )
  }

  const memoryConfig = resolveChatMemoryConfig(chat.model_config)
  const totalMessages = countProjectedConversationMessages(turnRows ?? [])

  return {
    chat,
    memoryConfig,
    episodicMemoryEnabled: profile?.enable_episodic_rag === true,
    totalMessages,
    summaryRows: summaryRows ?? [],
    factRows: factRows ?? [],
  }
}

async function resolveSummaryGenerationConfig({
  supabase,
  userId,
  overrideApiKeyId,
  overrideModelName,
}) {
  let apiKeyId = overrideApiKeyId

  if (!apiKeyId) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('summary_api_key_id')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) {
      throw new Error(`Failed to load summary_api_key_id for ${userId}: ${profileError.message}`)
    }

    apiKeyId = profile?.summary_api_key_id ?? null
  }

  if (!apiKeyId) {
    throw new Error(`No summary API key configured for ${userId}. Pass --api-key-id to override.`)
  }

  const { data: apiKeyRow, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('id, user_id, provider, model_preference, is_active')
    .eq('id', apiKeyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (apiKeyError || !apiKeyRow) {
    throw new Error(`Active API key not found for ${userId}: ${apiKeyId}`)
  }

  if (!SUPPORTED_LLM_PROVIDERS.has(apiKeyRow.provider)) {
    throw new Error(`Unsupported provider for summaries: ${apiKeyRow.provider}`)
  }

  const resolvedModelName = overrideModelName ?? apiKeyRow.model_preference?.trim() ?? ''
  if (!resolvedModelName) {
    throw new Error(
      `API key ${apiKeyId} does not have model_preference. Pass --model-name to override.`,
    )
  }

  return {
    apiKeyId: apiKeyRow.id,
    provider: apiKeyRow.provider,
    modelName: resolvedModelName,
  }
}

async function purgeChatMemoryArtifacts(supabase, chatId) {
  const { error: summaryDeleteError } = await supabase
    .from('chat_summaries')
    .delete()
    .eq('chat_id', chatId)
  if (summaryDeleteError) {
    throw new Error(`Failed to purge chat_summaries for ${chatId}: ${summaryDeleteError.message}`)
  }

  const { error: factsDeleteError } = await supabase
    .from('chat_facts')
    .delete()
    .eq('chat_id', chatId)
  if (factsDeleteError) {
    throw new Error(`Failed to purge chat_facts for ${chatId}: ${factsDeleteError.message}`)
  }
}

async function triggerSummaryRebuild({
  origin,
  summarySecret,
  chatId,
  userId,
  provider,
  modelName,
  apiKeyId,
}) {
  const response = await fetch(new URL('/api/summaries/generate', origin), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${summarySecret}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? {
            'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          }
        : {}),
    },
    body: JSON.stringify({
      chatId,
      userId,
      provider,
      modelName,
      apiKeyId,
    }),
  })

  const text = await response.text()
  let payload = null

  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    throw new Error(
      `Summary rebuild failed for ${chatId}: ${response.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
    )
  }

  return payload
}

function renderAnalysisReport(chatId, memoryConfig, analysis) {
  return [
    `- chat: ${chatId}`,
    `  memory.mode: ${memoryConfig.mode}`,
    `  totalMessages: ${analysis.counts.totalMessages}`,
    `  rows: summaries=${analysis.counts.summaries}, facts=${analysis.counts.facts}`,
    `  issues: ${analysis.issues.length > 0 ? analysis.issues.join(', ') : 'none'}`,
  ].join('\n')
}

function printUsage() {
  console.log(`Usage:
  npm run backfill:canonical-memory -- --chat-id <uuid[,uuid...]> [options]

Options:
  --chat-id <id[,id...]>   One or more chat ids to inspect/rebuild. Repeatable.
  --api-key-id <id>        Override summary_api_key_id for the selected chats.
  --model-name <name>      Override the model name used for rebuild.
  --origin <url>           Override the internal app origin for /api/summaries/generate.
  --dry-run                Detect only. Do not purge or rebuild.
  --purge-only             Purge chat_summaries/chat_facts without rebuilding.
  --force                  Rebuild even when no non-canonical issues are detected.
`)
}

async function main(argv = process.argv.slice(2), options = {}) {
  const consoleImpl = options.console ?? console
  loadEnv(options.cwd ?? process.cwd())
  const env = options.env ?? process.env

  const parsed = parseArgs(argv)
  if (parsed.help) {
    printUsage()
    return 0
  }

  if (parsed.chatIds.length === 0) {
    throw new Error('At least one --chat-id is required.')
  }

  const shouldRebuild = !parsed.dryRun && !parsed.purgeOnly
  const origin = shouldRebuild
    ? resolveSummaryGenerationOrigin({ origin: parsed.origin, env })
    : null
  const summarySecret = shouldRebuild ? env.SUMMARY_GENERATION_SECRET : null
  if (shouldRebuild && !summarySecret) {
    throw new Error('Missing SUMMARY_GENERATION_SECRET.')
  }

  const supabase = options.supabase ?? createSupabaseFromEnv(env)

  for (const chatId of parsed.chatIds) {
    const state = await fetchChatMemoryState(supabase, chatId)
    const analysis = analyzeChatMemoryRows({
      summaryRows: state.summaryRows,
      factRows: state.factRows,
      totalMessages: state.totalMessages,
      memoryConfig: state.memoryConfig,
      episodicMemoryEnabled: state.episodicMemoryEnabled,
    })

    consoleImpl.log(renderAnalysisReport(chatId, state.memoryConfig, analysis))

    if (!analysis.needsRebuild && !parsed.force) {
      consoleImpl.log('  action: skip (already canonical or no backfill needed)')
      continue
    }

    if (parsed.dryRun) {
      consoleImpl.log('  action: dry-run')
      continue
    }

    await purgeChatMemoryArtifacts(supabase, chatId)
    consoleImpl.log('  action: purged chat_summaries + chat_facts')

    if (parsed.purgeOnly) {
      consoleImpl.log('  rebuild: skipped (--purge-only)')
      continue
    }

    const summaryConfig = await resolveSummaryGenerationConfig({
      supabase,
      userId: state.chat.user_id,
      overrideApiKeyId: parsed.apiKeyId,
      overrideModelName: parsed.modelName,
    })

    const result = await triggerSummaryRebuild({
      origin,
      summarySecret,
      chatId,
      userId: state.chat.user_id,
      provider: summaryConfig.provider,
      modelName: summaryConfig.modelName,
      apiKeyId: summaryConfig.apiKeyId,
    })

    consoleImpl.log(
      `  rebuild: triggered via ${summaryConfig.provider}/${summaryConfig.modelName} (${summaryConfig.apiKeyId})`,
    )
    if (result && typeof result === 'object') {
      consoleImpl.log(`  result: ${JSON.stringify(result)}`)
    }
  }

  return 0
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

module.exports = {
  CANONICAL_CHUNK_SIZE,
  CANONICAL_META_SIZE,
  SUPPORTED_LLM_PROVIDERS,
  analyzeChatMemoryRows,
  buildExpectedCanonicalMetaRanges,
  buildExpectedCanonicalChunkRanges,
  countProjectedConversationMessages,
  createSupabaseFromEnv,
  isCanonicalChunkRange,
  isCanonicalMetaRange,
  keyForRange,
  main,
  minimumMessagesForArtifacts,
  normalizeOrigin,
  parseArgs,
  resolveChatMemoryConfig,
  resolveSummaryGenerationOrigin,
  splitChatIds,
}
