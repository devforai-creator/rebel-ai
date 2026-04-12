import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Button, { buttonClassName } from './Button'
import EmptyState from './EmptyState'
import ErrorState from './ErrorState'
import InlineFeedback from './InlineFeedback'
import LoadingState from './LoadingState'
import SurfaceCard, { surfaceCardClassName } from './SurfaceCard'

describe('buttonClassName', () => {
  it('encodes the shared button hierarchy variants', () => {
    expect(buttonClassName()).toContain('bg-blue-600')
    expect(buttonClassName({ variant: 'secondary' })).toContain('border-gray-300')
    expect(buttonClassName({ variant: 'destructive' })).toContain('bg-red-600')
    expect(buttonClassName({ variant: 'ghost' })).toContain('hover:bg-gray-100')
    expect(buttonClassName({ variant: 'ghostDestructive' })).toContain('hover:bg-red-50')
  })

  it('supports large full-width submit buttons', () => {
    const className = buttonClassName({ size: 'lg', fullWidth: true })

    expect(className).toContain('w-full')
    expect(className).toContain('px-6')
    expect(className).toContain('py-3')
  })
})

describe('SurfaceCard', () => {
  it('renders the dashed empty-state shell', () => {
    const html = renderToStaticMarkup(
      <SurfaceCard tone="dashed" className="text-center">
        Empty state
      </SurfaceCard>,
    )

    expect(surfaceCardClassName({ tone: 'dashed' })).toContain('border-dashed')
    expect(html).toContain('text-center')
    expect(html).toContain('Empty state')
  })
})

describe('InlineFeedback', () => {
  it('uses alert semantics for error feedback', () => {
    const html = renderToStaticMarkup(<InlineFeedback tone="error">Broken</InlineFeedback>)

    expect(html).toContain('role="alert"')
    expect(html).toContain('Broken')
    expect(html).toContain('bg-red-50')
  })

  it('renders success feedback with the shared success tone', () => {
    const html = renderToStaticMarkup(
      <InlineFeedback tone="success">Saved successfully.</InlineFeedback>,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('Saved successfully.')
    expect(html).toContain('bg-green-50')
  })
})

describe('Button', () => {
  it('defaults to a non-submit button so dialog and tool actions stay explicit', () => {
    const html = renderToStaticMarkup(<Button>Click</Button>)

    expect(html).toContain('type="button"')
    expect(html).toContain('Click')
  })
})

describe('EmptyState', () => {
  it('renders the shared dashed empty-state contract with status semantics', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="Nothing here" description="Create something to get started." />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('Nothing here')
    expect(html).toContain('Create something to get started.')
    expect(html).toContain('border-dashed')
  })
})

describe('LoadingState', () => {
  it('renders the shared loading copy with a status role', () => {
    const html = renderToStaticMarkup(
      <LoadingState title="Loading data" description="Preparing the current dashboard view." />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('Loading data')
    expect(html).toContain('Preparing the current dashboard view.')
    expect(html).toContain('animate-pulse')
  })
})

describe('ErrorState', () => {
  it('renders the shared recoverable error shell with alert semantics', () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Something went wrong" description="Please try again." />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('Something went wrong')
    expect(html).toContain('Please try again.')
  })
})
