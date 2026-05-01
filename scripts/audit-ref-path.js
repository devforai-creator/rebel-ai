#!/usr/bin/env node

/**
 * Maintenance script for SUU major-version bumps.
 *
 * Audit existing characters' SUU UI metadata against the V3 strict validator.
 *
 * Reads every row in `characters`, validates each ui card / ui_cards.*, and
 * prints a summary of which cards would now be rejected.
 *
 * Usage: node scripts/audit-ref-path.js
 */

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')

// Load env.local / .env (same pattern as scripts/backfill-embeddings.js)
const envFiles = ['.env.local', '.env']
for (const file of envFiles) {
  const envPath = path.join(process.cwd(), file)
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL or service role key')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

// Yield every SUU card found in metadata, labeled by its "slot".
// A character can have a single ui_card and/or a map of ui_cards.
function* extractCards(metadata) {
  if (!metadata || typeof metadata !== 'object') return
  if (metadata.ui_card) yield { slot: 'ui_card', card: metadata.ui_card }
  if (metadata.ui_cards && typeof metadata.ui_cards === 'object') {
    for (const [name, card] of Object.entries(metadata.ui_cards)) {
      yield { slot: `ui_cards.${name}`, card }
    }
  }
}

async function main() {
  const { loadCard } = await import('@safe-ugc-ui/validator')
  const { data: characters, error } = await supabase.from('characters').select('id, name, metadata')

  if (error) {
    console.error('DB error:', error.message)
    process.exit(1)
  }

  const failures = []
  let totalCards = 0
  let passCards = 0

  for (const row of characters ?? []) {
    for (const { slot, card } of extractCards(row.metadata)) {
      totalCards++
      const result = loadCard(card)
      if (result.valid) {
        passCards++
      } else {
        failures.push({ characterId: row.id, characterName: row.name, slot, errors: result.errors })
      }
    }
  }

  console.log(`\nTotal characters: ${characters?.length ?? 0}`)
  console.log(`Total SUU cards: ${totalCards}`)
  console.log(`Passing V3:      ${passCards}`)
  console.log(`Failing V3:      ${failures.length}`)

  if (failures.length > 0) {
    console.log(`\n--- Failures ---`)
    for (const f of failures) {
      console.log(`\n[${f.characterName} | ${f.characterId}] slot=${f.slot}`)
      for (const err of f.errors) {
        console.log(`  - ${err.code} @ ${err.path}: ${err.message}`)
      }
    }
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error', err)
  process.exit(1)
})
