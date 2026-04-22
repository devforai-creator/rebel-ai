const NORMALIZE_RULES = [
  { from: /그 때/g, to: '그때' },
  { from: /지난 번/g, to: '지난번' },
  { from: /\s+/g, to: ' ' },
] as const

const OLDER_PAST_REFERENCE_PATTERNS = [
  /지난번/,
  /그때/,
  /전에/,
  /이전에/,
  /예전에/,
  /첫\s*만남/,
  /처음\s*만났/,
  /오래전/,
]

const EXACT_RECALL_PATTERNS = [
  /뭐라고\s*했/,
  /무슨\s*말\s*했/,
  /그대로/,
  /원문/,
  /인용/,
  /정확히/,
  /정확한/,
  /다시\s*말해/,
  /기억해/,
  /기억나/,
]

const FIRST_OR_LAST_OCCURRENCE_PATTERNS = [
  /처음에/,
  /처음\s*(고백|사과|화해|약속|입맞춤|키스|인사|대화|손\s*잡|불렀|부른|말했|말한)/,
  /첫\s*(고백|사과|화해|약속|입맞춤|키스|인사|대화|장면|애칭|호칭|별명)/,
  /마지막에/,
  /마지막\s*(고백|사과|화해|약속|대화|장면|부분|말|인사|애칭|호칭|별명)/,
  /끝부분/,
  /끝에/,
]

const PROMISE_OR_BOUNDARY_PATTERNS = [
  /약속/,
  /비밀/,
  /조건/,
  /하지\s*말라/,
  /선\s*넘/,
  /경계/,
  /애칭/,
  /호칭/,
  /별명/,
  /고백/,
  /사과/,
  /화해/,
]

const CONTRADICTION_PATTERNS = [
  /말이\s*다르/,
  /말이\s*다른/,
  /모순/,
  /앞뒤가\s*안\s*맞/,
  /기억\s*못\s*하/,
  /헷갈/,
  /설정\s*충돌/,
]

const OLDER_SCENE_ANCHOR_PATTERNS = [/그\s*장면/, /그\s*사건/, /그\s*일/, /그\s*순간/, /그날/]

const RELATION_TURNING_POINT_PATTERNS = [
  /왜\s*화났/,
  /왜\s*화난/,
  /왜\s*화해/,
  /언제\s*고백/,
  /언제\s*사과/,
  /어떻게\s*화해/,
  /왜\s*멀어졌/,
  /왜\s*가까워졌/,
]

const RESET_OR_NEW_AU_PATTERNS = [
  /다시\s*시작/,
  /리셋/,
  /초기화/,
  /처음부터/,
  /처음\s*만나는\s*설정/,
  /첫만남\s*설정/,
  /새\s*au/i,
  /현대\s*au/i,
  /학교\s*au/i,
  /카페\s*au/i,
  /기억\s*없이/,
]

const STYLE_ONLY_PATTERNS = [
  /더\s*다정하게/,
  /더\s*차갑게/,
  /더\s*집착하/,
  /더\s*질투하/,
  /말투/,
  /톤/,
  /분위기/,
]

const IMMEDIATE_CONTINUATION_PATTERNS = [
  /방금/,
  /이어서/,
  /계속해/,
  /더\s*풀어/,
  /다시\s*한번/,
  /조금\s*더/,
  /그\s*말\s*다시/,
]

export type AgenticTranscriptRecallToolChoiceGateInput = {
  lastUserMessage: string | null
  lastAssistantMessage: string | null
  hasOlderSourceHints: boolean
  hasToolCapableSourceMap: boolean
}

export type AgenticTranscriptRecallToolChoiceGateDecision = {
  toolChoice: 'auto' | 'required'
  score: number
  matchedRuleIds: string[]
  blockedRuleIds: string[]
  source: 'heuristic'
  version: 'character-chat-v1-aggressive'
}

