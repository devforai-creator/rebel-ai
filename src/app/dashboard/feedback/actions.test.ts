import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

type DbError = { message: string; code?: string | null }

type FeedbackSupabaseOptions = {
  user?: { id: string } | null
  insertError?: DbError | null
}

function buildFeedbackFormData(
  overrides: Partial<{
    message: string
    sourcePage: string
    omitMessage: boolean
    omitSourcePage: boolean
  }> = {},
) {
  const formData = new FormData()

  if (!overrides.omitMessage) {
    formData.set('message', overrides.message ?? 'Feedback about a bug')
  }

  if (!overrides.omitSourcePage) {
    formData.set('source_page', overrides.sourcePage ?? '/dashboard')
  }

  return formData
}

function buildSupabase(options: FeedbackSupabaseOptions = {}) {
  const user = options.user === undefined ? { id: 'user-1' } : options.user
  const state = {
    insertPayloads: [] as Array<Record<string, unknown>>,
  }

  return {
    state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
    from(table: string) {
      if (table === 'user_feedback') {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            state.insertPayloads.push(payload)
            return { error: options.insertError ?? null }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

const INITIAL_STATE = {
  error: null,
  success: false,
}

describe('feedback actions', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    consoleErrorSpy.mockClear()
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns login required when unauthenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }))
    const { submitFeedback } = await import('./actions')

    const result = await submitFeedback(INITIAL_STATE, buildFeedbackFormData())

    expect(result).toEqual({
      error: 'Login required.',
      success: false,
    })
  })

  it('returns a validation error when the message field is missing', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { submitFeedback } = await import('./actions')

    const result = await submitFeedback(
      INITIAL_STATE,
      buildFeedbackFormData({
        omitMessage: true,
      }),
    )

    expect(result).toEqual({
      error: 'Please enter feedback.',
      success: false,
    })
    expect(supabase.state.insertPayloads).toHaveLength(0)
  })

  it('returns a validation error when the message is blank after trimming', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { submitFeedback } = await import('./actions')

    const result = await submitFeedback(
      INITIAL_STATE,
      buildFeedbackFormData({
        message: '   ',
      }),
    )

    expect(result).toEqual({
      error: 'Please write feedback content.',
      success: false,
    })
    expect(supabase.state.insertPayloads).toHaveLength(0)
  })

  it('returns a validation error when the message exceeds the maximum length', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { submitFeedback } = await import('./actions')

    const result = await submitFeedback(
      INITIAL_STATE,
      buildFeedbackFormData({
        message: 'a'.repeat(501),
      }),
    )

    expect(result).toEqual({
      error: 'Feedback must be 500 characters or less.',
      success: false,
    })
    expect(supabase.state.insertPayloads).toHaveLength(0)
  })

  it('persists trimmed feedback with a normalized source page', async () => {
    const supabase = buildSupabase()
    createClientMock.mockResolvedValue(supabase)
    const { submitFeedback } = await import('./actions')

    const result = await submitFeedback(
      INITIAL_STATE,
      buildFeedbackFormData({
        message: '  The first reply duplicated after refresh.  ',
        sourcePage: `  /dashboard/${'x'.repeat(200)}  `,
      }),
    )

    expect(result).toEqual({
      error: null,
      success: true,
    })
    expect(supabase.state.insertPayloads).toEqual([
      {
        user_id: 'user-1',
        message: 'The first reply duplicated after refresh.',
        source_page: `/dashboard/${'x'.repeat(109)}`,
      },
    ])
  })

  it('returns a persistence error when inserting feedback fails', async () => {
    const supabase = buildSupabase({
      insertError: { message: 'insert failed', code: 'XX000' },
    })
    createClientMock.mockResolvedValue(supabase)
    const { submitFeedback } = await import('./actions')

    const result = await submitFeedback(INITIAL_STATE, buildFeedbackFormData())

    expect(result).toEqual({
      error: 'Failed to save feedback. Please try again later.',
      success: false,
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[feedback] failed to insert', {
      message: 'insert failed',
      code: 'XX000',
    })
  })
})
