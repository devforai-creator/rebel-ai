#!/usr/bin/env node

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
const process = require('node:process')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')

const DEFAULT_OUTPUT_PATH = resolve(
  process.cwd(),
  'docs',
  'reviews',
  'experimental-agentic-transcript-recall-eval-report.md',
)

function loadEnv() {
  dotenv.config({ path: resolve(process.cwd(), '.env.local') })
  dotenv.config()
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const result = {
    fixturePath: null,
    outputPath: DEFAULT_OUTPUT_PATH,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--output') {
      result.outputPath = resolve(process.cwd(), args[index + 1] ?? '')
      index += 1
      continue
    }

    if (!result.fixturePath) {
      result.fixturePath = resolve(process.cwd(), arg)
      continue
    }

    throw new Error(`Unexpected argument: ${arg}`)
  }

  if (!result.fixturePath) {
    throw new Error(
      'Missing fixture path. Usage: node scripts/run-agentic-transcript-recall-eval.js <fixture.json> [--output <report.md>]',
    )
  }

  return result
}

function parseFixture(jsonText) {
  const parsed = JSON.parse(jsonText)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Eval fixture must be a JSON object.')
  }

  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error('Eval fixture must contain a non-empty `cases` array.')
  }

  return parsed
}

function createSupabaseFromEnv() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.')
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function readRequestIdFromDebugInfo(debugInfo) {
  return debugInfo && typeof debugInfo === 'object' && typeof debugInfo.requestId === 'string'
    ? debugInfo.requestId
    : null
}

function normalizeExperimentalRecall(debugInfo) {
  const experimental =
    debugInfo &&
    typeof debugInfo === 'object' &&
    debugInfo.experimental &&
    typeof debugInfo.experimental === 'object'
      ? debugInfo.experimental
      : null
  const recall =
    experimental &&
    experimental.agenticTranscriptRecall &&
    typeof experimental.agenticTranscriptRecall === 'object'
      ? experimental.agenticTranscriptRecall
      : null

  return {
    configured: typeof recall?.configured === 'boolean' ? recall.configured : null,
    enabled: typeof recall?.enabled === 'boolean' ? recall.enabled : null,
    wrapperUsed: typeof recall?.wrapperUsed === 'boolean' ? recall.wrapperUsed : null,
    fallbackToStandard:
      typeof recall?.fallbackToStandard === 'boolean' ? recall.fallbackToStandard : null,
    toolCallCount: Number.isFinite(recall?.toolCallCount) ? recall.toolCallCount : null,
    toolFetchCount: Number.isFinite(recall?.toolFetchCount) ? recall.toolFetchCount : null,
    toolBlockCount: Number.isFinite(recall?.toolBlockCount) ? recall.toolBlockCount : null,
    toolTotalMessagesFetched: Number.isFinite(recall?.toolTotalMessagesFetched)
      ? recall.toolTotalMessagesFetched
      : null,
    toolLastBlockReason:
      typeof recall?.toolLastBlockReason === 'string' ? recall.toolLastBlockReason : null,
  }
}

function extractRunSummary(messageRow, usageEventRow) {
  const debugInfo = messageRow.debug_info ?? null
  const requestId = readRequestIdFromDebugInfo(debugInfo)
  const promptTokens =
    typeof messageRow.prompt_tokens === 'number'
      ? messageRow.prompt_tokens
      : typeof usageEventRow?.prompt_tokens === 'number'
        ? usageEventRow.prompt_tokens
        : null
  const completionTokens =
    typeof messageRow.completion_tokens === 'number'
      ? messageRow.completion_tokens
      : typeof usageEventRow?.completion_tokens === 'number'
        ? usageEventRow.completion_tokens
        : null
  const totalTokens =
    promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null

  return {
    messageId: messageRow.id,
    chatId: messageRow.chat_id,
    requestId,
    createdAt: messageRow.created_at ?? null,
    latencyMs: typeof messageRow.latency_ms === 'number' ? messageRow.latency_ms : null,
    promptTokens,
    completionTokens,
    totalTokens,
    totalCostUsd:
      typeof usageEventRow?.total_cost_usd === 'number' ? usageEventRow.total_cost_usd : null,
    finishReason:
      debugInfo &&
      typeof debugInfo === 'object' &&
      debugInfo.modelConfig &&
      typeof debugInfo.modelConfig === 'object' &&
      typeof debugInfo.modelConfig.finishReason === 'string'
        ? debugInfo.modelConfig.finishReason
        : null,
    experimentalRecall: normalizeExperimentalRecall(debugInfo),
    content: messageRow.content,
  }
}

