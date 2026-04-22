import { describe, expect, it } from 'vitest'
import { decideAgenticTranscriptRecallToolChoice } from './tool-choice-gate'

describe('decideAgenticTranscriptRecallToolChoice', () => {
  it('forces required tool choice for older exact promise recall', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '지난번에 한 약속 정확히 다시 말해줘.',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 7,
      matchedRuleIds: ['OLDER_PAST_REFERENCE', 'EXACT_RECALL', 'PROMISE_OR_BOUNDARY'],
      blockedRuleIds: [],
      source: 'heuristic',
      version: 'character-chat-v0',
    })
  })

  it('forces required tool choice for older contradiction checks', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '그때 한 말이랑 지금 말이 다른데 뭐가 맞아?',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 5,
      matchedRuleIds: ['OLDER_PAST_REFERENCE', 'OLDER_CONTRADICTION'],
      blockedRuleIds: [],
    })
  })

  it('defers reset or new-au prompts even when ATR tools are available', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '이번엔 현대 AU로 다시 시작하자.',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'auto',
      score: 0,
      matchedRuleIds: [],
      blockedRuleIds: ['RESET_OR_NEW_AU'],
    })
  })

  it('defers immediate continuation requests that do not point to older detail', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '방금 그 말 다시 해줘.',
      lastAssistantMessage: '조용히 손을 내민다.',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'auto',
      score: 0,
      matchedRuleIds: [],
      blockedRuleIds: ['IMMEDIATE_CONTINUATION'],
    })
  })
})
