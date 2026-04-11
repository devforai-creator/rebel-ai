import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import SignupPage from './page'

describe('signup page', () => {
  it('renders a closed-signup notice instead of a dormant registration form', () => {
    const html = renderToStaticMarkup(<SignupPage />)

    expect(html).toContain('Sign-up Closed')
    expect(html).toContain('New registrations are temporarily suspended')
    expect(html).toContain('Supabase Dashboard')
    expect(html).not.toContain('Display Name')
    expect(html).not.toContain('Registration Suspended')
  })
})
