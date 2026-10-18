// @vitest-environment jsdom

import React from 'react'
import { act } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LocalTimestamp from './LocalTimestamp'

afterEach(() => vi.restoreAllMocks())
describe('LocalTimestamp', () => {
  it.each([false, true])(
    'hydrates across different server/browser time zones (dateOnly=%s)',
    async (dateOnly) => {
      const method = dateOnly ? 'toLocaleDateString' : 'toLocaleString'
      vi.spyOn(Date.prototype, method).mockImplementation((_locale, options) =>
        options?.timeZone === 'UTC' ? 'Stable server date' : 'Viewer local date',
      )
      const element = <LocalTimestamp timestamp="2026-01-01T23:00:00Z" dateOnly={dateOnly} />
      const container = document.createElement('div')
      container.innerHTML = renderToString(element)
      expect(container.textContent).toBe('Stable server date')
      const recoverableError = vi.fn()
      let root!: Root
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError: recoverableError })
      })
      expect(recoverableError).not.toHaveBeenCalled()
      expect(container.textContent).toBe('Viewer local date')
      expect(container.querySelector('time')?.dateTime).toBe('2026-01-01T23:00:00Z')
      await act(async () => root.unmount())
    },
  )
})
