import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LoginPage from './page'

describe('login page', () => {
  it('links to the closed-signup status instead of implying open registration', () => {
    const html = renderToStaticMarkup(<LoginPage />)

    expect(html).toContain('Need access or checking signup status?')
    expect(html).toContain('View Sign-up Status')
    expect(html).not.toContain('Don&#x27;t have an account?')
  })
})
