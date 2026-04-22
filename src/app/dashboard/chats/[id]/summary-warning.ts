export type SummaryWarningInfo = {
  error: string | null
  attempts: number | null
  timestamp: string | null
}

type ArtifactWithTimestamp = {
  created_at?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseSummaryWarningInfo(debugInfo: unknown): SummaryWarningInfo | null {
  if (!isRecord(debugInfo) || !isRecord(debugInfo.summaryWarning)) {
    return null
  }

  const summaryWarning = debugInfo.summaryWarning
  const parsed: SummaryWarningInfo = {
    error:
      typeof summaryWarning.error === 'string' && summaryWarning.error.length > 0
        ? summaryWarning.error
        : null,
    attempts: parseFiniteNumber(summaryWarning.attempts),
    timestamp:
      typeof summaryWarning.timestamp === 'string' && summaryWarning.timestamp.length > 0
        ? summaryWarning.timestamp
        : null,
  }

  return parsed.error || parsed.attempts !== null || parsed.timestamp ? parsed : null
}

export function resolveVisibleSummaryWarning(
  summaryWarning: SummaryWarningInfo | null,
  artifacts: ArtifactWithTimestamp[],
): SummaryWarningInfo | null {
  if (!summaryWarning) {
    return null
  }

  const warningTimestamp = parseTimestamp(summaryWarning.timestamp)
  if (warningTimestamp === null) {
    return summaryWarning
  }

  let latestArtifactTimestamp: number | null = null

  for (const artifact of artifacts) {
    const parsed = parseTimestamp(artifact.created_at ?? null)
    if (parsed === null) {
      continue
    }

    latestArtifactTimestamp =
      latestArtifactTimestamp === null ? parsed : Math.max(latestArtifactTimestamp, parsed)
  }

  if (latestArtifactTimestamp !== null && latestArtifactTimestamp >= warningTimestamp) {
    return null
  }

  return summaryWarning
}