function formatNullableNumber(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
}

function formatNullableInteger(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : 'n/a'
}

function summarizePair({ baseline, experimental }) {
  const totalCostDeltaRaw =
    baseline.totalCostUsd !== null && experimental.totalCostUsd !== null
      ? experimental.totalCostUsd - baseline.totalCostUsd
      : null

  return {
    latencyDeltaMs:
      baseline.latencyMs !== null && experimental.latencyMs !== null
        ? experimental.latencyMs - baseline.latencyMs
        : null,
    tokenDelta:
      baseline.totalTokens !== null && experimental.totalTokens !== null
        ? experimental.totalTokens - baseline.totalTokens
        : null,
    totalCostDeltaUsd: totalCostDeltaRaw !== null ? Number(totalCostDeltaRaw.toFixed(6)) : null,
  }
}

function accumulateSummary(cases) {
  const summary = {
    caseCount: cases.length,
    latencyDeltaMsValues: [],
    tokenDeltaValues: [],
    totalCostDeltaValues: [],
    baselineWins: 0,
    experimentalWins: 0,
    ties: 0,
    undecided: 0,
    experimentalFallbackCount: 0,
    experimentalFetchCaseCount: 0,
    experimentalBlockedCaseCount: 0,
  }

  for (const entry of cases) {
    if (typeof entry.comparison.latencyDeltaMs === 'number') {
      summary.latencyDeltaMsValues.push(entry.comparison.latencyDeltaMs)
    }
    if (typeof entry.comparison.tokenDelta === 'number') {
      summary.tokenDeltaValues.push(entry.comparison.tokenDelta)
    }
    if (typeof entry.comparison.totalCostDeltaUsd === 'number') {
      summary.totalCostDeltaValues.push(entry.comparison.totalCostDeltaUsd)
    }

    if (entry.qualityWinner === 'baseline') {
      summary.baselineWins += 1
    } else if (entry.qualityWinner === 'experimental') {
      summary.experimentalWins += 1
    } else if (entry.qualityWinner === 'tie') {
      summary.ties += 1
    } else {
      summary.undecided += 1
    }

    if (entry.experimental.experimentalRecall.fallbackToStandard === true) {
      summary.experimentalFallbackCount += 1
    }
    if ((entry.experimental.experimentalRecall.toolFetchCount ?? 0) > 0) {
      summary.experimentalFetchCaseCount += 1
    }
    if ((entry.experimental.experimentalRecall.toolBlockCount ?? 0) > 0) {
      summary.experimentalBlockedCaseCount += 1
    }
  }

  return {
    caseCount: summary.caseCount,
    baselineWins: summary.baselineWins,
    experimentalWins: summary.experimentalWins,
    ties: summary.ties,
    undecided: summary.undecided,
    experimentalFallbackCount: summary.experimentalFallbackCount,
    experimentalFetchCaseCount: summary.experimentalFetchCaseCount,
    experimentalBlockedCaseCount: summary.experimentalBlockedCaseCount,
    avgLatencyDeltaMs:
      summary.latencyDeltaMsValues.length > 0
        ? summary.latencyDeltaMsValues.reduce((sum, value) => sum + value, 0) /
          summary.latencyDeltaMsValues.length
        : null,
    avgTokenDelta:
      summary.tokenDeltaValues.length > 0
        ? summary.tokenDeltaValues.reduce((sum, value) => sum + value, 0) /
          summary.tokenDeltaValues.length
        : null,
    avgTotalCostDeltaUsd:
      summary.totalCostDeltaValues.length > 0
        ? summary.totalCostDeltaValues.reduce((sum, value) => sum + value, 0) /
          summary.totalCostDeltaValues.length
        : null,
  }
}

