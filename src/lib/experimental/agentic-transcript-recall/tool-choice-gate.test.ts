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
      version: 'character-chat-v1-aggressive',
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

  it('forces required tool choice for older promise recall without explicit exact-wording cues', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '지난번 애칭 뭐였어?',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 4,
      matchedRuleIds: ['OLDER_PAST_REFERENCE', 'PROMISE_OR_BOUNDARY'],
      blockedRuleIds: [],
    })
  })

  it('forces required tool choice for first-turning-point exact recall', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '처음 고백할 때 뭐라고 했어?',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 7,
      matchedRuleIds: ['FIRST_OR_LAST_OCCURRENCE', 'EXACT_RECALL', 'PROMISE_OR_BOUNDARY'],
      blockedRuleIds: [],
    })
  })

  it('forces required tool choice for older scene-anchor promise recall', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '그 장면에서 한 약속 뭐였지?',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 4,
      matchedRuleIds: ['PROMISE_OR_BOUNDARY', 'OLDER_SCENE_ANCHOR'],
      blockedRuleIds: [],
    })
  })

  it('forces required tool choice for last relation-turning-point checks', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '마지막에 왜 화해했어?',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 6,
      matchedRuleIds: ['FIRST_OR_LAST_OCCURRENCE', 'PROMISE_OR_BOUNDARY', 'RELATION_TURNING_POINT'],
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

  it('does not block older exact recall just because the quoted moment mentions starting over', () => {
    const decision = decideAgenticTranscriptRecallToolChoice({
      lastUserMessage: '지난번에 다시 시작하자고 한 말 정확히 다시 말해줘.',
      lastAssistantMessage: '...',
      hasOlderSourceHints: true,
      hasToolCapableSourceMap: true,
    })

    expect(decision).toMatchObject({
      toolChoice: 'required',
      score: 5,
      matchedRuleIds: ['OLDER_PAST_REFERENCE', 'EXACT_RECALL'],
      blockedRuleIds: [],
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
