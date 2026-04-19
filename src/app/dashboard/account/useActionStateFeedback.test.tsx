// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { resolveActionStateFeedback, useActionStateFeedback } from './useActionStateFeedback'

describe('resolveActionStateFeedback', () => {
  it('prefers error feedback over success feedback', () => {
    expect(
      resolveActionStateFeedback(
        {
          error: 'Save failed',
          success: true,
        },
        { successMessage: 'Saved successfully.' },
      ),
    ).toEqual({
      message: 'Save failed',
      tone: 'error',
    })
  })

  it('returns a success message when the action succeeds', () => {
    expect(
      resolveActionStateFeedback(
        {
          error: null,
          success: true,
        },
        { successMessage: 'Saved successfully.' },
      ),
    ).toEqual({
      message: 'Saved successfully.',
      tone: 'success',
    })
  })

  it('returns null when there is no feedback to show', () => {
    expect(
      resolveActionStateFeedback(
        {
          error: null,
          success: false,
        },
        { successMessage: 'Saved successfully.' },
      ),
    ).toBeNull()
  })
})

describe('useActionStateFeedback', () => {
  it('hides dismissed feedback until the action state changes', () => {
    const { result, rerender } = renderHook(
      ({ error, success }) =>
        useActionStateFeedback(
          {
            error,
            success,
          },
          { successMessage: 'Saved successfully.' },
        ),
      {
        initialProps: {
          error: null as string | null,
          success: true,
        },
      },
    )

    expect(result.current.feedback).toEqual({
      message: 'Saved successfully.',
      tone: 'success',
    })

    act(() => {
      result.current.clearFeedback()
    })

    expect(result.current.feedback).toBeNull()

    rerender({
      error: 'Save failed',
      success: false,
    })

    expect(result.current.feedback).toEqual({
      message: 'Save failed',
      tone: 'error',
    })
  })
})