function renderReport({ title, generatedAt, fixturePath, cases, summary }) {
  const lines = [
    '# Experimental Transcript Recall Eval Report',
    '',
    `- Generated: ${generatedAt}`,
    `- Fixture: \`${fixturePath}\``,
  ]

  if (title) {
    lines.push(`- Title: ${title}`)
  }

  lines.push(
    '',
    '## Summary',
    '',
    `- Cases: ${summary.caseCount}`,
    `- Quality winners: baseline ${summary.baselineWins}, experimental ${summary.experimentalWins}, tie ${summary.ties}, undecided ${summary.undecided}`,
    `- Avg latency delta (experimental - baseline): ${formatNullableNumber(summary.avgLatencyDeltaMs)} ms`,
    `- Avg token delta (experimental - baseline): ${formatNullableNumber(summary.avgTokenDelta, 0)}`,
    `- Avg total-cost delta (experimental - baseline): $${formatNullableNumber(summary.avgTotalCostDeltaUsd, 6)}`,
    `- Experimental fallback frequency: ${summary.experimentalFallbackCount}/${summary.caseCount}`,
    `- Experimental fetch frequency: ${summary.experimentalFetchCaseCount}/${summary.caseCount}`,
    `- Experimental blocked-call frequency: ${summary.experimentalBlockedCaseCount}/${summary.caseCount}`,
    '',
    '## Cases',
    '',
  )

  for (const entry of cases) {
    lines.push(
      `### ${entry.caseId}`,
      '',
      `- Focus: ${entry.focus}`,
      `- Quality winner: ${entry.qualityWinner}`,
      `- Quality notes: ${entry.qualityNotes || 'n/a'}`,
      `- Baseline message: \`${entry.baseline.messageId}\``,
      `- Baseline latency/tokens/cost: ${formatNullableInteger(entry.baseline.latencyMs)} ms / ${formatNullableInteger(entry.baseline.totalTokens)} / $${formatNullableNumber(entry.baseline.totalCostUsd, 6)}`,
      `- Experimental message: \`${entry.experimental.messageId}\``,
      `- Experimental latency/tokens/cost: ${formatNullableInteger(entry.experimental.latencyMs)} ms / ${formatNullableInteger(entry.experimental.totalTokens)} / $${formatNullableNumber(entry.experimental.totalCostUsd, 6)}`,
      `- Experimental recall: wrapperUsed=${String(entry.experimental.experimentalRecall.wrapperUsed)}, fallback=${String(entry.experimental.experimentalRecall.fallbackToStandard)}, toolCalls=${formatNullableInteger(entry.experimental.experimentalRecall.toolCallCount)}, toolFetches=${formatNullableInteger(entry.experimental.experimentalRecall.toolFetchCount)}, toolBlocks=${formatNullableInteger(entry.experimental.experimentalRecall.toolBlockCount)}, fetchedMessages=${formatNullableInteger(entry.experimental.experimentalRecall.toolTotalMessagesFetched)}, lastBlockReason=${entry.experimental.experimentalRecall.toolLastBlockReason ?? 'n/a'}`,
      `- Deltas: latency ${formatNullableNumber(entry.comparison.latencyDeltaMs)} ms, tokens ${formatNullableNumber(entry.comparison.tokenDelta, 0)}, total cost $${formatNullableNumber(entry.comparison.totalCostDeltaUsd, 6)}`,
      '',
    )
  }

  lines.push(
    '## Decision',
    '',
    '- keep / iterate / park: TBD',
    '- rationale: fill this after reviewing the case-by-case results above.',
    '',
  )

  return lines.join('\n')
}

