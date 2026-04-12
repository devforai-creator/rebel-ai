import { describe, expect, it, vi } from 'vitest'

import { runConfirmedAction } from './confirm-action'

describe('runConfirmedAction', () => {
  it('short-circuits without invoking the action when nothing is pending', async () => {
    const action = vi.fn()

    await expect(runConfirmedAction<string>(null, action)).resolves.toBe(false)
    expect(action).not.toHaveBeenCalled()
  })

  it('invokes the action when a pending value exists', async () => {
    const action = vi.fn()

    await expect(runConfirmedAction('summary-1', action)).resolves.toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith('summary-1')
  })
})
