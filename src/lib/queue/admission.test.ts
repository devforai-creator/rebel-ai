import { describe, expect, it } from 'vitest'
import {
  getChatSubmissionValidationMessage,
  isActiveChatJobConflict,
  isChatJobUserLimitViolation,
  isChatSubmissionNotFound,
} from './admission'

describe('chat queue admission error mapping', () => {
  it('recognizes only the active-chat constraint as a submission conflict', () => {
    expect(
      isActiveChatJobConflict({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "chat_generation_jobs_active_chat_idx"',
      }),
    ).toBe(true)

    expect(
      isActiveChatJobConflict({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "chat_turns_chat_id_turn_index_key"',
      }),
    ).toBe(false)
  })

  it('does not treat unrelated application exceptions as a user queue limit', () => {
    expect(
      isChatJobUserLimitViolation({
        code: 'P0001',
        message: 'User already has 3 active chat generation jobs',
      }),
    ).toBe(true)

    expect(
      isChatJobUserLimitViolation({
        code: 'P0001',
        message: 'Some other application exception',
      }),
    ).toBe(false)
  })

  it('maps only the stable not-found and regeneration errors', () => {
    expect(isChatSubmissionNotFound({ code: 'P0002', message: 'Chat not found' })).toBe(true)
    expect(isChatSubmissionNotFound({ code: 'P0002', message: 'Other row not found' })).toBe(false)

    expect(
      getChatSubmissionValidationMessage({
        code: '22023',
        message: 'Invalid regeneration target',
      }),
    ).toBe('Invalid regeneration target')
    expect(
      getChatSubmissionValidationMessage({
        code: '22023',
        message: 'Only the latest assistant message can be regenerated',
      }),
    ).toBe('Only the latest assistant message can be regenerated')
    expect(
      getChatSubmissionValidationMessage({
        code: '22023',
        message: 'Invalid chat submission',
      }),
    ).toBeNull()
  })
})
