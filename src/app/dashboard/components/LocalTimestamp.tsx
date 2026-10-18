'use client'

import React, { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export default function LocalTimestamp({
  timestamp,
  dateOnly = false,
}: {
  timestamp: string
  dateOnly?: boolean
}) {
  // Hydrate with the same UTC text as the server, then show the viewer's time.
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  const date = new Date(timestamp)
  const options = hydrated ? undefined : { timeZone: 'UTC' }
  return (
    <time dateTime={timestamp}>
      {dateOnly ? date.toLocaleDateString('en-US', options) : date.toLocaleString('en-US', options)}
    </time>
  )
}