async function fetchRowsForEval(supabase, fixture) {
  const messageIds = fixture.cases.flatMap((entry) => [
    entry.baselineMessageId,
    entry.experimentalMessageId,
  ])

  const { data: messages, error: messageError } = await supabase
    .from('messages')
    .select(
      'id, chat_id, content, prompt_tokens, completion_tokens, latency_ms, debug_info, created_at',
    )
    .in('id', messageIds)

  if (messageError) {
    throw new Error(`Failed to load eval messages: ${messageError.message}`)
  }

  const messageMap = new Map((messages ?? []).map((row) => [row.id, row]))
  for (const messageId of messageIds) {
    if (!messageMap.has(messageId)) {
      throw new Error(`Fixture references missing message id: ${messageId}`)
    }
  }

  const requestIds = Array.from(
    new Set(
      (messages ?? [])
        .map((row) => readRequestIdFromDebugInfo(row.debug_info))
        .filter((value) => typeof value === 'string' && value.length > 0),
    ),
  )

  const usageEventMap = new Map()
  if (requestIds.length > 0) {
    const { data: usageEvents, error: usageError } = await supabase
      .from('chat_usage_events')
      .select(
        'request_id, prompt_tokens, completion_tokens, total_tokens, total_cost_usd, cached_input_cost_usd, prompt_cost_usd, completion_cost_usd, reasoning_cost_usd',
      )
      .in('request_id', requestIds)

    if (usageError) {
      throw new Error(`Failed to load eval usage events: ${usageError.message}`)
    }

    for (const row of usageEvents ?? []) {
      usageEventMap.set(row.request_id, row)
    }
  }

  return { messageMap, usageEventMap }
}

async function buildEvalCases({ fixture, supabase }) {
  const { messageMap, usageEventMap } = await fetchRowsForEval(supabase, fixture)

  return fixture.cases.map((entry) => {
    const baselineMessage = messageMap.get(entry.baselineMessageId)
    const experimentalMessage = messageMap.get(entry.experimentalMessageId)
    const baselineRequestId = readRequestIdFromDebugInfo(baselineMessage.debug_info)
    const experimentalRequestId = readRequestIdFromDebugInfo(experimentalMessage.debug_info)

    const baseline = extractRunSummary(
      baselineMessage,
      baselineRequestId ? (usageEventMap.get(baselineRequestId) ?? null) : null,
    )
    const experimental = extractRunSummary(
      experimentalMessage,
      experimentalRequestId ? (usageEventMap.get(experimentalRequestId) ?? null) : null,
    )

    return {
      caseId: entry.caseId,
      focus: entry.focus,
      qualityWinner: entry.qualityWinner ?? 'undecided',
      qualityNotes: entry.qualityNotes ?? '',
      baseline,
      experimental,
      comparison: summarizePair({ baseline, experimental }),
    }
  })
}

async function main() {
  loadEnv()
  const { fixturePath, outputPath } = parseArgs(process.argv)

  if (!existsSync(fixturePath)) {
    throw new Error(`Missing eval fixture: ${fixturePath}`)
  }

  const fixture = parseFixture(readFileSync(fixturePath, 'utf8'))
  const supabase = createSupabaseFromEnv()
  const cases = await buildEvalCases({ fixture, supabase })
  const summary = accumulateSummary(cases)
  const report = renderReport({
    title: fixture.title ?? null,
    generatedAt: new Date().toISOString(),
    fixturePath,
    cases,
    summary,
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, report, 'utf8')
  process.stdout.write(`${report}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[agentic-transcript-recall-eval] failed')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  accumulateSummary,
  extractRunSummary,
  formatNullableInteger,
  formatNullableNumber,
  normalizeExperimentalRecall,
  parseArgs,
  parseFixture,
  readRequestIdFromDebugInfo,
  renderReport,
  summarizePair,
}
