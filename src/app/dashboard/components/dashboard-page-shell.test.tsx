import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DashboardCallout,
  DashboardPageShell,
  DashboardSectionHeading,
  dashboardPageBackgroundClassName,
  dashboardPageShellContentClassName,
} from './DashboardPageShell'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

describe('DashboardPageShell', () => {
  it('renders the shared page background, back link, and hero contract', () => {
    const html = renderToStaticMarkup(
      <DashboardPageShell
        title="Character Management"
        eyebrow="Library"
        description="Build personas and simulations."
        actions={<button type="button">Action</button>}
      >
        <div>Body</div>
      </DashboardPageShell>,
    )

    expect(dashboardPageBackgroundClassName).toContain('radial-gradient')
    expect(dashboardPageShellContentClassName('wide')).toContain('max-w-7xl')
    expect(html).toContain('Back to Dashboard')
    expect(html).toContain('Character Management')
    expect(html).toContain('Build personas and simulations.')
    expect(html).toContain('Action')
    expect(html).toContain('Body')
  })
})

describe('DashboardSectionHeading', () => {
  it('renders section title, badge, and actions with the shared hierarchy', () => {
    const html = renderToStaticMarkup(
      <DashboardSectionHeading
        title="Get Started"
        badge="Recommended"
        description="Ready-to-use entries."
        actions={<button type="button">Review</button>}
      />,
    )

    expect(html).toContain('Get Started')
    expect(html).toContain('Recommended')
    expect(html).toContain('Ready-to-use entries.')
    expect(html).toContain('Review')
  })
})

describe('DashboardCallout', () => {
  it('renders the shared callout chrome for visual direction anchors', () => {
    const html = renderToStaticMarkup(
      <DashboardCallout tone="info" eyebrow="Entry Paths" title="Bring your own keys">
        <ul>
          <li>Provider setup</li>
        </ul>
      </DashboardCallout>,
    )

    expect(html).toContain('Entry Paths')
    expect(html).toContain('Bring your own keys')
    expect(html).toContain('Provider setup')
    expect(html).toContain('border-sky-200/80')
  })
})
