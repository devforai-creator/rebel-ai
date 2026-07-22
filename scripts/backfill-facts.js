#!/usr/bin/env node

/**
 * Backfill Facts Extraction Script
 *
 * This script extracts episodic facts from existing chat_summaries chunks
 * that were created before the dual memory system was implemented.
 *
 * Usage:
 *   1. Add these to your .env.local:
 *      BACKFILL_API_PROVIDER=google
 *      BACKFILL_API_KEY=your-api-key
 *      BACKFILL_MODEL_NAME=gemini-3.5-flash-lite
 *
 *   2. Run the script:
 *      npm run backfill:facts
 *
 * Supported providers: google, openai, anthropic
 * Use your existing API keys and current model names.
 */

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')
const { generateText } = require('ai')

// Load environment variables
const envFiles = ['.env.local', '.env']
for (const file of envFiles) {
  const envPath = path.join(process.cwd(), file)
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const apiKeyProvider = process.env.BACKFILL_API_PROVIDER
const apiKey = process.env.BACKFILL_API_KEY
const modelName = process.env.BACKFILL_MODEL_NAME

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables')
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!apiKeyProvider || !apiKey || !modelName) {
  console.error('❌ Missing backfill configuration')
  console.error('Required environment variables:')
  console.error('  BACKFILL_API_PROVIDER (google|openai|anthropic)')
  console.error('  BACKFILL_API_KEY (your API key)')
  console.error(
    '  BACKFILL_MODEL_NAME (e.g., gemini-3.5-flash-lite, gpt-4o-mini, claude-3-5-haiku-20241022)',
  )
  console.error('')
  console.error('Example:')
  console.error('  BACKFILL_API_PROVIDER=google')
  console.error('  BACKFILL_API_KEY=your-google-api-key')
  console.error('  BACKFILL_MODEL_NAME=gemini-3.5-flash-lite')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const DEFAULT_FACT_EXTRACTION_PROMPT = `Extract specific facts from the following conversation that are worth referencing later, in Korean. Write each fact as a single bullet point line. Exclude generic conversational content.

Extract these types of facts:
- First-time events (first meeting, first experience, etc.)
- Specific places, dates, times, food, etc.
- Personal preferences, habits, characteristics
- Important promises or decisions
- Emotionally significant moments

Output format (plain text only, no JSON or Markdown):
- 2025년 11월 10일, '메코 식당'에서 떡볶이를 먹으며 처음 만남
- 사용자는 매운 음식을 잘 먹는다고 함
- 캐릭터는 고양이를 무서워함

If there are no significant facts to record, respond with only "기록할 사실 없음".`

// CRITICAL: DO NOT USE A LOWER VALUE.
// Gemini 2.5 Pro reserves ~1000-2000 tokens for internal 'thinking'
// BEFORE generating output. Setting to 1024 will cause a SILENT FAILURE.
const CHUNK_SUMMARY_MAX_TOKENS = 8192
const MESSAGE_CHAR_LIMIT = 1200

function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

async function extractFactsForChunk(chatId, userId, startSeq, endSeq, model) {
  // Load messages for this chunk
  const fromIndex = startSeq - 1
  const toIndex = endSeq - 1

  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('sequence', { ascending: true })
    .range(fromIndex, toIndex)

  if (messageError) {
    throw new Error(`Failed to load messages: ${messageError.message}`)
  }

  if (!messages || messages.length === 0) {
    return null
  }

  const formattedTranscript = messages
    .map((msg) => `${msg.role.toUpperCase()}: ${truncateText(msg.content, MESSAGE_CHAR_LIMIT)}`)
    .join('\n')

  try {
    const { text, finishReason } = await generateText({
      model,
      system: DEFAULT_FACT_EXTRACTION_PROMPT,
      prompt: formattedTranscript,
      maxTokens: CHUNK_SUMMARY_MAX_TOKENS,
      temperature: 0,
    })

    // 🚨 Critical: Detect MAX_TOKENS failure before it silently fails
    if (finishReason === 'max_tokens' && (!text || text.trim() === '')) {
      console.error(
        `  ❌ [Critical Failure] Fact extraction failed due to MAX_TOKENS. ` +
          `Model consumed all tokens without generating output. ` +
          `maxTokens: ${CHUNK_SUMMARY_MAX_TOKENS}`,
      )
      return null
    }

    const facts = text.trim()

    // Skip if no significant facts
    if (
      facts.includes('기록할 사실 없음') ||
      facts.length < 10 ||
      facts.toLowerCase().includes('no significant facts')
    ) {
      return null
    }

    return facts
  } catch (error) {
    console.error(`  ⚠️  LLM error: ${error.message}`)
    return null
  }
}

async function main() {
  console.log('🔍 Starting facts backfill process...\n')

  // Get all chunk-level summaries (level = 0)
  const { data: chunks, error: chunksError } = await supabase
    .from('chat_summaries')
    .select('id, chat_id, start_seq, end_seq')
    .eq('level', 0)
    .order('chat_id', { ascending: true })
    .order('start_seq', { ascending: true })

  if (chunksError) {
    console.error('❌ Failed to load chunks:', chunksError.message)
    process.exit(1)
  }

  if (!chunks || chunks.length === 0) {
    console.log('✓ No chunks found. Nothing to backfill.')
    return
  }

  console.log(`Found ${chunks.length} chunks to process\n`)

  // Group chunks by chat_id to get user_id
  const chunksByChat = chunks.reduce((acc, chunk) => {
    if (!acc[chunk.chat_id]) {
      acc[chunk.chat_id] = []
    }
    acc[chunk.chat_id].push(chunk)
    return acc
  }, {})

  let totalProcessed = 0
  let totalSkipped = 0
  let totalCreated = 0
  let totalErrors = 0

  // Setup AI model based on provider
  let model
  try {
    if (apiKeyProvider === 'google') {
      const { createGoogleGenerativeAI } = require('@ai-sdk/google')
      const google = createGoogleGenerativeAI({ apiKey })
      model = google(modelName)
      console.log(`Using Google model: ${modelName}\n`)
    } else if (apiKeyProvider === 'openai') {
      const { createOpenAI } = require('@ai-sdk/openai')
      const openai = createOpenAI({ apiKey })
      model = openai(modelName)
      console.log(`Using OpenAI model: ${modelName}\n`)
    } else if (apiKeyProvider === 'anthropic') {
      const { createAnthropic } = require('@ai-sdk/anthropic')
      const anthropic = createAnthropic({ apiKey })
      model = anthropic(modelName)
      console.log(`Using Anthropic model: ${modelName}\n`)
    } else if (apiKeyProvider === 'deepseek') {
      const { createDeepSeek } = require('@ai-sdk/deepseek')
      const deepseek = createDeepSeek({ apiKey })
      model = deepseek(modelName)
      console.log(`Using DeepSeek model: ${modelName}\n`)
    } else {
      throw new Error(`Unsupported provider: ${apiKeyProvider}`)
    }
  } catch (error) {
    console.error('❌ Failed to initialize AI model:', error.message)
    process.exit(1)
  }

  for (const [chatId, chatChunks] of Object.entries(chunksByChat)) {
    // Get chat info (for user_id)
    const { data: chat } = await supabase.from('chats').select('user_id').eq('id', chatId).single()

    if (!chat) {
      console.log(`⚠️  Chat ${chatId} not found, skipping...`)
      totalSkipped += chatChunks.length
      continue
    }

    console.log(`Processing chat ${chatId} (${chatChunks.length} chunks)...`)

    for (const chunk of chatChunks) {
      totalProcessed++

      // Check if facts already exist for this chunk
      const { data: existingFacts } = await supabase
        .from('chat_facts')
        .select('id')
        .eq('chat_id', chatId)
        .eq('start_seq', chunk.start_seq)
        .eq('end_seq', chunk.end_seq)
        .maybeSingle()

      if (existingFacts) {
        console.log(`  ✓ Chunk ${chunk.start_seq}-${chunk.end_seq} already has facts, skipping`)
        totalSkipped++
        continue
      }

      // Extract facts
      try {
        const facts = await extractFactsForChunk(
          chatId,
          chat.user_id,
          chunk.start_seq,
          chunk.end_seq,
          model,
        )

        if (!facts) {
          console.log(`  - Chunk ${chunk.start_seq}-${chunk.end_seq}: no significant facts`)
          totalSkipped++
          continue
        }

        // Save facts
        const { error: insertError } = await supabase.from('chat_facts').insert({
          chat_id: chatId,
          user_id: chat.user_id,
          start_seq: chunk.start_seq,
          end_seq: chunk.end_seq,
          facts,
        })

        if (insertError) {
          console.error(
            `  ❌ Failed to save facts for ${chunk.start_seq}-${chunk.end_seq}:`,
            insertError.message,
          )
          totalErrors++
          continue
        }

        console.log(`  ✓ Chunk ${chunk.start_seq}-${chunk.end_seq}: facts extracted`)
        totalCreated++

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch (error) {
        console.error(
          `  ❌ Error processing chunk ${chunk.start_seq}-${chunk.end_seq}:`,
          error.message,
        )
        totalErrors++
      }
    }

    console.log('')
  }

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Summary:')
  console.log(`  Total chunks:      ${totalProcessed}`)
  console.log(`  Facts created:     ${totalCreated}`)
  console.log(`  Skipped:           ${totalSkipped}`)
  console.log(`  Errors:            ${totalErrors}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✓ Backfill complete!')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
