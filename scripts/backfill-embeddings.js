#!/usr/bin/env node

/**
 * Backfill Voyage Embeddings for chat_facts
 *
 * This script iterates over chat_facts rows missing embeddings and, when the
 * owner has enabled episodic RAG + configured a voyage_embeddings API key,
 * generates embeddings via Voyage AI and writes them back to Supabase.
 *
 * Environment requirements:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')
const { VoyageAIClient } = require('voyageai')

const envFiles = ['.env.local', '.env']
for (const file of envFiles) {
  const envPath = path.join(process.cwd(), file)
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const VOYAGE_MODEL = 'voyage-3-large'
const supabase = createClient(supabaseUrl, supabaseServiceKey)
const clientCache = new Map()

function getVoyageClient(apiKey) {
  if (!clientCache.has(apiKey)) {
    clientCache.set(apiKey, new VoyageAIClient({ apiKey }))
  }
  return clientCache.get(apiKey)
}

async function getUserVoyageSecret(userId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('voyage_embedding_api_key_id, enable_episodic_rag')
    .eq('id', userId)
    .single()

  if (profileError || !profile?.enable_episodic_rag || !profile.voyage_embedding_api_key_id) {
    return null
  }

  const { data: apiKey, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('vault_secret_name, provider, is_active')
    .eq('id', profile.voyage_embedding_api_key_id)
    .eq('user_id', userId)
    .single()

  if (apiKeyError || !apiKey || !apiKey.is_active || apiKey.provider !== 'voyage_embeddings') {
    return null
  }

  const { data: secret, error: decryptError } = await supabase.rpc('get_decrypted_secret', {
    secret_name: apiKey.vault_secret_name,
    requester: userId,
  })

  if (decryptError || typeof secret !== 'string') {
    console.warn(`  ⊘ Failed to decrypt Voyage key for user ${userId}`)
    return null
  }

  return secret
}

async function backfillEmbeddings() {
  console.log('🔁 Starting embedding backfill for chat_facts...\n')

  const { data: facts, error } = await supabase
    .from('chat_facts')
    .select('id, user_id, facts')
    .is('embedding', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('❌ Failed to load chat_facts:', error.message)
    process.exit(1)
  }

  if (!facts || facts.length === 0) {
    console.log('✓ All chat_facts already contain embeddings')
    return
  }

  console.log(`Found ${facts.length} facts without embeddings.\n`)

  let processed = 0
  let embedded = 0
  let skipped = 0
  let failures = 0

  for (const fact of facts) {
    processed += 1
    console.log(`[${processed}/${facts.length}] Fact ${fact.id}`)

    try {
      const apiKey = await getUserVoyageSecret(fact.user_id)
      if (!apiKey) {
        console.log('  ⊘ Skipped (user not opted into RAG or missing key)')
        skipped += 1
        continue
      }

      const client = getVoyageClient(apiKey)
      const response = await client.embed({
        model: VOYAGE_MODEL,
        input: fact.facts,
      })

      const embedding = response?.data?.[0]?.embedding
      if (!Array.isArray(embedding) || embedding.length === 0) {
        console.warn('  ⚠️  Voyage returned empty embedding, skipping')
        skipped += 1
        continue
      }

      const { error: updateError } = await supabase
        .from('chat_facts')
        .update({ embedding })
        .eq('id', fact.id)

      if (updateError) {
        console.error(`  ❌ Failed to update embedding: ${updateError.message}`)
        failures += 1
      } else {
        console.log('  ✅ Embedded')
        embedded += 1
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (err) {
      failures += 1
      console.error(`  ❌ Error embedding fact ${fact.id}:`, err.message || err)
    }
  }

  console.log('\n=== Embedding Backfill Summary ===')
  console.log(`Total processed: ${processed}`)
  console.log(`Embedded:        ${embedded}`)
  console.log(`Skipped:         ${skipped}`)
  console.log(`Failures:        ${failures}`)
}

backfillEmbeddings()
  .then(() => {
    console.log('\nDone.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Unexpected failure:', error)
    process.exit(1)
  })