function normalizeText(text: string | null | undefined): string {
  let normalized = text?.trim() ?? ''
  for (const rule of NORMALIZE_RULES) {
    normalized = normalized.replace(rule.from, rule.to)
  }
  return normalized.trim()
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

export function decideAgenticTranscriptRecallToolChoice(
  input: AgenticTranscriptRecallToolChoiceGateInput,
): AgenticTranscriptRecallToolChoiceGateDecision {
  const lastUserMessage = normalizeText(input.lastUserMessage)
  const lastAssistantMessage = normalizeText(input.lastAssistantMessage)
  const blockedRuleIds: string[] = []

  if (!lastUserMessage) {
    blockedRuleIds.push('NO_LAST_USER_MESSAGE')
  }

  if (!input.hasOlderSourceHints) {
    blockedRuleIds.push('NO_OLDER_SOURCE_HINTS')
  }

  if (!input.hasToolCapableSourceMap) {
    blockedRuleIds.push('NO_TOOL_CAPABLE_SOURCE_MAP')
  }

  if (blockedRuleIds.length > 0) {
    return {
      toolChoice: 'auto',
      score: 0,
      matchedRuleIds: [],
      blockedRuleIds,
      source: 'heuristic',
      version: 'character-chat-v1-aggressive',
    }
  }

  const isResetOrNewAu = hasAny(lastUserMessage, RESET_OR_NEW_AU_PATTERNS)
  const isStyleOnly = hasAny(lastUserMessage, STYLE_ONLY_PATTERNS)
  const isImmediateContinuation = hasAny(lastUserMessage, IMMEDIATE_CONTINUATION_PATTERNS)
  const hasOlderPastReference = hasAny(lastUserMessage, OLDER_PAST_REFERENCE_PATTERNS)
  const hasExactRecall = hasAny(lastUserMessage, EXACT_RECALL_PATTERNS)
  const hasFirstOrLastOccurrence = hasAny(lastUserMessage, FIRST_OR_LAST_OCCURRENCE_PATTERNS)
  const hasPromiseOrBoundary = hasAny(lastUserMessage, PROMISE_OR_BOUNDARY_PATTERNS)
  const hasOlderSceneAnchor = hasAny(lastUserMessage, OLDER_SCENE_ANCHOR_PATTERNS)
  const hasRelationTurningPoint = hasAny(lastUserMessage, RELATION_TURNING_POINT_PATTERNS)
  const hasOlderContradiction =
    hasAny(lastUserMessage, CONTRADICTION_PATTERNS) && hasOlderPastReference
  const hasOlderRecallAnchor =
    hasOlderPastReference ||
    hasFirstOrLastOccurrence ||
    hasOlderSceneAnchor ||
    hasRelationTurningPoint

  if (
    isResetOrNewAu &&
    !hasOlderRecallAnchor &&
    !hasExactRecall &&
    !hasPromiseOrBoundary &&
    !hasOlderContradiction
  ) {
    return {
      toolChoice: 'auto',
      score: 0,
      matchedRuleIds: [],
      blockedRuleIds: ['RESET_OR_NEW_AU'],
      source: 'heuristic',
      version: 'character-chat-v1-aggressive',
    }
  }

  if (
    isStyleOnly &&
    !hasExactRecall &&
    !hasPromiseOrBoundary &&
    !hasOlderContradiction &&
    !hasOlderRecallAnchor
  ) {
    return {
      toolChoice: 'auto',
      score: 0,
      matchedRuleIds: [],
      blockedRuleIds: ['PURE_STYLE_ONLY'],
      source: 'heuristic',
      version: 'character-chat-v1-aggressive',
    }
  }

  if (
    !!lastAssistantMessage &&
    isImmediateContinuation &&
    !hasOlderRecallAnchor &&
    !hasPromiseOrBoundary &&
    !hasOlderContradiction
  ) {
    return {
      toolChoice: 'auto',
      score: 0,
      matchedRuleIds: [],
      blockedRuleIds: ['IMMEDIATE_CONTINUATION'],
      source: 'heuristic',
      version: 'character-chat-v1-aggressive',
    }
  }

  const matchedRuleIds: string[] = []
  let score = 0

  if (hasOlderPastReference) {
    matchedRuleIds.push('OLDER_PAST_REFERENCE')
    score += 2
  }

  if (hasFirstOrLastOccurrence) {
    matchedRuleIds.push('FIRST_OR_LAST_OCCURRENCE')
    score += 2
  }

  if (hasExactRecall) {
    matchedRuleIds.push('EXACT_RECALL')
    score += 3
  }

  if (hasPromiseOrBoundary) {
    matchedRuleIds.push('PROMISE_OR_BOUNDARY')
    score += 2
  }

  if (hasOlderSceneAnchor) {
    matchedRuleIds.push('OLDER_SCENE_ANCHOR')
    score += 2
  }

  if (hasRelationTurningPoint) {
    matchedRuleIds.push('RELATION_TURNING_POINT')
    score += 2
  }

  if (hasOlderContradiction) {
    matchedRuleIds.push('OLDER_CONTRADICTION')
    score += 3
  }

  return {
    toolChoice: hasOlderRecallAnchor && score >= 4 ? 'required' : 'auto',
    score,
    matchedRuleIds,
    blockedRuleIds: [],
    source: 'heuristic',
    version: 'character-chat-v1-aggressive',
  }
}
