import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Button, { buttonClassName } from './Button'
import InlineFeedback from './InlineFeedback'
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
